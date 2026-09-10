import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WaveBot, { type ApiClient, type ApiResponse } from '../app/wave-desk';
import '../app/globals.css';

type Connection = { apiUrl: string; sessionUrl: string; signInUrl: string };

function endpoint(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new Error('The connection address must use HTTPS.');
  }
  return url.href;
}

function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [viewer, setViewer] = useState('');
  const [message, setMessage] = useState('Checking connection…');

  useEffect(() => {
    const controller = new AbortController();
    async function connect() {
      try {
        const response = await fetch(
          new URL('./wave-bot.config.json', document.baseURI),
          { cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok)
          throw new Error('Connection settings are unavailable.');
        const config = (await response.json()) as Partial<
          Record<keyof Connection, unknown>
        >;
        if (!config || typeof config !== 'object')
          throw new Error('Connection settings are invalid.');
        const next = {
          apiUrl: endpoint(config.apiUrl),
          sessionUrl: endpoint(config.sessionUrl),
          signInUrl: endpoint(config.signInUrl),
        };
        if (!next.apiUrl || !next.sessionUrl) {
          setMessage(
            'The production connection is not configured yet. Files and run history will appear here when connected.',
          );
          return;
        }
        setConnection(next);
        const session = await fetch(next.sessionUrl, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (session.status === 401 || session.status === 403) {
          setMessage(
            'Sign in with an authorized account to view files and approve runs.',
          );
          return;
        }
        if (!session.ok)
          throw new Error('The connection is unavailable. Try again shortly.');
        const payload = (await session.json()) as {
          user?: { displayName?: unknown; email?: unknown };
        };
        const name = payload.user?.displayName || payload.user?.email;
        if (!name || typeof name !== 'string')
          throw new Error('Sign in to access this workspace.');
        setViewer(name);
        setMessage('');
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof TypeError
              ? 'The production connection could not be reached. Check your access or try again shortly.'
              : (error as Error).message,
          );
      }
    }
    void connect();
    return () => controller.abort();
  }, []);

  const request = useMemo<ApiClient>(
    () => async (body) => {
      if (!connection?.apiUrl)
        throw new Error('The production connection is not configured.');
      const response = await fetch(connection.apiUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok)
        throw new Error(
          payload.error ||
            'The request could not be completed. Refresh before retrying.',
        );
      return payload;
    },
    [connection],
  );

  return (
    <WaveBot
      viewer={viewer}
      request={request}
      signInUrl={connection?.signInUrl || ''}
      connectionMessage={message}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
