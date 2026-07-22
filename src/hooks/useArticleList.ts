import { useState, useEffect, useCallback } from 'react'
import { invoke, isTauriEnv } from '@/utils/tauri'
import { Article } from '@/types'
import { useFeedStore } from '@/stores/feedStore'
import { useArticleUpdateListener } from './useArticleUpdateListener'

const DEFAULT_PAGE_SIZE = 10

export interface UseArticleListOptions {
  feedId?: number
  tagId?: number
  groupId?: number
  filter?: 'all' | 'unread' | 'starred' | 'favorite'
  sortBy?: string
  pageSize?: number
  filterFn?: (article: Article) => boolean
  beforeRefresh?: () => Promise<void>
}

export interface UseArticleListReturn {
  articles: Article[]
  isLoading: boolean
  isMoreLoading: boolean
  hasMore: boolean
  refreshError: string | null
  selectedArticles: Set<number>
  loadArticles: () => Promise<void>
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  handleSelectArticle: (articleId: number) => void
  handleSelectAll: () => void
  clearSelection: () => void
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>
}

export function useArticleList(options: UseArticleListOptions): UseArticleListReturn {
  const {
    feedId,
    tagId,
    groupId,
    filter = 'all',
    sortBy: externalSortBy,
    pageSize = DEFAULT_PAGE_SIZE,
    filterFn,
    beforeRefresh
  } = options

  const [articles, setArticles] = useState<Article[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [isMoreLoading, setIsMoreLoading] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [selectedArticles, setSelectedArticles] = useState<Set<number>>(new Set())

  const { sortOrder: storeSortOrder } = useFeedStore()
  const sortBy = externalSortBy || storeSortOrder

  // Listen for article updates
  useArticleUpdateListener(setArticles, filterFn)

  // Get the command name based on filter type
  const getCommand = useCallback(() => {
    if (groupId !== undefined) return 'get_group_articles'
    if (tagId !== undefined) return 'get_articles_by_tag'
    switch (filter) {
      case 'unread': return 'get_unread_articles'
      case 'starred': return 'get_starred_articles'
      case 'favorite': return 'get_favorite_articles'
      case 'all':
      default: return 'get_articles'
    }
  }, [filter, groupId, tagId])

  // Get command arguments
  const getCommandArgs = useCallback((cursor: string | null) => {
    const args: Record<string, unknown> = {
      limit: pageSize,
      cursor,
      sortBy
    }
    if (feedId !== undefined) args.feedId = feedId
    if (tagId !== undefined) args.tagId = tagId
    if (groupId !== undefined) args.groupId = groupId
    return args
  }, [feedId, tagId, groupId, pageSize, sortBy])

  // Load initial articles
  const loadArticles = useCallback(async () => {
    if (!isTauriEnv) return

    try {
      setIsLoading(true)
      setHasMore(true)
      setSelectedArticles(new Set())

      const command = getCommand()
      const args = getCommandArgs(null)
      const articleList = await invoke<Article[]>(command, args)

      setArticles(articleList)
      setHasMore(articleList.length >= pageSize)
    } catch (error) {
      console.error('Failed to load articles:', error)
    } finally {
      setIsLoading(false)
    }
  }, [getCommand, getCommandArgs, pageSize])

  // Load more articles (pagination)
  const loadMore = useCallback(async () => {
    if (isMoreLoading || !hasMore || articles.length === 0) return

    const lastArticle = articles[articles.length - 1]
    const cursor = sortBy.startsWith('score_desc:')
      ? `offset|${articles.length}`
      : (lastArticle.publishedAt ? `${lastArticle.publishedAt}|${lastArticle.id}` : null)

    if (!cursor) return

    try {
      setIsMoreLoading(true)
      const command = getCommand()
      const args = getCommandArgs(cursor)
      const moreArticles = await invoke<Article[]>(command, args)

      if (moreArticles.length > 0) {
        setArticles(prev => [...prev, ...moreArticles])
        setHasMore(moreArticles.length >= pageSize)
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Failed to load more articles:', error)
    } finally {
      setIsMoreLoading(false)
    }
  }, [articles, hasMore, isMoreLoading, sortBy, getCommand, getCommandArgs, pageSize])

  // Refresh articles
  const refresh = useCallback(async () => {
    setIsLoading(true)
    setRefreshError(null)

    if (beforeRefresh) {
      try {
        await beforeRefresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setRefreshError(message)
      }
    }

    await loadArticles()
  }, [beforeRefresh, loadArticles])

  // Handle article selection
  const handleSelectArticle = useCallback((articleId: number) => {
    setSelectedArticles(prev => {
      const newSelected = new Set(prev)
      if (newSelected.has(articleId)) {
        newSelected.delete(articleId)
      } else {
        newSelected.add(articleId)
      }
      return newSelected
    })
  }, [])

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (selectedArticles.size === articles.length) {
      setSelectedArticles(new Set())
    } else {
      setSelectedArticles(new Set(articles.map(a => a.id)))
    }
  }, [articles, selectedArticles.size])

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedArticles(new Set())
  }, [])

  // Load on mount and when dependencies change
  useEffect(() => {
    if (isTauriEnv) {
      loadArticles()
    }
  }, [loadArticles])

  // Listen for feeds-updated event to refresh articles
  useEffect(() => {
    const handleFeedsUpdated = () => {
      loadArticles()
    }
    window.addEventListener('feeds-updated', handleFeedsUpdated)
    return () => window.removeEventListener('feeds-updated', handleFeedsUpdated)
  }, [loadArticles])

  return {
    articles,
    isLoading,
    isMoreLoading,
    hasMore,
    refreshError,
    selectedArticles,
    loadArticles,
    loadMore,
    refresh,
    handleSelectArticle,
    handleSelectAll,
    clearSelection,
    setArticles
  }
}
