import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import type { DOMNode, Element, HTMLReactParserOptions } from 'html-react-parser'

import { translateArticle, estimateTokens } from '@/services/ai'
import { generateSummaryForArticle } from '@/services/runtime'
import { useFeedStore } from '@/stores/feedStore'
import { useSettingsStore, defaultShortcuts } from '@/stores/settingsStore'
import { AiUiTask, useAiTaskUiStore } from '@/stores/aiTaskUiStore'
import { toast } from '@/stores/toastStore'

import { renderArticleContent, type TocItem } from '@/utils/articleContent'
import { handleExternalNavigation } from '@/utils/externalNavigation'
import { normalizeHref, resolveHref } from '@/utils/linkPolicy'
import { shouldProxyMediaUrl } from '@/utils/mediaProxy'
import { formatDate } from '@/utils'
import { invoke, isTauriEnv } from '@/utils/tauri'

import type { Article, ArticleNavigationContext, ArticleScore, Tag } from '@/types'

import CodeBlock from './CodeBlock'
import LazyHtmlContent, { loadHtmlParser } from './LazyHtmlContent'
import VideoEmbed from './VideoEmbed'

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Clock,
  ExternalLink,
  Languages,
  List,
  Plus,
  Sparkles,
  Star,
  Tag as TagIcon,
  X,
} from 'lucide-react'
import { countTasksByStatus, getDisplayStatus, getAiTaskSummary } from '@/utils/aiTaskStatus'

type HtmlParserModule = typeof import('html-react-parser')

