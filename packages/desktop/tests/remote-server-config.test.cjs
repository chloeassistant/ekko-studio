const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { loadRemoteServerConfig, writeActiveRemoteServer } = require('../dist/main/remote-server-config.js')

async function userDataWith(t, content) {
  const dir = await mkdtemp(join(tmpdir(), 'ekko-remote-servers-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  if (content !== undefined) {
    await writeFile(join(dir, 'remote-servers.json'), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

test('absent file and env keep local mode without an error', async t => {
  const dir = await userDataWith(t)
  assert.deepEqual(loadRemoteServerConfig(dir, ''), { active: null, servers: [], error: null })
})

test('valid file selects the active server and strips URLs to their origin', async t => {
  const dir = await userDataWith(t, {
    active: 'chloe',
    servers: [
      { name: 'chloe', url: 'http://10.23.23.140:8648/app/?next=1#/chat' },
      { name: 'backup', url: 'https://ekko.example.com:443/' },
    ],
  })
  const config = loadRemoteServerConfig(dir, '')
  assert.deepEqual(config.active, { name: 'chloe', url: 'http://10.23.23.140:8648' })
  assert.deepEqual(config.servers.map(server => server.url), ['http://10.23.23.140:8648', 'https://ekko.example.com'])
  assert.equal(config.error, null)
})

test('env override takes precedence over the file and is validated', async t => {
  const dir = await userDataWith(t, { active: 'chloe', servers: [{ name: 'chloe', url: 'http://10.23.23.140:8648' }] })
  const config = loadRemoteServerConfig(dir, ' https://env.example.com/path?q=1 ')
  assert.deepEqual(config.active, { name: 'https://env.example.com', url: 'https://env.example.com' })
  assert.equal(config.servers.length, 1)

  const invalid = loadRemoteServerConfig(dir, 'https://user:secret@env.example.com')
  assert.equal(invalid.active, null)
  assert.match(invalid.error, /EKKO_REMOTE_SERVER_URL/)
  assert.doesNotMatch(invalid.error, /secret/)
})

test('entries with credentials or non-http schemes are ignored without logging the URL', async t => {
  const warn = t.mock.method(console, 'warn', () => {})
  const dir = await userDataWith(t, {
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
  const config = loadRemoteServerConfig(dir, '')
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
    'null',
    '{ not json',
  ]
  for (const content of cases) {
    const config = loadRemoteServerConfig(await userDataWith(t, content), '')
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
  const dir = await userDataWith(t, original)
  writeActiveRemoteServer(dir, 'backup')
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'remote-servers.json'), 'utf8')), { ...original, active: 'backup' })
  assert.deepEqual(loadRemoteServerConfig(dir, '').active, { name: 'backup', url: 'https://ekko.example.com' })
})
