import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ThreadList } from './components/ThreadList';
import { Conversation } from './components/Conversation';
import { useWebSocket } from './hooks/useWebSocket';

const LS_ACTIVE = 'instabox.activeThreadId';

export default function App() {
  const [activeThreadId, setActiveThreadIdRaw] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_ACTIVE); }
    catch { return null; }
  });

  const setActiveThreadId = (id: string | null) => {
    setActiveThreadIdRaw(id);
    try {
      if (id) localStorage.setItem(LS_ACTIVE, id);
      else localStorage.removeItem(LS_ACTIVE);
    } catch {}
  };

  const { data: me = null } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    staleTime: 1000 * 60 * 60,    // 1h — me change rarement
  });

  // WebSocket : invalide les queries sur events
  useWebSocket(activeThreadId);

  // Re-sync au focus tab
  useEffect(() => {
    const onVis = () => {
      // TanStack Query gere refetchOnWindowFocus globalement, rien a faire
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-black text-white">
      {activeThreadId ? (
        <Conversation
          threadId={activeThreadId}
          me={me}
          onBack={() => setActiveThreadId(null)}
        />
      ) : (
        <ThreadList me={me} onOpen={setActiveThreadId} />
      )}
    </div>
  );
}
