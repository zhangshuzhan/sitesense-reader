import { invoke, isTauriEnv } from '@/utils/tauri'
import { useAiTaskUiStore } from '@/stores/aiTaskUiStore'
import { useFeedStore } from '@/stores/feedStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { AIProfile, Article, EastmoneyReport, Feed, FinancialInsight, MarketDataCheck, WordPressProbe } from '@/types'
import type { AiTask } from '@/types/rule'

type RuntimeSettingsPayload = {
  autoUpdate: boolean
  updateInterval: number
  rsshubDomain: string | null
  autoCleanupEnabled: boolean
  autoCleanupDays: number
  autoCleanupExceptStarred: boolean
  mediaCacheEnabled: boolean
  mediaCacheDays: number
  mediaCacheMaxSizeMb: number | null
}

type WindowRestoreContext = {
  lastRoute?: string | null
}

type FeedRefreshResponse = {
  newArticleIds: number[]
  newArticleCount: number
  updatedArticleIds?: number[]
  updatedArticleCount?: number
  feedsChanged?: boolean
}

type AiProfilePayload = {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  model: string
  provider: 'openai' | 'anthropic'
  prompt: string
}

type AiQueueTaskResult = {
  id: string
  articleId: number
  ruleId: string
  taskType: string
  status: 'done' | 'failed'
  errorMsg?: string | null
}

type AiQueueRunResult = {
  processed: number
  failed: number
  taskResults: AiQueueTaskResult[]
}

let aiQueuePromise: Promise<void> | null = null

function toProfilePayload(profile: AIProfile): AiProfilePayload {
  return {
    id: profile.id,
    name: profile.name,
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    model: profile.model,
    provider: profile.provider,
    prompt: profile.prompt,
  }
}

function getRuntimeSettings(): RuntimeSettingsPayload {
  const settings = useSettingsStore.getState()

  return {
    autoUpdate: settings.autoUpdate,
    updateInterval: settings.updateInterval,
    rsshubDomain: settings.rsshubDomain || null,
    autoCleanupEnabled: settings.autoCleanup.enabled,
    autoCleanupDays: settings.autoCleanup.maxRetentionDays,
    autoCleanupExceptStarred: settings.autoCleanup.exceptStarred,
    mediaCacheEnabled: settings.mediaCache.enabled,
    mediaCacheDays: settings.mediaCache.maxRetentionDays,
    mediaCacheMaxSizeMb: settings.mediaCache.maxCacheSizeMB ?? null,
  }
}

function getUsableProfiles(): AiProfilePayload[] {
  return useSettingsStore
    .getState()
    .aiProfiles
    .filter((profile) => Boolean(profile.apiKey?.trim()))
    .map(toProfilePayload)
}

function getAiTaskKey(task: AiTask): string {
  return task.taskType === 'action_score'
    ? `rule:score:${task.ruleId}`
    : `rule:condition:${task.ruleId}`
}

export async function refreshFeeds() {
  const feeds = await invoke<any[]>('get_feeds')
  useFeedStore.getState().setFeeds(feeds)
}

export async function syncRuntimeSettings() {
  if (!isTauriEnv) return
  await invoke('sync_runtime_settings', { settings: getRuntimeSettings() })
}

export async function syncWindowContext(lastRoute: string) {
  if (!isTauriEnv) return
  await invoke('sync_window_context', { context: { lastRoute } })
}

export async function getWindowRestoreContext(): Promise<WindowRestoreContext> {
  if (!isTauriEnv) return {}
  return invoke<WindowRestoreContext>('get_window_restore_context')
}

export async function runFeedRefresh(): Promise<FeedRefreshResponse> {
  if (!isTauriEnv) {
    return { newArticleIds: [], newArticleCount: 0 }
  }

  const response = await invoke<FeedRefreshResponse>('run_feed_refresh')
  await refreshFeeds()
  if (
    response.newArticleCount > 0 ||
    (response.updatedArticleCount ?? 0) > 0 ||
    response.feedsChanged
  ) {
    window.dispatchEvent(new CustomEvent('feeds-updated'))
  }
  return response
}

export async function generateSummaryForArticle(articleId: number, profile: AIProfile): Promise<string> {
  return invoke<string>('generate_article_summary', {
    articleId,
    profile: toProfilePayload(profile),
  })
}

export async function translateContentWithProfile(
  content: string,
  profile: AIProfile,
  targetLanguage: string
): Promise<string> {
  return invoke<string>('translate_content', {
    content,
    profile: toProfilePayload(profile),
    targetLanguage,
  })
}

