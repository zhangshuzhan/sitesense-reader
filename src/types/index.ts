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
  /** "rss" (default) or "wordpress" (SiteSense dual-mode source). */
  sourceType?: 'rss' | 'wordpress'
  /** Present only on the local machine; never persisted to our servers. */
  authToken?: string | null
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

export interface FinancialInsight {
  /** Short summary of the article's market/financial takeaway. */
  summary: string
  /** "bullish" | "bearish" | "neutral" */
  sentiment: string
  /** -100 (very bearish) .. 100 (very bullish) */
  sentimentScore: number
  /** Detected finance keywords / tickers. */
  keywords: string[]
  /** "ai" (cloud LLM) or "local" (heuristic fallback) */
  source: string
  /** Model id when source === "ai", otherwise null. */
  model: string | null
}

export interface WordPressProbe {
  feed?: { title: string; url: string } | null
  articles?: unknown[]
  mode: string
  auth: string
  reachable: boolean
  errorMessage?: string | null
}

export interface SpotCheck {
  code: string
  name: string
  price: number
  changePct: number
}

export interface MarketDataCheck {
  success: boolean
  stockCount: number
  latestDate: string
  expectedCount: number
  countOk: boolean
  nullCheckOk: boolean
  anomalyOk: boolean
  spotChecks: SpotCheck[]
  errors: string[]
}

export interface EastmoneyReport {
  id: number
  /** stock | industry | macro | morning */
  category: string
  title: string
  orgName: string
  orgSname: string
  stockName?: string | null
  stockCode?: string | null
  industryName?: string | null
  publishDate: string
  infoCode: string
  summary?: string | null
  isRead: boolean
  pdfPath?: string | null
  createdAt: string
}

export interface Group {
  id: number
  name: string
  createdAt: string
}
