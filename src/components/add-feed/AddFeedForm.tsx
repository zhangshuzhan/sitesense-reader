import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke, isTauriEnv } from '@/utils/tauri'
import { useFeedStore } from '@/stores/feedStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { validateFeedUrl } from '@/utils'
import { toast } from '@/stores/toastStore'
import { Loader2, AlertCircle, Globe, Rss, CheckCircle2 } from 'lucide-react'
import { Article, WordPressProbe } from '@/types'
import {
  fetchAndAddWordPress,
  detectWordPress,
  processNewArticles,
} from '@/services/runtime'

interface AddFeedFormProps {
  onClose: () => void
}

type SourceType = 'rss' | 'wordpress'

type FeedPayload = {
  title?: string
}

type FetchAddFeedResponse =
  | {
      feed?: FeedPayload | null
      articles?: Article[]
    }
  | [FeedPayload, Article[]]

function normalizeFetchAddFeedResponse(
  response: FetchAddFeedResponse
): { feed: FeedPayload | null; articles: Article[] } {
  if (Array.isArray(response)) {
    const [feed, articles] = response
    return {
      feed: feed ?? null,
      articles: Array.isArray(articles) ? articles : [],
    }
  }

  return {
    feed: response.feed ?? null,
    articles: Array.isArray(response.articles) ? response.articles : [],
  }
}

