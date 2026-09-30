import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REMOTE_SERVERS_FILE = 'remote-servers.json'
export const REMOTE_SERVER_URL_ENV = 'EKKO_REMOTE_SERVER_URL'

export type RemoteServer = { name: string; url: string }

// `active` null means local mode. `error` explains why a configured remote server
// was refused; the app then stays in local mode. The file is the only allowlist.
export type RemoteServerConfig = {
  active: RemoteServer | null
  servers: RemoteServer[]
  error: string | null
}

export function remoteServerOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

function localMode(error: string | null = null): RemoteServerConfig {
  return { active: null, servers: [], error }
}

export function loadRemoteServerConfig(
  userDataDir: string,
  envUrl = process.env[REMOTE_SERVER_URL_ENV],
): RemoteServerConfig {
  if (envUrl?.trim()) {
    const url = remoteServerOrigin(envUrl)
    if (!url) return localMode(`${REMOTE_SERVER_URL_ENV} must be an http(s) URL without credentials`)
    const server = { name: url, url }
    return { active: server, servers: [server], error: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(userDataDir, REMOTE_SERVERS_FILE), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return localMode()
    return localMode(`Cannot read ${REMOTE_SERVERS_FILE}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const { active, servers } = (parsed ?? {}) as { active?: unknown; servers?: unknown }
  const entries = (Array.isArray(servers) ? servers : []) as Array<{ name?: unknown; url?: unknown } | null>
  const valid: RemoteServer[] = []
  entries.forEach((entry, index) => {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const url = remoteServerOrigin(entry?.url)
    // Never log the URL: rejected entries may contain credentials.
    if (!name || !url || valid.some(server => server.name === name)) {
      console.warn(`[remote-server] ignoring invalid entry #${index} in ${REMOTE_SERVERS_FILE}`)
      return
    }
    valid.push({ name, url })
  })

  const selected = valid.find(server => server.name === active)
  if (!selected) return localMode(`${REMOTE_SERVERS_FILE}: active server "${String(active)}" is not a valid entry`)
  return { active: selected, servers: valid, error: null }
}

export function writeActiveRemoteServer(userDataDir: string, name: string): void {
  const file = join(userDataDir, REMOTE_SERVERS_FILE)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  data.active = name
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(temp, file)
}
