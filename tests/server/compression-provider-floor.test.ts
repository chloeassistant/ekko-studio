import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Real compressor, session store, usage store and snapshot store on an in-memory database;
// only the summarizer model call, profile config and context length are stubbed.
const summarizerRun = vi.fn()

describe('compression decisions with the provider usage floor', () => {
  let db: any = null

  beforeEach(async () => {
    vi.resetModules()
    summarizerRun.mockReset()
    summarizerRun.mockResolvedValue({ output: { role: 'assistant', content: 'new summary', finishReason: 'stop' } })
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/modules/studio/infrastructure/database/index', () => ({
      getDb: () => db,
      isSqliteAvailable: () => true,
      getStoragePath: () => ':memory:',
    }))
    vi.doMock('../../packages/server/src/modules/studio/public/profile-config', () => ({
      readConfigYamlForProfile: vi.fn(async () => ({})),
    }))
    vi.doMock('../../packages/server/src/modules/studio/public/provider-runtime', () => ({
      getModelContextLength: vi.fn(() => 256_000),
    }))
    vi.doMock('../../packages/server/src/modules/studio/public/chat-agent-runtime', async importOriginal => ({
      ...(await importOriginal<object>()),
      resolveChatEkkoProviderRuntimeConfig: vi.fn(async () => ({ provider: 'p', baseUrl: 'http://x', apiKey: 'k', apiMode: 'chat_completions' })),
      resolveChatEkkoModelProviderConfigs: vi.fn(() => ({ providerConfig: { id: 'p' } })),
      createChatEkkoModelClient: vi.fn(() => ({})),
      createChatEkkoAuthorizedProviderFetch: vi.fn(() => vi.fn()),
      getChatEkkoAgent: vi.fn(() => ({ runIsolated: (_options: unknown, input: unknown) => summarizerRun(input) })),
    }))
    const { initAllHermesTables } = await import('../../packages/server/src/modules/studio/infrastructure/database/schemas')
    initAllHermesTables()
  })

  afterEach(() => {
    db?.close()
    db = null
    vi.doUnmock('../../packages/server/src/modules/studio/infrastructure/database/index')
    vi.doUnmock('../../packages/server/src/modules/studio/public/profile-config')
    vi.doUnmock('../../packages/server/src/modules/studio/public/provider-runtime')
    vi.doUnmock('../../packages/server/src/modules/studio/public/chat-agent-runtime')
    vi.resetModules()
  })

  const run = async (sessionId: string) => {
    const { buildCompressedHistory } = await import('../../packages/server/src/modules/studio/services/chat-run/compression')
    return buildCompressedHistory(sessionId, 'default', '', undefined, vi.fn(), new Map(), { model: 'm', provider: 'p' })
  }

  it('saves a snapshot when the floor triggers compression, so the same usage does not trigger it again', async () => {
    const { addMessage, createSession } = await import('../../packages/server/src/modules/studio/repositories/session-store')
    const { getCompressionSnapshot, saveCompressionSnapshot } = await import('../../packages/server/src/modules/studio/repositories/compression-snapshot')
    const { updateUsage } = await import('../../packages/server/src/modules/studio/repositories/usage-store')
    createSession({ id: 's1', source: 'cli' })
    const ids = ['u', 'a', 'u', 'a', 'u', 'a', 'u'].map((role, index) => addMessage({
      session_id: 's1', role: role === 'u' ? 'user' : 'assistant', content: `message ${index}`, timestamp: index + 1,
    })!)
    expect(saveCompressionSnapshot('s1', 'old summary', 1, 2, {
      compressedThroughMessageId: ids[1], protectedHeadThroughMessageId: null, expectedHistoryRevision: 0,
    })).toBe(true)
    db.prepare('UPDATE chat_compression_snapshots SET updated_at = 1000 WHERE session_id = ?').run('s1')
    // Local estimate is tiny; the provider reported 160k of prompt (> 128k trigger) after the snapshot.
    updateUsage('s1', { source: 'hermes', inputTokens: 10_000, cacheReadTokens: 150_000, outputTokens: 10, createdAt: 2_000 })

    await run('s1')
    const snapshot = getCompressionSnapshot('s1')
    expect(summarizerRun).toHaveBeenCalledTimes(1)
    expect(snapshot?.summary).toBe('new summary')
    expect(snapshot?.compressedThroughMessageId).toBe(ids[5])
    expect(snapshot?.updatedAt).toBeGreaterThan(2_000)

    await run('s1')
    expect(summarizerRun).toHaveBeenCalledTimes(1)
  })

  it('ignores provider usage recorded before the history was cleared', async () => {
    const { addMessage, clearSessionMessages, createSession } = await import('../../packages/server/src/modules/studio/repositories/session-store')
    const { updateUsage } = await import('../../packages/server/src/modules/studio/repositories/usage-store')
    createSession({ id: 's2', source: 'cli' })
    for (let index = 0; index < 6; index++) {
      addMessage({ session_id: 's2', role: index % 2 ? 'assistant' : 'user', content: `old ${index}`, timestamp: 100 + index })
    }
    updateUsage('s2', { source: 'hermes', inputTokens: 10_000, cacheReadTokens: 150_000, outputTokens: 10, createdAt: 106_000 })
    clearSessionMessages('s2')
    // A request that failed before producing usage, then a short retry.
    addMessage({ session_id: 's2', role: 'user', content: 'failed request', timestamp: 200 })
    addMessage({ session_id: 's2', role: 'user', content: 'retry', timestamp: 201 })

    await expect(run('s2')).resolves.toEqual([{ role: 'user', content: 'failed request' }])
    expect(summarizerRun).not.toHaveBeenCalled()
  })
})