function PanelRichText({ content }: { content: string }) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    let cancelled = false

    void renderArticleContent(content, `panel:${content.length}:${content.slice(0, 128)}`)
      .then((result) => {
        if (!cancelled) {
          setHtml(result.html)
        }
      })
      .catch((error) => {
        console.error('Failed to render panel content:', error)
        if (!cancelled) {
          setHtml('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [content])

  return <LazyHtmlContent html={html} />
}

const TranslationPanel = ({
  translation,
  isTranslating,
  error,
  onClose,
  className = '',
}: {
  translation: string | null
  isTranslating: boolean
  error: string | null
  onClose: () => void
  className?: string
}) => {
  const { t } = useTranslation()
  if (!translation && !isTranslating && !error) return null

  return (
    <div
      className={`bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 relative group ${className}`}
    >
      <div className="flex items-center justify-between mb-3 px-6 pt-6">
        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium">
          <Languages className="w-4 h-4" />
          <span>{t('articleView.aiTranslation')}</span>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          title={t('articleView.closeTranslation')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 pb-6">
        {isTranslating ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/5" />
          </div>
        ) : error ? (
          <div className="text-red-500 dark:text-red-400 text-sm">{error}</div>
        ) : (
          <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300">
            <PanelRichText content={translation || ''} />
          </div>
        )}
      </div>
    </div>
  )
}

const SummaryPanel = ({
  summary,
  isGenerating,
  error,
  onClose,
  className = '',
}: {
  summary: string | null
  isGenerating: boolean
  error: string | null
  onClose: () => void
  className?: string
}) => {
  const { t } = useTranslation()
  if (!summary && !isGenerating && !error) return null

  return (
    <div
      className={`bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 relative group ${className}`}
    >
      <div className="flex items-center justify-between mb-3 px-6 pt-6">
        <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-medium">
          <Sparkles className="w-4 h-4" />
          <span>{t('articleView.aiSummary')}</span>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          title={t('articleView.closeSummary')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 pb-6">
        {isGenerating ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/5" />
          </div>
        ) : error ? (
          <div className="text-red-500 dark:text-red-400 text-sm">{error}</div>
        ) : (
          <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300">
            <PanelRichText content={summary || ''} />
          </div>
        )}
      </div>
    </div>
  )
}

const ScoreBadges = ({
  scores,
  className = '',
}: {
  scores?: ArticleScore[]
  className?: string
}) => {
  if (!scores || scores.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {scores.map((score) => (
        <span
          key={score.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border flex-shrink-0 whitespace-nowrap"
          style={
            score.badgeColor
              ? {
                  backgroundColor: `${score.badgeColor}1A`,
                  color: score.badgeColor,
                  borderColor: `${score.badgeColor}33`,
                }
              : {
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  color: '#3b82f6',
                  borderColor: 'rgba(59, 130, 246, 0.2)',
                }
          }
        >
          {score.badgeIcon && <span>{score.badgeIcon}</span>}
          {score.badgeName || 'Score'}: {score.score}
        </span>
      ))}
    </div>
  )
}


const EMPTY_TASKS: AiUiTask[] = []

function buildArticleNavigationContext(pathname: string, search: string): ArticleNavigationContext {
  const searchParams = new URLSearchParams(search)

  if (pathname.startsWith('/unread')) return { scope: 'unread' }
  if (pathname.startsWith('/starred')) return { scope: 'starred' }
  if (pathname.startsWith('/favorites')) return { scope: 'favorite' }

  if (pathname.startsWith('/feed/')) {
    const feedId = Number(pathname.split('/')[2])
    return Number.isFinite(feedId) ? { scope: 'feed', feedId } : { scope: 'all' }
  }

  if (pathname.startsWith('/tags/')) {
    const tagId = Number(pathname.split('/')[2])
    return Number.isFinite(tagId) ? { scope: 'tag', tagId } : { scope: 'all' }
  }

  if (pathname.startsWith('/group/')) {
    const groupId = Number(pathname.split('/')[2])
    return Number.isFinite(groupId) ? { scope: 'group', groupId } : { scope: 'all' }
  }

  if (pathname.startsWith('/search')) {
    return { scope: 'search', query: searchParams.get('q') || '' }
  }

  return { scope: 'all' }
}

export default function ArticleView() {
  const { t } = useTranslation();
  const { articleId } = useParams<{ articleId: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const basePath = location.pathname.split('/article/')[0] || '/'
  const navigationContext = useMemo(
    () => buildArticleNavigationContext(location.pathname, location.search),
    [location.pathname, location.search]
  )
  const backPath = `${basePath || '/'}${location.search}`
  const buildArticlePath = (id: number) =>
    `${basePath === '/' ? '' : basePath}/article/${id}${location.search}`

  const feeds = useFeedStore((state) => state.feeds)
  const aiProfiles = useSettingsStore((state) => state.aiProfiles)
  const featureMapping = useSettingsStore((state) => state.featureMapping)
  const summaryPosition = useSettingsStore((state) => state.summaryPosition)
  const translationPosition = useSettingsStore((state) => state.translationPosition)
  const targetLanguage = useSettingsStore((state) => state.targetLanguage)
  const autoMarkRead = useSettingsStore((state) => state.autoMarkRead)
  const externalLinkBehavior = useSettingsStore((state) => state.externalLinkBehavior)
  const shortcuts = useSettingsStore((state) => state.shortcuts ?? defaultShortcuts)
  const shortcutsEnabled = useSettingsStore((state) => state.shortcutsEnabled)

  const [article, setArticle] = useState<Article | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [newTag, setNewTag] = useState('')
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [prevArticle, setPrevArticle] = useState<Article | null>(null)
  const [nextArticle, setNextArticle] = useState<Article | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [readingProgress, setReadingProgress] = useState(0)
  const [showToc, setShowToc] = useState(false)

  const [summary, setSummary] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [translation, setTranslation] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [renderedArticleHtml, setRenderedArticleHtml] = useState('')
  const [toc, setToc] = useState<TocItem[]>([])
  const [isRenderingContent, setIsRenderingContent] = useState(false)
  const [parserModule, setParserModule] = useState<HtmlParserModule | null>(null)

  const contentScrollRef = useRef<HTMLDivElement | null>(null)

  const uiArticleId = articleId ? Number(articleId) : 0
  const aiTasks = useAiTaskUiStore((state) => state.tasksByArticleId[uiArticleId] ?? EMPTY_TASKS)
  const taskCounts = countTasksByStatus(aiTasks)
  const { hasFailed, hasProcessing, hasPending, displayText, icon } = getDisplayStatus(taskCounts)
  const aiTaskTitle = getAiTaskSummary(aiTasks)

  const feed = article ? feeds.find((f) => f.id === article.feedId) : null

  const handleOriginalLink = async (rawLink: string | undefined | null) => {
    const normalized = normalizeHref(rawLink || '')
    if (!normalized) {
      toast.warning(t('articleView.operationFailed'))
      return
    }

    const resolved = resolveHref(normalized, window.location.href)

    await handleExternalNavigation(resolved, {
      behavior: externalLinkBehavior,
      confirmMessage: 'Open in external browser?',
      blockedMessage: t('articleView.linkCopied'),
      blockedNoCopyMessage: t('articleView.operationFailed'),
      cancelledMessage: 'Cancelled',
      invalidMessage: t('articleView.operationFailed'),
      openErrorMessage: t('articleView.operationFailed'),
    })
  }

  const articleBodyRaw = article?.content || article?.summary || ''
  const tokenEstimate = useMemo(() => {
    if (!article) return 0
    return estimateTokens(article.content || article.summary || article.title || '')
  }, [article])

  useEffect(() => {
    if (!shortcutsEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return
      }

      if (e.key === shortcuts.toggleRead) {
        e.preventDefault()
        void handleToggleRead()
      } else if (e.key === shortcuts.toggleStar) {
        e.preventDefault()
        void handleToggleStar()
      } else if (e.key === shortcuts.openOriginal) {
        if (article?.link) {
          e.preventDefault()
          void handleOriginalLink(article.link)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [article, shortcuts, shortcutsEnabled, externalLinkBehavior])

  useEffect(() => {
    if (articleId && isTauriEnv) {
      void loadArticle()
      void loadTags()
    }
  }, [articleId])

  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0
    }
    setReadingProgress(0)
    setShowToc(false)
  }, [articleId])

  useEffect(() => {
    if (!isTauriEnv) return

    let unlistenFn: (() => void) | null = null

    listen<void>('articles-deleted', () => {
      navigate(backPath)
    })
      .then((unlisten) => {
        unlistenFn = unlisten
      })
      .catch((error) => {
        console.error('Failed to setup articles-deleted listener:', error)
      })

    return () => {
      if (unlistenFn) {
        unlistenFn()
      }
    }
  }, [backPath, navigate])

  useEffect(() => {
    if (article && isTauriEnv) {
      void loadNavigation()
    }
  }, [article, navigationContext])

  useEffect(() => {
    let cancelled = false

    void loadHtmlParser()
      .then((module) => {
        if (!cancelled) {
          setParserModule(module)
        }
      })
      .catch((error) => {
        console.error('Failed to load HTML parser:', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!articleBodyRaw.trim()) {
      setRenderedArticleHtml('')
      setToc([])
      setIsRenderingContent(false)
      return
    }

    setIsRenderingContent(true)

    const contentCacheKey = article
      ? `${article.id}:${article.updatedAt ?? ''}:${articleBodyRaw.length}:${articleBodyRaw.slice(0, 128)}`
      : articleBodyRaw

    void renderArticleContent(articleBodyRaw, contentCacheKey)
      .then((result) => {
        if (!cancelled) {
          setRenderedArticleHtml(result.html)
          setToc(result.toc)
        }
      })
      .catch((error) => {
        console.error('Failed to render article content:', error)
        if (!cancelled) {
          setRenderedArticleHtml('')
          setToc([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRenderingContent(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [article, articleBodyRaw])

  useEffect(() => {
    const container = contentScrollRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const docHeight = scrollHeight - clientHeight
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0
      setReadingProgress(progress)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => container.removeEventListener('scroll', handleScroll)
  }, [renderedArticleHtml])

  const loadTags = async () => {
    try {
      const articleTags = await invoke<Tag[]>('get_article_tags', {
        articleId: Number(articleId),
      })
      setTags(articleTags)
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }

  const loadArticle = async () => {
    try {
      const found = await invoke<Article | null>('get_article', { id: Number(articleId) })
      setArticle(found || null)

      if (found && !found.isRead && autoMarkRead) {
        await invoke('mark_article_read', { id: found.id, isRead: true })
        setArticle({ ...found, isRead: true })
        useFeedStore.getState().applyArticleUpdate({
          id: found.id,
          isRead: true,
          feedId: found.feedId,
          previousIsRead: found.isRead,
        })
      }
    } catch (error) {
      console.error('Failed to load article:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadNavigation = async () => {
    if (!article) return

    try {
      const [prev, next] = await invoke<[Article | null, Article | null]>('get_article_navigation', {
        currentId: article.id,
        context: navigationContext,
      })
      setPrevArticle(prev || null)
      setNextArticle(next || null)
    } catch (error) {
      console.error('Failed to load navigation:', error)
    }
  }

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!article || !newTag.trim()) return

    try {
      const tag = await invoke<Tag>('add_tag', {
        articleId: article.id,
        tagName: newTag.trim(),
      })
      setTags((prev) => [...prev, tag])
      setNewTag('')
      setIsAddingTag(false)
    } catch (error) {
      console.error('Failed to add tag:', error)
    }
  }

  const handleRemoveTag = async (tagId: number) => {
    if (!article) return

    try {
      await invoke('remove_tag', {
        articleId: article.id,
        tagId,
      })
      setTags((prev) => prev.filter((tag) => tag.id !== tagId))
    } catch (error) {
      console.error('Failed to remove tag:', error)
    }
  }

  const handleToggleStar = async () => {
    if (!article) return

    try {
      const newStarState = !article.isStarred
      await invoke('toggle_article_star', { id: article.id })
      setArticle({ ...article, isStarred: newStarState })
      useFeedStore.getState().applyArticleUpdate({
        id: article.id,
        isStarred: newStarState,
        feedId: article.feedId,
      })
    } catch (error) {
      console.error('Failed to toggle star:', error)
    }
  }

  const handleToggleFavorite = async () => {
    if (!article) return

    try {
      const newFavoriteState = !article.isFavorite
      await invoke('toggle_article_favorite', { id: article.id })
      setArticle({ ...article, isFavorite: newFavoriteState })
      useFeedStore.getState().applyArticleUpdate({
        id: article.id,
        isFavorite: newFavoriteState,
        feedId: article.feedId,
      })
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    }
  }

  const handleToggleRead = async () => {
    if (!article) return

    try {
      const newReadState = !article.isRead
      await invoke('mark_article_read', { id: article.id, isRead: newReadState })
      setArticle({ ...article, isRead: newReadState })
      useFeedStore.getState().applyArticleUpdate({
        id: article.id,
        isRead: newReadState,
        feedId: article.feedId,
        previousIsRead: article.isRead,
      })
    } catch (error) {
      console.error('Failed to toggle read state:', error)
    }
  }

  const handleGenerateSummary = async () => {
    if (!featureMapping.summaryProfileId) {
      toast.error(t('batchSummary.noProfileConfigured') || 'No AI profile configured')
      return
    }

    const profile = aiProfiles.find((p) => p.id === featureMapping.summaryProfileId)
    if (!profile || !profile.apiKey) {
      toast.error(t('articleView.operationFailed'))
      return
    }

    if (!article) return

    setIsGenerating(true)
    setSummaryError(null)
    setSummary(null)
    useAiTaskUiStore.getState().setProcessing(article.id, 'summary')

    try {
      const cached = await invoke<string | null>('get_article_ai_summary', {
        articleId: article.id,
      })
      if (cached) {
        setSummary(cached)
        useAiTaskUiStore.getState().clearTask(article.id, 'summary')
        return
      }

      const result = await generateSummaryForArticle(article.id, profile)
      setSummary(result)
      useAiTaskUiStore.getState().clearTask(article.id, 'summary')
    } catch (error: any) {
      const errorMessage = error?.message || t('articleView.summaryFailed')
      setSummaryError(errorMessage)
      useAiTaskUiStore.getState().setFailed(article.id, 'summary', errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCloseSummary = () => {
    setSummary(null)
    setSummaryError(null)
    setIsGenerating(false)
  }

  const handleTranslate = async () => {
    if (!featureMapping.translationProfileId) {
      toast.error(t('batchSummary.noProfileConfigured') || 'No AI profile configured')
      return
    }

    const profile = aiProfiles.find((p) => p.id === featureMapping.translationProfileId)
    if (!profile || !profile.apiKey) {
      toast.error(t('articleView.operationFailed'))
      return
    }

    if (!article) return

    setIsTranslating(true)
    setTranslationError(null)
    setTranslation(null)

    try {
      const content = article.content || article.summary || article.title || ''
      const result = await translateArticle(content, profile, targetLanguage)
      setTranslation(result)
    } catch (error: any) {
      const errorMessage = error?.message || t('articleView.translationFailed')
      setTranslationError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsTranslating(false)
    }
  }

  const handleCloseTranslation = () => {
    setTranslation(null)
    setTranslationError(null)
    setIsTranslating(false)
  }

  const TagsSection = () => (
    <div className="flex flex-wrap items-center gap-2 mt-6">
      {tags.map((tag) => (
        <div
          key={tag.id}
          className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full text-xs font-medium group transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <TagIcon className="w-3 h-3 text-slate-400" />
          <span>{tag.name}</span>
          <button
            onClick={() => void handleRemoveTag(tag.id)}
            className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-all ml-1"
            title={t('articleView.removeTag')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}

      {isAddingTag ? (
        <form onSubmit={handleAddTag} className="flex items-center animate-scale-in">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder={t('articleView.tagInput')}
            className="w-24 px-3 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500/50 text-slate-700 dark:text-slate-200"
            autoFocus
            onBlur={() => !newTag && setIsAddingTag(false)}
          />
        </form>
      ) : (
        <button
          onClick={() => setIsAddingTag(true)}
          className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-full text-xs font-medium transition-all"
        >
          <Plus className="w-3 h-3" />
          {t('articleView.addTagButton')}
        </button>
      )}
    </div>
  )

  const parsedArticleContent = useMemo(() => {
    if (!renderedArticleHtml || !parserModule) return null

    const baseUrl = article?.link || window.location.href
    const parserOptions: HTMLReactParserOptions = {
      replace: (domNode) => {
        if (domNode instanceof parserModule.Element && domNode.name === 'img') {
          let src = domNode.attribs?.['data-src'] || domNode.attribs?.src || ''
          if (src.startsWith('data:')) {
            return null
          }

          if (src.startsWith('//')) {
            src = `https:${src}`
          } else if (src && !src.includes(':') && !src.startsWith('#')) {
            src = resolveHref(src, baseUrl)
          }

          if (src) {
            domNode.attribs.src = isTauriEnv && shouldProxyMediaUrl(src)
              ? `rss-media://localhost/${encodeURIComponent(src)}`
              : src
          }

          delete domNode.attribs.width
          delete domNode.attribs.height
          delete domNode.attribs.style
          domNode.attribs.loading = 'lazy'
          domNode.attribs.decoding = 'async'
          if (!domNode.attribs.alt) {
            domNode.attribs.alt = 'article image'
          }
          domNode.attribs.class = `${domNode.attribs.class || ''} article-image`.trim()
        }

        if (domNode instanceof parserModule.Element && domNode.name === 'a') {
          const rawHref = domNode.attribs?.href || ''
          const normalized = normalizeHref(rawHref)
          const children = parserModule.domToReact(domNode.children as DOMNode[], parserOptions)

          if (!normalized) {
            return <span className="text-slate-400 dark:text-slate-500">{children}</span>
          }

          if (normalized.startsWith('#')) {
            return (
              <a href={normalized} className="cursor-pointer">
                {children}
              </a>
            )
          }

          const resolved = resolveHref(normalized, baseUrl)

          return (
            <a href={resolved} rel="noopener noreferrer nofollow">
              {children}
            </a>
          )
        }

        if (domNode instanceof parserModule.Element && domNode.name === 'pre') {
          const children = domNode.children as DOMNode[]
          const codeNode = children.find(
            (child) => child instanceof parserModule.Element && child.name === 'code'
          ) as Element | undefined

          if (codeNode && codeNode.children && codeNode.children.length > 0) {
            const getCodeText = (node: DOMNode): string => {
              if (node.type === 'text') return (node as any).data || ''
              if (node instanceof parserModule.Element && node.children) {
                return (node.children as DOMNode[]).map(getCodeText).join('')
              }
              return ''
            }

            const codeText = (codeNode.children as DOMNode[]).map(getCodeText).join('')
            const className = codeNode.attribs?.class || ''
            const match = className.match(/language-(\w+)/)

            return <CodeBlock language={match ? match[1] : 'text'} value={codeText} />
          }
        }

        if (domNode instanceof parserModule.Element && domNode.name === 'iframe') {
          const src = domNode.attribs?.src || ''
          if (src.includes('youtube.com') || src.includes('youtu.be')) {
            return <VideoEmbed url={src} type="youtube" />
          }
          if (src.includes('bilibili.com')) {
            return <VideoEmbed url={src} type="bilibili" />
          }
        }

        if (domNode instanceof parserModule.Element && domNode.name === 'table') {
          return (
            <div className="my-6 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-full border-collapse text-sm">
                {parserModule.domToReact(domNode.children as DOMNode[], parserOptions)}
              </table>
            </div>
          )
        }

        if (domNode instanceof parserModule.Element && domNode.name === 'th') {
          domNode.attribs.class = `${domNode.attribs.class || ''} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-left font-semibold`
        }

        if (domNode instanceof parserModule.Element && domNode.name === 'td') {
          domNode.attribs.class = `${domNode.attribs.class || ''} border-b border-slate-100 dark:border-slate-800 px-3 py-2 align-top`
        }
      },
    }

    return parserModule.default(renderedArticleHtml, parserOptions)
  }, [article?.link, parserModule, renderedArticleHtml])

  const showSummary = summary || isGenerating || summaryError
  const showTopSummary = showSummary && summaryPosition === 'top'
  const showSidebarSummary = showSummary && summaryPosition === 'sidebar'

  const showTranslation = translation || isTranslating || translationError
  const showTopTranslation = showTranslation && translationPosition === 'top'
  const showSidebarTranslation = showTranslation && translationPosition === 'sidebar'

  const originalLinkActionLabel = externalLinkBehavior === 'block' ? t('articleView.copyOriginalLink') : t('articleView.openOriginal')

  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-white dark:bg-slate-900">
        <header className="p-4 border-b border-slate-200 dark:border-slate-700/50">
          <div className="animate-pulse flex items-center gap-4">
            <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg" />
            <div className="flex-1">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-2" />
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
            </div>
          </div>
        </header>
        <div className="flex-1 p-8">
          <div className="max-w-3xl mx-auto animate-pulse space-y-4">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6" />
          </div>
        </div>
      </div>
    )
  }

  if (!article) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="w-16 h-16 mb-4 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
          <ExternalLink className="w-8 h-8 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="text-slate-500 dark:text-slate-400">{t('articleView.articleNotFound')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="fixed top-0 left-0 right-0 h-1 bg-slate-200 dark:bg-slate-700 z-50">
        <div
          className="h-full bg-primary-500 transition-all duration-200 ease-out"
          style={{ width: `${readingProgress}%` }}
        />
      </div>

      <header className="sticky top-0 z-20 px-4 py-3 border-b border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            to={backPath}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {article.title}
            </h2>
            {feed && (
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{feed.title}</p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {tokenEstimate > 0 && (
              <div
                className="hidden sm:flex items-center px-2 py-1 mr-2 text-xs text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-md"
                title={t('articleView.tokenEstimate')}
              >
                <span className="font-mono">~ {tokenEstimate}</span>
                <span className="ml-1 text-[10px]">Tokens</span>
              </div>
            )}

            <button
              onClick={() => void handleTranslate()}
              disabled={isTranslating}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer ${
                translation || isTranslating
                  ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/30'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${isTranslating ? 'animate-pulse' : ''}`}
              title={t('articleView.aiTranslation')}
            >
              <Languages className="w-5 h-5" />
              <span className="text-xs font-bold">{t('articleView.aiTranslation').slice(0, 1)}</span>
            </button>

            <button
              onClick={() => void handleGenerateSummary()}
              disabled={isGenerating}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer ${
                showSummary
                  ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/30'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${isGenerating ? 'animate-pulse' : ''}`}
              title={t('articleView.generateSummary')}
            >
              <Sparkles className="w-5 h-5" />
              <span className="text-xs font-bold">AI</span>
            </button>

            <button
              onClick={() => void handleToggleRead()}
              className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                article.isRead
                  ? 'text-primary-500 bg-primary-50 dark:bg-primary-900/30'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={article.isRead ? t('articleView.markAsUnread') : t('articleView.markAsRead')}
            >
              <Check className="w-5 h-5" />
            </button>

            <button
              onClick={() => void handleToggleStar()}
              className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                article.isStarred
                  ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/30'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={article.isStarred ? t('articleView.removeStar') : t('articleView.addStar')}
            >
              <Star className={`w-5 h-5 ${article.isStarred ? 'fill-current' : ''}`} />
            </button>

            <button
              onClick={() => void handleToggleFavorite()}
              className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                article.isFavorite
                  ? 'text-rose-500 bg-rose-50 dark:bg-rose-900/30'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={article.isFavorite ? t('articleView.removeFavorite') : t('articleView.addFavorite')}
            >
              <Bookmark className={`w-5 h-5 ${article.isFavorite ? 'fill-current' : ''}`} />
            </button>

            <button
              onClick={() => void handleOriginalLink(article.link)}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={originalLinkActionLabel}
            >
              <ExternalLink className="w-5 h-5" />
            </button>

          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto relative min-w-0">
          <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
            <div className="transition-all duration-300">
              <header className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white leading-tight mb-4 tracking-tight">
                  {article.title}
                </h1>

                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                  <div className="flex flex-wrap items-center gap-4">
                    {article.author && (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-semibold">
                          {article.author.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {article.author}
                        </span>
                      </div>
                    )}

                    {article.publishedAt && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <time dateTime={article.publishedAt} className="font-medium">
                          {formatDate(article.publishedAt)}
                        </time>
                      </>
                    )}

                    {article.isRead && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span className="text-primary-500 font-medium">{t('articleView.read')}</span>
                      </>
                    )}

                  </div>

                  {((article.scores && article.scores.length > 0) || hasProcessing || hasPending || hasFailed) && (
                    <div className="flex items-center gap-2 ml-auto">
                      <ScoreBadges scores={article.scores} className="justify-end" />
                      {(hasProcessing || hasPending || hasFailed) && (
                        <span
                          aria-label={displayText}
                          title={aiTaskTitle}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 ${
                            hasFailed && !hasProcessing
                              ? 'text-red-500 dark:text-red-400'
                              : hasProcessing
                                ? 'text-purple-500 dark:text-purple-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {icon === 'sparkles' && <Sparkles className="w-3.5 h-3.5 animate-spin" />}
                          {icon === 'clock' && <Clock className="w-3.5 h-3.5" />}
                          {icon === 'alert' && <AlertCircle className="w-3.5 h-3.5" />}
                          <span>{displayText}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <TagsSection />
              </header>

              {showTopSummary && (
                <SummaryPanel
                  summary={summary}
                  isGenerating={isGenerating}
                  error={summaryError}
                  onClose={handleCloseSummary}
                  className="mb-8 rounded-2xl"
                />
              )}

              {showTopTranslation && (
                <TranslationPanel
                  translation={translation}
                  isTranslating={isTranslating}
                  error={translationError}
                  onClose={handleCloseTranslation}
                  className="mb-8 rounded-2xl"
                />
              )}

              {isRenderingContent || (renderedArticleHtml && !parsedArticleContent) ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-4 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-4 w-11/12 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-4 w-4/5 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              ) : renderedArticleHtml ? (
                <div className="article-content">
                  {parsedArticleContent}
                </div>
              ) : (
                <div className="text-slate-600 dark:text-slate-300">
                  <p className="text-lg leading-relaxed mb-6">{t('articleView.noContent')}</p>
                </div>
              )}

              {!article.content && article.link && (
                <button
                  onClick={() => void handleOriginalLink(article.link)}
                  className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-all duration-200 cursor-pointer"
                >
                  {originalLinkActionLabel}
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
            </div>

            <nav className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-700/50">
              <div className="flex flex-col md:flex-row justify-between items-stretch gap-4">
                <Link
                  to={prevArticle ? buildArticlePath(prevArticle.id) : '#'}
                  className={`flex-1 flex items-center gap-3 p-4 rounded-xl transition-all duration-200 cursor-pointer ${
                    prevArticle
                      ? 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800'
                      : 'bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
                  onClick={(e) => {
                    if (!prevArticle) e.preventDefault()
                  }}
                >
                  <ArrowLeft
                    className={`w-5 h-5 ${
                      prevArticle ? 'text-primary-500' : 'text-slate-300 dark:text-slate-600'
                    }`}
                  />
                  <div className="text-left">
                    <p
                      className={`text-sm font-medium mb-1 ${
                        prevArticle
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    >
                      {t('articleView.prevArticle')}
                    </p>
                    <p
                      className={`text-sm ${
                        prevArticle
                          ? 'text-slate-600 dark:text-slate-400'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    >
                      {prevArticle ? prevArticle.title : t('articleView.noMoreArticles')}
                    </p>
                  </div>
                </Link>

                <Link
                  to={nextArticle ? buildArticlePath(nextArticle.id) : '#'}
                  className={`flex-1 flex items-center justify-end gap-3 p-4 rounded-xl transition-all duration-200 cursor-pointer ${
                    nextArticle
                      ? 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800'
                      : 'bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
                  onClick={(e) => {
                    if (!nextArticle) e.preventDefault()
                  }}
                >
                  <div className="text-right">
                    <p
                      className={`text-sm font-medium mb-1 ${
                        nextArticle
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    >
                      {t('articleView.nextArticle')}
                    </p>
                    <p
                      className={`text-sm ${
                        nextArticle
                          ? 'text-slate-600 dark:text-slate-400'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    >
                      {nextArticle ? nextArticle.title : t('articleView.noMoreArticles')}
                    </p>
                  </div>
                  <ArrowRight
                    className={`w-5 h-5 ${
                      nextArticle ? 'text-primary-500' : 'text-slate-300 dark:text-slate-600'
                    }`}
                  />
                </Link>
              </div>
            </nav>
          </article>
        </div>

        {/* 固定定位的目录按钮 */}
        {toc.length > 0 && (
          <button
            onClick={() => setShowToc((prev) => !prev)}
            className="fixed right-6 bottom-6 p-3 rounded-full z-30 text-slate-600 dark:text-slate-400 hover:text-primary-500 transition-colors border bg-white dark:bg-slate-900 shadow-lg border-slate-200 dark:border-slate-700"
            title={t('articleView.toc')}
          >
            {showToc ? <X className="w-5 h-5" /> : <List className="w-5 h-5" />}
          </button>
        )}

        {/* 目录弹窗 */}
        {showToc && toc.length > 0 && (
          <div className="fixed right-6 bottom-20 rounded-xl shadow-xl p-4 w-72 max-h-[60vh] overflow-y-auto z-30 animate-fade-in border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{t('articleView.toc')}</h3>
            <div className="space-y-1">
              {toc.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    const element = document.getElementById(item.id)
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth' })
                    }
                    setShowToc(false)
                  }}
                  className="w-full text-left text-sm py-1 px-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-700 dark:text-slate-300"
                  style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
                >
                  {item.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {(showSidebarSummary || showSidebarTranslation) && (
          <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex flex-col shrink-0 transition-all duration-300">
            {showSidebarSummary && (
              <div
                className={`flex-1 overflow-y-auto ${
                  showSidebarTranslation ? 'border-b border-slate-200 dark:border-slate-700' : ''
                }`}
              >
                <SummaryPanel
                  summary={summary}
                  isGenerating={isGenerating}
                  error={summaryError}
                  onClose={handleCloseSummary}
                  className="h-full border-0 bg-transparent rounded-none"
                />
              </div>
            )}

            {showSidebarTranslation && (
              <div className="flex-1 overflow-y-auto">
                <TranslationPanel
                  translation={translation}
                  isTranslating={isTranslating}
                  error={translationError}
                  onClose={handleCloseTranslation}
                  className="h-full border-0 bg-transparent rounded-none"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
