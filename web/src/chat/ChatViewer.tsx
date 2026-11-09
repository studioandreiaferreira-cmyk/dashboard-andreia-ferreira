import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { dayKeySP, fmtDayLabel, fmtPhone, fmtSeconds, fmtTime } from "../format";
import "./chat.css";

interface ContactChats {
  contact: { id: string; name: string | null; phone: string | null };
  deals: { id: string; origin: string | null; stage: string | null; status: string; responsible: string | null }[];
  chats: { id: string; channel: string; last_message_at: string | null; status: string }[];
  clint_url: string | null;
}

interface Msg {
  id: string;
  created_at: string;
  side: "lead" | "seller" | "system";
  seller_name: string | null;
  content_type: string;
  text: string | null;
  media: { url: string | null; name: string | null; seconds: number | null } | null;
  reactions: string[];
}

/** Opens the conversation viewer for a contact from anywhere in the app. */
export function openChat(contactId: string) {
  window.dispatchEvent(new CustomEvent("af:open-chat", { detail: contactId }));
}

const MEDIA_LABEL: Record<string, string> = { IMAGE: "🖼️ Imagem", AUDIO: "🎤 Áudio", VIDEO: "🎬 Vídeo", DOCUMENT: "📄 Documento", STICKER: "Figurinha" };

function Media({ m, onZoom }: { m: Msg; onZoom: (url: string, video: boolean) => void }) {
  const media = m.media!;
  if (!media.url) return <div class="media-missing">{MEDIA_LABEL[m.content_type] ?? m.content_type}</div>;
  switch (m.content_type) {
    case "AUDIO":
      return (
        <div class="audio">
          <audio controls preload="none" src={media.url} />
          {media.seconds ? <span class="muted">{fmtSeconds(media.seconds)}</span> : null}
        </div>
      );
    case "IMAGE":
    case "STICKER":
      return <img class="thumb" src={media.url} alt={media.name ?? "Imagem"} loading="lazy" onClick={() => onZoom(media.url!, false)} />;
    case "VIDEO":
      return (
        <button class="video-thumb" onClick={() => onZoom(media.url!, true)}>
          <video src={media.url} preload="metadata" muted />
          <span class="play">▶</span>
        </button>
      );
    default:
      return (
        <a class="doc" href={media.url} target="_blank" rel="noopener noreferrer">
          📄 {media.name ?? "Documento"}
        </a>
      );
  }
}

function Messages({ chatId }: { chatId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]); // oldest first
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ url: string; video: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const keepFromBottom = useRef<number | null>(null);

  const load = async (next: number) => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await api<{ has_more: boolean; messages: Msg[] }>(`/chats/${chatId}/messages`, { page: String(next) });
      if (box.current) keepFromBottom.current = box.current.scrollHeight - box.current.scrollTop;
      setMsgs((cur) => [...[...r.messages].reverse(), ...cur]);
      setHasMore(r.has_more);
      setPage(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMsgs([]);
    setPage(0);
    setHasMore(true);
    keepFromBottom.current = null;
    load(1);
  }, [chatId]);

  // First page: jump to the newest message; older pages: keep the user's position.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollTop = keepFromBottom.current === null || page <= 1 ? el.scrollHeight : el.scrollHeight - keepFromBottom.current;
  }, [msgs]);

  const onScroll = () => {
    if (box.current && box.current.scrollTop < 80 && hasMore && !loading) load(page + 1);
  };

  let lastDay = "";
  return (
    <div class="chat-body" ref={box} onScroll={onScroll}>
      {loading && <div class="chat-note">Carregando mensagens…</div>}
      {!hasMore && msgs.length > 0 && <div class="chat-note">Início da conversa</div>}
      {error && <div class="chat-note error">{error}</div>}
      {!loading && !error && msgs.length === 0 && <div class="chat-note">Nenhuma mensagem encontrada</div>}
      {msgs.map((m) => {
        const day = dayKeySP(m.created_at);
        const sep = day !== lastDay ? <div class="day-sep"><span>{fmtDayLabel(m.created_at)}</span></div> : null;
        lastDay = day;
        if (m.side === "system") {
          return (
            <>
              {sep}
              <div class="sys" key={m.id}>{m.text ?? "Evento do sistema"} · {fmtTime(m.created_at)}</div>
            </>
          );
        }
        return (
          <>
            {sep}
            <div class={`row ${m.side}`} key={m.id}>
              <div class="bubble">
                {m.side === "seller" && <div class="who">{m.seller_name}</div>}
                {m.media && <Media m={m} onZoom={(url, video) => setZoom({ url, video })} />}
                {m.text && <div class="text">{m.text}</div>}
                {!m.text && !m.media && <div class="text muted">[{m.content_type}]</div>}
                <div class="time">{fmtTime(m.created_at)}</div>
                {m.reactions.length > 0 && <div class="reactions">{m.reactions.join(" ")}</div>}
              </div>
            </div>
          </>
        );
      })}
      {zoom && (
        <div class="lightbox" onClick={() => setZoom(null)}>
          {zoom.video ? <video src={zoom.url} controls autoPlay onClick={(e) => e.stopPropagation()} /> : <img src={zoom.url} alt="" />}
        </div>
      )}
    </div>
  );
}

/** Read-only, WhatsApp-style conversation drawer (FR-031..035). */
export function ChatViewer() {
  const [contactId, setContactId] = useState<string | null>(null);
  const [info, setInfo] = useState<ContactChats | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (e: Event) => setContactId((e as CustomEvent<string>).detail);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setContactId(null);
    window.addEventListener("af:open-chat", open);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("af:open-chat", open);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  useEffect(() => {
    setInfo(null);
    setChatId(null);
    setError(null);
    if (!contactId) return;
    api<ContactChats>(`/contacts/${contactId}/chats`)
      .then((r) => {
        setInfo(r);
        setChatId(r.chats[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [contactId]);

  if (!contactId) return null;
  const deal = info?.deals[0];
  return (
    <div class="chat-overlay" onClick={() => setContactId(null)}>
      <div class="chat-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Conversa">
        <header class="chat-head">
          <div class="avatar">{(info?.contact.name ?? "?").slice(0, 1).toUpperCase()}</div>
          <div class="who-block">
            <div class="name">{info?.contact.name ?? "Carregando…"}</div>
            <div class="meta">
              {fmtPhone(info?.contact.phone ?? null)}
              {deal && ` · ${deal.origin ?? "—"} · ${deal.stage ?? "—"} · ${deal.responsible ?? "Sem responsável"}`}
            </div>
          </div>
          {info?.clint_url && (
            <a class="btn small" href={info.clint_url} target="_blank" rel="noopener noreferrer">
              Abrir na Clint
            </a>
          )}
          <button class="btn small" onClick={() => setContactId(null)} aria-label="Fechar">✕</button>
        </header>
        {info && info.chats.length > 1 && (
          <div class="chat-switch">
            {info.chats.map((c) => (
              <button class={`btn small ${c.id === chatId ? "active" : ""}`} onClick={() => setChatId(c.id)}>
                {c.channel}
              </button>
            ))}
          </div>
        )}
        {error && <div class="chat-note error">{error}</div>}
        {info && !chatId && <div class="chat-body"><div class="chat-note">Nenhuma conversa encontrada para este contato.</div></div>}
        {chatId && <Messages chatId={chatId} />}
        <footer class="chat-foot">Somente leitura · para responder, use a Clint</footer>
      </div>
    </div>
  );
}
