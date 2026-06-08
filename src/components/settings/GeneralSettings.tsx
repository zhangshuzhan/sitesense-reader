import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Globe, Database, Languages } from 'lucide-react'
import OpmlManager from '@/components/OpmlManager'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import { useToastStore } from '@/stores/toastStore'
import { useFeedStore } from '@/stores/feedStore'
import { Feed } from '@/types'
import { invoke } from '@/utils/tauri'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

interface StorageInfo {
  dbSize: number
  articleCount: number
  mediaCacheSize: number
}

export default function GeneralSettings() {
  const [isDeleteArticlesConfirmOpen, setIsDeleteArticlesConfirmOpen] = useState(false)
  const [isClearMediaConfirmOpen, setIsClearMediaConfirmOpen] = useState(false)
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)

  const {
    language,
    setLanguage,
    rsshubDomain,
    setRsshubDomain,
    externalLinkBehavior,
    setExternalLinkBehavior,
    autoMarkRead,
    setAutoMarkRead,
    autoCleanup,
    setAutoCleanup,
    mediaCache,
    setMediaCache,
    autoUpdate,
    setAutoUpdate,
    updateInterval,
    setUpdateInterval
  } = useSettingsStore()

  const { t } = useTranslation()

  const { addToast } = useToastStore()
  const setFeeds = useFeedStore(state => state.setFeeds)
  const [localRsshubDomain, setLocalRsshubDomain] = useState(rsshubDomain)
  const [localAutoCleanupDays, setLocalAutoCleanupDays] = useState(String(autoCleanup.maxRetentionDays))

  useEffect(() => {
    fetchStorageInfo()
  }, [])

  useEffect(() => {
    setLocalAutoCleanupDays(String(autoCleanup.maxRetentionDays))
  }, [autoCleanup.maxRetentionDays])

  const fetchStorageInfo = async () => {
    try {
      const info = await invoke<StorageInfo>('get_storage_info')
      setStorageInfo(info)
    } catch (error) {
      console.error('Failed to fetch storage info:', error)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleRsshubDomainSave = () => {
    let domain = localRsshubDomain.trim()
    if (!domain) {
      domain = 'https://rsshub.app'
    }
    if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
      domain = 'https://' + domain
    }
    if (domain.endsWith('/')) {
      domain = domain.slice(0, -1)
    }

    if (domain !== rsshubDomain) {
      setLocalRsshubDomain(domain)
      setRsshubDomain(domain)
      addToast({ message: t('generalSettings.rsshubUpdated'), type: 'success' })
    } else {
      setLocalRsshubDomain(domain)
    }
  }

  const handleExportData = async () => {
    try {
      const data = await invoke<string>('export_data', { format: 'json' })

      const filePath = await save({
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        defaultPath: 'rss-backup.json'
      })

      if (filePath) {
        await writeTextFile(filePath, data)
        addToast({ message: t('generalSettings.exportSuccess'), type: 'success' })
      }
    } catch (error) {
      console.error('Export failed:', error)
      addToast({ message: t('generalSettings.exportFailed') + ': ' + String(error), type: 'error' })
    }
  }


  const handleCleanArticles = async () => {
    setIsDeleteArticlesConfirmOpen(true)
  }

  const handleCleanArticlesConfirm = async () => {
    setIsDeleteArticlesConfirmOpen(false)

    try {
      await invoke('clean_all_articles', { exceptStarred: autoCleanup.exceptStarred })

      try {
        const feeds = await invoke<Feed[]>('get_feeds')
        setFeeds(feeds)
      } catch (error) {
        console.error('Failed to refresh feeds after cleaning articles:', error)
      }

      addToast({ message: t('generalSettings.articlesCleared'), type: 'success' })
      fetchStorageInfo()
    } catch (error) {
      console.error('Clean articles failed:', error)
      addToast({ message: t('generalSettings.clearArticlesFailed') + ': ' + String(error), type: 'error' })
    }
  }

  const handleCleanMediaCache = () => {
    setIsClearMediaConfirmOpen(true)
  }

  const handleCleanMediaCacheConfirm = async () => {
    setIsClearMediaConfirmOpen(false)

    try {
      await invoke('clean_media_cache', { days: 0 })
      addToast({ message: t('generalSettings.mediaCacheCleared'), type: 'success' })
      fetchStorageInfo()
    } catch (error) {
      console.error('Clean media cache failed:', error)
      addToast({ message: t('generalSettings.clearMediaCacheFailed') + ': ' + String(error), type: 'error' })
    }
  }

  return (
    <>
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
        {/* Language Settings */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700/50">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Languages className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('generalSettings.language')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.languageDesc')}</p>
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.language')}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.languageDesc')}</p>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-700 border-0 rounded-lg text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-primary-500/50 cursor-pointer"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ar">العربية</option>
                <option value="fr">Français</option>
                <option value="ru">Русский</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
        </section>

        {/* Update Settings */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700/50">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('generalSettings.title')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.subtitle')}</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.autoMarkRead')}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.autoMarkReadDesc')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoMarkRead}
                  onChange={(e) => setAutoMarkRead(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
              </label>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.autoUpdate')}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.autoUpdateDesc2')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoUpdate}
                    onChange={(e) => setAutoUpdate(e.target.checked)}
                    className="sr-only peer"
                    aria-label={t('generalSettings.autoUpdate')}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.updateInterval')}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.updateIntervalDesc')}</p>
              </div>
              <select
                value={updateInterval}
                onChange={(e) => setUpdateInterval(Number(e.target.value))}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-700 border-0 rounded-lg text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-primary-500/50 cursor-pointer"
                aria-label={t('generalSettings.updateInterval')}
              >
                <option value={5}>{t('generalSettings.5min')}</option>
                <option value={15}>{t('generalSettings.15min')}</option>
                <option value={30}>{t('generalSettings.30min')}</option>
                <option value={60}>{t('generalSettings.1hour')}</option>
                <option value={120}>{t('generalSettings.2hour')}</option>
                <option value={240}>{t('generalSettings.4hour')}</option>
                <option value={720}>{t('generalSettings.12hour')}</option>
                <option value={1440}>{t('generalSettings.24hour')}</option>
              </select>
            </div>
          </div>
        </section>

        {/* Network Settings */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700/50">
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Globe className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('generalSettings.network')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.networkDesc')}</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="rsshub-domain" className="font-medium text-slate-700 dark:text-slate-300">
                  {t('generalSettings.rsshubDomain')}
                </label>
                <button
                  onClick={() => {
                    setLocalRsshubDomain('https://rsshub.app')
                    setRsshubDomain('https://rsshub.app')
                    addToast({ message: t('generalSettings.resetDefault'), type: 'success' })
                  }}
                  className="text-xs text-primary-500 hover:text-primary-600 font-medium cursor-pointer"
                >
                  {t('generalSettings.rsshubReset')}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  id="rsshub-domain"
                  type="text"
                  value={localRsshubDomain}
                  onChange={(e) => setLocalRsshubDomain(e.target.value)}
                  onBlur={handleRsshubDomainSave}
                  placeholder="https://rsshub.app"
                  className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('generalSettings.rsshubDesc')}
              </p>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <label htmlFor="external-link-behavior" className="font-medium text-slate-700 dark:text-slate-300">
                {t('generalSettings.externalLinks')}
              </label>
              <div className="mt-2">
                <select
                  id="external-link-behavior"
                  value={externalLinkBehavior}
                  onChange={(e) => setExternalLinkBehavior(e.target.value as 'block' | 'confirm' | 'open')}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border-0 rounded-lg text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-primary-500/50 cursor-pointer"
                >
                  <option value="block">{t('generalSettings.blockDesc')}</option>
                  <option value="confirm">{t('generalSettings.confirmDesc')}</option>
                  <option value="open">{t('generalSettings.openDesc')}</option>
                </select>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('generalSettings.externalLinkDesc')}
              </p>
            </div>
          </div>
        </section>

        {/* Data Management */}
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700/50">
            <div className="w-10 h-10 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center">
              <Database className="w-5 h-5 text-accent-500" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('generalSettings.dataManagement')}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.dataManagementDesc')}</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
            {/* Storage Info */}
            {storageInfo && (
              <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <div className="text-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('generalSettings.databaseSize')}</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{formatBytes(storageInfo.dbSize)}</p>
                </div>
                <div className="text-center border-l border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('generalSettings.articleCount')}</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{storageInfo.articleCount}</p>
                </div>
                <div className="text-center border-l border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t('generalSettings.mediaCache')}</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{formatBytes(storageInfo.mediaCacheSize)}</p>
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.autoCleanup')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.autoCleanupDesc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCleanup.enabled}
                    onChange={(e) => setAutoCleanup({ enabled: e.target.checked })}
                    className="sr-only peer"
                    aria-label={t('generalSettings.autoCleanup')}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              </div>

              {autoCleanup.enabled && (
                <div className="pl-4 border-l-2 border-slate-100 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">{t('generalSettings.retentionDays')}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={localAutoCleanupDays}
                        onChange={(e) => {
                          setLocalAutoCleanupDays(e.target.value)
                          const value = parseInt(e.target.value)
                          if (Number.isFinite(value) && value >= 1) {
                            setAutoCleanup({ maxRetentionDays: value })
                          }
                        }}
                        onBlur={() => {
                          if (!localAutoCleanupDays) {
                            setLocalAutoCleanupDays(String(autoCleanup.maxRetentionDays))
                          }
                        }}
                        className="w-20 px-2 py-1 text-sm bg-slate-100 dark:bg-slate-700 border-0 rounded text-slate-900 dark:text-white focus:ring-1 focus:ring-primary-500"
                        aria-label={t('generalSettings.retentionDays')}
                      />
                      <span className="text-sm text-slate-500">{t('generalSettings.days')}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">{t('generalSettings.keepStarred')}</span>
                    <input
                      type="checkbox"
                      checked={autoCleanup.exceptStarred}
                      onChange={(e) => setAutoCleanup({ exceptStarred: e.target.checked })}
                      className="w-4 h-4 text-primary-500 rounded border-slate-300 focus:ring-primary-500"
                      aria-label={t('generalSettings.keepStarred')}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.mediaCacheManagement')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.mediaCacheManagementDesc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mediaCache.enabled}
                    onChange={(e) => setMediaCache({ enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              </div>

              {mediaCache.enabled && (
                <div className="pl-4 border-l-2 border-slate-100 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">{t('generalSettings.retentionDays')}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={mediaCache.maxRetentionDays}
                        onChange={(e) => setMediaCache({ maxRetentionDays: parseInt(e.target.value) || 30 })}
                        className="w-20 px-2 py-1 text-sm bg-slate-100 dark:bg-slate-700 border-0 rounded text-slate-900 dark:text-white focus:ring-1 focus:ring-primary-500"
                      />
                      <span className="text-sm text-slate-500">{t('generalSettings.days')}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">{t('generalSettings.maxCacheSize')}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="10"
                        value={mediaCache.maxCacheSizeMB}
                        onChange={(e) => setMediaCache({ maxCacheSizeMB: parseInt(e.target.value) || 500 })}
                        className="w-20 px-2 py-1 text-sm bg-slate-100 dark:bg-slate-700 border-0 rounded text-slate-900 dark:text-white focus:ring-1 focus:ring-primary-500"
                      />
                      <span className="text-sm text-slate-500">MB</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.opmlImportExport')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.opmlDesc')}</p>
                </div>
                <OpmlManager />
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{t('generalSettings.exportData')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.exportDataDesc')}</p>
                </div>
                <button
                  onClick={handleExportData}
                  className="px-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                >
                  {t('generalSettings.exportJson')}
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <p className="font-medium text-slate-700 dark:text-slate-300 mb-2">{t('generalSettings.clearData')}</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.clearAllMediaCache')}</span>
                  <button
                    onClick={handleCleanMediaCache}
                    className="px-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                  >
                    {t('generalSettings.clearMedia')}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-500 dark:text-slate-400">{t('generalSettings.clearAllArticles')}</span>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t('generalSettings.clearArticlesHint')}</p>
                  </div>
                  <button
                    onClick={handleCleanArticles}
                    className="px-4 py-2 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
                  >
                    {t('generalSettings.clearArticles')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={isDeleteArticlesConfirmOpen}
        onClose={() => setIsDeleteArticlesConfirmOpen(false)}
        onConfirm={handleCleanArticlesConfirm}
        title={t('generalSettings.clearArticlesTitle')}
        message={t('generalSettings.clearArticlesConfirm')}
        confirmText={t('generalSettings.clear')}
        cancelText={t('common.cancel')}
        confirmVariant="destructive"
      />

      <ConfirmDialog
        isOpen={isClearMediaConfirmOpen}
        onClose={() => setIsClearMediaConfirmOpen(false)}
        onConfirm={handleCleanMediaCacheConfirm}
        title={t('generalSettings.clearMediaTitle')}
        message={t('generalSettings.clearMediaConfirm')}
        confirmText={t('generalSettings.clear')}
        cancelText={t('common.cancel')}
        confirmVariant="destructive"
      />
    </>
  )
}
