import type { ComponentChildren } from "preact";
import { fmtDay, fmtInt } from "../format";

// Building blocks of the launch layout (substats strip, day bars, toggles, resumo).

/** Thin strip of secondary numbers under the KPIs ("CTR 1,42% · Connect rate 66%"). */
export function SubStats({ items }: { items: [string, string][] }) {
  return (
    <div class="substats">
      {items.map(([k, v]) => (
        <span class="ss">
          <span class="k">{k}</span>
          <span class="v">{v}</span>
        </span>
      ))}
    </div>
  );
}

export interface DayBar {
  date: string;
  total: number;
  /** part of the bar drawn in the main color at the base (e.g. paid traffic); the rest in the second color */
  part?: number;
  /** text under the bar (e.g. spend of the day) */
  below?: string;
}

/** Vertical bars per day with the value on top and an optional line below (reference chart). */
export function DayBars({ days, single }: { days: DayBar[]; single?: boolean }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  if (!days.length) return <div class="state">Sem dias no período</div>;
  return (
    <div class={`dchart ${days.length > 31 ? "dense" : ""}`}>
      {days.map((d) => (
        <div class="col" title={`${fmtDay(d.date)} · ${fmtInt(d.total)}`}>
          <div class="barwrap">
            <div class={`bar ${single ? "single" : ""}`} style={{ height: `${Math.max(d.total ? 3 : 1, (d.total / max) * 100)}%` }}>
              <span class="n">{d.total ? fmtInt(d.total) : ""}</span>
              {!single && <div class="pg" style={{ height: `${d.total ? Math.min(100, ((d.part ?? 0) / d.total) * 100) : 0}%` }} />}
            </div>
          </div>
          {d.below !== undefined && <div class="dspend">{d.below}</div>}
          <div class="dl">{fmtDay(d.date)}</div>
        </div>
      ))}
    </div>
  );
}

export function Toggle<K extends string>(props: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <div class="rtoggle" role="group">
      {props.options.map((o) => (
        <button type="button" class={`tbtn ${o.key === props.value ? "on" : ""}`} onClick={() => props.onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: ComponentChildren }) {
  return <div class="secttl">{children}</div>;
}

/** Resumo: grid of the main numbers and a button that copies a WhatsApp-ready text. */
export function Resumo({ title, items }: { title: string; items: [string, string][] }) {
  const text = [title, ...items.map(([k, v]) => `${k}: ${v}`)].join("\n");
  return (
    <>
      <div class="rgrid">
        {items.map(([k, v]) => (
          <div class="ri">
            <div class="k">{k}</div>
            <div class="v">{v}</div>
          </div>
        ))}
      </div>
      <button
        type="button"
        class="btn primary rcopy"
        onClick={(e) => {
          const b = e.currentTarget as HTMLButtonElement;
          navigator.clipboard?.writeText(text).then(
            () => {
              b.textContent = "Copiado ✓";
              setTimeout(() => (b.textContent = "Copiar resumo"), 1800);
            },
            () => {},
          );
        }}
      >
        Copiar resumo
      </button>
    </>
  );
}
