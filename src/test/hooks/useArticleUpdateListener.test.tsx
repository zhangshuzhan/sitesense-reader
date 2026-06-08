import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useArticleUpdateListener } from '@/hooks/useArticleUpdateListener'
import { useFeedStore } from '@/stores/feedStore'
import { Article } from '@/types'

const mockArticle: Article = {
  id: 1,
  feedId: 1,
  title: 'Article title',
  link: 'https://example.com/article',
  isRead: false,
  isStarred: false,
  isFavorite: false,
  createdAt: '2026-01-01T00:00:00Z',
}

function HookHarness({
  setArticles,
}: {
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>
}) {
  useArticleUpdateListener(setArticles, (article) => !article.isRead)
  return null
}

describe('useArticleUpdateListener', () => {
  beforeEach(() => {
    useFeedStore.getState().reset()
  })

  it('does not replay the same article update after caller rerenders', async () => {
    const setArticles = vi.fn((updater: React.SetStateAction<Article[]>) => {
      if (typeof updater === 'function') {
        updater([mockArticle])
      }
    })

    const { rerender } = render(<HookHarness setArticles={setArticles} />)

    act(() => {
      useFeedStore.getState().applyArticleUpdate({ id: 1, feedId: 1, isRead: true })
    })

    await waitFor(() => {
      expect(setArticles).toHaveBeenCalledTimes(1)
    })

    rerender(<HookHarness setArticles={setArticles} />)

    expect(setArticles).toHaveBeenCalledTimes(1)
  })
})
