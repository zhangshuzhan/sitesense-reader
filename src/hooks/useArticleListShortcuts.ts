import { useEffect } from 'react'
import i18n from '@/i18n'
import { useNavigate, useParams } from 'react-router-dom'
import { VirtuosoHandle } from 'react-virtuoso'
import { Article } from '@/types'
import { invoke } from '@/utils/tauri'
import { toast } from '@/stores/toastStore'
import { useSettingsStore, defaultShortcuts } from '@/stores/settingsStore'
import { useFeedStore } from '@/stores/feedStore'

export function useArticleListShortcuts(
  articles: Article[],
  virtuosoRef: React.RefObject<VirtuosoHandle>,
  basePath: string
) {
  const navigate = useNavigate()
  const { articleId } = useParams()
  const { shortcuts: config = defaultShortcuts, shortcutsEnabled } = useSettingsStore()

  useEffect(() => {
    if (!shortcutsEnabled) return

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ignore if input/textarea is focused or modifier keys are pressed
      if (
        ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) ||
        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey
      ) {
        return
      }

      const currentId = Number(articleId)
      const currentIndex = articles.findIndex(a => a.id === currentId)

      switch (e.key.toLowerCase()) {
        case config.next: { // 'j'
          if (currentIndex < articles.length - 1) {
            const nextArticle = articles[currentIndex + 1]
            const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
            navigate(`${cleanBasePath}/article/${nextArticle.id}`)
            virtuosoRef.current?.scrollIntoView({ index: currentIndex + 1, behavior: 'auto' })
          } else if (currentIndex === -1 && articles.length > 0) {
            const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
            navigate(`${cleanBasePath}/article/${articles[0].id}`)
            virtuosoRef.current?.scrollIntoView({ index: 0, behavior: 'auto' })
          }
          break
        }
        case config.prev: { // 'k'
          if (currentIndex > 0) {
            const prevArticle = articles[currentIndex - 1]
            const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
            navigate(`${cleanBasePath}/article/${prevArticle.id}`)
            virtuosoRef.current?.scrollIntoView({ index: currentIndex - 1, behavior: 'auto' })
          }
          break
        }
        case config.toggleRead: { // 'm'
          if (currentId) {
            const article = articles.find(a => a.id === currentId)
            if (article) {
              const isRead = !article.isRead
              await invoke('mark_article_read', { id: currentId, isRead })
              useFeedStore.getState().applyArticleUpdate({
                id: currentId,
                isRead,
                feedId: article.feedId,
                previousIsRead: article.isRead,
              })
              toast.success(article.isRead ? i18n.t('articleActions.markedAsUnread') : i18n.t('articleActions.markedAsRead'))
            }
          }
          break
        }
        case config.toggleStar: { // 's'
          if (currentId) {
            const article = articles.find(a => a.id === currentId)
            if (article) {
              const isStarred = !article.isStarred
              await invoke('toggle_article_star', { id: currentId })
              useFeedStore.getState().applyArticleUpdate({ id: currentId, isStarred, feedId: article.feedId })
              toast.success(article.isStarred ? i18n.t('articleActions.starRemoved') : i18n.t('articleActions.starAdded'))
            }
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [articles, articleId, virtuosoRef, navigate, basePath, config, shortcutsEnabled])
}
