import { act, cleanup, render, screen } from '@testing-library/react'
import type { RefObject } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { VirtuosoHandle } from 'react-virtuoso'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { useArticleListShortcuts } from '@/hooks/useArticleListShortcuts'
import { useGlobalShortcuts } from '@/hooks/useKeyboardShortcuts'
import { defaultShortcuts, useSettingsStore } from '@/stores/settingsStore'
import type { Article } from '@/types'

const articles: Article[] = [
  {
    id: 1,
    feedId: 1,
    title: 'First',
    link: 'https://example.com/1',
    isRead: false,
    isStarred: false,
    isFavorite: false,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    feedId: 1,
    title: 'Second',
    link: 'https://example.com/2',
    isRead: false,
    isStarred: false,
    isFavorite: false,
    createdAt: '2026-01-01T00:00:00Z',
  },
]

vi.mock('@/utils/tauri', () => ({
  invoke: vi.fn(),
}))

function CurrentPath() {
  const location = useLocation()
  return <div>{location.pathname}</div>
}

function GlobalShortcutHarness() {
  useGlobalShortcuts()
  return <CurrentPath />
}

function ArticleListShortcutHarness() {
  const virtuosoRef = {
    current: {
      scrollIntoView: vi.fn(),
    },
  } as unknown as RefObject<VirtuosoHandle>
  useArticleListShortcuts(articles, virtuosoRef, '/')
  return <CurrentPath />
}

describe('shortcut enable switch', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      shortcuts: defaultShortcuts,
      shortcutsEnabled: false,
    })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState({ shortcutsEnabled: true })
  })

  it('prevents global shortcuts when disabled', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <GlobalShortcutHarness />
      </MemoryRouter>
    )

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }))
    })

    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('prevents article list shortcuts when disabled', () => {
    render(
      <MemoryRouter initialEntries={['/article/1']}>
        <Routes>
          <Route path="/article/:articleId" element={<ArticleListShortcutHarness />} />
        </Routes>
      </MemoryRouter>
    )

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
    })

    expect(screen.getByText('/article/1')).toBeInTheDocument()
  })
})
