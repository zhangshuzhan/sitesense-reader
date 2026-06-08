import { useEffect, useState, type ReactNode } from 'react'
import type { DOMNode, Element, HTMLReactParserOptions } from 'html-react-parser'

type HtmlParserModule = typeof import('html-react-parser')

let htmlParserPromise: Promise<HtmlParserModule> | null = null

export async function loadHtmlParser(): Promise<HtmlParserModule> {
  if (!htmlParserPromise) {
    htmlParserPromise = import('html-react-parser')
  }

  return htmlParserPromise
}

interface LazyHtmlContentProps {
  html: string
  parserOptions?: HTMLReactParserOptions
  placeholder?: ReactNode
}

export type HtmlParserTypes = {
  DOMNode: DOMNode
  Element: Element
}

export default function LazyHtmlContent({
  html,
  parserOptions,
  placeholder = null,
}: LazyHtmlContentProps) {
  const [parserModule, setParserModule] = useState<HtmlParserModule | null>(null)

  useEffect(() => {
    let cancelled = false

    void loadHtmlParser().then((module) => {
      if (!cancelled) {
        setParserModule(module)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!html.trim()) return null
  if (!parserModule) return <>{placeholder}</>

  return <>{parserModule.default(html, parserOptions)}</>
}
