import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCheck,
  Layers,
  Sparkles,
  Trash2,
  List,
  Inbox,
  Star,
  Bookmark,
  Tag as TagIcon,
  Search,
  RefreshCw
} from 'lucide-react'

const headerIcons = {
  all: List,
  unread: Inbox,
  starred: Star,
  favorite: Bookmark,
  tag: TagIcon,
  group: Layers,
  search: Search
}

interface ArticleListHeaderProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  iconType?: keyof typeof headerIcons
  articleCount: number
  selectedCount: number
  showRefresh?: boolean
  isLoading?: boolean
  refreshError?: string | null
  onRefresh?: () => void
  onMarkSelectedAsRead?: () => void
  onMarkSelectedAsUnread?: () => void
  onAddToGroup?: () => void
  onBatchSummary?: () => void
  onRemoveFromGroup?: () => void
  onClearSelection?: () => void
  extraHeaderContent?: ReactNode
  canRemoveFromGroup?: boolean
}

export default function ArticleListHeader({
  title,
  subtitle,
  icon,
  iconType = 'all',
  articleCount,
  selectedCount,
  showRefresh = false,
  isLoading = false,
  refreshError = null,
  onRefresh,
  onMarkSelectedAsRead,
  onMarkSelectedAsUnread,
  onAddToGroup,
  onBatchSummary,
  onRemoveFromGroup,
  onClearSelection,
  extraHeaderContent,
  canRemoveFromGroup = false
}: ArticleListHeaderProps) {
  const { t } = useTranslation()
  const IconComponent = iconType ? headerIcons[iconType] : null
  const hasSelection = selectedCount > 0
  const hasRefreshError = !!refreshError && !isLoading

  return (
    <header className="px-6 py-3 border-b border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon ? (
            icon
          ) : IconComponent ? (
            <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
              <IconComponent className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
              {title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {subtitle || t('articleListHeader.articleCount', { count: articleCount })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasSelection && (
            <div className="flex items-center gap-2 animate-fade-in flex-shrink-0 ml-4">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {t('articleListHeader.selected', { count: selectedCount })}
              </span>
              <button
                onClick={onMarkSelectedAsRead}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-all duration-200 cursor-pointer"
                title={t('articleListHeader.markRead')}
              >
                <CheckCheck className="w-4 h-4" />
              </button>
              <button
                onClick={onMarkSelectedAsUnread}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                title={t('articleListHeader.markUnread')}
              >
                <div className="w-2 h-2 rounded-full bg-primary-500"></div>
              </button>
              <button
                onClick={onAddToGroup}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                title={t('articleListHeader.addToGroup')}
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                onClick={onBatchSummary}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-800 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                title={t('articleListHeader.batchSummary')}
              >
                <Sparkles className="w-4 h-4" />
              </button>
              {canRemoveFromGroup && (
                <button
                  onClick={onRemoveFromGroup}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                  title={t('articleListHeader.removeFromGroup')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClearSelection}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium transition-colors cursor-pointer"
              >
                {t('articleListHeader.cancel')}
              </button>
            </div>
          )}
          {showRefresh && (
            <button
              onClick={onRefresh}
              className={`p-2 rounded-lg transition-colors cursor-pointer ${isLoading ? 'animate-spin' : ''} ${
                hasRefreshError
                  ? 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={hasRefreshError ? `${t('articleListHeader.refreshFailed')}: ${refreshError}` : (isLoading ? t('articleListHeader.refreshing') : t('articleListHeader.refresh'))}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          )}
          {extraHeaderContent}
        </div>
      </div>
    </header>
  )
}
