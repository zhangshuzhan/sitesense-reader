import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke, isTauriEnv } from '@/utils/tauri'
import { useFeedStore } from '@/stores/feedStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { validateFeedUrl } from '@/utils'
import { toast } from '@/stores/toastStore'
import { Loader2, AlertCircle } from 'lucide-react'
import { Article } from '@/types'
import { processNewArticles } from '@/services/runtime'

interface AddFeedFormProps {
  onClose: () => void
}

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
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { setFeeds } = useFeedStore()
  const { rsshubDomain } = useSettingsStore()

  const handleSubmit = async (e: React.FormEvent) => {
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

  const handleClose = () => {
    if (!isLoading) {
      setUrl('')
      setCategory('')
      setError('')
      onClose()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-5">
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

        {error && (
          <div className="flex items-center gap-2 mt-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm animate-fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t('addFeed.hint')}
        </p>
      </div>

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

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={handleClose}
          className="px-5 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-medium transition-all duration-200 cursor-pointer"
          disabled={isLoading}
        >
          {t('addFeed.cancel')}
        </button>
        <button
          type="submit"
          className="flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:-translate-y-0.5"
          disabled={isLoading || !url || !isTauriEnv}
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isLoading ? t('addFeed.adding') : t('addFeed.add')}
        </button>
      </div>
    </form>
  )
}
