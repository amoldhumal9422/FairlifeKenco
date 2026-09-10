import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SubmitEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { KeyRound, Layers, LoaderCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import WaveBot, { type ApiClient, type ApiResponse } from '../app/wave-desk';
import {
  createWaveClient,
  parseConnection,
  type Connection,
} from '../lib/wave-connection';
import '../app/globals.css';

function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [session, setSession] = useState<{
    viewer: string;
    request: ApiClient;
  } | null>(null);
  const [message, setMessage] = useState('Checking connection…');
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);

  const disconnect = useCallback(
    (message = 'Enter your access key to connect.') => {
      lifetime.current?.abort();
      lifetime.current = null;
      setSession(null);
      setBusy(false);
      setMessage(message);
    },
    [],
  );

  const client = useCallback(
    (
      config: Connection,
      controller: AbortController,
      accessKey?: string,
    ): ApiClient => {
      const send = createWaveClient(config, {
        accessKey,
        signal: controller.signal,
        onUnauthorized: () => {
          if (lifetime.current === controller)
            disconnect(
              'Access was not accepted. Connect again with a valid key or account.',
            );
        },
      });
      return async (body) => (await send(body)) as ApiResponse;
    },
    [disconnect],
  );

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    async function connect() {
      try {
        const response = await fetch(
          new URL('./wave-bot.config.json', document.baseURI),
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error('Connection settings are unavailable.');
        const config = parseConnection(await response.json());
        if (controller.signal.aborted) return;
        setConnection(config);
        if (config.authMode === 'access-key') {
          setMessage('');
          return;
        }
        const responseSession = await fetch(config.sessionUrl, {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        if (responseSession.status === 401 || responseSession.status === 403) {
          setMessage('Sign in to view this workspace.');
          return;
        }
        if (!responseSession.ok)
          throw new Error('Sign-in is unavailable. Try again shortly.');
        const payload = await responseSession.json();
        const name = payload.user?.displayName || payload.user?.email;
        if (typeof name !== 'string' || !name.trim())
          throw new Error('Sign in to access this workspace.');
        if (!controller.signal.aborted)
          setSession({ viewer: name, request: client(config, controller) });
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof Error ? error.message : 'Could not connect.',
          );
      }
    }
    void connect();
    return () => {
      controller.abort();
      lifetime.current?.abort();
    };
  }, [client]);

  async function signIn(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || busy) return;
    const form = event.currentTarget;
    const enteredKey = new FormData(form).get('accessKey');
    const key = typeof enteredKey === 'string' ? enteredKey.trim() : '';
    if (!key) return;
    form.reset();
    lifetime.current?.abort();
    const controller = new AbortController();
    lifetime.current = controller;
    const request = client(connection, controller, key);
    setBusy(true);
    setMessage('');
    try {
      // Reading run history verifies access without starting a production action.
      await request({ action: 'list' });
      if (!controller.signal.aborted)
        setSession({ viewer: 'Wave Bot operator', request });
    } catch (error) {
      if (!controller.signal.aborted) setMessage((error as Error).message);
      controller.abort();
    } finally {
      if (lifetime.current === controller) setBusy(false);
    }
  }

  if (session && connection)
    return (
      <WaveBot
        viewer={session.viewer}
        request={session.request}
        readOnly={connection.readOnly}
        onDisconnect={() => disconnect()}
      />
    );

  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand">
          <Layers />
          <span>
            Wave Bot<small>fairlife · Arizona</small>
          </span>
        </div>
        <span className="access-eyebrow">WORKSPACE ACCESS</span>
        <h1 id="access-title">Your wave desk.</h1>
        <p>
          View wave files, appointment details, and run results in one place.
        </p>
        {connection?.readOnly && (
          <div className="access-mode">
            View-only mode · Production actions are paused
          </div>
        )}
        {connection?.authMode === 'access-key' && (
          <form onSubmit={(event) => void signIn(event)}>
            <label htmlFor="wave-access-key">Private access key</label>
            <Input
              id="wave-access-key"
              name="accessKey"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={512}
              disabled={busy}
              aria-describedby="access-help"
            />
            <p id="access-help" className="access-help">
              Use the Wave Bot key from your workspace administrator. It stays
              in this tab until you disconnect or reload.
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
              {busy ? 'Connecting…' : 'Connect to workspace'}
            </Button>
          </form>
        )}
        {connection?.authMode === 'session' && connection.signInUrl && (
          <a className="access-sign-in" href={connection.signInUrl}>
            Sign in to workspace
          </a>
        )}
        {message && <output className="access-message">{message}</output>}
        <footer>
          Arizona · AZ02 <span>America / Phoenix</span>
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
