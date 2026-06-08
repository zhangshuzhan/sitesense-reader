import { useEffect } from 'react'
import i18n from '@/i18n'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSettingsStore, defaultShortcuts } from '@/stores/settingsStore'

export function useGlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { shortcuts: config = defaultShortcuts, shortcutsEnabled } = useSettingsStore()

  useEffect(() => {
    if (!shortcutsEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = 
        document.activeElement?.tagName === 'INPUT' || 
        document.activeElement?.tagName === 'TEXTAREA'

      if (e.metaKey || e.ctrlKey) {
        if (e.key === config.search) {
          e.preventDefault()
          const searchInput = document.querySelector<HTMLInputElement>('#global-search')
          searchInput?.focus()
          return
        }
        if (e.key === config.settings) {
          e.preventDefault()
          navigate('/settings')
          return
        }
      }

      if (!isInputFocused) {
        if (e.key === config.goHome) {
          e.preventDefault()
          navigate('/')
          return
        }

        const isArticleView = location.pathname.includes('/article/')

        if (e.key === config.toggleStar) { // 's'
          if (!isArticleView) {
            e.preventDefault()
            navigate('/starred')
          }
          return
        }

        if (e.key === config.goFavorites) {
          e.preventDefault()
          navigate('/favorites')
          return
        }

        if (e.key === '?') {
          e.preventDefault()
          alert(`
${i18n.t('shortcutsHelp.title')}
⌘/Ctrl + ${config.search.toUpperCase()} - ${i18n.t('shortcutsHelp.focusSearch')}
⌘/Ctrl + ${config.settings} - ${i18n.t('shortcutsHelp.openSettings')}
${config.goHome.toUpperCase()} - ${i18n.t('shortcutsHelp.home')}
${config.toggleStar.toUpperCase()} - ${i18n.t('shortcutsHelp.starredOrToggle')}
${config.goFavorites.toUpperCase()} - ${i18n.t('shortcutsHelp.favorites')}
? - ${i18n.t('shortcutsHelp.showHelp')}
Esc - ${i18n.t('shortcutsHelp.cancelFocus')}
          `)
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate, location.pathname, config, shortcutsEnabled])
}
