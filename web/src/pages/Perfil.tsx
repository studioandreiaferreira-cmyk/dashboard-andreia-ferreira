import type { Meta } from "../api";
import { PALETTE } from "../components/Chart";
import { Async, BarList, Card, Note, Source } from "../components/ui";
import { fmtInt, fmtPct } from "../format";
import { filterParams, setQuery, useApi, useQuery } from "../hooks";

interface Resp {
  questions: { key: string; label: string; by_form: { form: string; total: number; answers: { value: string; count: number }[] }[] }[];
  meta: Meta;
}
interface CampResp {
  rows: { key: string; leads: number }[];
}

const NOT_INFORMED = "Não informado";
const pretty = (v: string) => (v === NOT_INFORMED ? v : v.replaceAll("_", " ").replace(/\s+/g, " ").trim());

function Select(props: { label: string; value: string | null; options: { key: string; leads: number }[]; onChange: (v: string | null) => void }) {
  return (
    <select
      class="pill-select"
      value={props.value ?? ""}
      onChange={(e) => props.onChange((e.target as HTMLSelectElement).value || null)}
      style="max-width:300px;border-radius:999px;height:30px"
      aria-label={props.label}
    >
      <option value="">{props.label}: todos</option>
      {props.options.map((o) => (
        <option value={o.key}>
          {o.key} ({fmtInt(o.leads)})
        </option>
      ))}
    </select>
  );
}

export function Perfil() {
  const q = useQuery();
  const campaign = q.get("campaign");
  const ad = q.get("ad");
  const form = q.get("form");
  const base = filterParams(q);
  base.delete("campaign");
  base.delete("ad");
  base.delete("form");
  const campaigns = useApi<CampResp>("/metrics/campaigns", new URLSearchParams([...base, ["level", "campaign"]]));
  const adsParams = new URLSearchParams([...base, ["level", "ad"]]);
  if (campaign) adsParams.set("campaign", campaign);
  const ads = useApi<CampResp>(campaign ? "/metrics/campaigns" : null, adsParams);
  const forms = useApi<CampResp>("/metrics/campaigns", new URLSearchParams([...base, ["level", "form"]]));
  const state = useApi<Resp>("/metrics/profile", filterParams(q));

  return (
    <>
      <div class="filters" style="padding-top:12px">
        <span class="mono-label">Cruzar com</span>
        <Select label="Campanha" value={campaign} options={campaigns.data?.rows ?? []} onChange={(v) => setQuery({ campaign: v, ad: null })} />
        {campaign && <Select label="Anúncio" value={ad} options={ads.data?.rows ?? []} onChange={(v) => setQuery({ ad: v })} />}
        <Select label="Formulário" value={form} options={forms.data?.rows ?? []} onChange={(v) => setQuery({ form: v })} />
      </div>
      <Async state={state} empty={(d) => d.questions.every((qq) => qq.by_form.length === 0)}>
        {(d) => (
          <div class="grid">
            {d.questions.map((qq) => (
              <Card key={qq.key} title={qq.label} sub="O que os leads responderam, separado por formulário">
                <div class="profile-forms">
                  {qq.by_form.map((f) => (
                    <div key={f.form}>
                      <h3>
                        {f.form} <span class="muted" style="font-family:var(--sans);font-size:12px">· {fmtInt(f.total)} leads</span>
                      </h3>
                      <BarList
                        items={f.answers.map((a, i) => ({
                          key: a.value,
                          label: pretty(a.value),
                          value: a.count,
                          aux: fmtPct(a.count / f.total),
                          color: a.value === NOT_INFORMED ? "var(--faint)" : PALETTE[i % PALETTE.length],
                        }))}
                      />
                    </div>
                  ))}
                </div>
                <Note>
                  Cada formulário aparece separado porque perguntas em idiomas e moedas diferentes (R$, US$, €) não podem ser somadas.{" "}
                  <b>Não informado</b> é quem não respondeu a pergunta.
                </Note>
              </Card>
            ))}
            <Source>
              <p>
                Respostas do formulário gravadas na Clint: <b>faturamento mensal</b> fica no negócio e <b>profissão</b> no contato. Para incluir uma
                nova pergunta, basta acrescentá-la em <code>PROFILE_FIELDS</code> — veja o README.
              </p>
            </Source>
          </div>
        )}
      </Async>
    </>
  );
}
