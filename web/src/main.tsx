import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { dataInfo, reloadData, type Meta } from "./api";
import { ChatViewer } from "./chat/ChatViewer";
import { FilterBar, PeriodPicker, type FilterOptions } from "./components/FilterBar";
import { StaleBanner } from "./components/StaleBanner";
import { fmtDateTime } from "./format";
import { useApi, useQuery } from "./hooks";
import { Utm } from "./pages/Utm";
import { Lancamento } from "./pages/Lancamento";
import { Vendas } from "./pages/Vendas";
import { Crm } from "./pages/Crm";
import { Entrada } from "./pages/Entrada";
import { Parados } from "./pages/Parados";
import { Perfil } from "./pages/Perfil";
import { SemResposta } from "./pages/SemResposta";
import { Vendedores } from "./pages/Vendedores";
import "./styles.css";

const TABS = [
  { view: "lancamento", label: "Lançamento", page: Lancamento },
  { view: "crm", label: "CRM", page: Crm },
  { view: "utm", label: "UTM", page: Utm },
  { view: "sem-resposta", label: "Sem resposta", page: SemResposta, noPeriod: true },
  { view: "vendedores", label: "Vendedores", page: Vendedores },
  { view: "entrada", label: "Entrada", page: Entrada },
  { view: "parados", label: "Parados", page: Parados, noPeriod: true },
  { view: "perfil", label: "Perfil dos leads", page: Perfil },
  { view: "vendas", label: "Vendas", page: Vendas },
] as const;

// The page lives under a secret path (/<slug>/), so the tab is a query parameter, not a path.
function useView(): [string, (v: string) => void] {
  const q = useQuery();
  const view = q.get("v") ?? TABS[0].view;
  const go = (v: string) => {
    const next = new URLSearchParams(location.search);
    next.delete("sort");
    next.delete("page");
    if (v === TABS[0].view) next.delete("v");
    else next.set("v", v);
    const s = next.toString();
    history.pushState(null, "", `${location.pathname}${s ? `?${s}` : ""}`);
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("af:query"));
  };
  return [view, go];
}

const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 3v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 9" />
    <path d="M3 21v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 15" />
  </svg>
);
const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
const PdfIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 18v-6M9 15l3 3 3-3" />
  </svg>
);

const THEME_KEY = "af-theme";
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, root.dataset.theme);
  } catch {}
  window.dispatchEvent(new Event("af:refresh"));
}
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}

/** Re-downloads the data file every 10 minutes while the tab is visible. */
function useAutoReload() {
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && reloadData(), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
}

function Hero({ meta, generatedAt }: { meta: Meta | null; generatedAt: string | null }) {
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    reloadData().finally(() => setBusy(false));
  };
  const synced = meta?.last_sync_at ?? generatedAt;
  return (
    <div class="hero">
      <div class="brand">
        <span class="mark" role="img" aria-label="Andreia Ferreira" />
        <div class="wsub">Painel<br />comercial</div>
      </div>
      <div>
        <span class="kicker">Clint · Meta Ads · somente leitura</span>
        <h1>
          Comercial <span class="sub">CRM Clint · Meta Ads</span>
        </h1>
      </div>
      <div class="meta">
        <button class="iconbtn" title="Tema claro / escuro" onClick={toggleTheme}>
          <MoonIcon />
        </button>
        <button class={`iconbtn ${busy ? "spin" : ""}`} title="Atualizar" onClick={refresh}>
          <RefreshIcon />
        </button>
        <button class="iconbtn" title="Baixar PDF" onClick={() => window.print()}>
          <PdfIcon />
        </button>
        <span class={`chip ${meta && !meta.sync_ok ? "warn" : ""}`}>
          <span class={`dot ${meta && !meta.sync_ok ? "warn" : ""}`} /> ao vivo · atualiza a cada 30 min
        </span>
        <span class="chip plain">
          dados de <span class="mono">{synced ? fmtDateTime(synced) : "—"}</span>
        </span>
      </div>
    </div>
  );
}

function Dashboard() {
  const [view, go] = useView();
  const tab = TABS.find((t) => t.view === view) ?? TABS[0];
  const q = useQuery();
  useAutoReload();
  // Option counts follow the selected period.
  const period = new URLSearchParams();
  if (q.get("from")) period.set("from", q.get("from")!);
  if (q.get("to")) period.set("to", q.get("to")!);
  const filters = useApi<FilterOptions & { meta: Meta }>("/filters", period);
  const noReply = useApi<{ total: number }>("/metrics/no-reply", new URLSearchParams(), 5 * 60_000);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  useEffect(() => {
    const on = () => dataInfo().then((d) => setGeneratedAt(d.generatedAt));
    on();
    window.addEventListener("af:refresh", on);
    return () => window.removeEventListener("af:refresh", on);
  }, []);
  const Page = tab.page;
  const noPeriod = "noPeriod" in tab && tab.noPeriod;
  return (
    <div class="wrap">
      <Hero meta={filters.data?.meta ?? null} generatedAt={generatedAt} />
      <nav class="vtoggle">
        {TABS.map((t) => (
          <a
            href={`?v=${t.view}`}
            class={`vbtn ${t.view === tab.view ? "on" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              go(t.view);
            }}
          >
            {t.label}
            {t.view === "sem-resposta" && (noReply.data?.total ?? 0) > 0 && <span class="count">{noReply.data!.total}</span>}
          </a>
        ))}
      </nav>
      <div class="controls">
        {noPeriod ? <span class="nowpill">Situação de agora · não muda com o período</span> : <PeriodPicker />}
      </div>
      <StaleBanner meta={filters.data?.meta ?? null} />
      <div class="controls">
        <FilterBar options={filters.data} />
      </div>
      <Page />
      <p class="foot-note">Andreia Ferreira · Clint + Meta Ads · somente leitura · dados atualizados a cada 30 min</p>
      <ChatViewer />
    </div>
  );
}

function App() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    dataInfo().then(
      () => setReady(true),
      (e: Error) => setError(e.message),
    );
  }, []);
  if (error) return <div class="state error">Não foi possível carregar os dados do dash. {error}</div>;
  if (!ready) return <div class="state">Carregando os dados…</div>;
  return <Dashboard />;
}

render(<App />, document.getElementById("app")!);
