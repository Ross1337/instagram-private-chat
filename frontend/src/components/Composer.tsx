import { useEffect, useRef, useState } from 'react';
import type { Message as Msg, User } from '../api';

interface Props {
  onSendText: (text: string) => void;
  onSendPhoto: (file: File) => void;
  onSendVoice: (file: File) => void;
  replyTo: Msg | null;
  replyToSender: User | null;
  onCancelReply: () => void;
}

export function Composer({ onSendText, onSendPhoto, onSendVoice, replyTo, replyToSender, onCancelReply }: Props) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const fileGalleryRef = useRef<HTMLInputElement>(null);
  const fileCameraRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{
    rec: MediaRecorder;
    chunks: Blob[];
    stream: MediaStream;
    mime: string;
    startedAt: number;
    timer: number;
    cancelled: boolean;
  } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Resize textarea selon contenu
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
  }, [text]);

  function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    onSendText(t);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    onSendPhoto(f);
  }

  async function startRec(e: React.PointerEvent) {
    e.preventDefault();
    if (recRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = () => {
        const r = recRef.current;
        if (!r) return;
        recRef.current = null;
        clearInterval(r.timer);
        r.stream.getTracks().forEach((tr: MediaStreamTrack) => tr.stop());
        setRecording(false);
        if (r.cancelled) return;
        const dur = (Date.now() - r.startedAt) / 1000;
        if (dur < 0.5) return;
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('webm') ? 'webm' : 'audio';
        const blob = new Blob(chunks, { type: mime || 'application/octet-stream' });
        const file = new File([blob], `voice.${ext}`, { type: blob.type });
        onSendVoice(file);
      };
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        setRecSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);
      recRef.current = { rec, chunks, stream, mime, startedAt, timer, cancelled: false };
      rec.start();
      setRecording(true);
      setRecSec(0);
    } catch (err: any) {
      alert('Micro inaccessible : ' + err.message);
    }
  }

  function stopRec() {
    const r = recRef.current;
    if (!r) return;
    if (r.rec.state === 'recording') r.rec.stop();
  }

  function cancelRec() {
    const r = recRef.current;
    if (!r) return;
    r.cancelled = true;
    if (r.rec.state === 'recording') r.rec.stop();
  }

  if (recording) {
    const m = Math.floor(recSec / 60);
    const s = String(recSec % 60).padStart(2, '0');
    return (
      <div className="px-2 pt-2 pb-safe border-t border-[var(--color-border)] bg-black flex-shrink-0 flex items-center gap-3 px-4">
        <div className="rec-pulse w-2.5 h-2.5 rounded-full bg-[var(--color-danger)]" />
        <span className="text-[var(--color-danger)]">{m}:{s}</span>
        <button onClick={cancelRec} className="ml-auto w-9 h-9 rounded-full flex items-center justify-center text-xl active:bg-[var(--color-surface)]">✕</button>
        <button onClick={stopRec} className="text-[var(--color-accent)] font-semibold px-3 py-1.5">Envoyer</button>
      </div>
    );
  }

  return (
    <div className="px-2 pt-2 pb-safe border-t border-[var(--color-border)] bg-black flex-shrink-0">
      <input ref={fileGalleryRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      <input ref={fileCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickFile} />
      {replyTo && (
        <div className="mx-1 mb-2 px-3 py-2 bg-[var(--color-surface)] rounded-xl flex items-center gap-2">
          <div className="w-1 self-stretch bg-[var(--color-accent)] rounded-full" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-[var(--color-accent)] font-semibold">
              Réponse à {replyToSender?.username || replyToSender?.full_name || ''}
            </div>
            <div className="text-[13px] text-[var(--color-muted)] truncate">
              {replyTo.text || `[${replyTo.item_type || 'message'}]`}
            </div>
          </div>
          <button onClick={onCancelReply} className="w-7 h-7 flex items-center justify-center text-[var(--color-muted)] active:text-white">✕</button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button onClick={() => fileCameraRef.current?.click()}
          className="w-9 h-9 rounded-full flex items-center justify-center text-xl active:bg-[var(--color-surface)]" aria-label="Camera">📷</button>
        <button onClick={() => fileGalleryRef.current?.click()}
          className="w-9 h-9 rounded-full flex items-center justify-center text-xl active:bg-[var(--color-surface)]" aria-label="Photo">🖼️</button>
        <div className="flex-1 bg-[var(--color-surface)] rounded-[22px] flex items-end px-3.5 py-1 min-h-[36px]">
          <textarea ref={taRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message..." rows={1}
            className="flex-1 bg-transparent border-0 outline-none resize-none py-1.5 leading-snug" />
        </div>
        {text.trim() ? (
          <button onClick={send}
            className="text-[var(--color-accent)] font-semibold px-2.5 py-1.5">Envoyer</button>
        ) : (
          <button onPointerDown={startRec} onPointerUp={stopRec} onPointerCancel={cancelRec} onPointerLeave={cancelRec}
            className="w-9 h-9 rounded-full flex items-center justify-center text-xl text-[var(--color-accent)] active:bg-[var(--color-surface)]"
            aria-label="Voice">🎤</button>
        )}
      </div>
    </div>
  );
}
