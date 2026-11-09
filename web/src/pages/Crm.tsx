import type { Meta } from "../api";
import { ChartView, GREY, PALETTE, TONES } from "../components/Chart";
import { WindowNote } from "../components/StaleBanner";
import { Async, BarList, Card, Kpi, Note, Source } from "../components/ui";
import { fmtDay, fmtInt, fmtPct } from "../format";
import { filterParams, setQuery, useApi, useQuery } from "../hooks";

interface Intake {
  days: string[];
  by_origin: { origin_id: string | null; name: string; group: string | null; per_day: number[]; total: number }[];
  total: number;
  meta: Meta;
}
interface Conversations {
  days: string[];
  seller_per_day: number[];
  lead_per_day: number[];
  total_seller_chats: number;
  total_lead_chats: number;
  meta: Meta;
}
interface StatusSummary {
  open: number;
  won: number;
  lost: number;
  lost_reasons: { reason: string; count: number }[];
}

export function Crm() {
  const q = useQuery();
  const params = filterParams(q);
  // The origin chart always lists every origin so the filter can be toggled from it.
  const allOrigins = filterParams(q);
  allOrigins.delete("origin_ids");
  allOrigins.delete("group_ids");
  const originsState = useApi<Intake>("/metrics/intake", allOrigins);
  const intake = useApi<Intake>("/metrics/intake", params);
  const convs = useApi<Conversations>("/metrics/conversations", params);
  const status = useApi<StatusSummary>("/metrics/status", params);

  const selected = new Set((q.get("origin_ids") ?? "").split(",").filter(Boolean));
  const toggleOrigin = (id: string | null) => {
    if (!id) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setQuery({ origin_ids: [...next].join(","), group_ids: null });
  };

  return (
    <>
      <WindowNote meta={convs.data?.meta ?? null} />
      <div class="grid">
        <Kpi span={4} label="Negócios criados" value={intake.data ? fmtInt(intake.data.total) : "…"} tone="accent" desc="No período e nas origens filtradas." />
        <Kpi
          span={4}
          label="Conversas atendidas"
          value={convs.data ? fmtInt(convs.data.total_seller_chats) : "…"}
          tone="ok"
          desc={convs.data ? `Conversas com mensagem de vendedor · ${fmtInt(convs.data.total_lead_chats)} em que o lead escreveu.` : ""}
        />

        <Kpi
          span={4}
          label="Perdidos"
          value={status.data ? fmtInt(status.data.lost) : "…"}
          tone="bad"
          desc={
            status.data
              ? `${fmtPct(status.data.lost / Math.max(1, status.data.open + status.data.won + status.data.lost))} dos negócios criados no período · passe o mouse para ver os motivos.`
              : ""
          }
          tip={
            status.data && (
              <>
                <div class="mono-label">Motivos de perda · {fmtInt(status.data.lost)} negócios</div>
                {status.data.lost_reasons.length ? (
                  <BarList
                    color="var(--bad)"
                    items={status.data.lost_reasons.map((r) => ({
                      key: r.reason,
                      label: r.reason,
                      value: r.count,
                      aux: fmtPct(r.count / Math.max(1, status.data!.lost)),
                    }))}
                  />
                ) : (
                  <div class="muted">Nenhum negócio perdido no período.</div>
                )}
              </>
            )
          }
        />
        <Card title="Negócios criados por dia" sub={intake.data ? `${fmtInt(intake.data.total)} negócios no período` : undefined}>
          <Async state={intake} empty={(d) => d.total === 0}>
            {(d) => {
              const perDay = d.days.map((_, i) => d.by_origin.reduce((s, o) => s + o.per_day[i], 0));
              return (
                <ChartView
                  config={{
                    type: "bar",
                    data: { labels: d.days.map(fmtDay), datasets: [{ label: "Negócios criados", data: perDay, backgroundColor: TONES.accent }] },
                    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
                  }}
                />
              );
            }}
          </Async>
        </Card>

        <Card
          title="Negócios criados por origem"
          sub={selected.size ? `${selected.size} origem(ns) selecionada(s) · clique de novo para tirar` : "Clique em uma ou mais barras para filtrar a tela pela origem"}
          actions={
            selected.size > 0 && (
              <button class="btn small" onClick={() => setQuery({ origin_ids: null, group_ids: null })}>
                Todas as origens
              </button>
            )
          }
        >
          <Async state={originsState} empty={(d) => d.total === 0}>
            {(d) => {
              const dup = new Set(d.by_origin.map((o) => o.name).filter((n, i, all) => all.indexOf(n) !== i));
              const label = (o: Intake["by_origin"][number]) => (dup.has(o.name) && o.group ? `${o.name} · ${o.group}` : o.name);
              const rows = d.by_origin;
              return (
                <ChartView
                  tall={rows.length > 8}
                  config={{
                    type: "bar",
                    data: {
                      labels: rows.map(label),
                      datasets: [
                        {
                          label: "Negócios criados",
                          data: rows.map((o) => o.total),
                          backgroundColor: rows.map((o, i) =>
                            selected.size === 0 || selected.has(o.origin_id ?? "") ? PALETTE[i % PALETTE.length] : GREY,
                          ),
                        },
                      ],
                    },
                    options: {
                      indexAxis: "y",
                      plugins: { legend: { display: false } },
                      scales: { x: { beginAtZero: true } },
                      onClick: (_e: unknown, els: { index: number }[]) => els[0] && toggleOrigin(rows[els[0].index].origin_id),
                      onHover: (e: { native: Event | null }, els: unknown[]) => {
                        const t = e.native?.target as HTMLElement | null | undefined;
                        if (t) t.style.cursor = els.length ? "pointer" : "default";
                      },
                    },
                  }}
                />
              );
            }}
          </Async>
        </Card>

        <Card title="Conversas por dia" sub="Conversas diferentes com movimento em cada dia">
          <Async state={convs} empty={(d) => d.days.length === 0}>
            {(d) => (
              <>
                <ChartView
                  config={{
                    type: "bar",
                    data: {
                      labels: d.days.map(fmtDay),
                      datasets: [
                        { label: "Atendidas (vendedor mandou mensagem)", data: d.seller_per_day, backgroundColor: TONES.ok, order: 2 },
                        {
                          type: "line",
                          label: "Lead escreveu",
                          data: d.lead_per_day,
                          borderColor: TONES.bad,
                          backgroundColor: TONES.bad,
                          pointRadius: 2,
                          tension: 0.3,
                          order: 1,
                        } as never,
                      ],
                    },
                    options: { plugins: { tooltip: { mode: "index", intersect: false } }, scales: { y: { beginAtZero: true } } },
                  }}
                />
                <Note>
                  <span class="tone-ok">Bronze</span> são conversas em que um vendedor mandou pelo menos uma mensagem no dia;{" "}
                  <span class="tone-bad">rosé</span> são conversas em que o lead escreveu. Uma conversa conta uma vez por dia, não importa quantas
                  mensagens teve. Reações não contam.
                </Note>
              </>
            )}
          </Async>
        </Card>

        <Source>
          <p>
            <b>Negócios</b>: data de criação na Clint, horário de Brasília. <b>Conversas</b>: mensagens de WhatsApp e Instagram da Clint dos últimos 90
            dias.
          </p>
        </Source>
      </div>
    </>
  );
}
