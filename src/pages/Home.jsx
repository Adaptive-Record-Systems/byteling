import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getConnection, getProviderKey } from '@/api/byteling';
import Onboarding from '@/pages/Onboarding';
import Chat from '@/pages/Chat';

/**
 * Landing router. Chat is the home surface; until the user has both a GitHub
 * connection and an active Anthropic key, they see Onboarding. `?setup=1` forces
 * Onboarding even when ready, so the chat header can offer a way back to setup.
 */
export default function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const forceSetup = new URLSearchParams(location.search).get('setup') === '1';
  const [ready, setReady] = useState(null); // null = checking

  const check = useCallback(async () => {
    try {
      const [connection, key] = await Promise.all([getConnection(), getProviderKey()]);
      setReady(Boolean(connection) && key?.status === 'active');
    } catch {
      setReady(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const handleReady = useCallback(async () => {
    if (forceSetup) navigate('/', { replace: true });
    await check();
  }, [forceSetup, navigate, check]);

  if (ready === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return ready && !forceSetup ? <Chat /> : <Onboarding onReady={handleReady} />;
}
