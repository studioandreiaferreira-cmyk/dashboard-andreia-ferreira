import type { Meta } from "../api";
import { fmtDateTime, fmtTime } from "../format";

export function SyncInfo({ meta }: { meta: Meta | null }) {
  if (!meta) return null;
  return <span class="sync">{meta.last_sync_at ? `lido às ${fmtTime(meta.last_sync_at)}` : "ainda não sincronizado"}</span>;
}

/** Global warning when the last sync is old or failed (data is kept, never zeroed). */
export function StaleBanner({ meta }: { meta: Meta | null }) {
  if (!meta || meta.sync_ok) return null;
  return (
    <div class="banner warn">
      Os dados podem estar desatualizados{meta.last_sync_at ? ` (última leitura ${fmtDateTime(meta.last_sync_at)})` : ""}.
      {meta.last_error ? ` Erro na sincronização: ${meta.last_error}` : ""}
    </div>
  );
}

/** Message-based views only cover the rolling 90-day window (FR-001a). */
export function WindowNote({ meta }: { meta: Meta | null }) {
  if (!meta?.message_window_truncated) return null;
  return <div class="banner warn">O histórico de mensagens cobre apenas os últimos 90 dias; dias anteriores não aparecem nesta visão.</div>;
}
