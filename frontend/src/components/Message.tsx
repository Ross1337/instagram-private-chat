import { useRef, useSyncExternalStore } from 'react';
import { Avatar } from './Avatar';
import { proxyUrl, type Message as Msg, type User } from '../api';
import { ephemeralSeenVersion, isEphemeralSeen as _isSeen, subscribeEphemeralSeen } from '../ephemeralSeen';

// Re-render le composant quand un ephemere est marque vu (subscription store React 18+)
function useEphemeralSeen(id: string): boolean {
  useSyncExternalStore(subscribeEphemeralSeen, ephemeralSeenVersion);
  return _isSeen(id);
}

interface Props {
  msg: Msg;
  isMine: boolean;
  consec: boolean;
  sender: User | null;
  onReply?: (msg: Msg) => void;
  onOpenEphemeral?: (msg: Msg) => void;
  onOpenMedia?: (imageUrl: string | null, videoUrl: string | null) => void;
}

function fmtPreviewType(item_type: string | null | undefined): string {
  return item_type || 'message';
}

function useLongPress(onLongPress: (() => void) | undefined, ms = 500) {
  const timerRef = useRef<number | null>(null);
  if (!onLongPress) return {};
  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Ne pas declencher si on touche un controle (audio/video)
      const target = e.target as HTMLElement;
      if (target.closest('audio, video, button, input')) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onLongPress();
      }, ms);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onPointerMove: cancel,
  };
}

