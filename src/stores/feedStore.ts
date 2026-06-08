import { create } from 'zustand'
import { Feed, Article, AppState } from '@/types'
import { invoke } from '@/utils/tauri'

export interface ArticleFilter {
  type: 'all' | 'unread' | 'starred' | 'favorite'
  feedId?: number
}

interface FeedStore extends AppState {
  setFeeds: (feeds: Feed[]) => void
  addFeed: (feed: Feed) => void
  updateFeed: (id: number, updates: Partial<Feed>) => void
  deleteFeed: (id: number) => void
  setCurrentFeed: (feed: Feed | null) => void

  setArticles: (articles: Article[]) => void
  addArticle: (article: Article) => void
  updateArticle: (id: number, updates: Partial<Article>) => void
  deleteArticle: (id: number) => void
  setCurrentArticle: (article: Article | null) => void

  // Unified article actions
  fetchArticles: (filter: ArticleFilter, limit?: number, cursor?: string | null) => Promise<Article[]>
  markArticleRead: (id: number, read: boolean) => Promise<void>
  markArticleStarred: (id: number, starred: boolean) => Promise<void>
  markArticleFavorite: (id: number, favorite: boolean) => Promise<void>
  batchMarkRead: (ids: number[], read?: boolean) => Promise<void>
  toggleArticleStar: (id: number) => Promise<boolean>
  toggleArticleFavorite: (id: number) => Promise<boolean>

  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  sortOrder: string
  setSortOrder: (order: string) => void
  lastArticleUpdate: ArticleUpdate | null
  articleUpdateVersion: number
  applyArticleUpdate: (update: ArticleUpdate) => void

  reset: () => void
}

export type ArticleUpdate = Partial<Article> & {
  id: number
  previousIsRead?: boolean
}

type FeedStoreState = AppState & {
  sortOrder: string
  lastArticleUpdate: ArticleUpdate | null
  articleUpdateVersion: number
}

const initialState: FeedStoreState = {
  feeds: [],
  articles: [],
  currentFeed: null,
  currentArticle: null,
  isLoading: false,
  error: null,
  sortOrder: 'date_desc',
  lastArticleUpdate: null,
  articleUpdateVersion: 0,
}

function updateArticleList(articles: Article[], update: ArticleUpdate) {
  const articlePatch = toArticlePatch(update)
  return articles.map((article) =>
    article.id === update.id ? { ...article, ...articlePatch } : article
  )
}

function getReadCountChange(state: AppState, update: ArticleUpdate) {
  if (typeof update.isRead !== 'boolean') return null

  const existing =
    state.articles.find((article) => article.id === update.id) ??
    (state.currentArticle?.id === update.id ? state.currentArticle : null)
  const previousIsRead =
    typeof update.previousIsRead === 'boolean' ? update.previousIsRead : existing?.isRead

  if (typeof previousIsRead !== 'boolean' || previousIsRead === update.isRead) return null

  const feedId = typeof update.feedId === 'number' ? update.feedId : existing?.feedId
  if (typeof feedId !== 'number') return null
  return {
    feedId,
    delta: update.isRead ? -1 : 1,
  }
}

function toArticlePatch(update: ArticleUpdate): Partial<Article> & { id: number } {
  const { previousIsRead: _previousIsRead, ...articlePatch } = update
  return articlePatch
}

function applyArticleUpdateState(state: FeedStoreState, update: ArticleUpdate) {
  const readChange = getReadCountChange(state, update)
  const articlePatch = toArticlePatch(update)

  return {
    articles: updateArticleList(state.articles, articlePatch),
    currentArticle:
      state.currentArticle?.id === update.id
        ? { ...state.currentArticle, ...articlePatch }
        : state.currentArticle,
    feeds: !readChange
      ? state.feeds
      : state.feeds.map((feed) =>
        feed.id === readChange.feedId
          ? { ...feed, unreadCount: Math.max(0, (feed.unreadCount || 0) + readChange.delta) }
          : feed
      ),
    lastArticleUpdate: articlePatch,
    articleUpdateVersion: state.articleUpdateVersion + 1,
  }
}

