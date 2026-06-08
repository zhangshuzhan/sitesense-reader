import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextMenuStore } from '@/stores/contextMenuStore'
import { invoke } from '@/utils/tauri'
import { 
  CheckCheck, 
  Star, 
  Bookmark, 
  Copy
} from 'lucide-react'
import { toast } from '@/stores/toastStore'
import { useFeedStore } from '@/stores/feedStore'
import { Article } from '@/types'

export default function GlobalContextMenu() {
  const { t } = useTranslation()
  const { isOpen, position, type, data, close } = useContextMenuStore()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        close()
      }
    }
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, close])

  if (!isOpen || !data) return null

  // Adjust position to prevent overflow
  const style: React.CSSProperties = {
    top: position.y,
    left: position.x,
  }
  
  // Basic boundary check
  if (position.x + 224 > window.innerWidth) { // 224 is w-56 (14rem)
    style.left = position.x - 224
  }
  if (position.y + 300 > window.innerHeight) {
    style.top = position.y - 300
  }

  const handleAction = async (action: () => Promise<void> | void) => {
    try {
      await action()
      close()
    } catch (error) {
      console.error('Action failed:', error)
      toast.error(t('globalContextMenu.operationFailed'))
    }
  }

  const renderArticleMenu = (article: Article) => (
    <div className="py-1">
      <button
        onClick={() => handleAction(async () => {
          const isRead = !article.isRead
          await invoke('mark_article_read', { id: article.id, isRead })
          toast.success(article.isRead ? t('globalContextMenu.markAsUnread') : t('globalContextMenu.markAsRead'))
          useFeedStore.getState().applyArticleUpdate({
            id: article.id,
            isRead,
            feedId: article.feedId,
            previousIsRead: article.isRead,
          })
        })}
        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer"
      >
        <CheckCheck className="w-4 h-4" />
        {article.isRead ? t('globalContextMenu.markAsUnread') : t('globalContextMenu.markAsRead')}
      </button>
      
      <button
        onClick={() => handleAction(async () => {
          const isStarred = !article.isStarred
          await invoke('toggle_article_star', { id: article.id })
          useFeedStore.getState().applyArticleUpdate({ id: article.id, isStarred, feedId: article.feedId })
          toast.success(article.isStarred ? t('globalContextMenu.removeStar') : t('globalContextMenu.addStar'))
        })}
        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer"
      >
        <Star className={`w-4 h-4 ${article.isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
        {article.isStarred ? t('globalContextMenu.removeStar') : t('globalContextMenu.addStar')}
      </button>

      <button
        onClick={() => handleAction(async () => {
          const isFavorite = !article.isFavorite
          await invoke('toggle_article_favorite', { id: article.id })
          useFeedStore.getState().applyArticleUpdate({ id: article.id, isFavorite, feedId: article.feedId })
          toast.success(article.isFavorite ? t('globalContextMenu.removeFavorite') : t('globalContextMenu.addFavorite'))
        })}
        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer"
      >
        <Bookmark className={`w-4 h-4 ${article.isFavorite ? 'fill-rose-400 text-rose-400' : ''}`} />
        {article.isFavorite ? t('globalContextMenu.removeFavorite') : t('globalContextMenu.addFavorite')}
      </button>

      <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />

      <button
        onClick={() => handleAction(async () => {
          await navigator.clipboard.writeText(article.link)
          toast.success(t('globalContextMenu.linkCopied'))
        })}
        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer"
      >
        <Copy className="w-4 h-4" />
        {t('globalContextMenu.copyLink')}
      </button>
    </div>
  )


  return (
    <div 
      ref={menuRef}
      style={style}
      className="fixed z-50 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 animate-in fade-in zoom-in-95 duration-100"
    >
      {type === 'article' && renderArticleMenu(data as Article)}
    </div>
  )
}
