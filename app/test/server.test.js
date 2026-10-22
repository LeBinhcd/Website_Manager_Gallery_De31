import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { fileURLToPath } from 'node:url';

let child;
let baseUrl;

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  const port = 33000 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  await waitForServer(`${baseUrl}/health`);
});

test.after(() => child?.kill('SIGTERM'));

test('health endpoint reports the Gallery app is ready', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'gallery-app' });
});

test('root endpoint is served by the Gallery app', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /id="current-user-name"/);
  assert.match(body, /class="auth-screen" id="auth-panel"/);
  assert.match(body, /class="app-shell dashboard" id="dashboard"/);
  assert.match(body, /class="app-shell dashboard" id="dashboard"[^>]*>/);
});

test('collections route serves the separate collections page', async () => {
  const response = await fetch(`${baseUrl}/collections`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /data-page="collections"/);
  assert.match(body, /Tất cả bộ sưu tập/);
  assert.match(body, /href="\/collections"/);
});

test('shared route and API are available', async () => {
  const page = await fetch(`${baseUrl}/shared`);
  const body = await page.text();
  assert.equal(page.status, 200);
  assert.match(body, /data-page="shared"/);
  assert.match(body, /Chia sẻ/);
  const api = await fetch(`${baseUrl}/api/shared`);
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'authentication_required' });
});

test('recent route and API are available', async () => {
  const page = await fetch(`${baseUrl}/recent`);
  const body = await page.text();
  assert.equal(page.status, 200);
  assert.match(body, /data-page="recent"/);
  assert.match(body, /Gần đây/);
  const api = await fetch(`${baseUrl}/api/recent`);
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'authentication_required' });
});


