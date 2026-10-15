const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { loadRemoteServerConfig, remoteServerRequestHeaders, writeActiveRemoteServer } = require('../dist/main/remote-server.js')

const SETTINGS = 'desktop-remote-server.json'

async function homeWith(t, content, file = SETTINGS) {
  const dir = await mkdtemp(join(tmpdir(), 'ekko-remote-servers-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  if (content !== undefined) {
    await writeFile(join(dir, file), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

// loadRemoteServerConfig(env, home, legacyUserDataDir)
const load = (home, env = {}, legacy) => loadRemoteServerConfig(env, home, legacy)

test('absent file and env keep local mode without an error', async t => {
  const dir = await homeWith(t)
  assert.deepEqual(load(dir), { active: null, servers: [], error: null, file: null })
})

test('valid file selects the active server and normalizes URLs like upstream', async t => {
  const dir = await homeWith(t, {
    active: 'chloe',
    servers: [
      { name: 'chloe', url: 'http://10.23.23.140:8648/app/?next=1#/chat' },
      { name: 'backup', url: 'https://ekko.example.com:443/' },
    ],
  })
  const config = load(dir)
  assert.deepEqual(config.active, { name: 'chloe', url: 'http://10.23.23.140:8648/app' })
  assert.deepEqual(config.servers.map(server => server.url), ['http://10.23.23.140:8648/app', 'https://ekko.example.com'])
  assert.equal(config.error, null)
  assert.equal(config.file, join(dir, SETTINGS))
})

test('env override takes precedence over the file; invalid values fall back silently', async t => {
  const dir = await homeWith(t, { active: 'chloe', servers: [{ name: 'chloe', url: 'http://10.23.23.140:8648' }] })
  const config = load(dir, { EKKO_STUDIO_DESKTOP_SERVER_URL: ' https://env.example.com/path?q=1 ' })
  assert.deepEqual(config.active, { name: 'https://env.example.com/path', url: 'https://env.example.com/path' })
  assert.equal(config.servers.length, 1)
  assert.equal(config.file, null)

  // The fork-era variable is still honoured, after the upstream one.
  assert.equal(load(dir, { EKKO_REMOTE_SERVER_URL: 'http://legacy.example.com' }).active.url, 'http://legacy.example.com')
  assert.equal(load(dir, { EKKO_STUDIO_DESKTOP_SERVER_URL: 'http://new.example.com', EKKO_REMOTE_SERVER_URL: 'http://legacy.example.com' }).active.url, 'http://new.example.com')

  const invalid = load(dir, { EKKO_STUDIO_DESKTOP_SERVER_URL: 'https://user:secret@env.example.com' })
  assert.equal(invalid.active.name, 'chloe')
})

test('the upstream single-URL file shape still works', async t => {
  const dir = await homeWith(t, { serverUrl: 'https://docker.example.com:6060/' })
  assert.deepEqual(load(dir).active, { name: 'https://docker.example.com:6060', url: 'https://docker.example.com:6060' })
  assert.equal(load(await homeWith(t, { serverUrl: '' })).active, null)
  assert.equal(load(await homeWith(t, { serverUrl: 'ftp://nope' })).error, null)
})

test('the legacy userData remote-servers.json is read when the Web UI home has no file', async t => {
  const home = await homeWith(t)
  const legacy = await homeWith(t, { active: 'chloe', servers: [{ name: 'chloe', url: 'http://10.23.23.140:8648' }] }, 'remote-servers.json')
  const config = load(home, {}, legacy)
  assert.equal(config.active.name, 'chloe')
  assert.equal(config.file, join(legacy, 'remote-servers.json'))
  await writeFile(join(home, SETTINGS), JSON.stringify({ serverUrl: 'http://home.example.com' }))
  assert.equal(load(home, {}, legacy).active.url, 'http://home.example.com')
})

test('entries with credentials or non-http schemes are ignored without logging the URL', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const dir = await homeWith(t, {
    active: 'ok',
    servers: [
      { name: 'creds', url: 'http://admin:secret@10.0.0.1:8648' },
      { name: 'user-only', url: 'https://admin@10.0.0.1' },
      { name: 'file', url: 'file:///etc/passwd' },
      { name: 'js', url: 'javascript:alert(1)' },
      { name: 'ftp', url: 'ftp://10.0.0.1' },
      { name: 'garbage', url: 'not a url' },
      { name: '', url: 'http://10.0.0.2' },
      { name: 'ok', url: 'http://10.0.0.3:8648' },
      { name: 'ok', url: 'http://10.0.0.4:8648' },
    ],
  })
  const config = load(dir)
  assert.deepEqual(config.servers, [{ name: 'ok', url: 'http://10.0.0.3:8648' }])
  assert.equal(warn.mock.callCount(), 8)
  assert.ok(warn.mock.calls.every(call => !String(call.arguments[0]).includes('secret')))
})

test('an invalid active entry falls back to local mode with an error', async t => {
  t.mock.method(console, 'warn', () => {})
  const cases = [
    { active: 'creds', servers: [{ name: 'creds', url: 'http://admin:secret@10.0.0.1' }] },
    { active: 'missing', servers: [{ name: 'chloe', url: 'http://10.23.23.140:8648' }] },
    { servers: [{ name: 'chloe', url: 'http://10.23.23.140:8648' }] },
    { active: 'chloe', servers: 'http://10.23.23.140:8648' },
    '{ not json',
  ]
  for (const content of cases) {
    const config = load(await homeWith(t, content))
    assert.equal(config.active, null, JSON.stringify(content))
    assert.equal(typeof config.error, 'string', JSON.stringify(content))
    assert.doesNotMatch(config.error, /secret/)
  }
})

test('switching writes only the active name and the next load selects it', async t => {
  const original = {
    active: 'chloe',
    servers: [{ name: 'chloe', url: 'http://10.23.23.140:8648' }, { name: 'backup', url: 'https://ekko.example.com' }],
  }
  const dir = await homeWith(t, original)
  writeActiveRemoteServer(load(dir).file, 'backup')
  assert.deepEqual(JSON.parse(await readFile(join(dir, SETTINGS), 'utf8')), { ...original, active: 'backup' })
  assert.deepEqual(load(dir).active, { name: 'backup', url: 'https://ekko.example.com' })
  if (process.platform !== 'win32') assert.equal((await stat(join(dir, SETTINGS))).mode & 0o777, 0o600)
})

test('server headers are validated per entry and never logged', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const token = { 'CF-Access-Client-Id': 'client-id.access', 'CF-Access-Client-Secret': 'top-secret' }
  const many = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [`X-H${i}`, 'top-secret']))
  const url = 'https://ekko.example.com'
  const dir = await homeWith(t, {
    active: 'ok',
    servers: [
      { name: 'ok', url, headers: token },
      { name: 'plain', url },
      { name: 'sixteen', url, headers: many(16) },
      { name: 'seventeen', url, headers: many(17) },
      { name: 'crlf', url, headers: { 'X-A': 'top-secret\r\nX-Injected: 1' } },
      { name: 'nul', url, headers: { 'X-A': 'top-secret\u0000' } },
      { name: 'host', url, headers: { HoSt: 'top-secret' } },
      { name: 'cookie', url, headers: { cookie: 'top-secret' } },
      { name: 'upgrade', url, headers: { Upgrade: 'top-secret' } },
      { name: 'number', url, headers: { 'X-A': 1 } },
      { name: 'bad-name', url, headers: { 'X A': 'top-secret' } },
      { name: 'same-name', url, headers: { 'X-A': 'top-secret', 'x-a': 'top-secret' } },
      { name: 'array', url, headers: ['top-secret'] },
      { name: 'null', url, headers: null },
    ],
  })
  const config = load(dir)
  assert.deepEqual(config.servers.map(server => server.name), ['ok', 'plain', 'sixteen'])
  assert.deepEqual(config.active, { name: 'ok', url, headers: token })
  assert.deepEqual(config.servers[1], { name: 'plain', url })
  assert.equal(warn.mock.callCount(), 11)
  assert.ok(warn.mock.calls.every(call => !/top-secret|CF-Access|X-H/.test(String(call.arguments[0]))))
})

test('headers are applied only to the exact origin of a listed server', () => {
  const servers = [
    { name: 'a', url: 'https://ekko.example.com', headers: { 'CF-Access-Client-Id': 'id' } },
    { name: 'b', url: 'http://10.0.0.1:8648' },
  ]
  const requestHeaders = { Accept: '*/*', 'cf-access-client-id': 'from-page' }
  const expected = { Accept: '*/*', 'CF-Access-Client-Id': 'id' }
  assert.deepEqual(remoteServerRequestHeaders(servers, 'https://ekko.example.com/api/x?y=1', requestHeaders), expected)
  assert.deepEqual(remoteServerRequestHeaders(servers, 'wss://ekko.example.com/socket.io/?EIO=4', requestHeaders), expected)
  for (const url of [
    'https://ekko.example.com:8443/',
    'http://ekko.example.com/',
    'ws://ekko.example.com/socket.io/',
    'https://evil.example.com/',
    'https://ekko.example.com.evil.example/',
    'http://10.0.0.1:8648/',
    'not a url',
  ]) assert.equal(remoteServerRequestHeaders(servers, url, requestHeaders), undefined, url)
})
