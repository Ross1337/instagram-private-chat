import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ThreadDetail, type ThreadSummary, type Me, type Message as Msg, type User } from '../api';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { Lightbox } from './Lightbox';
import { Message } from './Message';
import { proxyUrl } from '../api';
import { fmtDateSep, nowTs } from '../utils';
import { markEphemeralSeen } from '../ephemeralSeen';

interface Props {
  threadId: string;
  me: Me | null;
  onBack: () => void;
}

function pickName(detail: ThreadDetail | undefined, summary: ThreadSummary | undefined, mePk: string | null): string {
  if (detail?.title) return detail.title;
  if (summary?.title) return summary.title;
  const users = detail?.users || summary?.users || [];
  const others = mePk ? users.filter(u => u.pk !== mePk) : users;
  if (others.length === 1) return others[0].full_name || others[0].username;
  if (others.length === 0) return '(moi)';
  return others.map(u => u.username).slice(0, 3).join(', ') + (others.length > 3 ? '…' : '');
}

function pickAvatar(detail: ThreadDetail | undefined, summary: ThreadSummary | undefined, mePk: string | null): string | null {
  const users = detail?.users || summary?.users || [];
  const others = mePk ? users.filter(u => u.pk !== mePk) : users;
  return others[0]?.profile_pic_url || null;
}

