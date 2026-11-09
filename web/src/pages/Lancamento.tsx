import { useState } from "preact/hooks";
import type { Meta } from "../api";
import { DataTable } from "../components/DataTable";
import { PillSelect } from "../components/FilterBar";
import { DayBars, Resumo, SectionTitle, SubStats, Toggle } from "../components/sn";
import { Async, BarList, Card, Kpi, Note, Source } from "../components/ui";
import { brl, brl0, brlPer, fmtDay, fmtInt, pctOf } from "../format";
import { filterParams, setQuery, useApi, useQuery } from "../hooks";

interface Day {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  meta_leads: number;
  purchases: number;
  leads: number;
  traffic: number;
  organic: number;
}
interface Creative {
  name: string;
  spend: number;
  meta_leads: number;
  clint_leads: number;
  impressions: number;
  clicks: number;
  video_3s: number;
  purchases: number;
  cpl: number | null;
  ctr: number;
  hook: number | null;
  thumb: string | null;
  preview: string | null;
  tier: "good" | "warn" | "bad" | null;
}
interface Resp {
  days: Day[];
  totals: Omit<Day, "date">;
  captacao_spend: number;
  sources: { label: string; n: number }[];
  utm: Record<string, { value: string; n: number }[]>;
  phases: { key: string; label: string; campaigns: number; spend: number; meta_leads: number; purchases: number; purchase_value: number }[];
  creatives: Creative[];
  adsets: Creative[];
  funnel: {
    origin: { id: string; name: string } | null;
    options: { id: string; name: string; n: number }[];
    stages: { id: string; label: string; type: string | null; count: number }[];
    total: number;
    won: number;
    lost: number;
    evolution: { day: string; total: number; open: number; won: number; lost: number }[];
  };
  meta: Meta;
}

const UTMS = [
  { key: "utm_source", label: "Source" },
  { key: "utm_medium", label: "Medium" },
  { key: "utm_campaign", label: "Campaign" },
  { key: "utm_content", label: "Content" },
  { key: "utm_term", label: "Term" },
] as const;
type UtmKey = (typeof UTMS)[number]["key"];
const ctr = (clicks: number, impr: number) => pctOf(clicks, impr, 2);
const TIER = { good: "cgood", warn: "cwarn", bad: "cbad" } as const;

