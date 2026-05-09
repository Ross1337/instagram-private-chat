import { useQuery } from '@tanstack/react-query';
import { api, type ThreadSummary, type Me } from '../api';
import { Avatar } from './Avatar';
import { fmtTime } from '../utils';

interface Props {
  me: Me | null;
  onOpen: (id: string) => void;
}

function previewText(t: ThreadSummary): string {
  const m = t.last_message;
  if (!m) return '';
  if (m.text) return m.text;
  if (m.media?.audio_url) return '🎤 Message vocal';
  if (m.media?.video_url) return '🎬 Vidéo';
  if (m.media?.thumbnail_url) return '📷 Photo';
  if (m.animated_media) return '🎞️ GIF';
  if (m.visual_media) return '🔥 Photo éphémère';
  if (m.clip) return '🎞️ Reel partagé';
  if (m.media_share) return '📌 Post partagé';
  if (m.item_type === 'like') return '❤️';
  return `[${m.item_type || 'message'}]`;
}

function pickName(t: ThreadSummary, mePk: string | null): string {
  if (t.title) return t.title;
  const others = mePk ? t.users.filter(u => u.pk !== mePk) : t.users;
  if (others.length === 1) return others[0].full_name || others[0].username;
  if (others.length === 0) return '(moi)';
  return others.map(u => u.username).slice(0, 3).join(', ') + (others.length > 3 ? '…' : '');
}

function pickAvatar(t: ThreadSummary, mePk: string | null): string | null {
  const others = mePk ? t.users.filter(u => u.pk !== mePk) : t.users;
  return others[0]?.profile_pic_url || null;
}

export function ThreadList({ me, onOpen }: Props) {
  const mePk = me?.pk || null;
  const { data: threads = [], isLoading, refetch } = useQuery({
    queryKey: ['threads'],
    queryFn: api.threads,
    refetchInterval: 1000,           // 1s polling — backend cache, ~10ms par hit
    refetchIntervalInBackground: false,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="pt-safe pl-3.5 pr-3.5 pb-2.5 border-b border-[var(--color-border)] flex items-center gap-2 sticky top-0 bg-black z-10">
        <h1 className="flex-1 text-[22px] font-semibold truncate">{me?.username || 'Messages'}</h1>
        <button onClick={() => refetch()} className="text-[var(--color-accent)] font-semibold px-2.5 py-1.5">↻</button>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {isLoading && threads.length === 0 && (
          <div className="p-8 text-center text-[var(--color-muted)]"><div className="spinner mx-auto" /></div>
        )}
        {!isLoading && threads.length === 0 && (
          <div className="p-10 text-center text-[var(--color-muted)]">Aucune conversation</div>
        )}
        {threads.map(t => {
          const name = pickName(t, mePk);
          const avatarUrl = pickAvatar(t, mePk);
          const last = t.last_message;
          return (
            <div key={t.id} onClick={() => onOpen(t.id)}
              className="flex gap-3 px-3.5 py-2.5 items-center cursor-pointer border-b border-[#0d0d0d] active:bg-[#0a0a0a]">
              <Avatar url={avatarUrl} name={name} />
              <div className="flex-1 min-w-0">
                <div className={`truncate text-sm ${t.unread ? 'font-bold' : 'font-semibold'}`}>{name}</div>
                <div className={`truncate text-[13px] mt-0.5 flex gap-1 items-center ${t.unread ? 'text-white font-medium' : 'text-[var(--color-muted)]'}`}>
                  <span className="truncate">{previewText(t)}</span>
                  <span className="opacity-60">· {last ? fmtTime(last.timestamp) : ''}</span>
                </div>
              </div>
              {t.unread && <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
