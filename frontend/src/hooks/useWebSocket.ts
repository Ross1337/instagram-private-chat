import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message, ThreadSummary } from '../api';

type WSEvent =
  | { type: 'message_new'; thread_id: string; message: Message; thread?: ThreadSummary }
  | { type: 'thread_changed'; thread: ThreadSummary }
  | { type: 'thread_update'; thread: ThreadSummary };

/**
 * Connexion WebSocket avec auto-reconnect + invalidation des queries TanStack
 * sur chaque event. Le composant qui consomme la query refetch automatiquement
 * (cache hit instantane).
 */
export function useWebSocket(activeThreadId: string | null) {
  const qc = useQueryClient();
  const activeThreadIdRef = useRef(activeThreadId);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    let alive = true;
    let pingTimer: number | null = null;

    function connect() {
      if (!alive) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        let data: WSEvent;
        try { data = JSON.parse(ev.data); }
        catch { return; }

        if (data.type === 'message_new') {
          // Patch direct le cache thread (anti-flicker, pas besoin de refetch)
          qc.setQueryData<ThreadSummary[]>(['threads'], (old) => {
            if (!old || !data.thread) return old;
            const idx = old.findIndex(t => t.id === data.thread!.id);
            const next = idx >= 0
              ? [...old.slice(0, idx), data.thread!, ...old.slice(idx + 1)]
              : [data.thread!, ...old];
            return next.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
          });

          // Append le message dans la conv si elle est en cache
          qc.setQueryData<import('../api').ThreadDetail>(['thread', data.thread_id], (old) => {
            if (!old) return old;
            // Dedup par id
            if (old.messages.some(m => m.id === data.message.id)) return old;
            // Si message envoye par moi : merge avec l'optimistic match (garder le contenu
            // optimistic, prendre l'id IG du real — evite le flash "[message]" si le WS push
            // arrive avec text=null).
            if (data.message.is_sent_by_viewer) {
              const optIdx = old.messages.findIndex(m =>
                m._pending && m.is_sent_by_viewer &&
                ((data.message.text && m.text === data.message.text) ||
                 (!data.message.text && !m.text && m.item_type === data.message.item_type))
              );
              if (optIdx >= 0) {
                const opt = old.messages[optIdx];
                const merged = {
                  ...opt,
                  id: data.message.id,
                  timestamp: data.message.timestamp || opt.timestamp,
                  text: data.message.text ?? opt.text,
                  item_type: data.message.item_type ?? opt.item_type,
                  media: data.message.media ?? opt.media,
                  is_sent_by_viewer: true,
                  _pending: false,
                  _failed: false,
                };
                const messages = [...old.messages];
                messages[optIdx] = merged;
                return { ...old, messages };
              }
            }
            return { ...old, messages: [data.message, ...old.messages] };
          });

          // Mark seen si conv active
          if (activeThreadIdRef.current === data.thread_id) {
            fetch(`/api/threads/${data.thread_id}/seen`, { method: 'POST' }).catch(() => {});
          }
        } else if (data.type === 'thread_changed' || data.type === 'thread_update') {
          qc.setQueryData<ThreadSummary[]>(['threads'], (old) => {
            if (!old) return old;
            const idx = old.findIndex(t => t.id === data.thread.id);
            const next = idx >= 0
              ? [...old.slice(0, idx), data.thread, ...old.slice(idx + 1)]
              : [data.thread, ...old];
            return next.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
          });
        }
      };

      ws.onclose = () => {
        if (alive) setTimeout(connect, 2000);
      };
      ws.onerror = () => {};

      pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send('ping'); } catch {}
        }
      }, 25000);
    }

    connect();

    return () => {
      alive = false;
      if (pingTimer) clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [qc]);
}
