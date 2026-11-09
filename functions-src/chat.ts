/// <reference path="./deno.d.ts" />
// Supabase Edge Function `chat`: read-only live proxy to the Clint conversation API for the dash's
// chat viewer (message content is never stored). The page sends the link key in x-dash-key.
import { ClintClient } from "../src/clint/client";

const env = (name: string) => Deno.env.get(name) ?? "";
const ID = /^[\w-]{1,64}$/;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-dash-key, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env("SNAPSHOT_KEY") || req.headers.get("x-dash-key") !== env("SNAPSHOT_KEY")) return new Response("forbidden", { status: 403, headers: cors });
  const q = new URL(req.url).searchParams;
  const client = new ClintClient(env("CLINT_API_TOKEN"));
  try {
    const contact = q.get("contact");
    const chat = q.get("chat");
    if (contact && ID.test(contact)) return Response.json(await client.listChatsByContact(contact), { headers: cors });
    if (chat && ID.test(chat)) {
      const page = Math.max(1, Math.min(500, Number(q.get("page") ?? 1) || 1));
      return Response.json(await client.getMessagesPage(chat, page, 50), { headers: cors });
    }
    return Response.json({ error: "bad_request" }, { status: 400, headers: cors });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: cors });
  }
});