export async function batchGenerateSummary(
  articles: Article[],
  mode: 'one-shot' | 'separate',
  profile: AIProfile
): Promise<string | null> {
  return invoke<string | null>('batch_generate_summary', {
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      content: article.content ?? null,
      summary: article.summary ?? null,
    })),
    mode,
    profile: toProfilePayload(profile),
  })
}

export async function processNewArticles(articleIds: number[]) {
  const uniqueArticleIds = Array.from(new Set(articleIds.filter((id) => Number.isFinite(id))))
  if (uniqueArticleIds.length === 0) return

  const settings = useSettingsStore.getState()
  const summaryProfile = settings.aiProfiles.find(
    (profile) => profile.id === settings.featureMapping.summaryProfileId
  )

  if (settings.autoSummarizeNewArticles && summaryProfile?.apiKey) {
    const uiStore = useAiTaskUiStore.getState()

    for (const articleId of uniqueArticleIds) {
      uiStore.setProcessing(articleId, 'summary')
      try {
        await generateSummaryForArticle(articleId, summaryProfile)
        uiStore.clearTask(articleId, 'summary')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        uiStore.setFailed(articleId, 'summary', message)
      }
    }
  }

  await runAiQueueForeground()
}

// ---- SiteSense: WordPress dual-mode + financial interpretation ----

export async function fetchAndAddWordPress(
  base: string,
  category: string | null,
  token?: string
): Promise<{ feed: Feed; articles: Article[] }> {
  return invoke('fetch_and_add_wordpress', {
    base,
    category,
    token: token || null,
  })
}

export async function detectWordPress(base: string, token?: string): Promise<WordPressProbe> {
  return invoke('detect_wordpress', { base, token: token || null })
}

export async function generateFinancialInsight(
  articleId: number,
  profile: AIProfile
): Promise<FinancialInsight> {
  return invoke('generate_financial_insight', {
    articleId,
    profile: toProfilePayload(profile),
  })
}

export async function getArticleFinancialInsight(
  articleId: number
): Promise<FinancialInsight | null> {
  return invoke('get_article_financial_insight', { articleId })
}

export async function runAiQueueForeground() {
  if (!isTauriEnv) return
  if (aiQueuePromise) return aiQueuePromise

  aiQueuePromise = (async () => {
    const profiles = getUsableProfiles()
    if (profiles.length === 0) return

    const uiStore = useAiTaskUiStore.getState()
    const pendingTasks = await invoke<AiTask[]>('get_pending_ai_tasks', { limit: 50 })

    for (const task of pendingTasks) {
      uiStore.setPending(task.articleId, getAiTaskKey(task))
    }

    try {
      const result = await invoke<AiQueueRunResult>('run_ai_queue', { profiles })

      for (const taskResult of result.taskResults) {
        const key =
          taskResult.taskType === 'action_score'
            ? `rule:score:${taskResult.ruleId}`
            : `rule:condition:${taskResult.ruleId}`

        if (taskResult.status === 'done') {
          uiStore.clearTask(taskResult.articleId, key)
        } else {
          uiStore.setFailed(
            taskResult.articleId,
            key,
            taskResult.errorMsg || 'AI task failed'
          )
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const task of pendingTasks) {
        uiStore.setFailed(task.articleId, getAiTaskKey(task), message)
      }
    }
  })().finally(() => {
    aiQueuePromise = null
  })

  return aiQueuePromise
}

// ── Eastmoney research report commands (SiteSense) ──

export async function collectEastmoneyReports(): Promise<EastmoneyReport[]> {
  return invoke('collect_eastmoney_reports')
}

export async function getEastmoneyReports(
  category: string,
  limit?: number,
  offset?: number
): Promise<EastmoneyReport[]> {
  return invoke('get_eastmoney_reports', { category, limit: limit ?? 100, offset: offset ?? 0 })
}

export async function markEastmoneyReportRead(reportId: number): Promise<void> {
  return invoke('mark_eastmoney_report_read', { reportId })
}

export async function getEastmoneyLastDate(category: string): Promise<string | null> {
  return invoke('get_eastmoney_last_date', { category })
}

export async function downloadEastmoneyPdfs(): Promise<number> {
  return invoke('download_eastmoney_pdfs')
}

export async function downloadSelectedPdfs(reportIds: number[]): Promise<number> {
  return invoke('download_selected_pdfs', { reportIds })
}

// ── Market data sync ──
export async function syncMarketData(): Promise<MarketDataCheck> {
  return invoke('sync_market_data')
}
