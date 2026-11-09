import type { Meta } from "../api";
import { openChat } from "../chat/ChatViewer";
import { TONES } from "../components/Chart";
import { DataTable } from "../components/DataTable";
import { Async, BarList, Card, Kpi, Note, Source } from "../components/ui";
import { fmtInt, fmtPct } from "../format";
import { filterParams, setQuery, useApi, useQuery } from "../hooks";

interface Item {
  deal_id: string;
  contact_id: string | null;
  contact_name: string | null;
  origin: string | null;
  stage: string | null;
  responsible: string | null;
  days_inactive: number;
  days_in_stage: number;
}
interface Resp {
  buckets: { label: string; count: number }[];
  total: number;
  page: number;
  page_size: number;
  items: Item[];
  meta: Meta;
}

const BUCKET_COLORS = ["#e3c9b9", "#d1b183", "#a77e62", "#ba938c", "#7c5424"];

export function Parados() {
  const q = useQuery();
  const sort = q.get("sort") === "stage" ? "stage" : "inactive";
  const page = Number(q.get("page") ?? 1) || 1;
  const state = useApi<Resp>("/metrics/stalled", filterParams(q, { sort, page: String(page), page_size: "50" }));
  return (
    <Async state={state}>
      {(d) => {
        const pages = Math.max(1, Math.ceil(d.total / d.page_size));
        const [b0, b1, b2, b3, b4] = d.buckets.map((b) => b.count);
        return (
          <div class="grid">
            <Kpi label="Negócios em aberto" value={fmtInt(d.total)} tone="accent" desc="Todos os negócios com status aberto nas origens filtradas." />
            <Kpi label="Ativos (até 3 dias)" value={fmtInt(b0)} tone="ok" desc="Tiveram mensagem ou mudança de etapa nos últimos 3 dias." />
            <Kpi label="4 a 30 dias" value={fmtInt(b1 + b2 + b3)} tone="warn" desc="Esfriando: vale um follow-up." />
            <Kpi label="Mais de 30 dias" value={fmtInt(b4)} tone="bad" desc={`${d.total ? fmtPct(b4 / d.total) : "—"} do total — candidatos a fechar ou arquivar.`} />

            <Card title="Dias sem atividade" sub="Atividade = mudança de etapa ou mensagem trocada com o lead, o que for mais recente">
              <BarList
                items={d.buckets.map((b, i) => ({
                  key: b.label,
                  label: `${b.label} dias`,
                  value: b.count,
                  aux: d.total ? fmtPct(b.count / d.total) : "",
                  color: BUCKET_COLORS[i],
                }))}
              />
              <Note>
                Barra proporcional à maior faixa. Muitos negócios na faixa <span class="tone-bad">30+</span> costumam ser funis antigos que nunca
                foram fechados na Clint — fechar ou arquivar esses funis deixa esta tela (e a de Sem resposta) mais útil.
              </Note>
            </Card>

            <Card
              title="Negócios em aberto"
              sub="Clique em um negócio para ler a conversa do lead"
              actions={
                <div class="toolbar">
                  <button class={`btn small ${sort === "inactive" ? "active" : ""}`} onClick={() => setQuery({ sort: null, page: null })}>
                    Dias sem atividade
                  </button>
                  <button class={`btn small ${sort === "stage" ? "active" : ""}`} onClick={() => setQuery({ sort: "stage", page: null })}>
                    Dias sem mudar de etapa
                  </button>
                </div>
              }
            >
              <DataTable
                scroll
                sortable={false}
                rows={d.items}
                rowKey={(r) => r.deal_id}
                onRow={(r) => r.contact_id && openChat(r.contact_id)}
                columns={[
                  { key: "name", label: "Lead", render: (r) => <span class="strong">{r.contact_name ?? "—"}</span> },
                  { key: "origin", label: "Origem", render: (r) => r.origin ?? "—" },
                  { key: "stage", label: "Etapa", render: (r) => r.stage ?? "—" },
                  { key: "resp", label: "Responsável", render: (r) => r.responsible ?? "Sem responsável" },
                  {
                    key: "inactive",
                    label: "Sem atividade",
                    num: true,
                    render: (r) => (
                      <span class={`tag-pill ${r.days_inactive > 30 ? "bad" : r.days_inactive > 3 ? "warn" : "ok"}`}>{fmtInt(r.days_inactive)} d</span>
                    ),
                  },
                  { key: "stage_days", label: "Sem mudar de etapa", num: true, render: (r) => `${fmtInt(r.days_in_stage)} d` },
                ]}
              />
              <div class="pager">
                <span>
                  Página {d.page} de {fmtInt(pages)} · {fmtInt(d.total)} negócios
                </span>
                <button class="btn small" disabled={d.page <= 1} onClick={() => setQuery({ page: String(d.page - 1) })}>
                  ← Anterior
                </button>
                <button class="btn small" disabled={d.page >= pages} onClick={() => setQuery({ page: String(d.page + 1) })}>
                  Próxima →
                </button>
              </div>
            </Card>

            <Source>
              <p>
                Negócios com status <b>aberto</b> na Clint. "Sem mudar de etapa" conta desde a última mudança de etapa; "sem atividade" usa a data
                mais recente entre a mudança de etapa e a última mensagem da conversa do lead (em qualquer direção). Dias corridos, no horário de
                Brasília.
              </p>
            </Source>
          </div>
        );
      }}
    </Async>
  );
}
