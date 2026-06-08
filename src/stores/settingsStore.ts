import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AIProfile, FeatureMapping } from '../types'
import i18n from '../i18n'

export type ExternalLinkBehavior = 'block' | 'confirm' | 'open'

// Simple UUID generator fallback
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

interface SettingsStore {
  fontSize: 'small' | 'medium' | 'large' | 'xlarge'
  setFontSize: (size: 'small' | 'medium' | 'large' | 'xlarge') => void
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  rsshubDomain: string
  setRsshubDomain: (domain: string) => void
  
  aiProfiles: AIProfile[]
  addAIProfile: (profile: Omit<AIProfile, 'id'>) => void
  updateAIProfile: (id: string, profile: Partial<AIProfile>) => void
  deleteAIProfile: (id: string) => void
  
  featureMapping: FeatureMapping
  setFeatureMapping: (mapping: Partial<FeatureMapping>) => void
  
  summaryPosition: 'top' | 'sidebar'
  setSummaryPosition: (pos: 'top' | 'sidebar') => void

  translationPosition: 'top' | 'sidebar'
  setTranslationPosition: (pos: 'top' | 'sidebar') => void
  
  autoSummarizeUnread: boolean
  setAutoSummarizeUnread: (enabled: boolean) => void
  
  autoSummarizeNewArticles: boolean
  setAutoSummarizeNewArticles: (enabled: boolean) => void

  targetLanguage: string
  setTargetLanguage: (lang: string) => void
  
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  
  articleListWidth: number
  setArticleListWidth: (width: number) => void

  shortcuts: Record<string, string>
  shortcutsEnabled: boolean
  setShortcutsEnabled: (enabled: boolean) => void
  setShortcut: (action: string, key: string) => void
  resetShortcuts: () => void

  autoMarkRead: boolean
  setAutoMarkRead: (enabled: boolean) => void

  autoCleanup: {
    enabled: boolean
    maxRetentionDays: number
    exceptStarred: boolean
  }
  setAutoCleanup: (config: Partial<SettingsStore['autoCleanup']>) => void

  mediaCache: {
    enabled: boolean
    maxRetentionDays: number
    maxCacheSizeMB: number
  }
  setMediaCache: (config: Partial<SettingsStore['mediaCache']>) => void

  externalLinkBehavior: ExternalLinkBehavior
  setExternalLinkBehavior: (behavior: ExternalLinkBehavior) => void

  autoUpdate: boolean
  setAutoUpdate: (enabled: boolean) => void

  updateInterval: number
  setUpdateInterval: (interval: number) => void
  language: string
  setLanguage: (lang: string) => void
}


