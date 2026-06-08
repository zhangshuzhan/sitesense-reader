import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
interface VideoEmbedProps {
  url: string
  type: 'youtube' | 'bilibili'
}

export default function VideoEmbed({ url, type }: VideoEmbedProps) {
  const { t } = useTranslation()
  const videoKey = `${type}:${url}`
  const [loadState, setLoadState] = useState({
    key: videoKey,
    isFailed: false,
    isLoaded: false,
  })

  useEffect(() => {
    setLoadState({
      key: videoKey,
      isFailed: false,
      isLoaded: false,
    })
  }, [videoKey])

  const embedUrl = useMemo(() => {
    try {
      if (type === 'youtube') {
        let videoId = ''
        if (url.includes('youtube.com/watch')) {
          videoId = new URL(url).searchParams.get('v') || ''
        } else if (url.includes('youtu.be/')) {
          videoId = url.split('youtu.be/')[1]?.split('?')[0] || ''
        } else if (url.includes('youtube.com/embed/')) {
          videoId = url.split('youtube.com/embed/')[1]?.split('?')[0] || ''
        }
        return videoId ? `https://www.youtube.com/embed/${videoId}` : ''
      }

      if (type === 'bilibili') {
        const match = url.match(/(BV[a-zA-Z0-9]+)/)
        if (match) {
          return `https://player.bilibili.com/player.html?bvid=${match[1]}&page=1&high_quality=1&danmaku=0`
        }
      }
    } catch (error) {
      console.error('Failed to resolve embed url:', error)
    }

    return ''
  }, [type, url])

  const isFailed = loadState.key === videoKey && loadState.isFailed
  const isLoaded = loadState.key === videoKey && loadState.isLoaded

  if (isFailed || !embedUrl) {
    return (
      <div className="my-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('videoEmbed.loadFailed')}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex mt-3 text-sm text-primary-600 dark:text-primary-400 hover:underline"
        >
          {t('videoEmbed.openOriginal')}
        </a>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="my-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('videoEmbed.clickToLoad')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setLoadState({ key: videoKey, isFailed: false, isLoaded: true })}
            className="inline-flex rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {t('videoEmbed.loadVideo')}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            {t('videoEmbed.openOriginal')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black my-6 aspect-video shadow-lg">
      <iframe
        src={embedUrl}
        className="absolute top-0 left-0 w-full h-full border-0"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
        loading="lazy"
        title="Embedded video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        onError={() => setLoadState({ key: videoKey, isFailed: true, isLoaded: true })}
        scrolling="no"
      />
    </div>
  )
}
