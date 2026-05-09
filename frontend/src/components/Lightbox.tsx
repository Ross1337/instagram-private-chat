import { useEffect } from 'react';

interface Props {
  imageUrl?: string | null;
  videoUrl?: string | null;
  onClose: () => void;
  hint?: string;
}

export function Lightbox({ imageUrl, videoUrl, onClose, hint }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      {hint && (
        <div className="absolute bottom-6 left-0 right-0 text-center text-white/70 text-sm px-4">
          {hint}
        </div>
      )}
    </div>
  );
}
