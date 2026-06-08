import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GeneralSettings from '@/components/settings/GeneralSettings'

const invokeMock = vi.fn()
const addToastMock = vi.fn()
const setFeedsMock = vi.fn()
const setRsshubDomainMock = vi.fn()
const setAutoMarkReadMock = vi.fn()
const setAutoCleanupMock = vi.fn()
const setMediaCacheMock = vi.fn()
const setExternalLinkBehaviorMock = vi.fn()
const setAutoUpdateMock = vi.fn()
const setUpdateIntervalMock = vi.fn()
const setLanguageMock = vi.fn()

vi.mock('@/utils/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

vi.mock('@/stores/toastStore', () => ({
  useToastStore: () => ({
    addToast: addToastMock
  })
}))

vi.mock('@/stores/feedStore', () => ({
  useFeedStore: (selector: (state: { setFeeds: typeof setFeedsMock }) => unknown) =>
    selector({
      setFeeds: setFeedsMock
    })
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    language: 'zh',
    setLanguage: setLanguageMock,
    rsshubDomain: 'https://rsshub.app',
    setRsshubDomain: setRsshubDomainMock,
    autoMarkRead: true,
    setAutoMarkRead: setAutoMarkReadMock,
    autoCleanup: {
      enabled: true,
      maxRetentionDays: 30,
      exceptStarred: true
    },
    setAutoCleanup: setAutoCleanupMock,
    mediaCache: {
      enabled: true,
      maxRetentionDays: 30,
      maxCacheSizeMB: 500
    },
    setMediaCache: setMediaCacheMock,
    externalLinkBehavior: 'block',
    setExternalLinkBehavior: setExternalLinkBehaviorMock,
    autoUpdate: true,
    setAutoUpdate: setAutoUpdateMock,
    updateInterval: 15,
    setUpdateInterval: setUpdateIntervalMock
  })
}))

vi.mock('@/components/OpmlManager', () => ({
  default: () => <div data-testid="opml-manager" />
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn()
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn()
}))

describe('GeneralSettings', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    addToastMock.mockReset()
    setFeedsMock.mockReset()
    setExternalLinkBehaviorMock.mockReset()
    setAutoCleanupMock.mockReset()
    setAutoUpdateMock.mockReset()
    setUpdateIntervalMock.mockReset()

    invokeMock
      .mockResolvedValueOnce({
        dbSize: 1024,
        articleCount: 5,
        mediaCacheSize: 128
      }) // initial get_storage_info
      .mockResolvedValueOnce(5) // clean_all_articles
      .mockResolvedValueOnce([
        {
          id: 1,
          title: 'Feed A',
          url: 'https://example.com/rss',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          unreadCount: 0
        }
      ]) // get_feeds
      .mockResolvedValueOnce({
        dbSize: 512,
        articleCount: 0,
        mediaCacheSize: 128
      }) // refreshed get_storage_info
  })

  it('refreshes sidebar feed counts after cleaning all articles', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    const openConfirmButton = await screen.findByRole('button', { name: '清除文章' })
    await user.click(openConfirmButton)

    const confirmButton = await screen.findByRole('button', { name: '清除' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('clean_all_articles', { exceptStarred: true })
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('get_feeds')
      expect(setFeedsMock).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 1,
          unreadCount: 0
        })
      ])
    })
  })

  it('updates external link behavior setting', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    const behaviorSelect = await screen.findByLabelText('外部链接')
    await user.selectOptions(behaviorSelect, 'confirm')

    expect(setExternalLinkBehaviorMock).toHaveBeenCalledWith('confirm')
  })

  it('updates auto update and interval settings', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    await user.click(await screen.findByRole('checkbox', { name: '自动更新' }))
    await user.selectOptions(await screen.findByLabelText('更新间隔'), '60')

    expect(setAutoUpdateMock).toHaveBeenCalledWith(false)
    expect(setUpdateIntervalMock).toHaveBeenCalledWith(60)
  })

  it('updates auto cleanup settings', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)

    await user.click(await screen.findByRole('checkbox', { name: '自动清理文章' }))
    await user.clear(await screen.findByLabelText('保留天数'))
    await user.type(await screen.findByLabelText('保留天数'), '7')
    await user.click(await screen.findByRole('checkbox', { name: '保留星标文章' }))

    expect(setAutoCleanupMock).toHaveBeenCalledWith({ enabled: false })
    expect(setAutoCleanupMock).toHaveBeenCalledWith({ maxRetentionDays: 7 })
    expect(setAutoCleanupMock).toHaveBeenCalledWith({ exceptStarred: false })
  })
})
