import { useEffect, useState } from "preact/hooks";
import { openChat } from "../chat/ChatViewer";
import { fmtDateTime, fmtInt, fmtPhone } from "../format";
import { filterParams, useApi, useQuery } from "../hooks";
import { DataTable, type Column } from "./DataTable";
import { Async } from "./ui";

export type LeadKind = "all" | "contacted" | "not_contacted" | "replied" | "not_replied" | "stalled";

interface Lead {
  deal_id: string;
  contact_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  group: string;
  status: string;
  origin: string | null;
  stage: string | null;
  responsible: string | null;
  created_at: string;
  first_contact_hours: number | null;
  replied: boolean;
  days_inactive: number;
  clint_url: string | null;
}
interface Resp {
  stalled_days: number;
  counts: Record<LeadKind, number>;
  items: Lead[];
}

const STATUS_LABEL: Record<string, string> = { OPEN: "Aberto", WON: "Ganho", LOST: "Perdido" };

function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

function downloadCsv(name: string, rows: Lead[]) {
  const head = ["Nome", "E-mail", "Telefone", "Campanha/grupo", "Status", "Origem", "Etapa", "Responsável", "Entrou em", "1º contato (h)", "Respondeu", "Dias sem atividade", "Link do negócio"];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) =>
    [
      r.name,
      r.email,
      r.phone,
      r.group,
      STATUS_LABEL[r.status] ?? r.status,
      r.origin,
      r.stage,
      r.responsible,
      fmtDateTime(r.created_at),
      r.first_contact_hours === null ? "" : r.first_contact_hours.toFixed(1).replace(".", ","),
      r.replied ? "sim" : "não",
      r.days_inactive,
      r.clint_url,
    ]
      .map(esc)
      .join(";"),
  );
  const blob = new Blob([`﻿${[head.map(esc).join(";"), ...body].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leads-${name.replace(/[^\w-]+/g, "-").slice(0, 60)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The leads behind a UTM number, with tabs to switch between all / contacted / replied / stalled. */
export function LeadsModal(props: { dim: string; groupKey: string | null; label: string; initialKind: LeadKind; onClose: () => void }) {
  const q = useQuery();
  const [kind, setKind] = useState<LeadKind>(props.initialKind);
  const extra: Record<string, string> = { dim: props.dim, kind };
  if (props.groupKey !== null) extra.key = props.groupKey;
  const state = useApi<Resp>("/metrics/utm-leads", filterParams(q, extra));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const stalledDays = state.data?.stalled_days ?? 7;
  const tabs: { key: LeadKind; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "contacted", label: "Atendidos" },
    { key: "not_contacted", label: "Não atendidos" },
    { key: "replied", label: "Responderam" },
    { key: "not_replied", label: "Não responderam" },
    { key: "stalled", label: `Parados +${stalledDays}d` },
  ];

  const columns: Column<Lead>[] = [
    {
      key: "name",
      label: "Nome",
      sortValue: (r) => r.name ?? "",
      render: (r) => (
        <span class="strong clip" title={r.name ?? ""}>
          {r.name ?? "—"}
        </span>
      ),
    },
    {
      key: "phone",
      label: "Telefone",
      render: (r) =>
        r.phone ? (
          <a href={`https://wa.me/${r.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp">
            {fmtPhone(r.phone)}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "email",
      label: "E-mail",
      sortValue: (r) => r.email ?? "",
      render: (r) =>
        r.email ? (
          <a class="clip" href={`mailto:${r.email}`} title={r.email}>
            {r.email}
          </a>
        ) : (
          "—"
        ),
    },
  ];
  if (props.groupKey === null) {
    columns.push({ key: "group", label: "Campanha", sortValue: (r) => r.group, render: (r) => <span class="clip" title={r.group}>{r.group}</span> });
  }
  columns.push(
    { key: "created", label: "Entrou", sortValue: (r) => r.created_at, render: (r) => fmtDateTime(r.created_at) },
    {
      key: "first",
      label: "1º contato",
      num: true,
      sortValue: (r) => r.first_contact_hours ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (r.first_contact_hours === null ? <span class="tag-pill bad">não atendido</span> : fmtHours(r.first_contact_hours)),
    },
    { key: "replied", label: "Respondeu", sortValue: (r) => (r.replied ? 1 : 0), render: (r) => (r.replied ? <span class="tone-ok">sim</span> : "não") },
  );
  if (kind === "stalled") {
    columns.push({
      key: "days",
      label: "Parado há",
      num: true,
      sortValue: (r) => r.days_inactive,
      render: (r) => <span class={`tag-pill ${r.days_inactive > 30 ? "bad" : "warn"}`}>{fmtInt(r.days_inactive)} d</span>,
    });
  } else {
    columns.push({ key: "status", label: "Status", sortValue: (r) => r.status, render: (r) => STATUS_LABEL[r.status] ?? r.status });
  }
  columns.push(
    { key: "resp", label: "Responsável", sortValue: (r) => r.responsible ?? "", render: (r) => r.responsible ?? "Sem responsável" },
    {
      key: "link",
      label: "Negócio",
      render: (r) => (
        <span class="row-actions">
          {r.clint_url ? (
            <a class="btn small" href={r.clint_url} target="_blank" rel="noopener noreferrer">
              Abrir ↗
            </a>
          ) : (
            <span class="btn small" aria-disabled="true" title="Link da Clint ainda não configurado (CLINT_DEAL_URL_TEMPLATE)">
              Link pendente
            </span>
          )}
          {r.contact_id && (
            <button class="btn small" onClick={() => openChat(r.contact_id!)}>
              Conversa
            </button>
          )}
        </span>
      ),
    },
  );

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal card" role="dialog" aria-modal="true" aria-label="Leads" onClick={(e) => e.stopPropagation()}>
        <div class="card-head">
          <div class="titles">
            <h2>
              {tabs.find((t) => t.key === kind)?.label} {state.data ? `· ${fmtInt(state.data.items.length)} leads` : ""}
            </h2>
            <p class="sub">{props.label} · negócios criados no período, com os filtros da tela</p>
          </div>
          {state.data && state.data.items.length > 0 && (
            <button class="btn small" onClick={() => downloadCsv(`${props.label}-${kind}`, state.data!.items)}>
              Baixar CSV
            </button>
          )}
          <button class="btn small" onClick={props.onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div class="toolbar">
          {tabs.map((t) => (
            <button class={`btn small ${t.key === kind ? "active" : ""}`} onClick={() => setKind(t.key)}>
              {t.label}
              {state.data && <span class="muted"> {fmtInt(state.data.counts[t.key])}</span>}
            </button>
          ))}
        </div>
        <Async state={state} empty={(d) => d.items.length === 0}>
          {(d) => (
            <>
              <DataTable
                scroll
                rows={d.items}
                rowKey={(r) => r.deal_id}
                initialSort={kind === "stalled" ? { key: "days", dir: "desc" } : { key: "created", dir: "desc" }}
                columns={columns}
              />
              {!d.items.some((r) => r.clint_url) && (
                <p class="note">
                  "Abrir" fica ativo quando o endereço dos negócios na Clint for configurado. Enquanto isso, "Conversa" abre o histórico do lead aqui no
                  dash. Telefone abre o WhatsApp.
                </p>
              )}
            </>
          )}
        </Async>
      </div>
    </div>
  );
}
