import type { Meta } from "../api";
import { openChat } from "../chat/ChatViewer";
import { DataTable } from "../components/DataTable";
import { BarList, Card, Kpi, Note, Source, Async } from "../components/ui";
import { fmtBusinessMinutes, fmtDateTime, fmtInt, fmtPhone } from "../format";
import { filterParams, useApi, useQuery } from "../hooks";

interface Item {
  contact_id: string;
  contact_name: string | null;
  phone: string | null;
  origin: string | null;
  responsible: string | null;
  awaiting_since: string;
  business_minutes_waiting: number;
  chat_id: string;
}
interface Resp {
  total: number;
  threshold_minutes: number;
  business_hours: { days: number[]; start: string; end: string };
  items: Item[];
  meta: Meta;
}

const DAY_NAMES = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function SemResposta() {
  const q = useQuery();
  const state = useApi<Resp>("/metrics/no-reply", filterParams(q), 5 * 60_000);
  return (
    <Async state={state}>
      {(d) => {
        const bh = d.business_hours;
        const dayMin = Math.max(60, minutesOf(bh.end) - minutesOf(bh.start));
        const hours = `${DAY_NAMES[bh.days[0]]}–${DAY_NAMES[bh.days.at(-1)!]}, ${bh.start}–${bh.end}`;
        const fresh = d.items.filter((i) => i.business_minutes_waiting < dayMin).length;
        const mid = d.items.filter((i) => i.business_minutes_waiting >= dayMin && i.business_minutes_waiting < 5 * dayMin).length;
        const old = d.total - fresh - mid;
        const countBy = (key: (i: Item) => string) => {
          const m = new Map<string, number>();
          for (const i of d.items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
          return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v }));
        };
        const byResp = countBy((i) => i.responsible ?? "Sem responsável");
        const byOrigin = countBy((i) => i.origin ?? "Sem origem");
        const threshold = d.threshold_minutes >= 60 ? `${d.threshold_minutes / 60}h` : `${d.threshold_minutes}min`;
        return (
          <div class="grid">
            <Kpi label="Sem resposta" value={fmtInt(d.total)} tone={d.total ? "bad" : "ok"} desc={`Lead com negócio aberto esperando um vendedor há mais de ${threshold} útil.`} />
            <Kpi label="Menos de 1 dia útil" value={fmtInt(fresh)} tone="warn" desc="Dá para resolver hoje — prioridade." />
            <Kpi label="1 a 5 dias úteis" value={fmtInt(mid)} tone={mid ? "bad" : undefined} desc="Lead esfriando; vale retomar com urgência." />
            <Kpi label="Mais de 5 dias úteis" value={fmtInt(old)} desc="Casos antigos, muitas vezes de funis que ficaram abertos." />

            <Card span={6} title="Por responsável" sub={`${byResp.length} pessoas com leads esperando`}>
              <BarList color="var(--bad)" items={byResp} />
              <Note>Responsável = quem atende a conversa na Clint; se ninguém, o dono do negócio aberto mais recente.</Note>
            </Card>
            <Card span={6} title="Por origem" sub={`${byOrigin.length} origens com leads esperando`}>
              <BarList color="var(--warn)" items={byOrigin.slice(0, 8)} />
              {byOrigin.length > 8 && <Note>Mostrando as 8 origens com mais casos.</Note>}
            </Card>

            <Card title="Aguardando resposta" sub="Clique em um lead para ler a conversa sem sair do dash">
              {d.items.length === 0 ? (
                <div class="state">Ninguém esperando resposta 🎉</div>
              ) : (
                <DataTable
                  scroll
                  rows={d.items}
                  rowKey={(r) => r.chat_id}
                  onRow={(r) => openChat(r.contact_id)}
                  initialSort={{ key: "wait", dir: "desc" }}
                  columns={[
                    {
                      key: "name",
                      label: "Lead",
                      sortValue: (r) => r.contact_name ?? "",
                      render: (r) => (
                        <>
                          <div class="strong">{r.contact_name ?? "—"}</div>
                          <div style="font-size:11px">{fmtPhone(r.phone)}</div>
                        </>
                      ),
                    },
                    { key: "origin", label: "Origem", sortValue: (r) => r.origin ?? "", render: (r) => r.origin ?? "—" },
                    { key: "resp", label: "Responsável", sortValue: (r) => r.responsible ?? "", render: (r) => r.responsible ?? "Sem responsável" },
                    { key: "last", label: "Escreveu em", sortValue: (r) => r.awaiting_since, render: (r) => fmtDateTime(r.awaiting_since) },
                    {
                      key: "wait",
                      label: "Esperando",
                      num: true,
                      sortValue: (r) => r.business_minutes_waiting,
                      render: (r) => (
                        <span class={`tag-pill ${r.business_minutes_waiting >= 5 * dayMin ? "" : r.business_minutes_waiting >= dayMin ? "bad" : "warn"}`}>
                          {fmtBusinessMinutes(r.business_minutes_waiting, dayMin)}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
              <Note>
                A lista começa por quem espera <b>há mais tempo</b>; clique em "Esperando" para inverter. <span class="tone-warn">Caramelo</span> é menos de 1 dia útil,{" "}
                <span class="tone-bad">rosé</span> é de 1 a 5 dias úteis e sem destaque é mais antigo. Os dados se atualizam a cada 30 minutos.
              </Note>
            </Card>

            <Source>
              <p>
                Conversas de WhatsApp e Instagram da Clint. Um lead entra aqui quando tem pelo menos um <b>negócio em aberto</b> e a última mensagem
                da conversa é dele, sem resposta de um vendedor depois. Reações (ex.: 🙏) e eventos do sistema não contam.
              </p>
              <p>
                O tempo conta só dentro do horário comercial ({hours}): uma mensagem às 17h30 de sexta vira "sem resposta" às 9h30 de segunda.
              </p>
            </Source>
          </div>
        );
      }}
    </Async>
  );
}
