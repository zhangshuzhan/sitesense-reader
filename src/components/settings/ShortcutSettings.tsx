import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'

export default function ShortcutSettings() {
  const { t } = useTranslation()
  const { shortcuts, shortcutsEnabled, setShortcutsEnabled, setShortcut, resetShortcuts } = useSettingsStore()
  const getShortcutList = (t: any) => [
    { key: 'next', label: t('shortcutSettings.nextArticle') },
    { key: 'prev', label: t('shortcutSettings.prevArticle') },
    { key: 'toggleRead', label: t('shortcutSettings.toggleRead') },
    { key: 'toggleStar', label: t('shortcutSettings.toggleStar') },
    { key: 'openOriginal', label: t('shortcutSettings.openOriginal') },
    { key: 'search', label: t('shortcutSettings.search') + ' (⌘/Ctrl +)' },
    { key: 'settings', label: t('shortcutSettings.openSettings') + ' (⌘/Ctrl +)' },
    { key: 'goHome', label: t('shortcutSettings.goHome') },
    { key: 'goStarred', label: t('shortcutSettings.goStarred') },
    { key: 'goFavorites', label: t('shortcutSettings.goFavorites') },
  ] as const

  const shortcutList = getShortcutList(t)

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('shortcutSettings.title')}</h2>
        <button
          onClick={resetShortcuts}
          className="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer"
        >
          {t('shortcutSettings.resetDefaults')}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <span className="font-medium text-slate-900 dark:text-white">
              {t('shortcutSettings.enableShortcuts')}
            </span>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('shortcutSettings.enableShortcutsDesc')}
            </p>
          </div>
          <div className="relative inline-flex items-center">
            <input
              type="checkbox"
              checked={shortcutsEnabled}
              onChange={(e) => setShortcutsEnabled(e.target.checked)}
              className="sr-only peer"
              aria-label={t('shortcutSettings.enableShortcuts')}
            />
            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
          </div>
        </label>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
          {shortcutList.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between p-4">
              <span className="text-slate-700 dark:text-slate-300">{label}</span>
              <div className="relative group">
                <input
                  type="text"
                  value={shortcuts[key] || ''}
                  readOnly
                  onClick={(e) => {
                    const target = e.target as HTMLInputElement
                    target.select()

                    const handleKeyDown = (event: KeyboardEvent) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const newKey = event.key.length === 1 ? event.key.toLowerCase() : event.key
                      setShortcut(key, newKey)
                      target.blur()
                      window.removeEventListener('keydown', handleKeyDown)
                    }
                    window.addEventListener('keydown', handleKeyDown)
                    target.addEventListener('blur', () => {
                      window.removeEventListener('keydown', handleKeyDown)
                    })
                  }}
                  className="w-20 text-center px-3 py-1.5 bg-slate-100 dark:bg-slate-700 border border-transparent hover:border-slate-300 dark:hover:border-slate-600 rounded-lg text-sm font-mono text-slate-900 dark:text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                  <span className="bg-black/75 text-white text-xs px-2 py-1 rounded">{t('shortcutSettings.clickToModify')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
