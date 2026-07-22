import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { FileText, Loader2, RefreshCw, ExternalLink, Download } from 'lucide-react'
import { collectEastmoneyReports, getEastmoneyReports, markEastmoneyReportRead, downloadSelectedPdfs } from '@/services/runtime'
import { isTauriEnv } from '@/utils/tauri'
import { toast } from '@/stores/toastStore'
import type { EastmoneyReport } from '@/types'
import PdfViewer from './PdfViewer'

const CATEGORIES = [
  { key: 'stock', labelKey: 'eastmoney.stock' },
  { key: 'industry', labelKey: 'eastmoney.industry' },
  { key: 'macro', labelKey: 'eastmoney.macro' },
  { key: 'morning', labelKey: 'eastmoney.morning' },
] as const

type CategoryKey = (typeof CATEGORIES)[number]['key']

const DATE_RANGES = [
  { key: 'all', label: '全部' },
  { key: '1m', label: '近1个月' },
  { key: '3m', label: '近3个月' },
  { key: '6m', label: '近6个月' },
] as const

export default function EastmoneyReportsPanel() {
  const { t } = useTranslation()
  const { category } = useParams<{ category: string }>()
  const activeCat: CategoryKey = (CATEGORIES.find((c) => c.key === category)?.key || 'stock') as CategoryKey

  const [reports, setReports] = useState<EastmoneyReport[]>([])
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [downloadingPdfs, setDownloadingPdfs] = useState(false)
  const [hasData, setHasData] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [dateRange, setDateRange] = useState<string>('all')
  const [viewingPdf, setViewingPdf] = useState<{ path: string; title: string } | null>(null)

  const loadCategory = useCallback(async (cat: CategoryKey) => {
    setLoading(true)
    try {
      const items = await getEastmoneyReports(cat, 200, 0)
      setReports(items)
      if (items.length > 0) setHasData(true)
    } catch {
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCategory(activeCat)
    setSelectedIds(new Set())
  }, [activeCat, loadCategory])

  const handleCollect = async () => {
    setCollecting(true)
    try {
      const newItems = await collectEastmoneyReports()
      setHasData(true)
      const items = await getEastmoneyReports(activeCat, 200, 0)
      setReports(items)
      if (newItems.length > 0) {
        toast.success(`${t('eastmoney.collected')} ${newItems.length} ${t('eastmoney.items')}`)
      } else {
        toast.success(t('eastmoney.upToDate'))
      }
    } catch (e: any) {
      toast.error(e?.message || t('eastmoney.collectFailed'))
    } finally {
      setCollecting(false)
    }
  }

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) {
      toast.warning('请先勾选要下载的研报')
      return
    }
    setDownloadingPdfs(true)
    try {
      const count = await downloadSelectedPdfs(Array.from(selectedIds))
      if (count > 0) {
        toast.success(`${count} 篇 PDF 已下载`)
        const items = await getEastmoneyReports(activeCat, 200, 0)
        setReports(items)
      } else {
        toast.success('所选研报 PDF 均已下载')
      }
    } catch (e: any) {
      toast.error(e?.message || 'PDF 下载失败')
    } finally {
      setDownloadingPdfs(false)
    }
  }

  const handleRead = async (id: number) => {
    try {
      await markEastmoneyReportRead(id)
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, isRead: true } : r)))
    } catch {}
  }

  const handleOpenReport = (report: EastmoneyReport) => {
    if (isTauriEnv && report.pdfPath) {
      setViewingPdf({ path: report.pdfPath, title: report.title })
    } else {
      window.open(`https://data.eastmoney.com/report/info/${report.infoCode}.html`, '_blank')
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filteredReports = dateRange === 'all' ? reports : reports.filter((r) => {
    const pub = r.publishDate?.slice(0, 10) || ''
    const months = { '1m': 1, '3m': 3, '6m': 6 }[dateRange] || 0
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    return pub >= cutoff.toISOString().slice(0, 10)
  })

  const allSelected = filteredReports.length > 0 && selectedIds.size === filteredReports.length
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredReports.map((r) => r.id)))
    }
  }

  const catLabel = t(CATEGORIES.find((c) => c.key === activeCat)?.labelKey || 'eastmoney.stock')

  // When a PDF is opened, show it inline (replacing the report list)
  if (viewingPdf) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewingPdf(null)}
              className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              ← 返回列表
            </button>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate max-w-md">{viewingPdf.title}</h2>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <PdfViewer
            pdfPath={viewingPdf.path}
            title={viewingPdf.title}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{catLabel}</h2>
        <div className="flex items-center gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 border-none text-slate-700 dark:text-slate-300"
          >
            {DATE_RANGES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <button
            onClick={toggleSelectAll}
            className="px-2 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button
            onClick={() => void handleDownloadSelected()}
            disabled={downloadingPdfs || selectedIds.size === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {downloadingPdfs ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            PDF ({selectedIds.size})
          </button>
          <button
            onClick={() => void handleCollect()}
            disabled={collecting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            {collecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {collecting ? t('eastmoney.collecting') : t('eastmoney.refresh')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : !hasData && reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 gap-3">
            <FileText className="w-12 h-12" />
            <p className="text-sm">{t('eastmoney.clickToCollect')}</p>
            <button
              onClick={() => void handleCollect()}
              disabled={collecting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors text-sm"
            >
              {collecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {collecting ? t('eastmoney.collecting') : t('eastmoney.startCollect')}
            </button>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400 dark:text-slate-500 text-sm">
            {t('eastmoney.empty')}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredReports.map((report) => (
              <div
                key={report.id}
                className={`px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group ${
                  report.isRead ? 'opacity-60' : ''
                }`}
                onClick={() => {
                  handleRead(report.id)
                  handleOpenReport(report)
                }}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(report.id)}
                    onChange={(e) => {
                      e.stopPropagation()
                      toggleSelect(report.id)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1 min-w-0">
                    <h3
                      className={`text-sm leading-snug ${
                        report.isRead
                          ? 'text-slate-500 dark:text-slate-400'
                          : 'text-slate-900 dark:text-white font-medium'
                      }`}
                    >
                      {report.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                      <span>{report.orgSname}</span>
                      {report.stockName && (
                        <>
                          <span>·</span>
                          <span className="text-primary-500">{report.stockName}</span>
                          {report.stockCode && (
                            <span className="text-slate-400">{report.stockCode}</span>
                          )}
                        </>
                      )}
                      {report.industryName && (
                        <>
                          <span>·</span>
                          <span>{report.industryName}</span>
                        </>
                      )}
                      <span className="ml-auto">{report.publishDate?.slice(0, 10)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-1">
                    {report.pdfPath && (
                      <Download className="w-4 h-4 text-emerald-500" />
                    )}
                    <ExternalLink className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-primary-400 transition-colors" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
