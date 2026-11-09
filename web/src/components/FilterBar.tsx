import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { setQuery, useQuery } from "../hooks";

export interface FilterOptions {
  groups: { id: string; name: string }[];
  origins: { id: string; name: string; group_id: string | null; archived: boolean; deals: number; open: number }[];
  users: { id: string; name: string; active: boolean }[];
  campaigns: { name: string; deals: number }[];
}

const TZ = "America/Sao_Paulo";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const minusDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);
export const DEFAULT_STATUS = "OPEN";
export const STATUS_OPTIONS = [
  { key: "OPEN", label: "Aberto", color: "var(--act-strong)" },
  { key: "WON", label: "Ganho", color: "var(--ok)" },
  { key: "LOST", label: "Perdido", color: "var(--bad)" },
];
const fmt = (n: number) => n.toLocaleString("pt-BR");
const shorten = (s: string) => (s.length > 34 ? `${s.slice(0, 32)}…` : s);

function OriginCount({ o }: { o: { deals: number; open: number } }) {
  return (
    <span class="opt-count" title={`${fmt(o.deals)} negócios criados no período · ${fmt(o.open)} em aberto hoje`}>
      {fmt(o.deals)}
      <span class="tag"> · {fmt(o.open)} abertos</span>
    </span>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return { open, setOpen, ref };
}

const Chevron = () => <span class="dim">▾</span>;

/** Period: two date inputs and quick chips (reference layout); the selection lives in the URL. */
export function PeriodPicker({ summary }: { summary?: ComponentChildren }) {
  const q = useQuery();
  const t = today();
  const to = q.get("to") ?? t;
  const from = q.get("from") ?? minusDays(t, 29);
  const presets: { label: string; from: string; to: string }[] = [
    { label: "Hoje", from: t, to: t },
    { label: "Ontem", from: minusDays(t, 1), to: minusDays(t, 1) },
    { label: "7 dias", from: minusDays(t, 6), to: t },
    { label: "30 dias", from: minusDays(t, 29), to: t },
    { label: "90 dias", from: minusDays(t, 89), to: t },
    { label: "Esse mês", from: `${t.slice(0, 8)}01`, to: t },
  ];
  const apply = (f: string, tt: string) => setQuery({ from: f, to: tt, page: null });
  return (
    <>
      <span class="lbl">Período</span>
      <input type="date" class="dinput" value={from} max={to} onChange={(e) => apply((e.target as HTMLInputElement).value, to)} />
      <span class="sep">→</span>
      <input type="date" class="dinput" value={to} min={from} onChange={(e) => apply(from, (e.target as HTMLInputElement).value)} />
      <div class="chips">
        {presets.map((p) => (
          <button class={`qchip ${p.from === from && p.to === to ? "on" : ""}`} onClick={() => apply(p.from, p.to)}>
            {p.label}
          </button>
        ))}
      </div>
      {summary && <div class="periodsum">{summary}</div>}
    </>
  );
}

function Dropdown(props: { summary: string; active: boolean; children: ComponentChildren }) {
  const pop = usePopover();
  return (
    <div class="multi" ref={pop.ref}>
      <button type="button" class={`pill-btn ${props.active ? "primary" : ""}`} onClick={() => pop.setOpen(!pop.open)}>
        {props.summary} <Chevron />
      </button>
      {pop.open && <div class="panel">{props.children}</div>}
    </div>
  );
}

/** "FILTROS" row: origin (or whole group) and seller multi-selects, synced to the URL. */
export function FilterBar({ options, children }: { options: FilterOptions | null; children?: ComponentChildren }) {
  const q = useQuery();
  const originIds = csv(q.get("origin_ids"));
  const groupIds = csv(q.get("group_ids"));
  const userIds = csv(q.get("user_ids"));
  // One status at a time; "Aberto" is the default when the URL has none.
  const status = q.get("status") ?? DEFAULT_STATUS;
  // Campaign names may contain commas, so they are newline-separated in the URL.
  const campaigns = (q.get("campaigns") ?? "").split("\n").filter(Boolean);
  const toggleCampaign = (name: string) =>
    setQuery({ campaigns: (campaigns.includes(name) ? campaigns.filter((c) => c !== name) : [...campaigns, name]).join("\n"), page: null });
  const campaignSummary = campaigns.length === 0 ? "Campanha" : campaigns.length === 1 ? shorten(campaigns[0]) : `${campaigns.length} campanhas`;
  const pickStatus = (key: string) => setQuery({ status: key === DEFAULT_STATUS ? null : key, page: null });
  const toggle = (key: "origin_ids" | "group_ids" | "user_ids", list: string[], id: string) =>
    setQuery({ [key]: (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]).join(","), page: null });

  const nOrigins = originIds.length + groupIds.length;
  const originSummary =
    nOrigins === 0
      ? "Origem"
      : nOrigins === 1
        ? (options?.groups.find((x) => x.id === groupIds[0])?.name ?? options?.origins.find((x) => x.id === originIds[0])?.name ?? "Origem")
        : `${nOrigins} origens`;
  const userSummary =
    userIds.length === 0
      ? "Vendedor"
      : userIds.length === 1
        ? userIds[0] === "none"
          ? "Sem responsável"
          : (options?.users.find((x) => x.id === userIds[0])?.name ?? "Vendedor")
        : `${userIds.length} vendedores`;

  const groups = options?.groups ?? [];
  const ungrouped = options?.origins.filter((o) => !o.group_id) ?? [];

  return (
    <div class="filters">
      <span class="mono-label">Filtros</span>
      <Dropdown summary={originSummary} active={nOrigins > 0}>
        {groups.map((g) => (
          <div key={g.id}>
            <label class="opt group">
              <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle("group_ids", groupIds, g.id)} />
              <span class="opt-name">
                {g.name} <span class="tag">grupo inteiro</span>
              </span>
              <span class="opt-count">{fmt(options!.origins.filter((o) => o.group_id === g.id).reduce((s, o) => s + o.deals, 0))}</span>
            </label>
            {options!.origins
              .filter((o) => o.group_id === g.id)
              .map((o) => (
                <label class="opt indent" key={o.id}>
                  <input type="checkbox" checked={originIds.includes(o.id)} onChange={() => toggle("origin_ids", originIds, o.id)} />
                  <span class="opt-name">
                    {o.name} {o.archived && <span class="tag">(arquivada)</span>}
                  </span>
                  <OriginCount o={o} />
                </label>
              ))}
          </div>
        ))}
        {ungrouped.map((o) => (
          <label class="opt" key={o.id}>
            <input type="checkbox" checked={originIds.includes(o.id)} onChange={() => toggle("origin_ids", originIds, o.id)} />
            <span class="opt-name">
              {o.name} {o.archived && <span class="tag">(arquivada)</span>}
            </span>
            <OriginCount o={o} />
          </label>
        ))}
      </Dropdown>
      <Dropdown summary={userSummary} active={userIds.length > 0}>
        {(options?.users ?? []).map((u) => (
          <label class="opt" key={u.id}>
            <input type="checkbox" checked={userIds.includes(u.id)} onChange={() => toggle("user_ids", userIds, u.id)} />
            {u.name} {!u.active && <span class="tag">(inativo)</span>}
          </label>
        ))}
        <label class="opt">
          <input type="checkbox" checked={userIds.includes("none")} onChange={() => toggle("user_ids", userIds, "none")} />
          Sem responsável
        </label>
      </Dropdown>
      <Dropdown summary={campaignSummary} active={campaigns.length > 0}>
        <div class="opt-head">Negócios criados no período por campanha</div>
        {(options?.campaigns ?? []).map((c) => (
          <label class="opt" key={c.name}>
            <input type="checkbox" checked={campaigns.includes(c.name)} onChange={() => toggleCampaign(c.name)} />
            <span class="opt-name">{c.name}</span>
            <span class="opt-count">{fmt(c.deals)}</span>
          </label>
        ))}
        {options && options.campaigns.length === 0 && <div class="opt muted">Nenhuma campanha no período.</div>}
      </Dropdown>
      <span class="mono-label" style="margin-left:8px">Status</span>
      {STATUS_OPTIONS.map((s) => (
        <label class={`check-pill ${status === s.key ? "on" : ""}`} key={s.key}>
          <input type="radio" name="deal-status" checked={status === s.key} onChange={() => pickStatus(s.key)} />
          <span class="dot" style={{ background: s.color }} />
          {s.label}
        </label>
      ))}
      {children}
      {(nOrigins > 0 || userIds.length > 0 || status !== DEFAULT_STATUS || campaigns.length > 0) && (
        <button class="btn small" onClick={() => setQuery({ origin_ids: null, group_ids: null, user_ids: null, status: null, campaigns: null, page: null })}>
          Limpar
        </button>
      )}
    </div>
  );
}

/** Single-choice pill dropdown ("Agrupar por: Campanha ▾"). */
export function PillSelect(props: { label: string; value: string; options: { key: string; label: string; hint?: string }[]; onChange: (key: string) => void }) {
  const pop = usePopover();
  const current = props.options.find((o) => o.key === props.value) ?? props.options[0];
  return (
    <div class="multi" ref={pop.ref}>
      <button type="button" class="pill-btn primary" onClick={() => pop.setOpen(!pop.open)}>
        <span class="dim">{props.label}:</span> {current.label} <Chevron />
      </button>
      {pop.open && (
        <div class="panel">
          {props.options.map((o) => (
            <label class="opt" key={o.key}>
              <input
                type="radio"
                name={`pill-${props.label}`}
                checked={o.key === current.key}
                onChange={() => {
                  props.onChange(o.key);
                  pop.setOpen(false);
                }}
              />
              <span class="opt-name">{o.label}</span>
              {o.hint && <span class="opt-count">{o.hint}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
