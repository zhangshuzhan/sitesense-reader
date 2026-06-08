const PROXY_IMAGE_HOSTS = new Set([
  'mmbiz.qpic.cn',
  'mmbiz.qlogo.cn',
])

export function shouldProxyMediaUrl(rawUrl: string): boolean {
  try {
    const normalizedUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    const url = new URL(normalizedUrl)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    return PROXY_IMAGE_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}
