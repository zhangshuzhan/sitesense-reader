import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { AppRoutes } from '@/App'
import { ContextMenuProvider } from '@/components/ContextMenu'
import { useFeedStore } from '@/stores/feedStore'
import { useSettingsStore } from '@/stores/settingsStore'

const mockInvoke = vi.fn()

vi.mock('@/utils/tauri', () => ({
  isTauriEnv: true,
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: any) => (
    <div>
      {data.map((item: any, index: number) => (
        <div key={item.id}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="route">{location.pathname}</div>
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ContextMenuProvider>
        <AppRoutes />
      </ContextMenuProvider>
      <LocationProbe />
    </MemoryRouter>
  )
}

describe('App navigation', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useFeedStore.getState().reset()
    useSettingsStore.setState({ sidebarCollapsed: false })

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_feeds') return Promise.resolve([])
      if (cmd === 'get_all_tags') return Promise.resolve([])
      if (cmd === 'get_groups') return Promise.resolve([])
      if (cmd === 'get_rules') return Promise.resolve([])
      if (cmd === 'get_articles') return Promise.resolve([])
      if (cmd === 'get_unread_articles') return Promise.resolve([])
      if (cmd === 'get_starred_articles') return Promise.resolve([])
      if (cmd === 'get_favorite_articles') return Promise.resolve([])
      return Promise.resolve(null)
    })
  })

  it.each(['/unread', '/starred', '/favorites'])(
    'navigates from %s back to all articles',
    async (path) => {
      const user = userEvent.setup()
      renderAt(path)

      await waitFor(() => {
        expect(screen.getByTestId('route')).toHaveTextContent(path)
      })

      await user.click(screen.getByTitle('所有文章'))

      await waitFor(() => {
        expect(screen.getByTestId('route')).toHaveTextContent('/')
      })
      expect(await screen.findByRole('heading', { name: '所有文章' })).toBeInTheDocument()
    }
  )
})
