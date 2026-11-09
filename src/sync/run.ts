import type { Db } from "../db/types";
import { Budget, BudgetExhausted, ClintClient } from "../clint/client";
import { getConfig, type Env } from "../config";
import { recomputeReplyState } from "../metrics/noReply";
import { syncChats } from "./chats";
import { syncContacts } from "./contacts";
import { reconcileDealsFull, syncDealsIncremental } from "./deals";
import { syncMessages } from "./messages";
import { syncMeta } from "./meta";
import { syncReference } from "./reference";
import { getState, setState } from "./state";
import { todaySP } from "../lib/time";

export interface RunOptions {
  now?: Date;
  budget?: number;
  /** epoch ms after which no new Clint call is started (runtime wall-clock limit) */
  deadline?: number;
}

function windowStart(env: Env, now: Date): string {
  return new Date(now.getTime() - getConfig(env).messageWindowDays * 86_400_000).toISOString();
}

async function recordError(db: Db, e: unknown) {
  await setState(db, "last_error", JSON.stringify({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) }));
}

/** One incremental sync run (every 30 minutes on Supabase). Data already stored is never wiped on failure. */
export async function runIncremental(env: Env, opts: RunOptions = {}): Promise<{ complete: boolean; calls: number }> {
  const now = opts.now ?? new Date();
  const budget = new Budget(opts.budget ?? 800, opts.deadline);
  const client = new ClintClient(env.CLINT_API_TOKEN, budget);
  const db = env.DB;
  const start = windowStart(env, now);
  try {
    await syncReference(client, db);
    await syncDealsIncremental(client, db);
    await syncContacts(client, db, { full: false });
    await syncChats(client, db, start);
    await syncMessages(client, db, start);
    await recomputeReplyState(db);
    // Meta Ads data is independent of Clint: its own hourly schedule and error state.
    await syncMeta(env, now, () => budget.used++);
    const pending = await db
      .prepare("SELECT COUNT(*) AS n FROM chats WHERE last_message_at >= ? AND (messages_synced_until IS NULL OR last_message_at > messages_synced_until)")
      .bind(start)
      .first<{ n: number }>();
    await setState(db, "last_success_at", now.toISOString());
    await setState(db, "last_error", null);
    return { complete: (pending?.n ?? 0) === 0, calls: budget.used };
  } catch (e) {
    if (e instanceof BudgetExhausted) {
      // Partial progress is kept; the next run continues where this one stopped.
      await recomputeReplyState(db);
      await setState(db, "last_success_at", now.toISOString());
      await setState(db, "last_error", null);
      return { complete: false, calls: budget.used };
    }
    await recordError(db, e);
    throw e;
  }
}

interface NightlyState {
  day: string;
  runStart: string;
  step: "deals" | "contacts" | "done";
  page: number;
}

/**
 * Nightly reconcile (03:00 São Paulo): deleted deals, contact fields, message window and login attempts.
 * Runs in slices: each call continues where the previous one stopped (state `nightly`) until the
 * deadline, so it fits runtimes with a short wall-clock limit. Returns true once the day's pass is done.
 */
export async function runNightly(env: Env, opts: RunOptions = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const client = new ClintClient(env.CLINT_API_TOKEN, new Budget(opts.budget ?? Number.POSITIVE_INFINITY, opts.deadline));
  const db = env.DB;
  const day = todaySP(now);
  const raw = await getState(db, "nightly");
  let st: NightlyState = raw ? JSON.parse(raw) : { day: "", runStart: "", step: "done", page: 1 };
  if (st.day !== day) st = { day, runStart: now.toISOString(), step: "deals", page: 1 };
  if (st.step === "done") return true;
  const save = () => setState(db, "nightly", JSON.stringify(st));
  try {
    if (st.step === "deals") {
      // Resume one page early: deletions between slices shift the pages back.
      await reconcileDealsFull(client, db, {
        runStart: st.runStart,
        fromPage: Math.max(1, st.page - 1),
        onPage: async (p) => {
          st.page = p;
          await save();
        },
      });
      st = { ...st, step: "contacts", page: 1 };
      await save();
    }
    if (st.step === "contacts") {
      await syncContacts(client, db, {
        full: true,
        fromPage: Math.max(1, st.page - 1),
        onPage: async (p) => {
          st.page = p;
          await save();
        },
      });
      await db.prepare("DELETE FROM messages WHERE created_at < ?").bind(windowStart(env, now)).run();
      await recomputeReplyState(db);
      st = { ...st, step: "done" };
      await save();
    }
    return true;
  } catch (e) {
    if (e instanceof BudgetExhausted) return false;
    await recordError(db, e);
    throw e;
  }
}
