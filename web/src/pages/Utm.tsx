import type { Meta } from "../api";
import { ChartView, PALETTE, TONES } from "../components/Chart";
import { DataTable } from "../components/DataTable";
import { Async, Card, Kpi, Note, Source } from "../components/ui";
import { fmtDay, fmtInt, fmtPct } from "../format";
import { useState } from "preact/hooks";
import { PillSelect } from "../components/FilterBar";
import { LeadsModal, type LeadKind } from "../components/LeadsModal";
import { filterParams, setQuery, useApi, useQuery } from "../hooks";

interface Row {
  key: string;
  leads: number;
  contacted: number;
  replied: number;
  open: number;
  won: number;
  lost: number;
  stalled: number;
  median_first_contact_hours: number | null;
  top_lost_reason: string | null;
  ads: { spend: number; meta_leads: number; impressions: number; clicks: number; crm_leads: number; crm_won: number } | null;
}
interface Resp {
  dim: string;
  rows: Row[];
  days: string[];
  series: { key: string; per_day: number[] }[];
  stalled_days: number;
  contact_data_partial: boolean;
  ads_available: boolean;
  meta: Meta;
}

const DIMS = [
  { key: "campaign", label: "Campanha", hint: "Meta Ads" },
  { key: "ad", label: "Anúncio", hint: "Meta Ads" },
  { key: "form", label: "Formulário", hint: "Meta Ads" },
  { key: "utm_source", label: "utm_source" },
  { key: "utm_medium", label: "utm_medium" },
  { key: "utm_campaign", label: "utm_campaign" },
  { key: "utm_content", label: "utm_content" },
];
const NO_CAMPAIGN = "Sem campanha / Orgânico";

const pct = (a: number, b: number) => (b ? fmtPct(a / b) : "—");
function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}
const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n >= 1000 ? 0 : 2 });
const money = (num: number, den: number) => (den > 0 ? fmtBRL(num / den) : "—");
const shortKey = (k: string) => (k.length > 48 ? `${k.slice(0, 46)}…` : k);

