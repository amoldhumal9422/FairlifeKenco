export const WAVE_API =
  'https://amoldhumal.app.n8n.cloud/webhook/fairlife-wave-desk-api';

export type Connection = {
  apiUrl: string;
  authMode: 'access-key' | 'session';
  sessionUrl: string;
  signInUrl: string;
  readOnly: boolean;
};

export class AccessError extends Error {}

function endpoint(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error(
      'Connection addresses must use HTTPS without embedded credentials.',
    );
  return url.href;
}

export function parseConnection(value: unknown): Connection {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Connection settings are invalid.');
  const config = value as Record<string, unknown>;
  const authMode = config.authMode ?? 'session';
  if (authMode !== 'session' && authMode !== 'access-key')
    throw new Error('The sign-in method is not supported.');
  const connection = {
    apiUrl: endpoint(config.apiUrl),
    authMode,
    sessionUrl: endpoint(config.sessionUrl),
    signInUrl: endpoint(config.signInUrl),
    readOnly: config.readOnly !== false,
  } satisfies Connection;
  if (!connection.apiUrl || (authMode === 'session' && !connection.sessionUrl))
    throw new Error('The production connection is not configured.');
  if (authMode === 'access-key' && connection.apiUrl !== WAVE_API)
    throw new Error(
      'The access-key connection must use the Wave Bot endpoint.',
    );
  return connection;
}

const actions = new Set([
  'list',
  'detail',
  'generate',
  'approve',
  'reject',
  'upload',
]);
const readActions = new Set(['list', 'detail']);

export function createWaveClient(
  connection: Connection,
  options: {
    accessKey?: string;
    signal: AbortSignal;
    onUnauthorized: () => void;
    fetch?: typeof fetch;
  },
) {
  const send = options.fetch ?? fetch;
  const key = options.accessKey?.trim() ?? '';
  return async (
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    if (options.signal.aborted)
      throw new AccessError('Connect again to view this workspace.');
    if (typeof body.action !== 'string' || !actions.has(body.action))
      throw new Error('This action is not supported.');
    if (connection.readOnly && !readActions.has(body.action))
      throw new Error(
        'This website is in view-only mode. Production actions are paused.',
      );
    const runId =
      typeof body.runId === 'string' || typeof body.runId === 'number'
        ? String(body.runId)
        : '';
    if (
      body.action !== 'list' &&
      body.action !== 'generate' &&
      !/^\d+$/.test(runId)
    )
      throw new Error('Select a valid run.');
    if (connection.authMode === 'access-key' && (!key || /[\r\n]/.test(key)))
      throw new AccessError('Enter your private Wave Bot access key.');
    let response: Response;
    try {
      response = await send(connection.apiUrl, {
        method: 'POST',
        credentials: connection.authMode === 'access-key' ? 'omit' : 'include',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
          ...(connection.authMode === 'access-key'
            ? { Authorization: `Bearer ${key}` }
            : {}),
        },
        body: JSON.stringify(
          connection.authMode === 'access-key'
            ? { ...body, actor: 'Wave Bot operator' }
            : body,
        ),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(60000)]),
      });
    } catch (error) {
      if (options.signal.aborted)
        throw new AccessError('Disconnected from the workspace.');
      if (error instanceof Error && error.name === 'TimeoutError')
        throw new Error(
          'The connection timed out. Refresh the run before retrying.',
        );
      throw new Error(
        'Could not reach Wave Bot. Check your connection and try again.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      options.onUnauthorized();
      throw new AccessError(
        'Access was not accepted. Connect again with a valid key or account.',
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        'The service returned an unreadable response. Try refreshing shortly.',
      );
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('The service returned an invalid response.');
    if (!response.ok)
      throw new Error(
        typeof payload.error === 'string'
          ? payload.error
          : 'The request could not be completed.',
      );
    if (body.action === 'list' && !Array.isArray(payload.runs))
      throw new Error('The service did not return run history.');
    if (
      body.action === 'detail' &&
      (!payload.run || typeof payload.run !== 'object')
    )
      throw new Error('The service did not return the selected run.');
    return payload;
  };
}
