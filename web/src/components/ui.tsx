import type { ComponentChildren } from "preact";
import type { Loadable } from "../hooks";

type Span = 2 | 3 | 4 | 6 | 8 | 12;
export type Tone = "ok" | "warn" | "bad" | "accent" | undefined;

export function Card(props: { title?: string; sub?: ComponentChildren; span?: Span; actions?: ComponentChildren; className?: string; children: ComponentChildren }) {
  return (
    <section class={`card span-${props.span ?? 12} ${props.className ?? ""}`}>
      {(props.title || props.actions) && (
        <div class="card-head">
          <div class="titles">
            {props.title && <h2>{props.title}</h2>}
            {props.sub && <p class="sub">{props.sub}</p>}
          </div>
          {props.actions}
        </div>
      )}
      {props.children}
    </section>
  );
}

/** KPI card: mono label, big condensed number, short explanation; the left stripe carries the tone. */
export function Kpi(props: { label: string; value: string; desc?: ComponentChildren; tone?: Tone; span?: Span; tip?: ComponentChildren; onClick?: () => void }) {
  return (
    <section
      class={`card kpi span-${props.span ?? 3} ${props.tone ? `t-${props.tone}` : ""} ${props.tip ? "has-tip" : ""} ${props.onClick ? "clickable" : ""}`}
      tabIndex={props.tip || props.onClick ? 0 : undefined}
      role={props.onClick ? "button" : undefined}
      onClick={props.onClick}
      onKeyDown={(e) => props.onClick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), props.onClick())}
    >
      <div class="mono-label">
        {props.label}
        {props.tip && <span class="tip-hint"> ⓘ</span>}
        {props.onClick && <span class="tip-hint"> ↗</span>}
      </div>
      <div class={`value ${props.tone ? `tone-${props.tone}` : ""}`}>{props.value}</div>
      {props.desc && <div class="desc">{props.desc}</div>}
      {props.tip && <div class="kpi-tip" role="tooltip">{props.tip}</div>}
    </section>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  display?: string;
  aux?: string;
  color?: string;
  onClick?: () => void;
}

/** Horizontal bars proportional to the largest value of the list. */
export function BarList({ items, color, auxWidth }: { items: BarItem[]; color?: string; auxWidth?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  // Fixed aux column so every bar in the list starts and ends at the same x.
  const longestAux = Math.max(0, ...items.map((i) => (i.aux ?? "").length));
  const auxW = auxWidth ?? Math.min(240, Math.ceil(longestAux * 6.6));
  return (
    <div class="barlist" style={{ "--aux-w": `${auxW}px` }}>
      {items.map((i) => (
        <div key={i.key} class={`item ${i.onClick ? "clickable" : ""}`} onClick={i.onClick} title={i.label}>
          <span class="label">{i.label}</span>
          <span class="track">
            <span class="fill" style={{ width: `${Math.max(i.value > 0 ? 1.5 : 0, (i.value / max) * 100)}%`, background: i.color ?? color ?? "var(--accent)" }} />
          </span>
          <span class="aux">{i.aux ?? ""}</span>
          <span class="val">{i.display ?? i.value.toLocaleString("pt-BR")}</span>
        </div>
      ))}
    </div>
  );
}

export function Note({ children }: { children: ComponentChildren }) {
  return <p class="note">{children}</p>;
}

/** "De onde vem este número": where the data on the page comes from. */
export function Source({ children }: { children: ComponentChildren }) {
  return (
    <Card title="De onde vem este número" sub="Dados da Clint e do Meta Ads, atualizados a cada 30 minutos" className="source">
      {children}
    </Card>
  );
}

/** Loading / error / empty states shared by every page. */
export function Async<T>(props: { state: Loadable<T>; empty?: (d: T) => boolean; children: (d: T) => ComponentChildren }) {
  const { data, error, loading } = props.state;
  if (!data && loading) return <div class="state">Carregando…</div>;
  if (!data && error) return <div class="state error">{error}</div>;
  if (!data) return null;
  if (props.empty?.(data)) return <div class="state">Nenhum dado para os filtros selecionados.</div>;
  return <>{props.children(data)}</>;
}
