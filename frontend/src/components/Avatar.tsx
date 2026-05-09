import { useState } from 'react';
import { proxyUrl } from '../api';
import { initials } from '../utils';

interface Props {
  url?: string | null;
  name?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function Avatar({ url, name, size = 'md', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const px = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-14 h-14 text-base';
  const src = !failed && url ? proxyUrl(url) : null;
  return (
    <div className={`${px} rounded-full bg-[var(--color-surface)] flex items-center justify-center overflow-hidden flex-shrink-0 font-semibold ${className}`}>
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
