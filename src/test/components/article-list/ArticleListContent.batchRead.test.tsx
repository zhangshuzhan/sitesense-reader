import { forwardRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ArticleListContent from '@/components/article-list/ArticleListContent'
import { useFeedStore } from '@/stores/feedStore'

const mockInvoke = vi.fn()

vi.mock('@/utils/tauri', () => ({
  invoke: (cmd: string, args?: any) => mockInvoke(cmd, args),
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef<any, any>(({ data, itemContent }, _ref) => (
    <div>
      {data.map((item: any, index: number) => (
        <div key={item.id}>{itemContent(index, item)}</div>
      ))}
    </div>
  )),
}))

vi.mock('@/components/ArticleItem', () => ({
  default: ({ article }: any) => <div>{article.title}</div>,
}))

describe('ArticleListContent batch read actions', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useFeedStore.getState().reset()
    useFeedStore.getState().setFeeds([
      {
        id: 1,
        title: 'Feed 1',
        url: 'https://example.com/feed.xml',
        unreadCount: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ])
  })

  it('refreshes feed unread counts after marking selected articles as read', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'mark_articles_read') {
        return Promise.resolve(null)
      }
      if (cmd === 'get_feeds') {
        return Promise.resolve([
          {
            id: 1,
            title: 'Feed 1',
            url: 'https://example.com/feed.xml',
            unreadCount: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ])
      }

      return Promise.resolve(null)
    })

    const setArticles = vi.fn()
    const onClearSelection = vi.fn()

    render(
      <MemoryRouter>
        <ArticleListContent
          title="All"
          basePath=""
          articles={[
            {
              id: 1,
              feedId: 1,
              title: 'Article 1',
              link: 'https://example.com/articles/1',
              isRead: false,
              isStarred: false,
              isFavorite: false,
              createdAt: '2026-01-01T00:00:00Z',
            },
            {
              id: 2,
              feedId: 1,
              title: 'Article 2',
              link: 'https://example.com/articles/2',
              isRead: false,
              isStarred: false,
              isFavorite: false,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ]}
          isLoading={false}
          isMoreLoading={false}
          hasMore={false}
          refreshError={null}
          selectedArticles={new Set([1, 2])}
          emptyMessage="Empty"
          onLoadMore={() => {}}
          onRefresh={() => {}}
          onSelectArticle={() => {}}
          onSelectAll={() => {}}
          onClearSelection={onClearSelection}
          setArticles={setArticles}
        />
      </MemoryRouter>
    )

    await userEvent.click(screen.getByTitle('标记已读'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('mark_articles_read', {
        ids: [1, 2],
        isRead: true,
      })
    })

    await waitFor(() => {
      expect(useFeedStore.getState().feeds[0].unreadCount).toBe(0)
    })
  })
})