export function Message({ msg, isMine, consec, sender, onReply, onOpenEphemeral, onOpenMedia }: Props) {
  const status = msg._pending ? 'opacity-55' : msg._failed ? 'bg-red-500/20' : '';
  const showAvatar = !isMine && !consec;
  const consecCls = consec
    ? (isMine ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]')
    : (isMine ? 'rounded-br-[4px]' : 'rounded-bl-[4px]');

  // Hooks toujours en haut (Rules of Hooks)
  const canReply = !msg._pending && !msg._failed && !!onReply;
  const longPressProps = useLongPress(canReply ? () => onReply!(msg) : undefined);
  const ephemeralSeen = useEphemeralSeen(msg.id);

  // Reply preview style IG : petite bulle grise au-dessus de la reponse,
  // cliquable pour scroller au message original avec flash de highlight.
  const replyPreview = msg.reply ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const id = msg.reply?.id;
        if (!id) return;
        const el = document.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('msg-flash');
          setTimeout(() => el.classList.remove('msg-flash'), 1500);
        }
      }}
      className={`flex flex-col gap-1 max-w-[78%] mb-2 cursor-pointer ${
        isMine ? 'self-end items-end' : 'self-start items-start ml-9'
      }`}
    >
      <div className="text-[11px] text-[var(--color-muted)] px-2 flex items-center gap-1">
        <span>↩</span>
        <span>Réponse</span>
      </div>
      <div className="bg-[var(--color-surface)] text-[var(--color-muted)] text-[13px] px-3 py-2 rounded-[14px] truncate max-w-full opacity-80 active:opacity-60 text-left">
        {msg.reply.text || `[${fmtPreviewType(msg.reply.item_type)}]`}
      </div>
    </button>
  ) : null;

  // Voice / audio
  if (msg.media?.audio_url) {
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <div {...longPressProps} className={`max-w-[78%] rounded-[18px] px-2 py-1.5 ${consecCls} ${
            isMine ? 'msg-me-grad text-white' : 'bg-[var(--color-bubble-them)]'
          } ${status}`}>
            <audio controls preload="none" src={proxyUrl(msg.media.audio_url)} className="block h-8 min-w-[200px]" />
          </div>
        </Row>
      </Wrapper>
    );
  }

  // Photo / video — clickable pour fullscreen
  if (msg.media?.thumbnail_url || msg._localPhotoUrl) {
    const thumb = msg._localPhotoUrl || proxyUrl(msg.media?.thumbnail_url);
    const handleOpen = () => {
      if (!onOpenMedia) return;
      const imgUrl = msg._localPhotoUrl || proxyUrl(msg.media?.thumbnail_url) || null;
      const vidUrl = proxyUrl(msg.media?.video_url) || null;
      onOpenMedia(imgUrl, vidUrl);
    };
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <button {...longPressProps} onClick={handleOpen}
            className={`max-w-[60%] rounded-[18px] overflow-hidden ${status} cursor-zoom-in`}>
            {msg.media?.video_url ? (
              <video preload="metadata"
                poster={proxyUrl(msg.media.thumbnail_url)}
                src={proxyUrl(msg.media.video_url)}
                className="block w-full max-h-[280px] object-cover pointer-events-none" />
            ) : (
              <img src={thumb} alt="" loading="lazy"
                className="block w-full max-h-[280px] object-cover" />
            )}
          </button>
        </Row>
      </Wrapper>
    );
  }

  // GIF — clickable pour fullscreen
  if (msg.animated_media?.url) {
    const url = proxyUrl(msg.animated_media.url) || null;
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <button onClick={() => onOpenMedia?.(url, null)}
            className={`max-w-[60%] rounded-[18px] overflow-hidden ${status} cursor-zoom-in`}>
            <img src={url ?? undefined} alt="GIF" className="block w-full" />
          </button>
        </Row>
      </Wrapper>
    );
  }

  // xma_share : posts/reels partages. Click = preview fullscreen local.
  // (Le code IG permalien n'est pas dans le payload — Meta l'a degrade.)
  if (msg.xma_share && msg.xma_share.preview_url) {
    const preview = proxyUrl(msg.xma_share.preview_url) ?? null;
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <button onClick={() => preview && onOpenMedia?.(preview, null)}
            className={`max-w-[78%] rounded-[18px] overflow-hidden ${
              isMine ? 'msg-me-grad' : 'bg-[var(--color-bubble-them)]'
            } ${status} cursor-zoom-in`}>
            {preview && (
              <img src={preview} alt="" loading="lazy"
                className="block w-full max-h-[280px] object-cover" />
            )}
            <div className="px-3 py-2 flex items-center gap-2 text-white text-sm">
              <span>📌</span>
              <span className="font-semibold truncate flex-1 text-left">{msg.xma_share.title || 'Contenu partagé'}</span>
            </div>
          </button>
        </Row>
      </Wrapper>
    );
  }

  // Like (heart)
  if (msg.item_type === 'like') {
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <div {...longPressProps} className={`text-[32px] px-3 py-1 ${status}`}>❤️</div>
        </Row>
      </Wrapper>
    );
  }

  // Texte (par défaut)
  if (msg.text) {
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <div {...longPressProps} className={`max-w-[78%] px-3 py-2 rounded-[18px] whitespace-pre-wrap break-words text-[14.5px] ${consecCls} ${
            isMine ? 'msg-me-grad text-white' : 'bg-[var(--color-bubble-them)]'
          } ${status}`}>
            {msg.text}
          </div>
        </Row>
      </Wrapper>
    );
  }

  // Photo / video ephemere — cliquable pour ouvrir, garde l'historique vu
  if (msg.visual_media && (msg.visual_media.image_url || msg.visual_media.video_url)) {
    const hasContent = !!(msg.visual_media.image_url || msg.visual_media.video_url);
    const isVideo = !!msg.visual_media.video_url;
    const alreadySeen = ephemeralSeen;
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <button
            {...longPressProps}
            onClick={() => onOpenEphemeral && hasContent && onOpenEphemeral(msg)}
            className={`max-w-[78%] px-4 py-3 rounded-[18px] flex items-center gap-2 ${consecCls} ${
              isMine ? 'msg-me-grad text-white' : 'bg-[var(--color-bubble-them)]'
            } ${alreadySeen ? 'opacity-70' : ''} ${status}`}
          >
            <span>{alreadySeen ? '✓' : '🔥'}</span>
            <span className="text-sm">
              {isVideo ? 'Vidéo éphémère' : 'Photo éphémère'}
              {alreadySeen ? ' — déjà vue, toucher pour revoir' : ' — toucher pour voir'}
            </span>
          </button>
        </Row>
      </Wrapper>
    );
  }

  // Reel ou post partage : si on a le code IG, on ouvre dans un nouvel onglet
  if ((msg.clip || msg.media_share) && (msg.clip?.code || msg.media_share?.code)) {
    const isReel = !!msg.clip;
    const ref = msg.clip || msg.media_share!;
    const url = isReel
      ? `https://www.instagram.com/reel/${ref.code}/`
      : `https://www.instagram.com/p/${ref.code}/`;
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`max-w-[78%] rounded-[18px] overflow-hidden block ${consecCls} ${
              isMine ? 'msg-me-grad' : 'bg-[var(--color-bubble-them)]'
            } ${status}`}
            {...longPressProps}
          >
            {ref.thumbnail_url && (
              <img src={proxyUrl(ref.thumbnail_url)} alt=""
                className="block w-full max-h-[280px] object-cover" />
            )}
            <div className="px-3 py-2 flex items-center gap-2 text-white text-sm">
              <span>{isReel ? '🎞️' : '📌'}</span>
              <span className="font-semibold">{isReel ? 'Reel' : 'Post'}</span>
              <span className="opacity-60 text-xs ml-auto">↗ ouvrir</span>
            </div>
            {ref.caption && (
              <div className="px-3 pb-2 text-xs text-white/70 line-clamp-2">{ref.caption}</div>
            )}
          </a>
        </Row>
      </Wrapper>
    );
  }

  // Placeholders pour les autres types non geres
  let label = '';
  if (msg.visual_media) label = '🔥 Photo éphémère (expirée)';
  else if (msg.clip) label = '🎞️ Reel partagé';
  else if (msg.media_share) label = '📌 Post partagé';
  else label = `[${fmtPreviewType(msg.item_type)}]`;

  return (
    <Wrapper replyPreview={replyPreview} isMine={isMine}>
      <Row isMine={isMine}>
        {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
        {!showAvatar && !isMine && <div className="w-7 invisible" />}
        <div className={`max-w-[78%] px-3 py-2 rounded-[18px] italic text-[var(--color-muted)] bg-[var(--color-surface)] ${consecCls} ${status}`}>
          {label}
        </div>
      </Row>
    </Wrapper>
  );
}

function Row({ isMine, children }: { isMine: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex gap-2 items-end w-full ${isMine ? 'flex-row-reverse' : ''}`}>
      {children}
    </div>
  );
}

function Wrapper({ replyPreview, isMine, children }: {
  replyPreview: React.ReactNode;
  isMine: boolean;
  children: React.ReactNode;
}) {
  if (!replyPreview) return <>{children}</>;
  return (
    <div className={`flex flex-col gap-0 ${isMine ? 'items-end' : 'items-start'}`}>
      {replyPreview}
      {children}
    </div>
  );
}
