import type { Meta } from "../api";
import { DataTable } from "../components/DataTable";
import { DayBars } from "../components/sn";
import { Async, Card, Kpi, Note, Source } from "../components/ui";
import { brl, brl0, brlPer, fmtInt, pctOf } from "../format";
import { filterParams, useApi, useQuery } from "../hooks";

interface Group {
  name: string;
  sales: number;
  revenue: number;
}
interface Resp {
  totals: { sales: number; revenue: number; spend: number; meta_sales: number; meta_revenue: number; pixel_purchases: number; pixel_value: number };
  days: { date: string; sales: number; revenue: number; spend: number }[];
  by_origin: Group[];
  by_ad: Group[];
  by_campaign: Group[];
  meta: Meta;
}

function GroupTable({ rows, label, empty }: { rows: Group[]; label: string; empty: string }) {
  if (!rows.length) return <div class="empty-box">{empty}</div>;
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.name}
      initialSort={{ key: "revenue", dir: "desc" }}
      columns={[
        { key: "name", label, sortValue: (r) => r.name, render: (r) => <span class="cname" title={r.name}>{r.name}</span> },
        { key: "sales", label: "Vendas", num: true, sortValue: (r) => r.sales, render: (r) => fmtInt(r.sales) },
        { key: "revenue", label: "Faturamento", num: true, sortValue: (r) => r.revenue, render: (r) => brl0(r.revenue) },
        { key: "ticket", label: "Ticket", num: true, sortValue: (r) => (r.sales ? r.revenue / r.sales : 0), render: (r) => brlPer(r.revenue, r.sales) },
      ]}
    />
  );
}

export function Vendas() {
  const q = useQuery();
  const state = useApi<Resp>("/metrics/sales", filterParams(q));
  return (
    <Async state={state}>
      {(d) => {
        const t = d.totals;
        const roas = t.spend > 0 ? t.revenue / t.spend : null;
        return (
          <>
            <div class="grid">
              <Kpi span={2} label="Vendas" value={fmtInt(t.sales)} desc="negócios ganhos no período" />
              <Kpi span={2} label="Faturamento" value={brl0(t.revenue)} desc={`ticket médio ${brlPer(t.revenue, t.sales)}`} />
              <Kpi span={2} label="ROAS" tone="ok" value={roas !== null ? `${roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"} desc={roas !== null ? "faturamento ÷ investido" : "sem investimento no período"} />
              <Kpi span={2} label="CPA" value={brlPer(t.spend, t.sales)} desc="investido ÷ vendas" />
              <Kpi span={2} label="Vendas via Meta" tone="ok" value={fmtInt(t.meta_sales)} desc={`${pctOf(t.meta_sales, t.sales)} das vendas · ${brl0(t.meta_revenue)}`} />
              <Kpi span={2} label="Compras (pixel)" value={fmtInt(t.pixel_purchases)} desc={t.pixel_value ? `${brl0(t.pixel_value)} pelo pixel` : "o que o Meta atribui ao anúncio"} />
            </div>
            <div class="grid">
              <Card title="Vendas por dia" sub="Negócios ganhos na Clint em cada dia · valor abaixo = faturamento do dia.">
                <DayBars single days={d.days.map((x) => ({ date: x.date, total: x.sales, below: x.revenue ? brl0(x.revenue) : "—" }))} />
              </Card>
              <Card span={6} title="Por origem (produto)" sub="Vendas por origem da Clint no período.">
                <GroupTable rows={d.by_origin} label="Origem" empty="Sem vendas no período" />
              </Card>
              <Card span={6} title="Venda por criativo" sub="Vendas cujo negócio veio de um anúncio do Meta (formulário).">
                <GroupTable rows={d.by_ad} label="Criativo" empty="Nenhuma venda com anúncio no período" />
              </Card>
              <Card title="Por campanha" sub="Campanha do Meta registrada no negócio ganho.">
                <GroupTable rows={d.by_campaign} label="Campanha" empty="Sem vendas no período" />
              </Card>
              <Source>
                <p>
                  <b>Venda</b> = negócio com status <b>ganho</b> na Clint, no dia em que foi marcado como ganho; <b>faturamento</b> = valor do negócio na Clint. Investido e compras
                  pelo pixel vêm do Meta Ads. Se as vendas acontecem numa plataforma (Hotmart, Eduzz…), dá para ligar ela aqui para ter o faturamento real.
                </p>
                <Note>Ticket e ROAS dependem do campo valor preenchido em cada negócio ganho ({brl(t.revenue)} no período).</Note>
              </Source>
            </div>
          </>
        );
      }}
    </Async>
  );
}
