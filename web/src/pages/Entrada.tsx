import type { Meta } from "../api";
import { ChartView, GREY, PALETTE } from "../components/Chart";
import { Async, BarList, Card, Kpi, Note, Source } from "../components/ui";
import { fmtDay, fmtInt, fmtPct } from "../format";
import { filterParams, setQuery, useApi, useQuery } from "../hooks";

interface Origin {
  origin_id: string | null;
  name: string;
  group: string | null;
  per_day: number[];
  total: number;
}
interface Resp {
  days: string[];
  by_origin: Origin[];
  total: number;
  meta: Meta;
}

const TOP = 8;

export function Entrada() {
  const q = useQuery();
  const state = useApi<Resp>("/metrics/intake", filterParams(q));
  return (
    <Async state={state} empty={(d) => d.total === 0}>
      {(d) => {
        // Same origin name in different groups (e.g. ARÉOLA FLOWER) gets the group appended.
        const dup = new Set(d.by_origin.map((o) => o.name).filter((n, i, all) => all.indexOf(n) !== i));
        const nameOf = (o: Origin) => (dup.has(o.name) && o.group ? `${o.name} · ${o.group}` : o.name);
        const top = d.by_origin.slice(0, TOP);
        const rest = d.by_origin.slice(TOP);
        const colorOf = new Map(top.map((o, i) => [o.origin_id, PALETTE[i % PALETTE.length]]));
        const datasets = top.map((o) => ({ label: nameOf(o), data: o.per_day, backgroundColor: colorOf.get(o.origin_id)!, stack: "s" }));
        if (rest.length) {
          datasets.push({ label: "Outras", data: d.days.map((_, i) => rest.reduce((s, o) => s + o.per_day[i], 0)), backgroundColor: GREY, stack: "s" });
        }
        const perDay = d.days.map((_, i) => d.by_origin.reduce((s, o) => s + o.per_day[i], 0));
        const best = Math.max(...perDay);
        const bestDay = d.days[perDay.indexOf(best)];
        const zeroDays = perDay.filter((n) => n === 0).length;
        return (
          <div class="grid">
            <Kpi label="Negócios criados" value={fmtInt(d.total)} tone="accent" desc={`Entraram na Clint em ${d.days.length} dias, em ${d.by_origin.length} origens.`} />
            <Kpi label="Média por dia" value={fmtInt(Math.round(d.total / Math.max(1, d.days.length)))} desc="Negócios novos por dia corrido." />
            <Kpi label="Maior dia" value={fmtInt(best)} tone="ok" desc={bestDay ? `Em ${fmtDay(bestDay)}.` : ""} />
            <Kpi label="Dias sem entrada" value={fmtInt(zeroDays)} tone={zeroDays > d.days.length / 3 ? "warn" : undefined} desc="Dias do período em que nenhum negócio foi criado." />

            <Card title="Negócios criados por dia" sub={`${fmtInt(d.total)} negócios · cada cor é uma origem${rest.length ? ` · ${rest.length} menores em "Outras"` : ""}`}>
              <ChartView
                tall
                config={{
                  type: "bar",
                  data: { labels: d.days.map(fmtDay), datasets },
                  options: {
                    plugins: { tooltip: { mode: "index", intersect: false } },
                    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
                  },
                }}
              />
              <Note>
                Data de criação do negócio na Clint, no horário de Brasília — um lead que chega às 23h conta no próprio dia. Campanhas novas aparecem
                sozinhas, sem precisar configurar nada.
              </Note>
            </Card>

            <Card title="Por origem" sub="Clique em uma origem para filtrar o dash inteiro por ela">
              <BarList
                items={d.by_origin.map((o) => ({
                  key: o.origin_id ?? "none",
                  label: nameOf(o),
                  value: o.total,
                  aux: `${o.group ?? "sem grupo"} · ${fmtPct(o.total / d.total)}`,
                  color: colorOf.get(o.origin_id) ?? GREY,
                  onClick: o.origin_id ? () => setQuery({ origin_ids: o.origin_id, group_ids: null }) : undefined,
                }))}
              />
            </Card>

            <Source>
              <p>
                Negócios da Clint (todas as origens e grupos, inclusive arquivadas), pela <b>data de criação</b>. Os números batem com a lista de
                negócios da Clint filtrada pela mesma origem e período.
              </p>
            </Source>
          </div>
        );
      }}
    </Async>
  );
}
