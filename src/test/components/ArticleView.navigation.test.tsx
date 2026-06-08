import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ArticleView from '@/components/ArticleView'
import { useSettingsStore } from '@/stores/settingsStore'

const mockInvoke = vi.fn()

vi.mock('@/utils/tauri', () => ({
  invoke: (cmd: string, args?: any) => mockInvoke(cmd, args),
  isTauriEnv: true,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}))

describe('ArticleView navigation context', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useSettingsStore.setState({
      autoMarkRead: false,
      shortcutsEnabled: true,
    })
  })

  it('requests search-scoped navigation when opened from search results', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_article') {
        return Promise.resolve({
          id: 1,
          feedId: 1,
          title: 'Search hit',
          link: 'https://example.com/articles/1',
          content: '<p>hello</p>',
          isRead: true,
          isStarred: false,
          isFavorite: false,
          createdAt: '2026-01-01T00:00:00Z',
        })
      }

      if (cmd === 'get_article_tags') {
        return Promise.resolve([])
      }

      if (cmd === 'get_article_navigation') {
        return Promise.resolve([null, null])
      }

      return Promise.resolve(null)
    })

    render(
      <MemoryRouter initialEntries={['/search/article/1?q=rust']}>
        <Routes>
          <Route path="/search/article/:articleId" element={<ArticleView />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Search hit' })).toBeInTheDocument()
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_article_navigation', {
        currentId: 1,
        context: {
          scope: 'search',
          query: 'rust',
        },
      })
    })
  })

  it('does not run article shortcuts when shortcuts are disabled', async () => {
    useSettingsStore.setState({ shortcutsEnabled: false })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_article') {
        return Promise.resolve({
          id: 1,
          feedId: 1,
          title: 'Shortcut disabled',
          link: 'https://example.com/articles/1',
          content: '<p>hello</p>',
          isRead: true,
          isStarred: false,
          isFavorite: false,
          createdAt: '2026-01-01T00:00:00Z',
        })
      }

      if (cmd === 'get_article_tags') {
        return Promise.resolve([])
      }

      if (cmd === 'get_article_navigation') {
        return Promise.resolve([null, null])
      }

      return Promise.resolve(null)
    })

    render(
      <MemoryRouter initialEntries={['/article/1']}>
        <Routes>
          <Route path="/article/:articleId" element={<ArticleView />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Shortcut disabled' })).toBeInTheDocument()

    mockInvoke.mockClear()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))
    })

    expect(mockInvoke).not.toHaveBeenCalledWith('mark_article_read', expect.anything())
  })
})
