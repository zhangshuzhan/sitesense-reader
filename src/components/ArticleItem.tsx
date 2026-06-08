import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Article, ArticleScore } from '@/types'
import { formatRelativeTime } from '@/utils'
import { extractFirstImage } from '@/utils/imageExtract'
import { Star, Bookmark, Sparkles, AlertCircle, Clock } from 'lucide-react'
import { useContextMenuStore } from '@/stores/contextMenuStore'
import { isTauriEnv } from '@/utils/tauri'
import { useAiTaskUiStore } from '@/stores/aiTaskUiStore'
import { countTasksByStatus, getDisplayStatus, getAiTaskSummary } from '@/utils/aiTaskStatus'
import { shouldProxyMediaUrl } from '@/utils/mediaProxy'

const ScoreBadges = ({ scores, className = "" }: { scores?: ArticleScore[], className?: string }) => {
  if (!scores || scores.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {scores.map(s => (
        <span 
          key={s.id} 
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0 whitespace-nowrap"
          style={
            s.badgeColor 
              ? { 
                  backgroundColor: `${s.badgeColor}1A`, 
                  color: s.badgeColor, 
                  borderColor: `${s.badgeColor}33` 
                } 
              : { 
                  backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                  color: '#3b82f6', 
                  borderColor: 'rgba(59, 130, 246, 0.2)' 
                }
          }
        >
          {s.badgeIcon && <span>{s.badgeIcon}</span>}
          {s.badgeName || 'Score'}: {s.score}
        </span>
      ))}
    </div>
  )
}


interface ArticleItemProps {
  article: Article
  isSelected: boolean
  onSelect: (id: number) => void
  linkTarget: string
}

export default function ArticleItem({ article, isSelected, onSelect, linkTarget }: ArticleItemProps) {
  const { open } = useContextMenuStore()
  const [useProxyImage, setUseProxyImage] = useState(false)
  const [hideImage, setHideImage] = useState(false)
  const aiTasks = useAiTaskUiStore((state) => state.tasksByArticleId[article.id] ?? [])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    open('article', { x: e.clientX, y: e.clientY }, article)
  }

  // Decode HTML entities in thumbnail from DB (e.g. &amp; → &)
  let firstImage = article.thumbnail
    ? article.thumbnail.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    : extractFirstImage(article.content || '')
  if (!firstImage && article.summary) {
    firstImage = extractFirstImage(article.summary)
  }
  // Normalize protocol-relative URLs from legacy DB entries
  if (firstImage?.startsWith('//')) {
    firstImage = `https:${firstImage}`
  }

  const shouldUseProxyFallback = Boolean(firstImage && isTauriEnv && shouldProxyMediaUrl(firstImage))
  const proxiedImageUrl = firstImage && shouldUseProxyFallback
    ? `rss-media://localhost/${encodeURIComponent(firstImage)}`
    : null
  const imageUrl = useProxyImage && proxiedImageUrl ? proxiedImageUrl : firstImage

  useEffect(() => {
    setUseProxyImage(false)
    setHideImage(false)
  }, [article.id, firstImage])

  const taskCounts = countTasksByStatus(aiTasks)
  const { hasFailed, hasProcessing, hasPending, displayText, icon } = getDisplayStatus(taskCounts)

  return (
    <div className="px-4 py-2">
      <Link
        to={linkTarget}
        onContextMenu={handleContextMenu}
        className={`group flex flex-col gap-2 p-4 rounded-xl transition-all cursor-pointer border border-slate-100 dark:border-slate-800 h-full ${
          !article.isRead 
            ? 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 shadow-sm hover:shadow-md' 
            : 'bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50'
        }`}
      >
        <div className="flex gap-3">
          <div
            className="flex-shrink-0 pt-1"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSelect(article.id)
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(article.id)}
              onClick={(e) => e.stopPropagation()}
              className={`w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary-500 focus:ring-primary-500 cursor-pointer transition-opacity ${
                isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex gap-4">
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <h3 className={`text-base font-semibold leading-snug line-clamp-2 ${
                  !article.isRead
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}>
                  {article.title}
                </h3>

                {article.summary && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
                    {article.summary.replace(/<[^>]*>/g, '')}
                  </p>
                )}
              </div>

              {imageUrl && !hideImage && (
                <div className="flex-shrink-0">
                  <img
                    src={imageUrl}
                    alt=""
                    className="w-24 h-16 object-cover rounded-lg bg-slate-100 dark:bg-slate-700"
                    onError={() => {
                      if (!useProxyImage && proxiedImageUrl) {
                        setUseProxyImage(true)
                      } else {
                        setHideImage(true)
                      }
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-auto pt-1">
              <div className="flex items-center gap-2">
                {article.isStarred && (
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />
                )}
                {article.isFavorite && (
                  <Bookmark className="w-3.5 h-3.5 text-rose-400 fill-rose-400 flex-shrink-0" />
                )}
                {(hasProcessing || hasPending || hasFailed) && (
                  <span
                    aria-label={displayText}
                    title={getAiTaskSummary(aiTasks)}
                    className={`inline-flex items-center gap-1 text-xs ${
                      hasFailed && !hasProcessing
                        ? 'text-red-500 dark:text-red-400'
                        : hasProcessing
                          ? 'text-purple-500 dark:text-purple-400'
                          : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {icon === 'sparkles' && <Sparkles className="w-3.5 h-3.5 animate-spin" />}
                    {icon === 'clock' && <Clock className="w-3.5 h-3.5" />}
                    {icon === 'alert' && <AlertCircle className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{displayText}</span>
                  </span>
                )}
                {article.scores && article.scores.length > 0 && (
                  <ScoreBadges scores={article.scores} />
                )}
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {formatRelativeTime(article.publishedAt)}
                </span>
              </div>
              {article.feed?.title && (
                <span className="text-xs text-slate-400 dark:text-slate-500 max-w-[120px] truncate">
                  {article.feed.title}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </div>
  )
}
