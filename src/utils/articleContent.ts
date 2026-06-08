export interface TocItem {
  id: string
  text: string
  level: number
}

type RendererDeps = {
  marked: typeof import('marked').marked
  DOMPurify: typeof import('dompurify').default
}

type RenderedArticleContent = {
  html: string
  toc: TocItem[]
}

const MARKDOWN_HINT_RE =
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~|\|.+\|)|\[[^\]]+\]\([^)]+\)/m
const HTML_RE = /<\/?[a-z][\s\S]*>/i
const MAX_CACHE_ENTRIES = 48

const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'details', 'div',
  'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'iframe', 'img', 'li', 'mark', 'ol', 'p', 'pre', 's', 'section', 'small', 'span',
  'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]

const ALLOWED_ATTR = [
  'align', 'allow', 'allowfullscreen', 'alt', 'class', 'colspan', 'data-src', 'height', 'href',
  'id', 'loading', 'rel', 'rowspan', 'scrolling', 'src', 'target', 'title', 'width',
]

const ALLOWED_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'player.bilibili.com',
  'www.bilibili.com',
  'bilibili.com',
])

const renderCache = new Map<string, RenderedArticleContent>()
let rendererDepsPromise: Promise<RendererDeps> | null = null

function getCacheKey(content: string, explicitKey?: string): string {
  return explicitKey && explicitKey.trim() ? explicitKey : content
}

function setRenderCache(key: string, value: RenderedArticleContent) {
  if (renderCache.has(key)) {
    renderCache.delete(key)
  }

  renderCache.set(key, value)

  if (renderCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = renderCache.keys().next().value
    if (oldestKey) {
      renderCache.delete(oldestKey)
    }
  }
}

async function loadRendererDeps(): Promise<RendererDeps> {
  if (!rendererDepsPromise) {
    rendererDepsPromise = Promise.all([import('marked'), import('dompurify')]).then(
      ([markedModule, domPurifyModule]) => ({
        marked: markedModule.marked,
        DOMPurify: domPurifyModule.default,
      })
    )
  }

  return rendererDepsPromise
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function detectContentFormat(content: string): 'html' | 'markdown' | 'text' {
  if (!content.trim()) return 'text'
  if (HTML_RE.test(content)) return 'html'
  if (MARKDOWN_HINT_RE.test(content)) return 'markdown'
  return 'text'
}

async function normalizeToHtml(content: string, deps: RendererDeps): Promise<string> {
  const format = detectContentFormat(content)
  if (format === 'html') return content
  if (format === 'markdown') {
    return deps.marked.parse(content, {
      async: false,
      breaks: true,
      gfm: true,
    }) as string
  }
  return `<p>${escapeHtml(content)}</p>`
}

function isAllowedIframeSrc(src: string): boolean {
  if (!src) return false
  try {
    const normalized = src.startsWith('//') ? `https:${src}` : src
    const url = new URL(normalized, 'https://localhost')
    return ALLOWED_IFRAME_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function sanitizeHtml(html: string, deps: RendererDeps): string {
  const purified = deps.DOMPurify.sanitize(html, {
    ALLOWED_ATTR,
    ALLOWED_TAGS,
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['script', 'style'],
  }) as string

  const parser = new DOMParser()
  const doc = parser.parseFromString(purified, 'text/html')

  doc.querySelectorAll('iframe').forEach((iframe) => {
    const src = iframe.getAttribute('src') || ''
    if (!isAllowedIframeSrc(src)) {
      iframe.remove()
      return
    }

    iframe.setAttribute('loading', 'lazy')
    if (!iframe.getAttribute('title')) {
      iframe.setAttribute('title', 'Embedded content')
    }
  })

  doc.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  return doc.body.innerHTML
}

function addHeadingIds(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')

  headings.forEach((heading, index) => {
    heading.id = `heading-${index}`
  })

  return doc.body.innerHTML
}

export function extractTocFromHtml(html: string): TocItem[] {
  if (!html.trim()) return []

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')

  return Array.from(headings).map((heading) => ({
    id: heading.id,
    text: heading.textContent || '',
    level: Number.parseInt(heading.tagName.charAt(1), 10),
  }))
}

export async function buildRenderableHtml(content: string): Promise<string> {
  const rendered = await renderArticleContent(content)
  return rendered.html
}

export async function renderArticleContent(
  content: string,
  explicitCacheKey?: string
): Promise<RenderedArticleContent> {
  if (!content.trim()) {
    return { html: '', toc: [] }
  }

  const cacheKey = getCacheKey(content, explicitCacheKey)
  const cached = renderCache.get(cacheKey)
  if (cached) {
    renderCache.delete(cacheKey)
    renderCache.set(cacheKey, cached)
    return cached
  }

  const deps = await loadRendererDeps()
  const html = await normalizeToHtml(content, deps)
  const renderedHtml = addHeadingIds(sanitizeHtml(html, deps))
  const rendered = {
    html: renderedHtml,
    toc: extractTocFromHtml(renderedHtml),
  }

  setRenderCache(cacheKey, rendered)
  return rendered
}
