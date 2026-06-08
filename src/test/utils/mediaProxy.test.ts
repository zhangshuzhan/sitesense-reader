import { describe, expect, it } from 'vitest'
import { shouldProxyMediaUrl } from '@/utils/mediaProxy'

describe('shouldProxyMediaUrl', () => {
  it('only proxies known hotlink image hosts', () => {
    expect(shouldProxyMediaUrl('https://mmbiz.qpic.cn/image.jpg')).toBe(true)
    expect(shouldProxyMediaUrl('//mmbiz.qlogo.cn/avatar.png')).toBe(true)

    expect(shouldProxyMediaUrl('https://example.com/image.jpg')).toBe(false)
    expect(shouldProxyMediaUrl('data:image/png;base64,abc')).toBe(false)
    expect(shouldProxyMediaUrl('not a url')).toBe(false)
  })
})
