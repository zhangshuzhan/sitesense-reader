import { describe, expect, it } from 'vitest'
import {
  buildRenderableHtml,
  detectContentFormat,
  extractTocFromHtml,
} from '@/utils/articleContent'

describe('articleContent pipeline', () => {
  it('detects markdown content', () => {
    expect(detectContentFormat('# Heading\n\n- item')).toBe('markdown')
  })

  it('detects html content', () => {
    expect(detectContentFormat('<p>Hello</p>')).toBe('html')
  })

  it('builds sanitized html from markdown with heading ids', async () => {
    const html = await buildRenderableHtml('# Hello\n\n- A\n- B')

    expect(html).toContain('<h1 id="heading-0">Hello</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>A</li>')
  })

  it('removes unsafe script tags', async () => {
    const html = await buildRenderableHtml('<p>safe</p><script>alert(1)</script>')
    expect(html).toContain('<p>safe</p>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })

  it('keeps trusted iframe providers and removes untrusted iframe providers', async () => {
    const html = await buildRenderableHtml(
      '<iframe src="https://www.youtube.com/embed/abc"></iframe><iframe src="https://evil.example.com/embed/1"></iframe>'
    )

    expect(html).toContain('youtube.com/embed/abc')
    expect(html).not.toContain('evil.example.com')
  })

  it('escapes plain text content', async () => {
    const html = await buildRenderableHtml('1 < 2 && 3 > 1')
    expect(html).toContain('<p>')
    expect(html).toContain('&lt;')
    expect(html).toContain('&gt;')
  })

  it('adds safe attributes to links', async () => {
    const html = await buildRenderableHtml('<a href="https://example.com">example</a>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('extracts toc from rendered html', async () => {
    const html = await buildRenderableHtml('# A\n\n## B')
    expect(extractTocFromHtml(html)).toEqual([
      { id: 'heading-0', text: 'A', level: 1 },
      { id: 'heading-1', text: 'B', level: 2 },
    ])
  })
})
