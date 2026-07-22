import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import { shallow } from 'zustand/shallow'

import { useSettingsStore } from '@/stores/settingsStore'
import {
  getWindowRestoreContext,
  processNewArticles,
  refreshFeeds,
  runAiQueueForeground,
  syncRuntimeSettings,
  syncWindowContext,
} from '@/services/runtime'
import { isTauriEnv, invoke } from '@/utils/tauri'
import { toast } from '@/stores/toastStore'

type FeedRefreshPayload = {
  newArticleIds?: number[]
  updatedArticleIds?: number[]
  deletedArticleCount?: number
  feedsChanged?: boolean
}

function getRestorableRoute(route: string | null | undefined) {
  const value = route?.trim()
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null

  const pathname = value.split(/[?#]/, 1)[0]
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return null

  return value
}

export default function AppRuntimeBridge() {
  const location = useLocation()
  const navigate = useNavigate()
  const initialRouteRef = useRef<string | null>(null)
  const latestRouteRef = useRef<string | null>(null)
  const routeChangedSinceInitialRef = useRef(false)
  const [restoreReady, setRestoreReady] = useState(false)

  const runtimeSettings = useSettingsStore(
    (state) => ({
      autoUpdate: state.autoUpdate,
      updateInterval: state.updateInterval,
      rsshubDomain: state.rsshubDomain,
      autoCleanupEnabled: state.autoCleanup.enabled,
      autoCleanupDays: state.autoCleanup.maxRetentionDays,
      autoCleanupExceptStarred: state.autoCleanup.exceptStarred,
      mediaCacheEnabled: state.mediaCache.enabled,
      mediaCacheDays: state.mediaCache.maxRetentionDays,
      mediaCacheMaxSizeMB: state.mediaCache.maxCacheSizeMB,
    }),
    shallow
  )

  const route = useMemo(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search]
  )

  if (initialRouteRef.current === null) {
    initialRouteRef.current = route
  } else if (route !== initialRouteRef.current) {
    routeChangedSinceInitialRef.current = true
  }
  latestRouteRef.current = route

  useEffect(() => {
    if (!isTauriEnv) {
      setRestoreReady(true)
      return
    }

    let cancelled = false
    const initialRoute = initialRouteRef.current ?? '/'

    void (async () => {
      try {
        const context = await getWindowRestoreContext()
        const lastRoute = getRestorableRoute(context.lastRoute)

        if (
          !cancelled &&
          lastRoute &&
          lastRoute !== initialRoute &&
          initialRoute === '/' &&
          !routeChangedSinceInitialRef.current &&
          latestRouteRef.current === initialRoute
        ) {
          navigate(lastRoute, { replace: true })
        }
      } catch (error) {
        console.error('Failed to restore window route:', error)
      } finally {
        if (!cancelled) {
          setRestoreReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    if (!isTauriEnv) return

    syncRuntimeSettings().catch((error) => {
      console.error('Failed to sync runtime settings:', error)
    })
  }, [runtimeSettings])

  useEffect(() => {
    if (!isTauriEnv || !restoreReady) return
    const restorableRoute = getRestorableRoute(route)
    if (!restorableRoute) return

    syncWindowContext(restorableRoute).catch((error) => {
      console.error('Failed to sync window context:', error)
    })
  }, [restoreReady, route])

  useEffect(() => {
    if (!isTauriEnv) return

    void runAiQueueForeground()

    let disposed = false
    let unlisten: (() => void) | null = null

    void listen<FeedRefreshPayload>('app-runtime://feeds-updated', (event) => {
      if (disposed) return
      const articleIds = Array.isArray(event.payload?.newArticleIds)
        ? event.payload.newArticleIds
        : []

      void (async () => {
        try {
          await refreshFeeds()
        } catch (error) {
          console.error('Failed to refresh feeds after runtime update:', error)
        }

        if (disposed) return
        window.dispatchEvent(new CustomEvent('feeds-updated'))
        if (articleIds.length > 0) {
          void processNewArticles(articleIds)
        }
      })()
    })
      .then((cleanup) => {
        unlisten = cleanup
      })
      .catch((error) => {
        console.error('Failed to listen for runtime updates:', error)
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  // Startup: check if market data needs syncing
  useEffect(() => {
    if (!isTauriEnv) return
    void (async () => {
      try {
        const hint = await invoke<string | null>('check_market_status')
        if (hint) toast.info(hint)
      } catch { /* ignore */ }
    })()
  }, [])

  return null
}
