import { useEffect, useState } from 'react';

interface Props {
  imageUrl?: string | null;
  videoUrl?: string | null;
  onClose: () => void;
  onMarkSeenOnIG?: () => Promise<void> | void;
  hint?: string;
}

export function Lightbox({ imageUrl, videoUrl, onClose, onMarkSeenOnIG, hint }: Props) {
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleNotify(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onMarkSeenOnIG || notifying || notified) return;
    setNotifying(true);
    setError(null);
    try {
      await onMarkSeenOnIG();
      setNotified(true);
    } catch (err: any) {
      setError(err.message || 'Erreur');
    } finally {
      setNotifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white text-xl flex items-center justify-center"
        style={{ marginTop: 'env(safe-area-inset-top)' }}
        aria-label="Fermer"
      >
        ✕
      </button>
      {videoUrl ? (
        <video src={videoUrl} controls autoPlay
          className="max-w-full max-h-full"
          onClick={(e) => e.stopPropagation()} />
      ) : imageUrl ? (
        <img src={imageUrl} alt=""
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="text-white/70">Pas de média</div>
      )}
      <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-2 px-4"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {hint && <div className="text-white/70 text-sm text-center">{hint}</div>}
        {onMarkSeenOnIG && (
          <button
            onClick={handleNotify}
            disabled={notifying || notified}
            className={`px-4 py-2 rounded-full text-sm font-semibold ${
              notified
                ? 'bg-green-500/20 text-green-300'
                : 'bg-white/10 text-white active:bg-white/20'
            } disabled:opacity-60`}
          >
            {notifying ? '...' : notified ? '✓ Notifié à Instagram' : 'Notifier Instagram (vu)'}
          </button>
        )}
        {error && <div className="text-red-400 text-xs">{error}</div>}
      </div>
    </div>
  );
}
