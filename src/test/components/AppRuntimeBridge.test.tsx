import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppRuntimeBridge from '@/components/AppRuntimeBridge'

const getWindowRestoreContext = vi.fn()
const processNewArticles = vi.fn()
const refreshFeeds = vi.fn()
const runAiQueueForeground = vi.fn()
const syncRuntimeSettings = vi.fn()
const syncWindowContext = vi.fn()
const listen = vi.fn()

vi.mock('@/utils/tauri', () => ({
  isTauriEnv: true,
}))

vi.mock('@/services/runtime', () => ({
  getWindowRestoreContext: () => getWindowRestoreContext(),
  processNewArticles: (articleIds: number[]) => processNewArticles(articleIds),
  refreshFeeds: () => refreshFeeds(),
  runAiQueueForeground: () => runAiQueueForeground(),
  syncRuntimeSettings: () => syncRuntimeSettings(),
  syncWindowContext: (route: string) => syncWindowContext(route),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (eventName: string, handler: (event: { payload?: unknown }) => void) =>
    listen(eventName, handler),
}))

function RouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <button type="button" onClick={() => navigate('/settings')}>
      {location.pathname}
    </button>
  )
}

function MultiRouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div>
      <div>{location.pathname}</div>
      <button type="button" onClick={() => navigate('/unread')}>
        unread
      </button>
      <button type="button" onClick={() => navigate('/')}>
        home
      </button>
    </div>
  )
}

function CurrentRoute() {
  const location = useLocation()
  return <div>{location.pathname}</div>
}

describe('AppRuntimeBridge', () => {
  beforeEach(() => {
    getWindowRestoreContext.mockReset()
    processNewArticles.mockReset()
    refreshFeeds.mockReset()
    runAiQueueForeground.mockReset()
    syncRuntimeSettings.mockReset()
    syncWindowContext.mockReset()
    listen.mockReset()

    getWindowRestoreContext.mockResolvedValue({})
    processNewArticles.mockResolvedValue(undefined)
    refreshFeeds.mockResolvedValue(undefined)
    runAiQueueForeground.mockResolvedValue(undefined)
    syncRuntimeSettings.mockResolvedValue(undefined)
    syncWindowContext.mockResolvedValue(undefined)
    listen.mockResolvedValue(() => {})
  })

  it('syncs the initial route after restore is ready', async () => {
    render(
      <MemoryRouter initialEntries={['/unread?filter=new#top']}>
        <AppRuntimeBridge />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(syncWindowContext).toHaveBeenCalledWith('/unread?filter=new#top')
    })
  })

  it('does not let a delayed route restore override user navigation', async () => {
    let resolveRestore: (value: { lastRoute: string }) => void = () => {}
    getWindowRestoreContext.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve
      })
    )

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeBridge />
        <RouteProbe />
      </MemoryRouter>
    )

    act(() => {
      screen.getByRole('button', { name: '/' }).click()
    })
    expect(screen.getByRole('button')).toHaveTextContent('/settings')

    await act(async () => {
      resolveRestore({ lastRoute: '/unread' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('/settings')
    })
  })

  it('does not let delayed route restore override navigation back to the initial route', async () => {
    let resolveRestore: (value: { lastRoute: string }) => void = () => {}
    getWindowRestoreContext.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve
      })
    )

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeBridge />
        <MultiRouteProbe />
      </MemoryRouter>
    )

    act(() => {
      screen.getByRole('button', { name: 'unread' }).click()
    })
    expect(screen.getByText('/unread')).toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: 'home' }).click()
    })
    expect(screen.getByText('/')).toBeInTheDocument()

    await act(async () => {
      resolveRestore({ lastRoute: '/starred' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('/')).toBeInTheDocument()
    })
    expect(screen.queryByText('/starred')).not.toBeInTheDocument()
  })

  it('does not restore the settings route as a content route', async () => {
    getWindowRestoreContext.mockResolvedValue({ lastRoute: '/settings' })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeBridge />
        <CurrentRoute />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(syncWindowContext).toHaveBeenCalledWith('/')
    })
    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('does not save settings as the last restorable route', async () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppRuntimeBridge />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(runAiQueueForeground).toHaveBeenCalled()
    })
    expect(syncWindowContext).not.toHaveBeenCalledWith('/settings')
  })

  it('processes only article ids from runtime feed update events', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeBridge />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('app-runtime://feeds-updated', expect.any(Function))
    })

    const handler = listen.mock.calls[0][1] as (event: { payload?: unknown }) => void

    act(() => {
      handler({ payload: { newArticleIds: [1, 2] } })
    })

    await waitFor(() => {
      expect(processNewArticles).toHaveBeenCalledWith([1, 2])
    })
  })

  it('refreshes feed state for runtime feed update events', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeBridge />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('app-runtime://feeds-updated', expect.any(Function))
    })

    const handler = listen.mock.calls[0][1] as (event: { payload?: unknown }) => void

    act(() => {
      handler({ payload: { feedsChanged: true } })
    })

    await waitFor(() => {
      expect(refreshFeeds).toHaveBeenCalledTimes(1)
    })
  })

  it('refreshes the UI for runtime cleanup events without running new-article work', async () => {
    const feedsUpdated = vi.fn()
    window.addEventListener('feeds-updated', feedsUpdated)

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRuntimeBridge />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('app-runtime://feeds-updated', expect.any(Function))
    })

    const handler = listen.mock.calls[0][1] as (event: { payload?: unknown }) => void

    act(() => {
      handler({ payload: { deletedArticleCount: 3 } })
    })

    await waitFor(() => {
      expect(feedsUpdated).toHaveBeenCalledTimes(1)
    })
    expect(processNewArticles).not.toHaveBeenCalled()

    window.removeEventListener('feeds-updated', feedsUpdated)
  })
})
