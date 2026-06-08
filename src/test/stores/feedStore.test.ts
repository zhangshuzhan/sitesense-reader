import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFeedStore } from '@/stores/feedStore'
import { Feed, Article } from '@/types'
import { invoke } from '@/utils/tauri'

vi.mock('@/utils/tauri', () => ({
  invoke: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)

describe('FeedStore', () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
    mockedInvoke.mockResolvedValue(null)
    useFeedStore.getState().reset()
  })

  describe('Feed operations', () => {
    const mockFeed: Feed = {
      id: 1,
      title: 'Test Feed',
      url: 'https://example.com/feed',
      description: 'Test description',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    it('should set feeds', () => {
      const { setFeeds } = useFeedStore.getState()
      setFeeds([mockFeed])
      
      const { feeds } = useFeedStore.getState()
      expect(feeds).toHaveLength(1)
      expect(feeds[0].title).toBe('Test Feed')
    })

    it('should add a feed', () => {
      const { addFeed } = useFeedStore.getState()
      addFeed(mockFeed)
      
      const { feeds } = useFeedStore.getState()
      expect(feeds).toHaveLength(1)
      expect(feeds[0].title).toBe('Test Feed')
    })

    it('should update a feed', () => {
      const { setFeeds, updateFeed } = useFeedStore.getState()
      setFeeds([mockFeed])
      
      updateFeed(1, { title: 'Updated Feed' })
      
      const { feeds } = useFeedStore.getState()
      expect(feeds[0].title).toBe('Updated Feed')
    })

    it('should delete a feed', () => {
      const { setFeeds, deleteFeed } = useFeedStore.getState()
      setFeeds([mockFeed])
      
      deleteFeed(1)
      
      const { feeds } = useFeedStore.getState()
      expect(feeds).toHaveLength(0)
    })
  })

  describe('Article operations', () => {
    const mockArticle: Article = {
      id: 1,
      feedId: 1,
      title: 'Test Article',
      link: 'https://example.com/article',
      isRead: false,
      isStarred: false,
      isFavorite: false,
      createdAt: '2026-01-01T00:00:00Z',
    }

    it('should set articles', () => {
      const { setArticles } = useFeedStore.getState()
      setArticles([mockArticle])
      
      const { articles } = useFeedStore.getState()
      expect(articles).toHaveLength(1)
      expect(articles[0].title).toBe('Test Article')
    })

    it('should add an article', () => {
      const { addArticle } = useFeedStore.getState()
      addArticle(mockArticle)
      
      const { articles } = useFeedStore.getState()
      expect(articles).toHaveLength(1)
      expect(articles[0].title).toBe('Test Article')
    })

    it('should update an article', () => {
      const { setArticles, updateArticle } = useFeedStore.getState()
      setArticles([mockArticle])
      
      updateArticle(1, { title: 'Updated Article' })
      
      const { articles } = useFeedStore.getState()
      expect(articles[0].title).toBe('Updated Article')
    })

    it('should delete an article', () => {
      const { setArticles, deleteArticle } = useFeedStore.getState()
      setArticles([mockArticle])
      
      deleteArticle(1)
      
      const { articles } = useFeedStore.getState()
      expect(articles).toHaveLength(0)
    })

    it('should mark article as read', () => {
      const { setArticles, updateArticle } = useFeedStore.getState()
      setArticles([mockArticle])
      
      updateArticle(1, { isRead: true })
      
      const { articles } = useFeedStore.getState()
      expect(articles[0].isRead).toBe(true)
    })

    it('should toggle article star', () => {
      const { setArticles, updateArticle } = useFeedStore.getState()
      setArticles([mockArticle])
      
      updateArticle(1, { isStarred: true })
      
      const { articles } = useFeedStore.getState()
      expect(articles[0].isStarred).toBe(true)
    })

    it('should toggle article favorite', () => {
      const { setArticles, updateArticle } = useFeedStore.getState()
      setArticles([mockArticle])
      
      updateArticle(1, { isFavorite: true })
      
      const { articles } = useFeedStore.getState()
      expect(articles[0].isFavorite).toBe(true)
    })

    it('should apply read updates idempotently to feed unread counts', () => {
      const { setFeeds, setArticles, applyArticleUpdate } = useFeedStore.getState()
      setFeeds([
        {
          id: 1,
          title: 'Test Feed',
          url: 'https://example.com/feed',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          unreadCount: 1,
        },
      ])
      setArticles([mockArticle])

      applyArticleUpdate({ id: 1, feedId: 1, isRead: true })
      applyArticleUpdate({ id: 1, feedId: 1, isRead: true })

      const { articles, feeds } = useFeedStore.getState()
      expect(articles[0].isRead).toBe(true)
      expect(feeds[0].unreadCount).toBe(0)
    })

    it('should not change feed unread counts when article state is unknown', () => {
      const { setFeeds, applyArticleUpdate } = useFeedStore.getState()
      setFeeds([
        {
          id: 1,
          title: 'Test Feed',
          url: 'https://example.com/feed',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          unreadCount: 3,
        },
      ])

      applyArticleUpdate({ id: 99, feedId: 1, isRead: true })

      const { feeds } = useFeedStore.getState()
      expect(feeds[0].unreadCount).toBe(3)
    })

    it('should update feed unread counts when caller provides previous read state', () => {
      const { setFeeds, applyArticleUpdate } = useFeedStore.getState()
      setFeeds([
        {
          id: 1,
          title: 'Test Feed',
          url: 'https://example.com/feed',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          unreadCount: 1,
        },
      ])

      applyArticleUpdate({
        id: 99,
        feedId: 1,
        isRead: true,
        previousIsRead: false,
      })

      const { feeds } = useFeedStore.getState()
      expect(feeds[0].unreadCount).toBe(0)
    })

    it('should keep public read action in sync with feed counts and current article', async () => {
      const { setFeeds, setArticles, setCurrentArticle, markArticleRead } = useFeedStore.getState()
      setFeeds([
        {
          id: 1,
          title: 'Test Feed',
          url: 'https://example.com/feed',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          unreadCount: 1,
        },
      ])
      setArticles([mockArticle])
      setCurrentArticle(mockArticle)

      await markArticleRead(1, true)

      const { articles, currentArticle, feeds } = useFeedStore.getState()
      expect(articles[0].isRead).toBe(true)
      expect(currentArticle?.isRead).toBe(true)
      expect(feeds[0].unreadCount).toBe(0)
    })

    it('should use one IPC call for batch read updates', async () => {
      const { setFeeds, setArticles, batchMarkRead } = useFeedStore.getState()
      setFeeds([
        {
          id: 1,
          title: 'Test Feed',
          url: 'https://example.com/feed',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          unreadCount: 2,
        },
      ])
      setArticles([
        mockArticle,
        { ...mockArticle, id: 2, link: 'https://example.com/article-2' },
      ])

      await batchMarkRead([1, 2], true)

      expect(mockedInvoke).toHaveBeenCalledTimes(1)
      expect(mockedInvoke).toHaveBeenCalledWith('mark_articles_read', {
        ids: [1, 2],
        isRead: true,
      })
      const { articles, feeds } = useFeedStore.getState()
      expect(articles.every((article) => article.isRead)).toBe(true)
      expect(feeds[0].unreadCount).toBe(0)
    })
  })

  describe('Loading and error states', () => {
    it('should set loading state', () => {
      const { setLoading } = useFeedStore.getState()
      setLoading(true)
      
      const { isLoading } = useFeedStore.getState()
      expect(isLoading).toBe(true)
    })

    it('should set error state', () => {
      const { setError } = useFeedStore.getState()
      setError('Test error')
      
      const { error } = useFeedStore.getState()
      expect(error).toBe('Test error')
    })

    it('should clear error', () => {
      const { setError } = useFeedStore.getState()
      setError('Test error')
      setError(null)
      
      const { error } = useFeedStore.getState()
      expect(error).toBeNull()
    })
  })
})
