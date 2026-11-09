import type { Meta } from "../api";
import { ChartView, GREY, PALETTE } from "../components/Chart";
import { WindowNote } from "../components/StaleBanner";
import { Async, BarList, Card, Kpi, Note, Source } from "../components/ui";
import { fmtDay, fmtInt, fmtPct } from "../format";
import { filterParams, useApi, useQuery } from "../hooks";

interface Series {
  user_id: string;
  name: string;
  messages_per_day: number[];
  messages_total: number;
  deals_worked: number;
}
interface Resp {
  days: string[];
  series: Series[];
  unattributed: Omit<Series, "user_id" | "name"> | null;
  inferred_attribution_count: number;
  meta: Meta;
}

export function Vendedores() {
  const q = useQuery();
  const state = useApi<Resp>("/metrics/sellers", filterParams(q));
  return (
    <Async state={state}>
      {(d) => {
        const rows = [...d.series];
        if (d.unattributed && d.unattributed.messages_total + d.unattributed.deals_worked > 0) {
          rows.push({ user_id: "none", name: "Sem responsável", ...d.unattributed });
        }
        const colorOf = new Map(rows.map((r, i) => [r.user_id, r.user_id === "none" ? GREY : PALETTE[i % PALETTE.length]]));
        const totalMsgs = rows.reduce((s, r) => s + r.messages_total, 0);
        const totalDeals = rows.reduce((s, r) => s + r.deals_worked, 0);
        const nDays = Math.max(1, d.days.length);
        const active = rows.filter((r) => r.messages_total > 0);
        return (
          <>
            <WindowNote meta={d.meta} />
            <div class="grid">
              <Kpi label="Mensagens enviadas" value={fmtInt(totalMsgs)} tone="accent" desc={`Por ${active.length} pessoas em ${nDays} dias.`} />
              <Kpi label="Média por dia" value={fmtInt(Math.round(totalMsgs / nDays))} desc="Mensagens de vendedores por dia corrido, fins de semana incluídos." />
              <Kpi label="Negócios trabalhados" value={fmtInt(totalDeals)} tone="ok" desc="Soma por vendedor: mandou mensagem ao lead ou mudou o negócio de etapa." />
              <Kpi
                label="Sem autor na Clint"
                value={totalMsgs ? fmtPct(d.inferred_attribution_count / totalMsgs) : "—"}
                tone="warn"
                desc={`${fmtInt(d.inferred_attribution_count)} mensagens enviadas pelo celular, atribuídas ao responsável.`}
              />

              <Card title="Mensagens enviadas por dia" sub={`${fmtInt(totalMsgs)} mensagens · ${active.length} vendedores · cada cor é uma pessoa`}>
                <ChartView
                  config={{
                    type: "bar",
                    data: {
                      labels: d.days.map(fmtDay),
                      datasets: active.map((r) => ({
                        label: r.name,
                        data: r.messages_per_day,
                        backgroundColor: colorOf.get(r.user_id),
                        stack: "msgs",
                      })),
                    },
                    options: {
                      plugins: { tooltip: { mode: "index", intersect: false } },
                      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
                    },
                  }}
                />
                <Note>
                  Conta toda mensagem que saiu de um vendedor na conversa (texto, áudio, foto, documento). <b>Reações</b> não contam. Dias sem envio
                  aparecem zerados, para o intervalo vazio ficar visível.
                </Note>
              </Card>

              <Card span={6} title="Quem mais enviou" sub="Mensagens no período">
                <BarList
                  items={rows
                    .filter((r) => r.messages_total + r.deals_worked > 0)
                    .sort((a, b) => b.messages_total - a.messages_total)
                    .map((r) => ({
                      key: r.user_id,
                      label: r.name,
                      value: r.messages_total,
                      aux: `${fmtInt(Math.round(r.messages_total / nDays))}/dia`,
                      color: colorOf.get(r.user_id),
                    }))}
                />
              </Card>
              <Card span={6} title="Negócios trabalhados" sub="Negócios diferentes em que cada pessoa atuou">
                <BarList
                  items={rows
                    .filter((r) => r.messages_total + r.deals_worked > 0)
                    .sort((a, b) => b.deals_worked - a.deals_worked)
                    .map((r) => ({
                      key: r.user_id,
                      label: r.name,
                      value: r.deals_worked,
                      aux: r.deals_worked ? `${(r.messages_total / r.deals_worked).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} msg/negócio` : "",
                      color: colorOf.get(r.user_id),
                    }))}
                />
              </Card>

              <Source>
                <p>
                  Mensagens das conversas da Clint dos <b>últimos 90 dias</b>. Quando a Clint não diz quem enviou (mensagem mandada direto pelo
                  celular), ela vai para quem atende a conversa; se não houver, para o dono do negócio aberto mais recente do lead; senão, "Sem
                  responsável".
                </p>
                <p>
                  Negócio trabalhado = o vendedor enviou ao menos uma mensagem na conversa do lead daquele negócio ou o negócio dele mudou de etapa
                  no período.
                </p>
              </Source>
            </div>
          </>
        );
      }}
    </Async>
  );
}