export function Lancamento() {
  const q = useQuery();
  const params = filterParams(q);
  if (q.get("funnel_origin")) params.set("funnel_origin", q.get("funnel_origin")!);
  const state = useApi<Resp>("/metrics/launch", params);
  const [utmKey, setUtmKey] = useState<UtmKey>("utm_source");
  const [rankView, setRankView] = useState<"creatives" | "adsets">("creatives");
  const from = q.get("from");
  const to = q.get("to");

  return (
    <Async state={state}>
      {(d) => {
        const t = d.totals;
        const hasMeta = t.spend > 0 || t.impressions > 0;
        const ranked = rankView === "creatives" ? d.creatives : d.adsets;
        const utmRows = d.utm[utmKey] ?? [];
        const utmTotal = utmRows.reduce((s, r) => s + r.n, 0);
        const fu = d.funnel;
        const period = `${fmtDay(d.days[0]?.date ?? from ?? "")} a ${fmtDay(d.days[d.days.length - 1]?.date ?? to ?? "")}`;
        const resumo: [string, string][] = [
          ["Investido", hasMeta ? brl0(t.spend) : "—"],
          ["Leads totais (Clint)", fmtInt(t.leads)],
          ["Leads de tráfego", fmtInt(t.traffic)],
          ["Leads orgânicos", fmtInt(t.organic)],
          ["CPL de tráfego", brlPer(t.spend, t.traffic)],
          ["CPL geral", brlPer(t.spend, t.leads)],
          ["Leads no Meta", fmtInt(t.meta_leads)],
          ["CTR", ctr(t.clicks, t.impressions)],
        ];
        return (
          <>
            <div class="grid">
              <Kpi span={2} label="Investido" value={hasMeta ? brl0(t.spend) : "—"} desc={hasMeta ? `${brl0(d.captacao_spend)} em captação` : "sem anúncios no período"} />
              <Kpi span={2} label="Leads (Clint)" value={fmtInt(t.leads)} desc="negócios criados no período" />
              <Kpi span={2} label="Leads de tráfego" value={fmtInt(t.traffic)} desc={`${pctOf(t.traffic, t.leads)} do total · anúncio Meta ou UTM paga`} />
              <Kpi span={2} label="Orgânicos" tone="ok" value={fmtInt(t.organic)} desc={`${pctOf(t.organic, t.leads)} do total · sem anúncio`} />
              <Kpi span={2} label="CPL de tráfego" tone="ok" value={brlPer(t.spend, t.traffic)} desc="investido ÷ leads de tráfego" />
              <Kpi span={2} label="CPL geral" tone="ok" value={brlPer(t.spend, t.leads)} desc="investido ÷ todos os leads" />
            </div>
            <SubStats
              items={[
                ["CTR", ctr(t.clicks, t.impressions)],
                ["CPC (link)", brlPer(t.spend, t.link_clicks)],
                ["CPM", t.impressions ? brl((t.spend / t.impressions) * 1000) : "—"],
                ["Leads no Meta", fmtInt(t.meta_leads)],
                ["CPL no Meta", brlPer(t.spend, t.meta_leads)],
                ["Chegaram na Clint", pctOf(t.traffic, t.meta_leads)],
                ["Compras (pixel)", fmtInt(t.purchases)],
              ]}
            />

            <div class="grid">
              <Card title="Leads por dia" sub="Barra = leads que entraram na Clint no dia · caramelo = tráfego · rosé = orgânico · valor abaixo = investido no dia.">
                <DayBars days={d.days.map((x) => ({ date: x.date, total: x.leads, part: x.traffic, below: x.spend > 0 ? brl0(x.spend) : "—" }))} />
                <div class="legend">
                  <span>
                    <i style="background:var(--brand)" />
                    Tráfego
                  </span>
                  <span>
                    <i style="background:var(--data2)" />
                    Orgânico
                  </span>
                </div>
              </Card>
              <Card span={6} title="Origem dos leads" sub="De onde vieram os leads (Clint), no período.">
                <BarList
                  items={d.sources.map((s) => ({
                    key: s.label,
                    label: s.label,
                    value: s.n,
                    display: `${fmtInt(s.n)} · ${pctOf(s.n, t.leads)}`,
                    color: s.label.startsWith("Tráfego") ? "var(--brand)" : "var(--data2)",
                  }))}
                  auxWidth={0}
                />
                <div class="splitbar">
                  <span style={{ width: `${t.leads ? (t.traffic / t.leads) * 100 : 0}%`, background: "var(--brand)" }} />
                  <span style={{ width: `${t.leads ? (t.organic / t.leads) * 100 : 0}%`, background: "var(--data2)" }} />
                </div>
                <div class="legend">
                  <span>
                    <i style="background:var(--brand)" />
                    Tráfego <b>{pctOf(t.traffic, t.leads)}</b>
                  </span>
                  <span>
                    <i style="background:var(--data2)" />
                    Orgânico <b>{pctOf(t.organic, t.leads)}</b>
                  </span>
                </div>
              </Card>

              <Card
                span={6}
                title="Todas as UTMs"
                sub="Valores exatos das UTMs dos leads (Clint), no período."
                actions={<Toggle value={utmKey} options={UTMS.map((u) => ({ key: u.key, label: u.label }))} onChange={setUtmKey} />}
              >
                <BarList
                  items={utmRows.slice(0, 15).map((r) => ({ key: r.value, label: r.value, value: r.n, display: `${fmtInt(r.n)} · ${pctOf(r.n, utmTotal)}` }))}
                  color="var(--brand)"
                  auxWidth={0}
                />
                {utmRows.length > 15 && <Note>Mostrando os 15 valores mais comuns de {utmRows.length}.</Note>}
                <Note>
                  Se quase tudo aparece como <b>(sem valor)</b>, os leads chegam sem UTM na Clint — os de formulário do Meta são reconhecidos pela campanha, não pela UTM.
                </Note>
              </Card>

              <Card
                title="Funil comercial (Clint)"
                sub={
                  <>
                    Leads que <b>entraram no período</b>, pela etapa em que estão <b>agora</b>
                    {fu.origin ? ` na origem ${fu.origin.name}` : ""}. Perdidos saem das barras.
                  </>
                }
                actions={
                  fu.options.length > 1 && (
                    <PillSelect
                      label="Origem"
                      value={fu.origin?.id ?? ""}
                      options={fu.options.map((o) => ({ key: o.id, label: o.name, hint: fmtInt(o.n) }))}
                      onChange={(k) => setQuery({ funnel_origin: k })}
                    />
                  )
                }
              >
                {!fu.origin ? (
                  <div class="empty-box">
                    <b>Nenhum lead no período</b>o funil aparece quando entrarem negócios
                  </div>
                ) : (
                  <>
                    <div class="grid" style="margin-top:0">
                      <Kpi span={3} label="Leads no período" value={fmtInt(fu.total)} desc={`entraram em ${fu.origin.name}`} />
                      <Kpi span={3} label="Ganhos" tone="ok" value={fmtInt(fu.won)} desc="negócio ganho na Clint" />
                      <Kpi span={3} label="Perdidos" tone="bad" value={fmtInt(fu.lost)} desc="marcados como perdidos" />
                      <Kpi span={3} label="Lead → ganho" value={pctOf(fu.won, fu.total, 1)} desc="ganhos ÷ leads do período" />
                    </div>
                    <div style="margin-top:16px">
                      <BarList
                        items={fu.stages.map((s) => ({
                          key: s.id,
                          label: s.label,
                          value: s.count,
                          display: `${fmtInt(s.count)} · ${pctOf(s.count, fu.total)}`,
                          color: s.type === "CLOSING" ? "var(--brand)" : "var(--data2)",
                        }))}
                        auxWidth={0}
                      />
                    </div>
                    <SectionTitle>Evolução da origem — dia a dia</SectionTitle>
                    <DataTable
                      scroll
                      rows={[...fu.evolution].reverse()}
                      rowKey={(r) => r.day}
                      sortable={false}
                      columns={[
                        { key: "day", label: "Dia", render: (r) => fmtDay(r.day) },
                        { key: "total", label: "Na origem", num: true, render: (r) => fmtInt(r.total) },
                        { key: "open", label: "Abertos", num: true, render: (r) => fmtInt(r.open) },
                        { key: "won", label: "Ganhos", num: true, render: (r) => fmtInt(r.won) },
                        { key: "lost", label: "Perdidos", num: true, render: (r) => fmtInt(r.lost) },
                      ]}
                    />
                    <Note>Reconstruído pelas datas da Clint (criação, ganho e perda de cada negócio da origem, desde o início).</Note>
                  </>
                )}
              </Card>

              <Card title="Fases das campanhas" sub="Campanhas separadas pelo nome: [LEAD]/[MSG] = captação · [VENDA] = vendas · [TRAFEGO] = tráfego para o perfil. Compras = pixel do Meta.">
                <DataTable
                  rows={d.phases}
                  rowKey={(r) => r.key}
                  sortable={false}
                  columns={[
                    { key: "label", label: "Fase", render: (r) => <span class="strong">{r.label}</span> },
                    { key: "campaigns", label: "Campanhas", num: true, render: (r) => fmtInt(r.campaigns) },
                    { key: "spend", label: "Investido", num: true, render: (r) => (r.spend ? brl0(r.spend) : "—") },
                    { key: "leads", label: "Leads Meta", num: true, render: (r) => (r.meta_leads ? fmtInt(r.meta_leads) : "—") },
                    { key: "cpl", label: "CPL Meta", num: true, render: (r) => brlPer(r.spend, r.meta_leads) },
                    { key: "purch", label: "Compras (pixel)", num: true, render: (r) => (r.purchases ? fmtInt(r.purchases) : "—") },
                    { key: "val", label: "Valor (pixel)", num: true, render: (r) => (r.purchase_value ? brl0(r.purchase_value) : "—") },
                  ]}
                />
              </Card>

              <Card
                title={`${rankView === "creatives" ? "Criativos" : "Públicos (conjuntos)"} — ranqueados por CPL`}
                sub={rankView === "creatives" ? "Criativos rodando no período. Bronze = melhor CPL · rosé = candidato a cortar." : "Conjuntos de anúncios (públicos) no período."}
                actions={
                  <Toggle
                    value={rankView}
                    options={[
                      { key: "creatives", label: "Criativos" },
                      { key: "adsets", label: "Públicos" },
                    ]}
                    onChange={setRankView}
                  />
                }
              >
                {ranked.length ? (
                  <div class="table-wrap scroll">
                    <table>
                      <thead>
                        <tr>
                          <th class="rank" />
                          <th>{rankView === "creatives" ? "Criativo" : "Público / conjunto"}</th>
                          <th class="num">Gasto</th>
                          <th class="num">Leads Meta</th>
                          <th class="num">Leads Clint</th>
                          <th class="num">CPL</th>
                          <th class="num">CTR</th>
                          <th class="num">Hook 3s</th>
                          {rankView === "creatives" && <th class="num">Preview</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {ranked.map((c, i) => (
                          <tr class={i === 0 && c.cpl !== null ? "win" : ""} key={c.name}>
                            <td class="rank">{i + 1}</td>
                            <td>
                              <div class="cwrap">
                                {rankView === "creatives" &&
                                  (c.thumb ? (
                                    <img class="cthumb" src={c.thumb} alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
                                  ) : (
                                    <span class="cthumb" />
                                  ))}
                                <span class="cname" title={c.name}>
                                  {c.name}
                                </span>
                              </div>
                            </td>
                            <td class="num">{brl0(c.spend)}</td>
                            <td class="num">{fmtInt(c.meta_leads)}</td>
                            <td class="num">{c.clint_leads ? fmtInt(c.clint_leads) : "—"}</td>
                            <td class="num">{c.cpl !== null ? <span class={`pill ${c.tier ? TIER[c.tier] : ""}`}>{brl(c.cpl)}</span> : "—"}</td>
                            <td class="num muted">{c.ctr.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</td>
                            <td class="num muted">{c.hook !== null ? `${Math.round(c.hook)}%` : "—"}</td>
                            {rankView === "creatives" && (
                              <td class="num">
                                {c.preview ? (
                                  <a class="link" href={c.preview} target="_blank" rel="noopener noreferrer">
                                    ver ↗
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div class="empty-box">
                    <b>Sem anúncios no período</b>os criativos aparecem quando houver investimento no Meta
                  </div>
                )}
                <Note>
                  <b>Hook 3s</b> = visualizações de 3 segundos ÷ impressões (só vídeo). <b>Leads Clint</b> = negócios criados no período com esse anúncio.
                </Note>
              </Card>

              <Card title="Dia a dia" sub="Leads vêm da Clint (data de entrada) e Meta é o que o Gerenciador reporta — quando os dois se afastam, é sinal de lead que não chegou. Clique num cabeçalho para reordenar.">
                <DataTable
                  scroll
                  rows={[...d.days].reverse()}
                  rowKey={(r) => r.date}
                  columns={[
                    { key: "date", label: "Dia", sortValue: (r) => r.date, render: (r) => fmtDay(r.date) },
                    { key: "spend", label: "Investido", num: true, sortValue: (r) => r.spend, render: (r) => (r.spend ? brl0(r.spend) : "—") },
                    { key: "leads", label: "Leads", num: true, sortValue: (r) => r.leads, render: (r) => fmtInt(r.leads) },
                    { key: "traffic", label: "Tráfego", num: true, sortValue: (r) => r.traffic, render: (r) => fmtInt(r.traffic) },
                    { key: "cpl", label: "CPL real", num: true, sortValue: (r) => (r.traffic ? r.spend / r.traffic : 0), render: (r) => brlPer(r.spend, r.traffic) },
                    { key: "meta", label: "Meta", num: true, sortValue: (r) => r.meta_leads, render: (r) => fmtInt(r.meta_leads) },
                    { key: "ctr", label: "CTR", num: true, sortValue: (r) => (r.impressions ? r.clicks / r.impressions : 0), render: (r) => ctr(r.clicks, r.impressions) },
                  ]}
                />
              </Card>

              <Card title="Resumo" sub="Números do período selecionado — os mesmos dos cartões lá em cima. O botão copia um texto pronto pro WhatsApp.">
                <Resumo title={`Andreia Ferreira — ${period}`} items={resumo} />
              </Card>

              <Source>
                <p>
                  <b>Leads</b>: negócios criados na Clint no período (todas as situações; filtros de origem, vendedor e campanha valem). <b>Tráfego</b> = o negócio tem campanha,
                  anúncio ou formulário do Meta, ou UTM paga; o resto é orgânico. <b>Investido, CTR, criativos</b>: Meta Ads (contas da BM), atualizado de hora em hora — só o
                  filtro de campanha vale para eles.
                </p>
              </Source>
            </div>
          </>
        );
      }}
    </Async>
  );
}
