import { useRef } from 'react';
import { Avatar } from './Avatar';
import { proxyUrl, type Message as Msg, type User } from '../api';

interface Props {
  msg: Msg;
  isMine: boolean;
  consec: boolean;
  sender: User | null;
  onReply?: (msg: Msg) => void;
  onOpenEphemeral?: (msg: Msg) => void;
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

export function Message({ msg, isMine, consec, sender, onReply, onOpenEphemeral }: Props) {
  const status = msg._pending ? 'opacity-55' : msg._failed ? 'bg-red-500/20' : '';
  const showAvatar = !isMine && !consec;
  const consecCls = consec
    ? (isMine ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]')
    : (isMine ? 'rounded-br-[4px]' : 'rounded-bl-[4px]');

  // Long-press declenche reply (sauf si pending/failed)
  const canReply = !msg._pending && !msg._failed && !!onReply;
  const longPressProps = useLongPress(canReply ? () => onReply!(msg) : undefined);

  // Reply preview (si ce message repond a un autre)
  const replyPreview = msg.reply ? (
    <div className={`text-xs text-[var(--color-muted)] px-3 -mb-1 truncate max-w-[78%] flex items-center gap-1 ${
      isMine ? 'self-end' : 'self-start ml-9'
    }`}>
      <span className="opacity-60">↩</span>
      <span className="truncate opacity-80">
        {msg.reply.text || `[${fmtPreviewType(msg.reply.item_type)}]`}
      </span>
    </div>
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

  // Photo / video
  if (msg.media?.thumbnail_url || msg._localPhotoUrl) {
    const thumb = msg._localPhotoUrl || proxyUrl(msg.media?.thumbnail_url);
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <div {...longPressProps} className={`max-w-[60%] rounded-[18px] overflow-hidden ${status}`}>
            {msg.media?.video_url ? (
              <video controls preload="metadata"
                poster={proxyUrl(msg.media.thumbnail_url)}
                src={proxyUrl(msg.media.video_url)}
                className="block w-full max-h-[280px] object-cover" />
            ) : (
              <img src={thumb} alt="" loading="lazy"
                className="block w-full max-h-[280px] object-cover" />
            )}
          </div>
        </Row>
      </Wrapper>
    );
  }

  // GIF
  if (msg.animated_media?.url) {
    return (
      <Wrapper replyPreview={replyPreview} isMine={isMine}>
        <Row isMine={isMine}>
          {showAvatar && <Avatar url={sender?.profile_pic_url} name={sender?.username} size="sm" />}
          {!showAvatar && !isMine && <div className="w-7 invisible" />}
          <div {...longPressProps} className={`max-w-[60%] rounded-[18px] overflow-hidden ${status}`}>
            <img src={proxyUrl(msg.animated_media.url)} alt="GIF" className="block w-full" />
          </div>
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

  // Photo / video ephemere — cliquable pour ouvrir
  if (msg.visual_media && (msg.visual_media.image_url || msg.visual_media.video_url)) {
    const hasContent = !!(msg.visual_media.image_url || msg.visual_media.video_url);
    const isVideo = !!msg.visual_media.video_url;
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
            } ${status}`}
          >
            <span>🔥</span>
            <span className="text-sm">
              {isVideo ? 'Vidéo éphémère' : 'Photo éphémère'} — toucher pour voir
            </span>
          </button>
        </Row>
      </Wrapper>
    );
  }

  // Placeholders pour les autres types non gérés
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
    <div className={`flex gap-2 items-end max-w-full ${isMine ? 'flex-row-reverse' : ''}`}>
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
