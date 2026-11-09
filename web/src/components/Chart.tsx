import Chart from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import { useEffect, useRef } from "preact/hooks";

// Andreia Ferreira palette: caramel and rose first (series 1 / 2), then brown, gold and supporting tones.
export const PALETTE = ["#a77e62", "#cfaca3", "#452f20", "#d1b183", "#7c5424", "#ba938c", "#e3c9b9", "#b58d72", "#8f7464", "#eddccd"];
export const GREY = "#e8d8cb";
export const TONES = { ok: "#7c5424", warn: "#d1b183", bad: "#ba938c", accent: "#a77e62", muted: "#b9a293" };

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Thin Chart.js wrapper; re-creates the chart whenever the config changes. */
export function ChartView({ config, tall }: { config: ChartConfiguration; tall?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    Chart.defaults.color = cssVar("--faint");
    Chart.defaults.borderColor = cssVar("--line");
    Chart.defaults.font.family = cssVar("--font");
    Chart.defaults.font.size = 10.5;
    Chart.defaults.plugins.legend.labels.boxWidth = 9;
    Chart.defaults.plugins.legend.labels.boxHeight = 9;
    Chart.defaults.plugins.tooltip.backgroundColor = "#452f20";
    Chart.defaults.plugins.tooltip.borderColor = "#452f20";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.datasets.bar.borderRadius = 5;
    Chart.defaults.datasets.bar.maxBarThickness = 28;
    // Category axes read better without vertical grid lines.
    const opts = { responsive: true, maintainAspectRatio: false, ...config.options } as Record<string, any>;
    const catAxis = opts.indexAxis === "y" ? "y" : "x";
    opts.scales = { ...opts.scales, [catAxis]: { ...opts.scales?.[catAxis], grid: { display: false, ...opts.scales?.[catAxis]?.grid } } };
    const chart = new Chart(ref.current, { ...config, options: opts });
    return () => chart.destroy();
  }, [JSON.stringify(config.data), JSON.stringify(config.options ?? {}), config.type]);
  return (
    <div class={`chart-box ${tall ? "tall" : ""}`}>
      <canvas ref={ref} />
    </div>
  );
}
