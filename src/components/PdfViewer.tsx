import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { invoke } from '@/utils/tauri'

// pdfjs-dist UMD worker
import * as pdfjsLib from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

interface PdfViewerProps {
  pdfPath: string
  title: string
}

export default function PdfViewer({ pdfPath, title }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, num: number, s: number) => {
    // Cancel any previous render to avoid "Cannot use the same canvas" error
    if (renderTaskRef.current) {
      try { await renderTaskRef.current.cancel(); } catch {}
      renderTaskRef.current = null
    }
    try {
      const page = await doc.getPage(num)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const viewport = page.getViewport({ scale: s })
      canvas.height = viewport.height
      canvas.width = viewport.width
      // Reset canvas state before each render
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const task = page.render({ canvasContext: ctx, viewport, canvas } as any)
      renderTaskRef.current = task
      await task.promise
    } catch (e: any) {
      if (e?.message?.includes('Rendering cancelled')) return
      setError(e?.message || '渲染失败')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const hex = await invoke<string>('read_local_file', { path: pdfPath })
        const bytes = new Uint8Array(hex.length / 2)
        for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise
        setPdf(doc)
        setTotalPages(doc.numPages)
        setLoading(false)
        await renderPage(doc, 1, scale)
      } catch (e: any) {
        setError(e?.message || '加载 PDF 失败')
        setLoading(false)
      }
    })()
  }, [pdfPath])

  useEffect(() => {
    if (pdf) renderPage(pdf, pageNum, scale)
  }, [pageNum, scale, pdf, renderPage])

  const changePage = (delta: number) => {
    const next = Math.min(Math.max(1, pageNum + delta), totalPages)
    setPageNum(next)
  }

  return (
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-950">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 text-white text-sm">
        <div className="flex-1 truncate text-xs">{title}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => changePage(-1)} disabled={pageNum <= 1} className="p-1 hover:bg-slate-700 rounded disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-300">{pageNum} / {totalPages}</span>
          <button onClick={() => changePage(1)} disabled={pageNum >= totalPages} className="p-1 hover:bg-slate-700 rounded disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="p-1 hover:bg-slate-700 rounded"><ZoomOut className="w-4 h-4" /></button>
          <span className="text-xs text-slate-300">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="p-1 hover:bg-slate-700 rounded"><ZoomIn className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
        {loading && <Loader2 className="w-8 h-8 animate-spin text-slate-400 mt-20" />}
        {error && <div className="text-red-400 mt-20">{error}</div>}
        <canvas ref={canvasRef} className="bg-white rounded shadow-lg" />
      </div>
    </div>
  )
}