export const defaultShortcuts = {
  next: 'j',
  prev: 'k',
  toggleRead: 'm',
  toggleStar: 's',
  openOriginal: 'o',
  search: 'k', // cmd+k
  settings: ',', // cmd+,
  goHome: 'g',
  goStarred: 'S', // Shift+s to avoid conflict? Or handled by logic
  goFavorites: 'f',
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      fontSize: 'medium',
      setFontSize: (size) => set({ fontSize: size }),
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      rsshubDomain: 'https://rsshub.app',
      setRsshubDomain: (domain) => set({ rsshubDomain: domain }),
      
       sidebarCollapsed: false,
       setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

       articleListWidth: 320,
      setArticleListWidth: (width) => set({ articleListWidth: width }),
      
      shortcuts: defaultShortcuts,
      shortcutsEnabled: true,
      setShortcutsEnabled: (enabled) => set({ shortcutsEnabled: enabled }),
      setShortcut: (action, key) => set((state) => ({ shortcuts: { ...state.shortcuts, [action]: key } })),
      resetShortcuts: () => set({ shortcuts: defaultShortcuts }),
      
      aiProfiles: [],
      addAIProfile: (profile) =>
        set((state) => ({
          aiProfiles: [...state.aiProfiles, { ...profile, id: generateUUID() }],
        })),
      updateAIProfile: (id, profile) =>
        set((state) => ({
          aiProfiles: state.aiProfiles.map((p) =>
            p.id === id ? { ...p, ...profile } : p
          ),
        })),
      deleteAIProfile: (id) =>
        set((state) => ({
          aiProfiles: state.aiProfiles.filter((p) => p.id !== id),
        })),
        
      featureMapping: {
        summaryProfileId: '',
        translationProfileId: '',
        batchSummaryProfileId: '',
      },
      setFeatureMapping: (mapping) =>
        set((state) => ({
          featureMapping: { ...state.featureMapping, ...mapping },
        })),
        
      summaryPosition: 'top',
      setSummaryPosition: (pos) => set({ summaryPosition: pos }),
      
      translationPosition: 'top',
      setTranslationPosition: (pos) => set({ translationPosition: pos }),
      
      autoSummarizeUnread: false,
      setAutoSummarizeUnread: (enabled) => set({ autoSummarizeUnread: enabled }),

      autoSummarizeNewArticles: false,
      setAutoSummarizeNewArticles: (enabled) => set({ autoSummarizeNewArticles: enabled }),
      
      targetLanguage: 'Chinese',
      setTargetLanguage: (lang) => set({ targetLanguage: lang }),

      autoMarkRead: true,
      setAutoMarkRead: (enabled) => set({ autoMarkRead: enabled }),

      autoCleanup: {
        enabled: false,
        maxRetentionDays: 30,
        exceptStarred: true
      },
      setAutoCleanup: (config) => set((state) => ({ autoCleanup: { ...state.autoCleanup, ...config } })),

      mediaCache: {
        enabled: false,
        maxRetentionDays: 30,
        maxCacheSizeMB: 500
      },
      setMediaCache: (config) => set((state) => ({ mediaCache: { ...state.mediaCache, ...config } })),

      externalLinkBehavior: 'block',
      setExternalLinkBehavior: (behavior) => set({ externalLinkBehavior: behavior }),

      autoUpdate: true,
      setAutoUpdate: (enabled) => set({ autoUpdate: enabled }),

      updateInterval: 15,
      setUpdateInterval: (interval) => set({ updateInterval: interval }),

      language: 'zh',
      setLanguage: (lang) => {
        i18n.changeLanguage(lang)
        set({ language: lang })
      },
    }),
    {
      name: 'settings-storage',
      version: 6,
      migrate: (persistedState: any, version) => {
        try {
          let state = persistedState || {}
          
          if (version === 0) {
            // Handle case where persistedState is empty or invalid
            const oldConfig = state.aiConfig || {}
            const defaultProfileId = 'default-profile'
            
            // Only create migration profile if we actually had some config
            const hasOldConfig = oldConfig.apiKey && oldConfig.apiKey.length > 0
            
            const newProfile: AIProfile = {
              id: defaultProfileId,
              name: 'Default Profile',
              apiKey: oldConfig.apiKey || '',
              baseUrl: oldConfig.baseUrl || 'https://api.openai.com/v1',
              model: oldConfig.model || '',
              provider: oldConfig.provider || 'openai',
              prompt: oldConfig.prompt || 'You are a helpful assistant that summarizes articles. Please provide a concise summary of the following content.',
            }
            
            state = {
              ...state,
              aiProfiles: hasOldConfig ? [newProfile] : [],
              featureMapping: {
                summaryProfileId: hasOldConfig ? defaultProfileId : '',
                translationProfileId: hasOldConfig ? defaultProfileId : '',
                batchSummaryProfileId: hasOldConfig ? defaultProfileId : '',
              },
              summaryPosition: oldConfig.summaryPosition || 'top',
              autoSummarizeUnread: false,
              targetLanguage: 'Chinese',
              version: 1
            }
          }

          if (version < 2) {
            state = {
              ...state,
              shortcuts: defaultShortcuts
            }
          }

          if (version < 3) {
            state = {
              ...state,
              externalLinkBehavior: 'block'
            }
          }

          if (version < 4) {
            state = {
              ...state,
              autoUpdate: true,
              updateInterval: 15
            }
          }

          if (version < 5) {
            state = {
              ...state,
              language: 'zh'
            }
          }

          if (version < 6) {
            state = {
              ...state,
              shortcutsEnabled: true
            }
          }

          return state
        } catch (e) {
          console.error('Migration failed:', e)
          // Return default safe state on error, preserving what we can
          return persistedState
        }
      },
    }
  )
)
