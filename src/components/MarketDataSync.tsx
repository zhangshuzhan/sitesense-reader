import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Loader2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { syncMarketData } from '@/services/runtime'
import type { MarketDataCheck } from '@/types'

export default function MarketDataSync() {
  const { t } = useTranslation()
  const [check, setCheck] = useState<MarketDataCheck | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const result = await syncMarketData()
      setCheck(result)
    } catch (e: any) {
      setError(e?.message || '行情同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const statusColor = !check ? 'text-slate-400' : check.success ? 'text-emerald-500' : 'text-amber-500'
  const StatusIcon = !check ? RefreshCw : check.success ? CheckCircle2 : AlertTriangle

  return (
    <div className="p-3 space-y-2">
      <button
        onClick={() => void handleSync()}
        disabled={syncing}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 text-sm font-medium transition-colors"
      >
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
        {syncing ? t('marketData.syncing') : t('marketData.sync')}
      </button>

      {check && (
        <div className="text-xs space-y-1 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
          <div className="flex items-center gap-1.5">
            <StatusIcon className={`w-3.5 h-3.5 ${statusColor}`} />
            <span className="text-slate-600 dark:text-slate-300">
              {check.latestDate} · {check.stockCount} 只
              {check.success ? ' ✅' : ' ⚠️'}
            </span>
          </div>

          {!check.countOk && <div className="text-amber-600">⚠ {t('marketData.countIssue')}</div>}
          {!check.nullCheckOk && <div className="text-amber-600">⚠ {t('marketData.nullIssue')}</div>}
          {!check.anomalyOk && <div className="text-amber-600">⚠ {t('marketData.anomaly')}</div>}

          {check.spotChecks.length > 0 && (
            <div className="text-slate-500 dark:text-slate-400">
              {check.spotChecks.map((s) => (
                <div key={s.code} className="flex justify-between">
                  <span>{s.name}</span>
                  <span className={s.changePct >= 0 ? 'text-red-500' : 'text-green-500'}>
                    {s.price.toFixed(2)} ({s.changePct > 0 ? '+' : ''}{s.changePct.toFixed(2)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-xs text-red-500">{error}</div>}
    </div>
  )
}
