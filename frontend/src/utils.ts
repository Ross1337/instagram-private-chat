// Helpers de formatting

export function initials(s: string | null | undefined): string {
  return (s || '?').split(/[\s,_.]+/).filter(Boolean).slice(0, 2)
    .map(x => x[0] || '').join('').toUpperCase() || '?';
}

function parseTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return isNaN(+d) ? null : d;
}

export function fmtTime(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffDays = (+now - +d) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

export function fmtDateSep(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return '';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function nowTs(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
