import { useEffect, useRef } from 'react'
import { Article } from '@/types'
import { useFeedStore } from '@/stores/feedStore'

type FilterFn = (article: Article) => boolean

export function useArticleUpdateListener(
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>,
  filterFn?: FilterFn
) {
  const articleUpdate = useFeedStore((state) => state.lastArticleUpdate)
  const articleUpdateVersion = useFeedStore((state) => state.articleUpdateVersion)
  const filterFnRef = useRef(filterFn)
  const handledUpdateVersionRef = useRef<number | null>(null)

  useEffect(() => {
    filterFnRef.current = filterFn
  }, [filterFn])

  useEffect(() => {
    if (!articleUpdate) return
    if (handledUpdateVersionRef.current === articleUpdateVersion) return
    handledUpdateVersionRef.current = articleUpdateVersion

    const { id, ...updates } = articleUpdate
    setArticles(prev => {
      const updated = prev.map(a => {
        if (a.id === id) {
          return { ...a, ...updates }
        }
        return a
      })

      const currentFilterFn = filterFnRef.current
      if (currentFilterFn) {
        return updated.filter(currentFilterFn)
      }
      return updated
    })
  }, [articleUpdate, articleUpdateVersion, setArticles])
}