export const useFeedStore = create<FeedStore>((set) => ({
  ...initialState,

  setFeeds: (feeds) => set({ feeds }),
  
  addFeed: (feed) => set((state) => ({ 
    feeds: [...state.feeds, feed] 
  })),
  
  updateFeed: (id, updates) => set((state) => ({
    feeds: state.feeds.map((feed) =>
      feed.id === id ? { ...feed, ...updates } : feed
    ),
  })),
  
  deleteFeed: (id) => set((state) => ({
    feeds: state.feeds.filter((feed) => feed.id !== id),
  })),
  
  setCurrentFeed: (feed) => set({ currentFeed: feed }),

  setArticles: (articles) => set({ articles }),
  
  addArticle: (article) => set((state) => ({
    articles: [article, ...state.articles],
  })),
  
  updateArticle: (id, updates) => set((state) => ({
    articles: state.articles.map((article) =>
      article.id === id ? { ...article, ...updates } : article
    ),
  })),
  
  deleteArticle: (id) => set((state) => ({
    articles: state.articles.filter((article) => article.id !== id),
  })),
  
  setCurrentArticle: (article) => set({ currentArticle: article }),
  applyArticleUpdate: (update) => set((state) => applyArticleUpdateState(state, update)),

  // Unified article actions
  fetchArticles: async (filter, limit = 50, cursor = null) => {
    try {
      const args: Record<string, unknown> = { limit, cursor }
      if (filter.feedId !== undefined) {
        args.feedId = filter.feedId
      }

      let command: string
      switch (filter.type) {
        case 'unread':
          command = 'get_unread_articles'
          break
        case 'starred':
          command = 'get_starred_articles'
          break
        case 'favorite':
          command = 'get_favorite_articles'
          break
        case 'all':
        default:
          command = filter.feedId !== undefined ? 'get_articles' : 'get_articles'
          break
      }

      const articles = await invoke<Article[]>(command, args)
      return articles
    } catch (error) {
      console.error('Failed to fetch articles:', error)
      return []
    }
  },

  markArticleRead: async (id, read) => {
    try {
      await invoke('mark_article_read', { id, isRead: read })
      set((state) => applyArticleUpdateState(state, { id, isRead: read }))
    } catch (error) {
      console.error('Failed to mark article read:', error)
      throw error
    }
  },

  markArticleStarred: async (id, starred) => {
    try {
      await invoke('toggle_article_star', { id })
      set((state) => applyArticleUpdateState(state, { id, isStarred: starred }))
    } catch (error) {
      console.error('Failed to mark article starred:', error)
      throw error
    }
  },

  markArticleFavorite: async (id, favorite) => {
    try {
      await invoke('toggle_article_favorite', { id })
      set((state) => applyArticleUpdateState(state, { id, isFavorite: favorite }))
    } catch (error) {
      console.error('Failed to mark article favorite:', error)
      throw error
    }
  },

  batchMarkRead: async (ids, read = true) => {
    try {
      await invoke('mark_articles_read', { ids, isRead: read })
      for (const id of ids) {
        set((state) => applyArticleUpdateState(state, { id, isRead: read }))
      }
    } catch (error) {
      console.error('Failed to batch mark read:', error)
      throw error
    }
  },

  toggleArticleStar: async (id) => {
    try {
      await invoke('toggle_article_star', { id })
      const article = await invoke<Article | null>('get_article', { id })
      const newState = article?.isStarred ?? false
      set((state) => applyArticleUpdateState(state, { id, isStarred: newState }))
      return newState
    } catch (error) {
      console.error('Failed to toggle star:', error)
      throw error
    }
  },

  toggleArticleFavorite: async (id) => {
    try {
      await invoke('toggle_article_favorite', { id })
      const article = await invoke<Article | null>('get_article', { id })
      const newState = article?.isFavorite ?? false
      set((state) => applyArticleUpdateState(state, { id, isFavorite: newState }))
      return newState
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
      throw error
    }
  },

  setLoading: (isLoading) => set({ isLoading }),
  
  setError: (error) => set({ error }),
  
  setSortOrder: (order) => set({ sortOrder: order }),
  
  reset: () => set(initialState),
}))
