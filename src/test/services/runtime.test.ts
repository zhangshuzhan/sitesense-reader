import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runFeedRefresh, syncRuntimeSettings } from '@/services/runtime'
import { useSettingsStore } from '@/stores/settingsStore'

const invokeMock = vi.fn()

vi.mock('@/utils/tauri', () => ({
  isTauriEnv: true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

describe('runtime service', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  afterEach(() => {
    useSettingsStore.setState({
      autoUpdate: true,
      updateInterval: 15,
      rsshubDomain: 'https://rsshub.app',
      autoCleanup: {
        enabled: false,
        maxRetentionDays: 30,
        exceptStarred: true,
      },
      mediaCache: {
        enabled: false,
        maxRetentionDays: 30,
        maxCacheSizeMB: 500,
      },
    })
  })

  it('syncs auto update and cleanup settings to the Rust runtime', async () => {
    useSettingsStore.setState({
      autoUpdate: false,
      updateInterval: 60,
      rsshubDomain: 'https://rsshub.example.com',
      autoCleanup: {
        enabled: true,
        maxRetentionDays: 7,
        exceptStarred: false,
      },
      mediaCache: {
        enabled: true,
        maxRetentionDays: 14,
        maxCacheSizeMB: 256,
      },
    })

    await syncRuntimeSettings()

    expect(invokeMock).toHaveBeenCalledWith('sync_runtime_settings', {
      settings: {
        autoUpdate: false,
        updateInterval: 60,
        rsshubDomain: 'https://rsshub.example.com',
        autoCleanupEnabled: true,
        autoCleanupDays: 7,
        autoCleanupExceptStarred: false,
        mediaCacheEnabled: true,
        mediaCacheDays: 14,
        mediaCacheMaxSizeMb: 256,
      },
    })
  })

  it('dispatches feeds-updated when a refresh changes existing articles', async () => {
    const feedsUpdated = vi.fn()
    window.addEventListener('feeds-updated', feedsUpdated)
    invokeMock.mockImplementation((command: string) => {
      if (command === 'run_feed_refresh') {
        return Promise.resolve({
          newArticleIds: [],
          newArticleCount: 0,
          updatedArticleIds: [42],
          updatedArticleCount: 1,
          feedsChanged: false,
        })
      }
      if (command === 'get_feeds') return Promise.resolve([])
      return Promise.resolve(null)
    })

    await runFeedRefresh()

    expect(feedsUpdated).toHaveBeenCalledTimes(1)

    window.removeEventListener('feeds-updated', feedsUpdated)
  })
})
