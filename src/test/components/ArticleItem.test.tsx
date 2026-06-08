import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ArticleItem from '@/components/ArticleItem'

const baseArticle = {
  feedId: 1,
  link: 'https://example.com/article/1',
  summary: 'summary',
  isRead: false,
  isStarred: false,
  isFavorite: false,
  createdAt: '2026-01-01T00:00:00Z',
}

describe('ArticleItem', () => {
  it('renders selection checkbox before article title content', () => {
    render(
      <MemoryRouter>
        <ArticleItem
          article={{
            ...baseArticle,
            id: 1,
            title: 'Article title',
            thumbnail: 'https://example.com/image.jpg',
          }}
          isSelected={false}
          onSelect={vi.fn()}
          linkTarget="/feed/1/article/1"
        />
      </MemoryRouter>
    )

    const checkbox = screen.getByRole('checkbox')
    const heading = screen.getByRole('heading', { name: 'Article title' })

    const relation = checkbox.compareDocumentPosition(heading)
    expect((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
  })

  it('resets hidden image state when a virtualized row receives another article', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <ArticleItem
          article={{
            ...baseArticle,
            id: 1,
            title: 'First article',
            thumbnail: 'https://example.com/broken.jpg',
          }}
          isSelected={false}
          onSelect={vi.fn()}
          linkTarget="/feed/1/article/1"
        />
      </MemoryRouter>
    )

    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()

    rerender(
      <MemoryRouter>
        <ArticleItem
          article={{
            ...baseArticle,
            id: 2,
            title: 'Second article',
            thumbnail: 'https://example.com/ok.jpg',
          }}
          isSelected={false}
          onSelect={vi.fn()}
          linkTarget="/feed/1/article/2"
        />
      </MemoryRouter>
    )

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/ok.jpg'
    )
  })
})
