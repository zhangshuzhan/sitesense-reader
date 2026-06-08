import { ReactNode, useMemo, useRef, useState } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { useTranslation } from 'react-i18next'
import { Article, Feed } from '@/types'
import { useFeedStore } from '@/stores/feedStore'
import { useArticleListShortcuts } from '@/hooks/useArticleListShortcuts'
import ArticleItem from '@/components/ArticleItem'
import { invoke } from '@/utils/tauri'
import { toast } from '@/stores/toastStore'
import ArticleListHeader from './ArticleListHeader'
import ArticleListEmpty from './ArticleListEmpty'
import ArticleListSelectionBar from './ArticleListSelectionBar'
import ArticleListModals from './ArticleListModals'
import ArticleListLoading from './ArticleListLoading'
import ArticleListSummary from './ArticleListSummary'

type IconType = 'all' | 'unread' | 'starred' | 'favorite' | 'tag' | 'group' | 'search'

interface ArticleListContentProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  iconType?: IconType
  basePath: string
  articles: Article[]
  isLoading: boolean
  isMoreLoading: boolean
  hasMore: boolean
  refreshError: string | null
  selectedArticles: Set<number>
  emptyMessage: string
  emptySubMessage?: string
  showAddFeed?: boolean
  showRefresh?: boolean
  showSelectAll?: boolean
  onRemoveFromGroup?: (articleIds: number[]) => Promise<void>
  extraHeaderContent?: ReactNode
  autoSummary?: string | null
  onCloseAutoSummary?: () => void
  isAutoSummarizing?: boolean
  onLoadMore: () => void
  onRefresh: () => void
  onSelectArticle: (articleId: number) => void
  onSelectAll: () => void
  onClearSelection: () => void
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>
  buildArticleLink?: (article: Article) => string
}

