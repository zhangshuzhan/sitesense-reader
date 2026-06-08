import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import VideoEmbed from '@/components/VideoEmbed'

describe('VideoEmbed', () => {
  it('does not create the youtube iframe until requested', () => {
    render(<VideoEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" type="youtube" />)

    expect(screen.queryByTitle('Embedded video')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '加载视频' }))

    const iframe = screen.getByTitle('Embedded video')
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(iframe).toHaveAttribute('loading', 'lazy')
  })

  it('falls back to open link when url cannot be embedded', () => {
    render(<VideoEmbed url="not-a-valid-url" type="youtube" />)

    expect(screen.getByText('视频加载失败，请打开原链接观看。')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '打开原视频' })
    expect(link).toHaveAttribute('href', 'not-a-valid-url')
  })

  it('renders bilibili embed url for valid bvid link', () => {
    render(<VideoEmbed url="https://www.bilibili.com/video/BV1xx411c7mD" type="bilibili" />)

    fireEvent.click(screen.getByRole('button', { name: '加载视频' }))

    const iframe = screen.getByTitle('Embedded video')
    expect(iframe).toHaveAttribute(
      'src',
      'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1&high_quality=1&danmaku=0'
    )
  })

  it('resets loaded state when the video url changes', () => {
    const { rerender } = render(
      <VideoEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" type="youtube" />
    )

    fireEvent.click(screen.getByRole('button', { name: '加载视频' }))
    expect(screen.getByTitle('Embedded video')).toBeInTheDocument()

    rerender(<VideoEmbed url="https://www.youtube.com/watch?v=abc123" type="youtube" />)

    expect(screen.queryByTitle('Embedded video')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加载视频' })).toBeInTheDocument()
  })
})