export function Utm() {
  const q = useQuery();
  const dim = q.get("dim") ?? "campaign";
  const dimLabel = DIMS.find((d) => d.key === dim)?.label ?? "Campanha";
  const state = useApi<Resp>("/metrics/utm", filterParams(q, { dim }));
  const noneLabel = dim.startsWith("utm_") ? `Sem ${dim}` : NO_CAMPAIGN;
  const label = (k: string) => (k === NO_CAMPAIGN ? noneLabel : k);

  // Clicking a campaign row applies the global campaign filter to the whole dashboard.
  const selected = (q.get("campaigns") ?? "").split("\n").filter(Boolean);
  const [leadsOf, setLeadsOf] = useState<{ key: string | null; kind: LeadKind } | null>(null);
  const toggleCampaign = (k: string) =>
    setQuery({ campaigns: (selected.includes(k) ? selected.filter((c) => c !== k) : [...selected, k]).join("\n") });

  return (
    <>
      <div class="filters" style="padding-top:12px">
        <PillSelect label="Agrupar por" value={dim} options={DIMS} onChange={(k) => setQuery({ dim: k === "campaign" ? null : k })} />
      </div>
      <Async state={state}>
        {(d) => {
          const t = d.rows.reduce(
            (s, r) => ({
              leads: s.leads + r.leads,
              contacted: s.contacted + r.contacted,
              replied: s.replied + r.replied,
              won: s.won + r.won,
              lost: s.lost + r.lost,
              stalled: s.stalled + r.stalled,
            }),
            { leads: 0, contacted: 0, replied: 0, won: 0, lost: 0, stalled: 0 },
          );
          const adRows = d.rows.filter((r) => r.ads);
          const ads = {
            spend: adRows.reduce((s, r) => s + r.ads!.spend, 0),
            metaLeads: adRows.reduce((s, r) => s + r.ads!.meta_leads, 0),
            crmLeads: adRows.reduce((s, r) => s + r.ads!.crm_leads, 0),
            crmWon: adRows.reduce((s, r) => s + r.ads!.crm_won, 0),
          };
          const best = [...d.rows].filter((r) => r.key !== NO_CAMPAIGN && r.leads >= 5 && r.won > 0).sort((a, b) => b.won / b.leads - a.won / a.leads)[0];
          const top = d.rows.slice(0, 10);
          return (
            <div class="grid">
              {d.contact_data_partial && (
                <div class="banner warn span-12" style="margin:0">
                  Atendimento e resposta só existem para os últimos 90 dias (histórico de mensagens); leads mais antigos aparecem como não atendidos.
                </div>
              )}
              {d.ads_available && (
                <>
                  <Kpi
                    span={4}
                    label="Investimento"
                    value={fmtBRL(ads.spend)}
                    tone="accent"
                    desc={`Gasto no Meta Ads no período · ${fmtInt(ads.metaLeads)} leads no formulário · ${money(ads.spend, ads.metaLeads)} por lead no Meta.`}
                  />
                  <Kpi
                    span={4}
                    label="Custo por lead no CRM"
                    value={money(ads.spend, ads.crmLeads)}
                    desc={`${fmtInt(ads.crmLeads)} desses leads chegaram na Clint (${pct(ads.crmLeads, ads.metaLeads)} do que o Meta registrou).`}
                  />
                  <Kpi
                    span={4}
                    label="Custo por venda"
                    value={money(ads.spend, ads.crmWon)}
                    tone={ads.crmWon ? "ok" : "warn"}
                    desc={ads.crmWon ? `${fmtInt(ads.crmWon)} vendas (status ganho) vindas das campanhas pagas.` : "Nenhuma venda (status ganho) das campanhas pagas no período."}
                  />
                </>
              )}
              <Kpi onClick={() => setLeadsOf({ key: null, kind: "all" })} label="Leads" value={fmtInt(t.leads)} tone="accent" desc={`Negócios criados no período, em ${d.rows.length} ${dimLabel.toLowerCase()}(s).`} />
              <Kpi onClick={() => setLeadsOf({ key: null, kind: "contacted" })} label="Atendidos" value={pct(t.contacted, t.leads)} tone="ok" desc={`${fmtInt(t.contacted)} leads receberam mensagem de um vendedor depois de entrar.`} />
              <Kpi onClick={() => setLeadsOf({ key: null, kind: "replied" })} label="Responderam" value={pct(t.replied, t.leads)} tone="warn" desc={`${fmtInt(t.replied)} leads escreveram na conversa depois de entrar.`} />
              <Kpi
                label="Ganhos"
                value={pct(t.won, t.leads)}
                tone="ok"
                desc={best ? `${fmtInt(t.won)} vendas · melhor taxa: ${shortKey(label(best.key))} (${pct(best.won, best.leads)}).` : `${fmtInt(t.won)} vendas.`}
              />

              <Card title={`Leads por dia · 5 maiores (${dimLabel.toLowerCase()})`} sub="Quando cada fonte trouxe leads no período">
                <ChartView
                  config={{
                    type: "line",
                    data: {
                      labels: d.days.map(fmtDay),
                      datasets: d.series.map((s, i) => ({
                        label: shortKey(label(s.key)),
                        data: s.per_day,
                        borderColor: PALETTE[i % PALETTE.length],
                        backgroundColor: PALETTE[i % PALETTE.length],
                        pointRadius: 2,
                        tension: 0.3,
                      })),
                    },
                    options: { plugins: { tooltip: { mode: "index", intersect: false } }, scales: { y: { beginAtZero: true } } },
                  }}
                />
              </Card>

              <Card title="Do lead à venda" sub={`Funil dentro do CRM · ${top.length} maiores por número de leads`}>
                <ChartView
                  tall={top.length > 5}
                  config={{
                    type: "bar",
                    data: {
                      labels: top.map((r) => shortKey(label(r.key))),
                      datasets: [
                        { label: "Leads", data: top.map((r) => r.leads), backgroundColor: TONES.accent },
                        { label: "Atendidos", data: top.map((r) => r.contacted), backgroundColor: "#cfaca3" },
                        { label: "Responderam", data: top.map((r) => r.replied), backgroundColor: TONES.warn },
                        { label: "Ganhos", data: top.map((r) => r.won), backgroundColor: TONES.ok },
                        { label: "Perdidos", data: top.map((r) => r.lost), backgroundColor: TONES.bad },
                      ],
                    },
                    options: { indexAxis: "y", plugins: { tooltip: { mode: "index", intersect: false } }, scales: { x: { beginAtZero: true } } },
                  }}
                />
                <Note>
                  Para cada {dimLabel.toLowerCase()}: quantos leads entraram, quantos receberam mensagem de um vendedor, quantos responderam e quantos
                  viraram <span class="tone-ok">ganho</span> ou <span class="tone-bad">perda</span>. Muito lead e pouco atendimento indica fila; muito
                  atendimento e pouca resposta indica lead frio.
                </Note>
              </Card>

              <Card
                title={`Performance por ${dimLabel.toLowerCase()}`}
                sub={dim === "campaign" ? "Clique em uma campanha para filtrar o dash inteiro por ela" : "Ordenável por qualquer coluna"}
              >
                <DataTable
                  scroll
                  rows={d.rows}
                  rowKey={(r) => r.key}
                  onRow={dim === "campaign" ? (r) => toggleCampaign(r.key) : undefined}
                  initialSort={{ key: "leads", dir: "desc" }}
                  columns={[
                    {
                      key: "key",
                      label: dimLabel,
                      sortValue: (r) => r.key,
                      render: (r) => (
                        <span class="strong" title={r.key}>
                          {selected.includes(r.key) ? "✓ " : ""}
                          {shortKey(label(r.key))}
                        </span>
                      ),
                    },
                    { key: "leads", label: "Leads", num: true, sortValue: (r) => r.leads, render: (r) => fmtInt(r.leads) },
                    ...(d.ads_available
                      ? [
                          {
                            key: "spend",
                            label: "Investimento",
                            num: true,
                            sortValue: (r: Row) => r.ads?.spend ?? -1,
                            render: (r: Row) => (r.ads ? fmtBRL(r.ads.spend) : "—"),
                          },
                          {
                            key: "meta_leads",
                            label: "Leads Meta",
                            num: true,
                            sortValue: (r: Row) => r.ads?.meta_leads ?? -1,
                            render: (r: Row) =>
                              r.ads ? (
                                <span title={`${fmtInt(r.ads.crm_leads)} chegaram na Clint`}>
                                  {fmtInt(r.ads.meta_leads)} <span class="muted">({pct(r.ads.crm_leads, r.ads.meta_leads)} na Clint)</span>
                                </span>
                              ) : (
                                "—"
                              ),
                          },
                          {
                            key: "cpl",
                            label: "Custo/lead",
                            num: true,
                            sortValue: (r: Row) => (r.ads && r.ads.crm_leads ? r.ads.spend / r.ads.crm_leads : Number.MAX_SAFE_INTEGER),
                            render: (r: Row) => (r.ads ? money(r.ads.spend, r.ads.crm_leads) : "—"),
                          },
                          {
                            key: "cps",
                            label: "Custo/venda",
                            num: true,
                            sortValue: (r: Row) => (r.ads && r.ads.crm_won ? r.ads.spend / r.ads.crm_won : Number.MAX_SAFE_INTEGER),
                            render: (r: Row) => (r.ads ? money(r.ads.spend, r.ads.crm_won) : "—"),
                          },
                        ]
                      : []),
                    { key: "contacted", label: "Atendidos", num: true, sortValue: (r) => r.contacted / r.leads, render: (r) => pct(r.contacted, r.leads) },
                    { key: "replied", label: "Responderam", num: true, sortValue: (r) => r.replied / r.leads, render: (r) => pct(r.replied, r.leads) },
                    {
                      key: "first",
                      label: "1º contato",
                      num: true,
                      sortValue: (r) => r.median_first_contact_hours ?? Number.MAX_SAFE_INTEGER,
                      render: (r) => fmtHours(r.median_first_contact_hours),
                    },
                    { key: "open", label: "Abertos", num: true, sortValue: (r) => r.open, render: (r) => fmtInt(r.open) },
                    {
                      key: "stalled",
                      label: `Parados +${d.stalled_days}d`,
                      num: true,
                      sortValue: (r) => r.stalled,
                      render: (r) =>
                        r.stalled ? (
                          <button
                            class="pill-link"
                            title="Ver quem são os leads parados"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLeadsOf({ key: r.key, kind: "stalled" });
                            }}
                          >
                            <span class="tag-pill warn">{fmtInt(r.stalled)}</span>
                          </button>
                        ) : (
                          "0"
                        ),
                    },
                    { key: "won", label: "Ganhos", num: true, sortValue: (r) => r.won, render: (r) => <span class="tone-ok">{fmtInt(r.won)}</span> },
                    { key: "lost", label: "Perdidos", num: true, sortValue: (r) => r.lost, render: (r) => fmtInt(r.lost) },
                    { key: "rate", label: "% ganho", num: true, sortValue: (r) => r.won / r.leads, render: (r) => pct(r.won, r.leads) },
                    { key: "reason", label: "Principal motivo de perda", sortValue: (r) => r.top_lost_reason ?? "", render: (r) => r.top_lost_reason ?? "—" },
                  ]}
                />
                <Note>
                  <b>1º contato</b> = mediana do tempo entre o lead entrar na Clint e a primeira mensagem de um vendedor (horas corridas).{" "}
                  <b>Parados</b> = abertos sem mensagem nem mudança de etapa há mais de {d.stalled_days} dias — clique no número para ver quem são.
                  {d.ads_available && (
                    <>
                      {" "}
                      <b>Investimento</b> e <b>Leads Meta</b> vêm do Meta Ads e não mudam com os filtros de origem, vendedor ou status;{" "}
                      <b>custo/lead</b> e <b>custo/venda</b> usam todos os leads e vendas da campanha na Clint, qualquer que seja o status.
                    </>
                  )}
                </Note>
              </Card>

              <Source>
                <p>
                  Campanha, anúncio e formulário vêm do formulário do <b>Meta Lead Ads</b> gravado em cada negócio da Clint; <code>utm_*</code> vêm dos
                  campos de mesmo nome quando a página de captura os envia. Atendimento, resposta e 1º contato vêm das conversas de WhatsApp e
                  Instagram da Clint (últimos 90 dias). Ganho e perda são o status da Clint; o motivo é o "motivo de perda" marcado no negócio.
                </p>
                <p>
                  Investimento, impressões, cliques e leads do formulário vêm da <b>API de Marketing do Meta</b> (somente leitura), por anúncio e por dia,
                  atualizados a cada hora. O cruzamento com a Clint é pelo ID da campanha e do anúncio gravado em cada negócio.
                </p>
              </Source>
            </div>
          );
        }}
      </Async>
      {leadsOf && (
        <LeadsModal
          dim={dim}
          groupKey={leadsOf.key}
          label={leadsOf.key === null ? `Todas as ${dimLabel.toLowerCase()}s` : label(leadsOf.key)}
          initialKind={leadsOf.kind}
          onClose={() => setLeadsOf(null)}
        />
      )}
    </>
  );
}