export default function ArticleListContent(props: ArticleListContentProps) {
  const {
    title,
    subtitle,
    icon,
    iconType = 'all',
    basePath,
    articles,
    isLoading,
    isMoreLoading,
    hasMore,
    refreshError,
    selectedArticles,
    emptyMessage,
    emptySubMessage,
    showAddFeed = false,
    showRefresh = false,
    showSelectAll = true,
    onRemoveFromGroup,
    extraHeaderContent,
    autoSummary,
    onCloseAutoSummary,
    isAutoSummarizing,
    onLoadMore,
    onRefresh,
    onSelectArticle,
    onSelectAll,
    onClearSelection,
    setArticles,
    buildArticleLink
  } = props

  const feeds = useFeedStore(state => state.feeds)
  const setFeeds = useFeedStore(state => state.setFeeds)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [isAddToGroupOpen, setIsAddToGroupOpen] = useState(false)
  const [isBatchSummaryOpen, setIsBatchSummaryOpen] = useState(false)
  const feedMap = useMemo(() => new Map(feeds.map(feed => [feed.id, feed])), [feeds])

  useArticleListShortcuts(articles, virtuosoRef, basePath)

  const { t } = useTranslation()

  const refreshFeeds = async () => {
    try {
      const updatedFeeds = await invoke<Feed[]>('get_feeds')
      setFeeds(updatedFeeds)
    } catch (error) {
      console.error('Failed to refresh feed counts:', error)
    }
  }

  const handleMarkSelectedAsRead = async () => {
    if (selectedArticles.size === 0) return
    try {
      await invoke('mark_articles_read', { ids: Array.from(selectedArticles), isRead: true })
      setArticles(prev => prev.map(a =>
        selectedArticles.has(a.id) ? { ...a, isRead: true } : a
      ))
      await refreshFeeds()
      onClearSelection()
    } catch (error) {
      console.error('Failed to mark articles as read:', error)
    }
  }

  const handleMarkSelectedAsUnread = async () => {
    if (selectedArticles.size === 0) return
    try {
      await invoke('mark_articles_read', { ids: Array.from(selectedArticles), isRead: false })
      setArticles(prev => prev.map(a =>
        selectedArticles.has(a.id) ? { ...a, isRead: false } : a
      ))
      await refreshFeeds()
      onClearSelection()
    } catch (error) {
      console.error('Failed to mark articles as unread:', error)
    }
  }

  const handleRemoveFromGroupInternal = async () => {
    if (!onRemoveFromGroup || selectedArticles.size === 0) return
    try {
      await onRemoveFromGroup(Array.from(selectedArticles))
      setArticles(prev => prev.filter(a => !selectedArticles.has(a.id)))
      onClearSelection()
      toast.success(t('articleListContent.removedFromGroup'))
    } catch (error) {
      console.error('Failed to remove articles from group:', error)
      toast.error(t('articleListContent.removeFailed'))
    }
  }

  if (isLoading && articles.length === 0) {
    return <ArticleListLoading />
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900">
      <ArticleListHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        iconType={iconType}
        articleCount={articles.length}
        selectedCount={selectedArticles.size}
        showRefresh={showRefresh}
        isLoading={isLoading}
        refreshError={refreshError}
        onRefresh={onRefresh}
        onMarkSelectedAsRead={handleMarkSelectedAsRead}
        onMarkSelectedAsUnread={handleMarkSelectedAsUnread}
        onAddToGroup={() => setIsAddToGroupOpen(true)}
        onBatchSummary={() => setIsBatchSummaryOpen(true)}
        onRemoveFromGroup={handleRemoveFromGroupInternal}
        onClearSelection={onClearSelection}
        extraHeaderContent={extraHeaderContent}
        canRemoveFromGroup={!!onRemoveFromGroup}
      />

      <div className="flex-1 overflow-hidden">
        <ArticleListSummary
          autoSummary={autoSummary}
          isAutoSummarizing={isAutoSummarizing}
          onCloseAutoSummary={onCloseAutoSummary}
        />

        {articles.length === 0 ? (
          <ArticleListEmpty
            message={emptyMessage}
            subMessage={emptySubMessage}
            showAddFeed={showAddFeed}
          />
        ) : (
          <div className="h-full flex flex-col">
            {showSelectAll && (
              <ArticleListSelectionBar
                articleCount={articles.length}
                selectedCount={selectedArticles.size}
                onSelectAll={onSelectAll}
              />
            )}

            <div className="flex-1">
              <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%' }}
                data={articles}
                endReached={onLoadMore}
                overscan={96}
                defaultItemHeight={112}
                itemContent={(_, article: Article) => {
                  const articleWithFeed = {
                    ...article,
                    feed: feedMap.get(article.feedId) || undefined
                  }
                  return (
                    <ArticleItem
                      article={articleWithFeed}
                      isSelected={selectedArticles.has(article.id)}
                      onSelect={onSelectArticle}
                      linkTarget={buildArticleLink?.(article) ?? `${basePath}/article/${article.id}`}
                    />
                  )
                }}
                components={{
                  Footer: () => (
                    <div className="py-4 text-center">
                      {isMoreLoading ? (
                        <div className="flex justify-center">
                          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      ) : hasMore ? (
                        <span className="text-xs text-slate-400">{t('articleListContent.loadMore')}</span>
                      ) : (
                        <span className="text-xs text-slate-400">{t('articleListContent.noMore')}</span>
                      )}
                    </div>
                  )
                }}
              />
            </div>
          </div>
        )}
      </div>

      <ArticleListModals
        isAddToGroupOpen={isAddToGroupOpen}
        isBatchSummaryOpen={isBatchSummaryOpen}
        selectedArticleIds={Array.from(selectedArticles)}
        selectedArticles={articles.filter(a => selectedArticles.has(a.id))}
        onCloseAddToGroup={() => setIsAddToGroupOpen(false)}
        onCloseBatchSummary={() => setIsBatchSummaryOpen(false)}
        onBatchSummaryComplete={onRefresh}
      />
    </div>
  )
}
