import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ArticleListLayout from '@/components/ArticleListLayout'
import ArticleListContent from '@/components/article-list/ArticleListContent'
import { useArticleUpdateListener } from '@/hooks/useArticleUpdateListener'
import { Article } from '@/types'
import { invoke, isTauriEnv } from '@/utils/tauri'

export default function SearchResults() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''
  const [articles, setArticles] = useState<Article[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedArticles, setSelectedArticles] = useState<Set<number>>(new Set())
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const searchRunRef = useRef(0)

  useArticleUpdateListener(setArticles)

  useEffect(() => {
    setSelectedArticles(new Set())

    if (query && isTauriEnv) {
      void handleSearch(query)
    } else {
      searchRunRef.current += 1
      setArticles([])
      setIsLoading(false)
      setRefreshError(null)
    }
  }, [query])

  const handleSearch = async (searchQuery: string) => {
    const runId = searchRunRef.current + 1
    searchRunRef.current = runId
    setIsLoading(true)
    setRefreshError(null)
    try {
      const results = await invoke<Article[]>('search_articles', { query: searchQuery })
      if (runId === searchRunRef.current) {
        setArticles(results)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (runId === searchRunRef.current) {
        setRefreshError(message)
      }
      console.error('Search failed:', error)
    } finally {
      if (runId === searchRunRef.current) {
        setIsLoading(false)
      }
    }
  }

  const handleSelectArticle = (articleId: number) => {
    setSelectedArticles((prev) => {
      const next = new Set(prev)
      if (next.has(articleId)) {
        next.delete(articleId)
      } else {
        next.add(articleId)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedArticles((prev) =>
      prev.size === articles.length ? new Set() : new Set(articles.map((article) => article.id))
    )
  }

  const refresh = () => {
    if (query) {
      void handleSearch(query)
    }
  }

  return (
    <ArticleListLayout>
      <ArticleListContent
        title={query ? `${t('pages.searchResults.title')}: ${query}` : t('pages.searchResults.title')}
        subtitle={t('pages.searchResults.found', { count: articles.length })}
        iconType="search"
        basePath="/search"
        articles={articles}
        isLoading={isLoading}
        isMoreLoading={false}
        hasMore={false}
        refreshError={refreshError}
        selectedArticles={selectedArticles}
        emptyMessage={query ? t('pages.searchResults.noResults') : t('search.placeholder')}
        emptySubMessage={query ? t('pages.searchResults.noResultsHint') : undefined}
        showRefresh={Boolean(query)}
        onLoadMore={() => {}}
        onRefresh={refresh}
        onSelectArticle={handleSelectArticle}
        onSelectAll={handleSelectAll}
        onClearSelection={() => setSelectedArticles(new Set())}
        setArticles={setArticles}
        buildArticleLink={(article) =>
          `/search/article/${article.id}?q=${encodeURIComponent(query)}`
        }
      />
    </ArticleListLayout>
  )
}