export default function AddFeedForm({ onClose }: AddFeedFormProps) {
  const { t } = useTranslation()
  const [sourceType, setSourceType] = useState<SourceType>('rss')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // WordPress-specific state
  const [wpBase, setWpBase] = useState('')
  const [wpToken, setWpToken] = useState('')
  const [isDetecting, setIsDetecting] = useState(false)
  const [probe, setProbe] = useState<WordPressProbe | null>(null)

  const { setFeeds } = useFeedStore()
  const { rsshubDomain } = useSettingsStore()

  const handleRssSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isTauriEnv) {
      setError(t('addFeed.tauriOnly'))
      return
    }

    if (!validateFeedUrl(url)) {
      setError(t('addFeed.invalidUrl'))
      return
    }

    setIsLoading(true)

    try {
      const rawResult = await invoke<FetchAddFeedResponse>('fetch_and_add_feed', {
        url,
        category: category.trim() || null,
        rsshubDomain
      })
      const result = normalizeFetchAddFeedResponse(rawResult)

      const feeds = await invoke<any[]>('get_feeds')
      setFeeds(feeds)
      await processNewArticles(result.articles.map((article) => article.id))

      setUrl('')
      setCategory('')
      onClose()
      toast.success(t('addFeed.successWithTitle', { title: result.feed?.title || url }))
    } catch (err) {
      const errorMsg = String(err)

      if (errorMsg.includes('UNIQUE constraint failed')) {
        setError(t('addFeed.duplicateFeed'))
        toast.warning(t('addFeed.duplicateFeed'))
      } else if (errorMsg.includes('Failed to parse feed')) {
        setError(t('addFeed.parseFailed'))
      } else {
        setError(errorMsg)
      }
      toast.error(t('addFeed.failed'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleDetect = async () => {
    setError('')
    setProbe(null)
    if (!wpBase.trim()) {
      setError(t('addFeed.invalidUrl'))
      return
    }
    setIsDetecting(true)
    try {
      const result = await detectWordPress(wpBase.trim(), wpToken.trim() || undefined)
      setProbe(result)
      if (!result.reachable) {
        setError(result.errorMessage || t('addFeed.wpUnreachable'))
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsDetecting(false)
    }
  }

  const handleWpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isTauriEnv) {
      setError(t('addFeed.tauriOnly'))
      return
    }

    if (!wpBase.trim()) {
      setError(t('addFeed.invalidUrl'))
      return
    }

    setIsLoading(true)
    try {
      const result = await fetchAndAddWordPress(
        wpBase.trim(),
        category.trim() || null,
        wpToken.trim() || undefined
      )

      const feeds = await invoke<any[]>('get_feeds')
      setFeeds(feeds)
      await processNewArticles((result.articles || []).map((article) => article.id))

      setWpBase('')
      setWpToken('')
      setCategory('')
      setProbe(null)
      onClose()
      toast.success(
        t('addFeed.successWithTitle', { title: result.feed?.title || wpBase })
      )
    } catch (err) {
      const errorMsg = String(err)
      if (errorMsg.includes('UNIQUE constraint failed')) {
        setError(t('addFeed.duplicateFeed'))
        toast.warning(t('addFeed.duplicateFeed'))
      } else {
        setError(errorMsg)
      }
      toast.error(t('addFeed.failed'))
    } finally {
      setIsLoading(false)
    }
  }

  const SegmentButton = ({
    active,
    onClick,
    icon,
    label,
  }: {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
        active
          ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <form onSubmit={sourceType === 'rss' ? handleRssSubmit : handleWpSubmit} className="p-5">
      {/* Source type selector */}
      <div className="flex gap-2 p-1 mb-4 bg-slate-100 dark:bg-slate-900 rounded-xl">
        <SegmentButton
          active={sourceType === 'rss'}
          onClick={() => {
            setSourceType('rss')
            setError('')
          }}
          icon={<Rss className="w-4 h-4" />}
          label={t('addFeed.sourceRss')}
        />
        <SegmentButton
          active={sourceType === 'wordpress'}
          onClick={() => {
            setSourceType('wordpress')
            setError('')
            setProbe(null)
          }}
          icon={<Globe className="w-4 h-4" />}
          label={t('addFeed.sourceWordPress')}
        />
      </div>

      {sourceType === 'rss' ? (
        <div className="mb-4">
          <label
            htmlFor="feed-url"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
          >
            {t('addFeed.feedUrl')}
          </label>
          <input
            id="feed-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('addFeed.feedUrlPlaceholder')}
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all duration-200"
            disabled={isLoading}
            autoFocus
          />
        </div>
      ) : (
        <div className="mb-4 space-y-4">
          <div>
            <label
              htmlFor="wp-base"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
            >
              {t('addFeed.wpBase')}
            </label>
            <input
              id="wp-base"
              type="text"
              value={wpBase}
              onChange={(e) => {
                setWpBase(e.target.value)
                setProbe(null)
              }}
              placeholder={t('addFeed.wpBasePlaceholder')}
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all duration-200"
              disabled={isLoading || isDetecting}
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="wp-token"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
            >
              {t('addFeed.wpToken')}
            </label>
            <input
              id="wp-token"
              type="password"
              value={wpToken}
              onChange={(e) => {
                setWpToken(e.target.value)
                setProbe(null)
              }}
              placeholder={t('addFeed.wpTokenPlaceholder')}
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all duration-200"
              disabled={isLoading || isDetecting}
            />
          </div>

          <button
            type="button"
            onClick={handleDetect}
            disabled={isLoading || isDetecting || !wpBase.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isDetecting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isDetecting ? t('addFeed.detecting') : t('addFeed.detect')}
          </button>

          {probe && probe.reachable && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl text-green-600 dark:text-green-400 text-sm animate-fade-in">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>
                {probe.auth === 'account'
                  ? t('addFeed.wpReachableAccount')
                  : t('addFeed.wpReachablePublic')}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mb-4">
        <label
          htmlFor="feed-category"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
        >
          {t('addFeed.group')}
        </label>
        <input
          id="feed-category"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t('addFeed.groupPlaceholder')}
          className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 transition-all duration-200"
          disabled={isLoading}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 mt-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm animate-fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        {sourceType === 'rss' ? t('addFeed.hint') : t('addFeed.hintWordPress')}
      </p>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => {
            if (!isLoading && !isDetecting) {
              setUrl('')
              setWpBase('')
              setWpToken('')
              setCategory('')
              setError('')
              onClose()
            }
          }}
          className="px-5 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-medium transition-all duration-200 cursor-pointer"
          disabled={isLoading || isDetecting}
        >
          {t('addFeed.cancel')}
        </button>
        <button
          type="submit"
          className="flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:-translate-y-0.5"
          disabled={isLoading || isDetecting || !isTauriEnv}
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isLoading ? t('addFeed.adding') : t('addFeed.add')}
        </button>
      </div>
    </form>
  )
}
