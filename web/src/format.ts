const TZ = "America/Sao_Paulo";

export const fmtInt = (n: number) => n.toLocaleString("pt-BR");
export const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

/** Business wait time; beyond one business day (9h) it is shown in business days. */
export function fmtBusinessMinutes(min: number, minutesPerDay = 9 * 60): string {
  if (min >= minutesPerDay) {
    const days = Math.floor(min / minutesPerDay);
    return `${days} ${days === 1 ? "dia útil" : "dias úteis"}`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min úteis`;
  return `${h}h${m ? ` ${m}min` : ""} úteis`;
}

export function dayKeySP(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

export function fmtDayLabel(iso: string): string {
  const key = dayKeySP(iso);
  const today = dayKeySP(new Date().toISOString());
  const yesterday = dayKeySP(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Hoje";
  if (key === yesterday) return "Ontem";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtPhone(p: string | null): string {
  if (!p) return "—";
  const m = p.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${p}`;
}

export function fmtSeconds(s: number | null): string {
  if (!s) return "";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** R$ with cents below 1.000 and without above (reference style: "R$ 423.110", "R$ 30,93"). */
export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
export const brl0 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
/** a ÷ b as R$ or "—" when there is nothing to divide by */
export const brlPer = (a: number, b: number) => (b > 0 && a > 0 ? brl(a / b) : "—");
export const pctOf = (a: number, b: number, digits = 0) =>
  b > 0 ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%` : "—";
