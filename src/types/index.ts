export interface Feed {
  id: number
  title: string
  url: string
  description?: string
  link?: string
  icon?: string
  category?: string
  lastUpdated?: string
  etag?: string
  lastModified?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
  unreadCount?: number
}

export interface Article {
  id: number
  feedId: number
  title: string
  link: string
  author?: string
  content?: string
  summary?: string
  publishedAt?: string
  updatedAt?: string
  isRead: boolean
  isStarred: boolean
  isFavorite: boolean
  createdAt: string
  thumbnail?: string
  feed?: Feed
  tags?: Tag[]
  scores?: ArticleScore[]
}

export type ArticleNavigationScope =
  | 'all'
  | 'unread'
  | 'starred'
  | 'favorite'
  | 'feed'
  | 'tag'
  | 'group'
  | 'search'

export interface ArticleNavigationContext {
  scope: ArticleNavigationScope
  feedId?: number
  tagId?: number
  groupId?: number
  query?: string
}

export interface ArticleScore {
  id: number
  articleId: number
  ruleId: string
  score: number
  badgeName?: string
  badgeColor?: string
  badgeIcon?: string
  createdAt: string
}

export interface Tag {
  id: number
  name: string
  createdAt: string
}

export interface FeedCategory {
  id: string
  name: string
  feeds: Feed[]
}

export interface AppState {
  feeds: Feed[]
  articles: Article[]
  currentFeed: Feed | null
  currentArticle: Article | null
  isLoading: boolean
  error: string | null
}

export interface AIProfile {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  model: string
  provider: 'openai' | 'anthropic'
  prompt: string
}

export interface FeatureMapping {
  summaryProfileId: string
  translationProfileId: string
  batchSummaryProfileId: string
}

export interface Group {
  id: number
  name: string
  createdAt: string
}