export function Conversation({ threadId, me, onBack }: Props) {
  const qc = useQueryClient();
  const mePk = me?.pk || null;
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [openedEphemeral, setOpenedEphemeral] = useState<Msg | null>(null);
  const [openedMedia, setOpenedMedia] = useState<{ imageUrl: string | null; videoUrl: string | null } | null>(null);

  // Lit la summary depuis le cache des threads (pas de fetch dedie)
  const summary = qc.getQueryData<ThreadSummary[]>(['threads'])?.find(t => t.id === threadId);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['thread', threadId],
    queryFn: async () => {
      const fresh = await api.thread(threadId);
      const previous = qc.getQueryData<ThreadDetail>(['thread', threadId]);
      if (previous) {
        const newIds = new Set(fresh.messages.map(m => m.id));
        // 1) Preserve les optimistic en vol (pending/failed) qui ne sont pas
        //    encore confirmes par le serveur — sinon le refetch les efface.
        const optimistic = previous.messages.filter(m =>
          (m._pending || m._failed) && !newIds.has(m.id)
        );
        if (optimistic.length) {
          fresh.messages = [...optimistic, ...fresh.messages];
        }
        // 2) Pour chaque msg deja confirme mais dont la version fresh n'a pas
        //    encore de media (instagrapi ne le populate pas immediatement apres
        //    direct_send_photo), preserver le _localPhotoUrl du blob local
        //    pour eviter le flash "[media]" en attendant le CDN URL.
        fresh.messages = fresh.messages.map(m => {
          const prev = previous.messages.find(p => p.id === m.id);
          if (prev?._localPhotoUrl && !m.media?.thumbnail_url) {
            return { ...m, _localPhotoUrl: prev._localPhotoUrl };
          }
          return m;
        });
      }
      return fresh;
    },
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  });

  // Mark seen a l'ouverture
  useEffect(() => {
    api.markSeen(threadId).catch(() => {});
  }, [threadId]);

  const userById = useMemo<Record<string, User>>(() => {
    const map: Record<string, User> = {};
    (detail?.users || summary?.users || []).forEach(u => { map[u.pk] = u; });
    return map;
  }, [detail?.users, summary?.users]);

  const sendText = useMutation({
    mutationFn: ({ text, replyTo: rt }: { text: string; replyTo: Msg | null }) =>
      api.sendText(threadId, text,
        rt ? {
          id: rt.id,
          user_id: rt.user_id,
          client_context: rt.client_context,
          text: rt.text,
          item_type: rt.item_type,
        } : undefined),
    onMutate: async ({ text, replyTo: rt }) => {
      const optId = 'opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const optMsg: Msg = {
        id: optId, item_type: 'text',
        user_id: mePk, is_sent_by_viewer: true,
        timestamp: nowTs(), text, _pending: true,
        // Preview reply en optimistic
        reply: rt ? {
          id: rt.id,
          text: rt.text || '',
          item_type: rt.item_type || 'text',
        } : undefined,
      };
      // Insertion optimistic dans la conv
      qc.setQueryData<ThreadDetail>(['thread', threadId], (old) =>
        old ? { ...old, messages: [optMsg, ...old.messages] } : old
      );
      // Bump le thread en haut de la liste avec ce last_message
      qc.setQueryData<ThreadSummary[]>(['threads'], (old) => {
        if (!old) return old;
        const idx = old.findIndex(t => t.id === threadId);
        if (idx < 0) return old;
        const updated: ThreadSummary = {
          ...old[idx],
          last_message: optMsg,
          last_activity_at: optMsg.timestamp,
          unread: false,
        };
        const next = [...old.slice(0, idx), updated, ...old.slice(idx + 1)];
        return next.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
      });
      return { optId };
    },
    onSuccess: (real, _text, ctx) => {
      qc.setQueryData<ThreadDetail>(['thread', threadId], (old) => {
        if (!old) return old;
        const optIdx = old.messages.findIndex(m => m.id === ctx?.optId);
        const realAlready = old.messages.some(m => m.id === real.id);
        if (realAlready && optIdx >= 0) {
          return { ...old, messages: old.messages.filter(m => m.id !== ctx?.optId) };
        }
        if (optIdx >= 0) {
          // Garder le contenu de l'optimistic (text/item_type sont fiables cote client),
          // juste prendre l'id IG + timestamp + retirer les flags pending.
          const opt = old.messages[optIdx];
          const merged: Msg = {
            ...opt,
            id: real.id,
            timestamp: real.timestamp || opt.timestamp,
            // Si le real a fourni du contenu plus riche (rare mais possible), preferer
            text: real.text ?? opt.text,
            item_type: real.item_type ?? opt.item_type,
            media: real.media ?? opt.media,
            is_sent_by_viewer: true,
            _pending: false,
            _failed: false,
          };
          const messages = [...old.messages];
          messages[optIdx] = merged;
          return { ...old, messages };
        }
        return old;
      });
      qc.setQueryData<ThreadSummary[]>(['threads'], (old) => {
        if (!old) return old;
        const idx = old.findIndex(t => t.id === threadId);
        if (idx < 0) return old;
        // Construire un last_message merge (meme logique : on prefere le contenu
        // de l'optimistic si le real est vide)
        const opt = old[idx].last_message;
        const lm: Msg = {
          ...(opt && opt._pending ? opt : real),
          id: real.id,
          timestamp: real.timestamp || (opt?.timestamp ?? ''),
          text: real.text ?? opt?.text ?? null,
          item_type: real.item_type ?? opt?.item_type ?? null,
          is_sent_by_viewer: true,
          _pending: false, _failed: false,
        };
        const updated: ThreadSummary = {
          ...old[idx], last_message: lm, last_activity_at: lm.timestamp,
        };
        const next = [...old.slice(0, idx), updated, ...old.slice(idx + 1)];
        return next.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
      });
    },
    onError: (_err, _text, ctx) => {
      qc.setQueryData<ThreadDetail>(['thread', threadId], (old) => {
        if (!old) return old;
        const messages = old.messages.map(m =>
          m.id === ctx?.optId ? { ...m, _pending: false, _failed: true } : m
        );
        return { ...old, messages };
      });
    },
  });

  function makeOptMedia(kind: 'photo' | 'voice', file: File): { optId: string; optMsg: Msg } {
    const optId = 'opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const localUrl = kind === 'photo' ? URL.createObjectURL(file) : undefined;
    const optMsg: Msg = {
      id: optId,
      item_type: kind === 'voice' ? 'voice_media' : 'media',
      user_id: mePk, is_sent_by_viewer: true,
      timestamp: nowTs(),
      text: kind === 'voice' ? '🎤 Envoi vocal...' : null,
      _pending: true,
      _localPhotoUrl: localUrl,
    };
    return { optId, optMsg };
  }

  const sendMedia = useMutation({
    mutationFn: ({ kind, file }: { kind: 'photo' | 'voice'; file: File }) =>
      kind === 'voice' ? api.sendVoice(threadId, file) : api.sendPhoto(threadId, file),
    onMutate: ({ kind, file }) => {
      const { optId, optMsg } = makeOptMedia(kind, file);
      qc.setQueryData<ThreadDetail>(['thread', threadId], (old) =>
        old ? { ...old, messages: [optMsg, ...old.messages] } : old
      );
      qc.setQueryData<ThreadSummary[]>(['threads'], (old) => {
        if (!old) return old;
        const idx = old.findIndex(t => t.id === threadId);
        if (idx < 0) return old;
        const updated: ThreadSummary = {
          ...old[idx], last_message: optMsg, last_activity_at: optMsg.timestamp, unread: false,
        };
        const next = [...old.slice(0, idx), updated, ...old.slice(idx + 1)];
        return next.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
      });
      return { optId, localUrl: optMsg._localPhotoUrl };
    },
    onSuccess: (real, _vars, ctx) => {
      qc.setQueryData<ThreadDetail>(['thread', threadId], (old) => {
        if (!old) return old;
        const optIdx = old.messages.findIndex(m => m.id === ctx?.optId);
        const realAlready = old.messages.some(m => m.id === real.id);
        if (realAlready && optIdx >= 0) {
          return { ...old, messages: old.messages.filter(m => m.id !== ctx?.optId) };
        }
        if (optIdx >= 0) {
          const opt = old.messages[optIdx];
          const merged: Msg = {
            ...opt,
            id: real.id,
            timestamp: real.timestamp || opt.timestamp,
            text: real.text ?? opt.text,
            item_type: real.item_type ?? opt.item_type,
            media: real.media ?? opt.media,
            is_sent_by_viewer: true,
            _pending: false,
            _failed: false,
          };
          const messages = [...old.messages];
          messages[optIdx] = merged;
          return { ...old, messages };
        }
        return old;
      });
      if (ctx?.localUrl) URL.revokeObjectURL(ctx.localUrl);
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData<ThreadDetail>(['thread', threadId], (old) => {
        if (!old) return old;
        const messages = old.messages.map(m =>
          m.id === ctx?.optId ? { ...m, _pending: false, _failed: true } : m
        );
        return { ...old, messages };
      });
    },
  });

  const messages = detail?.messages || [];
  const name = pickName(detail, summary, mePk);
  const avatarUrl = pickAvatar(detail, summary, mePk);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="pt-safe pl-1 pr-3.5 pb-2.5 border-b border-[var(--color-border)] flex items-center gap-2 sticky top-0 bg-black z-10">
        <button onClick={onBack} className="text-2xl px-2 py-1.5">‹</button>
        <Avatar url={avatarUrl} name={name} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold truncate">{name}</div>
        </div>
      </div>

      {/* Messages — column-reverse pour que [0] = bas */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-1 flex flex-col-reverse gap-0.5"
        style={{ WebkitOverflowScrolling: 'touch' }}>
        {isLoading && messages.length === 0 && (
          <div className="p-8 text-center"><div className="spinner mx-auto" /></div>
        )}
        {messages.map((m, i) => {
          const next = messages[i + 1]; // plus ancien
          const isMine = m.is_sent_by_viewer === true || (mePk && m.user_id === mePk);
          const sameSender = !!next &&
            (next.is_sent_by_viewer === m.is_sent_by_viewer) &&
            String(next.user_id || '') === String(m.user_id || '');
          const sender = m.user_id ? userById[m.user_id] || null : null;

          // Day separator (au-dessus du message le plus ancien d'un nouveau jour)
          const day = m.timestamp ? new Date(m.timestamp.replace(' ', 'T') + 'Z').toDateString() : '';
          const nextDay = next?.timestamp ? new Date(next.timestamp.replace(' ', 'T') + 'Z').toDateString() : '';
          const showDaySep = day && day !== nextDay;

          return (
            <div key={m.id} data-msg-id={m.id} className="flex flex-col gap-0.5 transition-colors duration-300 rounded-2xl">
              <Message msg={m} isMine={!!isMine} consec={sameSender} sender={sender}
                onReply={(target) => setReplyTo(target)}
                onOpenEphemeral={(target) => {
                  setOpenedEphemeral(target);
                  markEphemeralSeen(target.id);
                }}
                onOpenMedia={(imageUrl, videoUrl) => setOpenedMedia({ imageUrl, videoUrl })} />
              {showDaySep && (
                <div className="self-center text-[11px] text-[var(--color-muted)] uppercase tracking-wide font-semibold pt-3 pb-2">
                  {fmtDateSep(m.timestamp)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Composer
        onSendText={(t) => {
          sendText.mutate({ text: t, replyTo });
          setReplyTo(null);
        }}
        onSendPhoto={(f) => sendMedia.mutate({ kind: 'photo', file: f })}
        onSendVoice={(f) => sendMedia.mutate({ kind: 'voice', file: f })}
        replyTo={replyTo}
        replyToSender={replyTo?.user_id ? userById[replyTo.user_id] || null : null}
        onCancelReply={() => setReplyTo(null)}
      />
      {openedEphemeral && (
        <Lightbox
          imageUrl={proxyUrl(openedEphemeral.visual_media?.image_url)}
          videoUrl={proxyUrl(openedEphemeral.visual_media?.video_url)}
          onClose={() => setOpenedEphemeral(null)}
          onMarkSeenOnIG={openedEphemeral.is_sent_by_viewer
            ? undefined
            : () => api.markItemSeen(threadId, openedEphemeral.id, true).then(() => {})}
          hint="Affichage local — IG n'est pas notifié sauf si tu cliques sur 'Notifier'"
        />
      )}
      {openedMedia && (
        <Lightbox
          imageUrl={openedMedia.imageUrl}
          videoUrl={openedMedia.videoUrl}
          onClose={() => setOpenedMedia(null)}
        />
      )}
    </div>
  );
}
