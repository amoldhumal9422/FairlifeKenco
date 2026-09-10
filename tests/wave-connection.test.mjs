import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WAVE_API,
  parseConnection,
  createWaveClient,
  AccessError,
} from '../lib/wave-connection.ts';

const config = parseConnection({
  apiUrl: WAVE_API,
  authMode: 'access-key',
  readOnly: true,
});
function clientWith(send, overrides = {}) {
  return createWaveClient(config, {
    accessKey: 'test-only-key',
    signal: new AbortController().signal,
    onUnauthorized: () => {},
    fetch: send,
    ...overrides,
  });
}

test('configuration defaults to view only and keeps keys on the intended HTTPS endpoint', () => {
  assert.equal(
    parseConnection({ apiUrl: WAVE_API, authMode: 'access-key' }).readOnly,
    true,
  );
  for (const apiUrl of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com',
    WAVE_API + '?forward=1',
  ])
    assert.throws(() => parseConnection({ apiUrl, authMode: 'access-key' }));
  assert.throws(() => parseConnection(null));
  assert.throws(() =>
    parseConnection({ apiUrl: WAVE_API, authMode: 'unknown' }),
  );
});

test('read calls use bearer authentication without cookies, redirects, or caller-supplied identity', async () => {
  let sent;
  const client = clientWith(async (url, init) => {
    sent = { url, init };
    return Response.json({ runs: [] });
  });
  assert.deepEqual(await client({ action: 'list', actor: 'Forged identity' }), {
    runs: [],
  });
  assert.equal(sent.url, WAVE_API);
  assert.equal(sent.init.headers.Authorization, 'Bearer test-only-key');
  assert.equal(sent.init.credentials, 'omit');
  assert.equal(sent.init.redirect, 'error');
  assert.equal(sent.init.cache, 'no-store');
  assert.deepEqual(JSON.parse(sent.init.body), {
    action: 'list',
    actor: 'Wave Bot operator',
  });
});

test('view-only mode blocks every write before it reaches n8n', async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls++;
    return Response.json({});
  });
  for (const action of ['generate', 'approve', 'reject', 'upload'])
    await assert.rejects(client({ action, runId: '123' }), /view-only/);
  await assert.rejects(
    client({ action: 'delete', runId: '123' }),
    /not supported/,
  );
  await assert.rejects(
    client({ action: 'detail', runId: '../123' }),
    /valid run/,
  );
  assert.equal(calls, 0);
});

test('file preparation can be enabled without enabling approval or replacement uploads', async () => {
  assert.equal(config.allowPreparation, false);
  assert.equal(
    parseConnection({
      apiUrl: WAVE_API,
      authMode: 'access-key',
      allowPreparation: 'true',
    }).allowPreparation,
    false,
  );
  const preparing = parseConnection({
    apiUrl: WAVE_API,
    authMode: 'access-key',
    readOnly: true,
    allowPreparation: true,
  });
  const sent = [];
  const client = createWaveClient(preparing, {
    accessKey: 'test-only-key',
    signal: new AbortController().signal,
    onUnauthorized: () => {},
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body).action);
      return Response.json(
        { runId: '123', status: 'generating' },
        { status: 202 },
      );
    },
  });
  assert.equal((await client({ action: 'generate' })).runId, '123');
  for (const action of ['approve', 'reject', 'upload'])
    await assert.rejects(
      client({ action, runId: '123' }),
      /Production actions are paused/,
    );
  assert.deepEqual(sent, ['generate']);
});

test('production mode permits review decisions and replacement uploads through the authenticated client', async () => {
  const production = parseConnection({
    apiUrl: WAVE_API,
    authMode: 'access-key',
    readOnly: false,
    allowPreparation: true,
  });
  const sent = [];
  const client = createWaveClient(production, {
    accessKey: 'test-only-key',
    signal: new AbortController().signal,
    onUnauthorized: () => {},
    fetch: async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer test-only-key');
      const body = JSON.parse(init.body);
      sent.push(body.action);
      return Response.json({
        runId: body.runId,
        status: body.action === 'reject' ? 'rejected' : 'running',
      });
    },
  });
  assert.equal(
    (await client({ action: 'approve', runId: '123' })).status,
    'running',
  );
  assert.equal(
    (
      await client({
        action: 'reject',
        runId: '123',
        reason: 'Use the revised file',
      })
    ).status,
    'rejected',
  );
  assert.equal(
    (
      await client({
        action: 'upload',
        runId: '123',
        fileName: 'replacement.xlsx',
        fileBase64: 'UEsDBAo=',
        sheetName: 'Waves',
      })
    ).status,
    'running',
  );
  await assert.rejects(
    client({ action: 'approve', runId: 'invalid' }),
    /valid run/,
  );
  assert.deepEqual(sent, ['approve', 'reject', 'upload']);
});

test('expired access clears the session and a disconnected client makes no more requests', async () => {
  const controller = new AbortController();
  let expired = 0,
    requests = 0;
  const client = clientWith(
    async () => {
      requests++;
      return new Response('Unauthorized', { status: 401 });
    },
    {
      signal: controller.signal,
      onUnauthorized: () => {
        expired++;
        controller.abort();
      },
    },
  );
  await assert.rejects(client({ action: 'list' }), AccessError);
  await assert.rejects(client({ action: 'list' }), AccessError);
  assert.equal(expired, 1);
  assert.equal(requests, 1);
});

test('download reads use the detail action and preserve the original-file option', async () => {
  const client = clientWith(async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.deepEqual(request, {
      action: 'detail',
      runId: '123',
      download: true,
      original: true,
      actor: 'Wave Bot operator',
    });
    return Response.json({
      run: { runId: '123', fileBase64: 'UEsDB', downloadName: 'wave.xlsx' },
    });
  });
  const result = await client({
    action: 'detail',
    runId: '123',
    download: true,
    original: true,
  });
  assert.equal(result.run.downloadName, 'wave.xlsx');
});

test('bad keys, unreadable responses and missing data fail with clear errors', async () => {
  await assert.rejects(
    clientWith(
      () => {
        throw Error('must not send');
      },
      { accessKey: '' },
    )({ action: 'list' }),
    /private Wave Bot access key/,
  );
  await assert.rejects(
    clientWith(async () => new Response('<html>'))({ action: 'list' }),
    /unreadable response/,
  );
  await assert.rejects(
    clientWith(async () => Response.json({}))({ action: 'list' }),
    /run history/,
  );
  await assert.rejects(
    clientWith(async () => Response.json({}))({
      action: 'detail',
      runId: '123',
    }),
    /selected run/,
  );
});
