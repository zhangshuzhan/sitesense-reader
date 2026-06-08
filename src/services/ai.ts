import type { AIProfile, Article } from '@/types'
import { batchGenerateSummary, generateSummaryForArticle, translateContentWithProfile } from '@/services/runtime'

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 3)
}

export async function translateArticle(
  content: string,
  profile: AIProfile,
  targetLanguage = 'Chinese'
): Promise<string> {
  if (!profile.apiKey) {
    throw new Error('API key is missing')
  }

  const truncatedContent = content.length > 12000 ? content.slice(0, 12000) : content
  return translateContentWithProfile(truncatedContent, profile, targetLanguage)
}

export async function batchSummarize(
  articles: Article[],
  mode: 'one-shot' | 'separate',
  profile: AIProfile,
  onProgress?: (current: number, total: number) => void
): Promise<string | void> {
  if (!profile.apiKey) {
    throw new Error('API key is missing')
  }

  if (mode === 'separate') {
    let current = 0
    for (const article of articles) {
      current += 1
      onProgress?.(current, articles.length)
      await generateSummaryForArticle(article.id, profile)
    }
    return
  }

  const result = await batchGenerateSummary(articles, mode, profile)
  return result ?? undefined
}
