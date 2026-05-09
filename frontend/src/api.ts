// Types alignés avec ig_client.py côté backend

export interface User {
  username: string;
  full_name: string;
  pk: string;
  profile_pic_url: string | null;
}

export interface Me {
  pk: string;
  username: string;
  full_name: string;
  profile_pic_url: string | null;
}

export interface Media {
  media_type?: number;
  thumbnail_url: string | null;
  video_url: string | null;
  audio_url: string | null;
}

export interface Reaction {
  emoji: string | null;
  sender_id: string;
}

export interface Message {
  id: string;
  item_type: string | null;
  user_id: string | null;
  timestamp: string;
  is_sent_by_viewer: boolean | null;
  text: string | null;
  media?: Media;
  visual_media?: {
    image_url: string | null;
    video_url: string | null;
    view_mode: string | null;
    seen_count: number;
  };
  animated_media?: { url: string | null };
  reactions?: Reaction[];
  reply?: { id?: string; text: string; item_type: string };
  clip?: { id: string | null; code?: string | null; thumbnail_url?: string | null; caption?: string | null };
  media_share?: { id: string | null; code?: string | null; thumbnail_url?: string | null; caption?: string | null };
  xma_share?: {
    title?: string | null;
    preview_url?: string | null;
    video_url?: string | null;
    header_icon_url?: string | null;
    ig_code?: string | null;
  };
  client_context?: string | null;

  // Local optimistic flags (pas du backend)
  _pending?: boolean;
  _failed?: boolean;
  _localPhotoUrl?: string;
}

export interface ThreadSummary {
  id: string;
  title: string | null;
  users: User[];
  unread: boolean;
  last_activity_at: string | null;
  last_message: Message | null;
}

export interface ThreadDetail {
  id: string;
  title: string | null;
  users: User[];
  messages: Message[];
}

// ---------- Client ----------

const API = '';  // meme origine en prod, proxy Vite en dev

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, init);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  return r.json();
}

export const api = {
  me: () => http<Me>('/api/me'),
  threads: () => http<ThreadSummary[]>('/api/threads'),
  thread: (id: string) => http<ThreadDetail>(`/api/threads/${id}`),
  threadFresh: (id: string) => http<ThreadDetail>(`/api/threads/${id}?fresh=1`),
  sendText: (
    id: string,
    text: string,
    replyTo?: {
      id: string;
      user_id: string | null;
      client_context?: string | null;
      text?: string | null;
      item_type?: string | null;
    },
  ) =>
    http<Message>(`/api/threads/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        reply_to_id: replyTo?.id,
        reply_to_user_id: replyTo?.user_id,
        reply_to_client_context: replyTo?.client_context,
        reply_to_text: replyTo?.text,
        reply_to_item_type: replyTo?.item_type,
      }),
    }),
  sendPhoto: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http<Message>(`/api/threads/${id}/send_photo`, { method: 'POST', body: fd });
  },
  sendVoice: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http<Message>(`/api/threads/${id}/send_voice`, { method: 'POST', body: fd });
  },
  markSeen: (id: string) =>
    http<{ ok: boolean }>(`/api/threads/${id}/seen`, { method: 'POST' }),
  markItemSeen: (threadId: string, messageId: string, isVisual = false) =>
    http<{ ok: boolean }>(
      `/api/threads/${threadId}/items/${messageId}/seen${isVisual ? '?is_visual=1' : ''}`,
      { method: 'POST' },
    ),
};

export const proxyUrl = (url: string | null | undefined): string | undefined =>
  url ? `/api/proxy?url=${encodeURIComponent(url)}` : undefined;
