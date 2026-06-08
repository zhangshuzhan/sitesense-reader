import { getVersion } from '@tauri-apps/api/app'
import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isTauriEnv } from '@/utils/tauri'

export default function AboutSettings() {
  const { t } = useTranslation()
  const [version, setVersion] = useState(__APP_VERSION__)

  useEffect(() => {
    if (!isTauriEnv) return

    getVersion()
      .then(setVersion)
      .catch((error: unknown) => {
        console.error('Failed to read app version:', error)
      })
  }, [])

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-700/50">
          <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Info className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">{t('aboutSettings.title')}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('aboutSettings.appInfo')}</p>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">{t('aboutSettings.version')}</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">{version}</span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700/50">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('aboutSettings.description')}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
