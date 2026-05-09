// Persiste localement les ids des photos/videos ephemerales que j'ai deja ouvertes,
// pour pouvoir les afficher comme "vues" + permettre de les revoir indefiniment.

const KEY = 'instabox.seenEphemerals';

function load(): Set<string> {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return new Set();
    return new Set(JSON.parse(v) as string[]);
  } catch { return new Set(); }
}

function save(set: Set<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); }
  catch {}
}

let cache = load();

// Bump quand un id est marque vu, pour forcer un re-render des composants qui consomment.
let version = 0;
const listeners = new Set<() => void>();

export function isEphemeralSeen(id: string): boolean {
  return cache.has(id);
}

export function markEphemeralSeen(id: string) {
  if (cache.has(id)) return;
  cache.add(id);
  save(cache);
  version++;
  listeners.forEach(fn => fn());
}

export function subscribeEphemeralSeen(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function ephemeralSeenVersion(): number { return version; }
