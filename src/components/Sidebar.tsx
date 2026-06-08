import { useTranslation } from 'react-i18next'
import { useState, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { invoke, isTauriEnv } from '@/utils/tauri'
import { listen } from '@tauri-apps/api/event'
import { useFeedStore } from '@/stores/feedStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'
import { Feed, Tag } from '@/types'
import AddFeedModal from '@/components/add-feed/AddFeedModal'
import EditFeedModal from './EditFeedModal'
import FeedUpdater from './FeedUpdater'
import SearchBar from './SearchBar'
import GroupList from './GroupList'
import { 
  useContextMenu,
  preventContextMenu,
  Edit2,
  Trash2,
  Copy
} from './ContextMenu'
import { 
  Rss, 
  Inbox,
  Star, 
  Bookmark, 
  Folder, 
  Plus, 
  Settings,
  ChevronDown,
  ChevronRight,
  Tag as TagIcon,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'

const FeedIcon = ({ feed }: { feed: Feed }) => {
  const [imgError, setImgError] = useState(false)

  if (feed.icon && !imgError) {
    return (
      <img 
        src={feed.icon} 
        alt={feed.title}
        className="w-5 h-5 rounded object-cover flex-shrink-0"
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div className="w-5 h-5 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
        {feed.title?.charAt(0)?.toUpperCase() || 'R'}
      </span>
    </div>
  )
}

export default function Sidebar() {
  const { t } = useTranslation()
  const feeds = useFeedStore(state => state.feeds)
  const setFeeds = useFeedStore(state => state.setFeeds)
  const deleteFeed = useFeedStore(state => state.deleteFeed)
  const sidebarCollapsed = useSettingsStore(state => state.sidebarCollapsed)
  const setSidebarCollapsed = useSettingsStore(state => state.setSidebarCollapsed)
  const [tags, setTags] = useState<Tag[]>([])
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false)
  const [editingFeed, setEditingFeed] = useState<Feed | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const location = useLocation()
  const navigate = useNavigate()
  const { showMenu } = useContextMenu()
  
  useEffect(() => {
    if (isTauriEnv) {
      loadFeeds()
      loadTags()
    }
  }, [])

  // Listen for articles-deleted event to reload feeds
  useEffect(() => {
    if (!isTauriEnv) return

    const setupListener = async () => {
      const unlisten = await listen<void>('articles-deleted', () => {
        loadFeeds()
      })
      return unlisten
    }

    let unlistenFn: (() => void) | null = null

    setupListener().then((fn) => {
      unlistenFn = fn
    }).catch((error) => {
      console.error('Failed to setup articles-deleted listener:', error)
    })

    return () => {
      if (unlistenFn) {
        unlistenFn()
      }
    }
  }, [])

  const loadFeeds = async () => {
    try {
      const feedList = await invoke<Feed[]>('get_feeds')
      setFeeds(feedList)
    } catch (error) {
      console.error('Failed to load feeds:', error)
    }
  }

  const loadTags = async () => {
    try {
      const tagList = await invoke<Tag[]>('get_all_tags')
      setTags(tagList)
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }
  
  // Refresh tags when location changes (e.g. after adding a tag in ArticleView)
  useEffect(() => {
    if (isTauriEnv) {
      loadTags()
    }
  }, [location.pathname])
  
  const groupedFeeds = useMemo(() => {
    const groups: Record<string, Feed[]> = {}
    feeds.forEach(feed => {
      const cat = feed.category || t('sidebar.uncategorized')
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(feed)
    })
    return groups
  }, [feeds])

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [group]: !prev[group]
    }))
  }
  
  const totalUnread = feeds.reduce((sum, feed) => sum + (feed.unreadCount || 0), 0)
  
  const isActive = (path: string) => location.pathname === path

  const handleDeleteFeed = async (feed: Feed) => {
    try {
      if (isTauriEnv) {
        await invoke('delete_feed', { id: feed.id })
      }
      deleteFeed(feed.id)
      toast.success(t('sidebar.deleteSuccess'))
    } catch (error) {
      console.error('Failed to delete feed:', error)
      toast.error(t('sidebar.deleteFailed'))
    }
  }

  const handleFeedContextMenu = (e: React.MouseEvent, feed: Feed) => {
    e.preventDefault()
    showMenu(e.clientX, e.clientY, [
      {
        icon: Edit2,
        label: t('sidebar.edit'),
        onClick: () => setEditingFeed(feed)
      },
      {
        icon: Copy,
        label: t('sidebar.copyUrl'),
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(feed.url)
            toast.success(t('sidebar.copiedToClipboard'))
          } catch (error) {
            console.error('Failed to copy URL:', error)
            toast.error(t('articleView.copyFailed'))
          }
        }
      },
      {
        icon: Trash2,
        label: t('sidebar.delete'),
        danger: true,
        onClick: () => handleDeleteFeed(feed)
      }
    ])
  }
  
  return (
    <>
      <aside 
        className={`bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700/50 flex flex-col h-full flex-shrink-0 transition-all duration-300 ${
          sidebarCollapsed ? 'w-[70px]' : 'w-[280px]'
        }`}
      >
        {/* Header */}
        <div className={`p-5 border-b border-slate-200 dark:border-slate-700/50 flex flex-col gap-4 ${sidebarCollapsed ? 'items-center px-2' : ''}`}>
          <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-4' : 'justify-between'}`}>
            <div className="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" className="w-10 h-10 rounded-xl flex-shrink-0">
                <defs>
                  <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#bce0f9" />
                    <stop offset="100%" stopColor="#6bb8f2" />
                  </linearGradient>
                  <linearGradient id="oceanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4ea4e6" />
                    <stop offset="100%" stopColor="#2a85d2" />
                  </linearGradient>
                </defs>
                <rect x="16" y="16" width="224" height="224" rx="52" fill="url(#bgGrad)" />
                <g fill="none" stroke="#ffffff" strokeWidth="18" strokeLinecap="round">
                  <path d="M 88 96 A 72 72 0 0 1 160 168" />
                  <path d="M 88 56 A 112 112 0 0 1 200 168" />
                </g>
                <g transform="translate(48, 128) scale(5)">
                  <path fill="#ffffff" d="M8 0c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zM13.2 5.3c0.4 0 0.7 0.3 1.1 0.3-0.3 0.4-1.6 0.4-2-0.1 0.3-0.1 0.5-0.2 0.9-0.2zM1 8c0-0.4 0-0.8 0.1-1.3 0.1 0 0.2 0.1 0.3 0.1 0 0 0.1 0.1 0.1 0.2 0 0.3 0.3 0.5 0.5 0.5 0.8 0.1 1.1 0.8 1.8 1 0.2 0.1 0.1 0.3 0 0.5-0.6 0.8-0.1 1.4 0.4 1.9 0.5 0.4 0.5 0.8 0.6 1.4 0 0.7 0.1 1.5 0.4 2.2-2.5-1.2-4.2-3.6-4.2-6.5zM8 15c-0.7 0-1.5-0.1-2.1-0.3-0.1-0.2-0.1-0.4 0-0.6 0.4-0.8 0.8-1.5 1.3-2.2 0.2-0.2 0.4-0.4 0.4-0.7 0-0.2 0.1-0.5 0.2-0.7 0.3-0.5 0.2-0.8-0.2-0.9-0.8-0.2-1.2-0.9-1.8-1.2s-1.2-0.5-1.7-0.2c-0.2 0.1-0.5 0.2-0.5-0.1 0-0.4-0.5-0.7-0.4-1.1-0.1 0-0.2 0-0.3 0.1s-0.2 0.2-0.4 0.1c-0.2-0.2-0.1-0.4-0.1-0.6 0.1-0.2 0.2-0.3 0.4-0.4 0.4-0.1 0.8-0.1 1 0.4 0.3-0.9 0.9-1.4 1.5-1.8 0 0 0.8-0.7 0.9-0.7s0.2 0.2 0.4 0.3c0.2 0 0.3 0 0.3-0.2 0.1-0.5-0.2-1.1-0.6-1.2 0-0.1 0.1-0.1 0.1-0.1 0.3-0.1 0.7-0.3 0.6-0.6 0-0.4-0.4-0.6-0.8-0.6-0.2 0-0.4 0-0.6 0.1-0.4 0.2-0.9 0.4-1.5 0.4 1.1-0.8 2.5-1.2 3.9-1.2 0.3 0 0.5 0 0.8 0-0.6 0.1-1.2 0.3-1.6 0.5 0.6 0.1 0.7 0.4 0.5 0.9-0.1 0.2 0 0.4 0.2 0.5s0.4 0.1 0.5-0.1c0.2-0.3 0.6-0.4 0.9-0.5 0.4-0.1 0.7-0.3 1-0.7 0-0.1 0.1-0.1 0.2-0.2 0.6 0.2 1.2 0.6 1.8 1-0.1 0-0.1 0.1-0.2 0.1-0.2 0.2-0.5 0.3-0.2 0.7 0.1 0.2 0 0.3-0.1 0.4-0.2 0.1-0.3 0-0.4-0.1s-0.1-0.3-0.4-0.3c-0.1 0.2-0.4 0.3-0.4 0.6 0.5 0 0.4 0.4 0.5 0.7-0.6 0.1-0.8 0.4-0.5 0.9 0.1 0.2-0.1 0.3-0.2 0.4-0.4 0.6-0.8 1-0.8 1.7s0.5 1.4 1.3 1.3c0.9-0.1 0.9-0.1 1.2 0.7 0 0.1 0.1 0.2 0.1 0.3 0.1 0.2 0.2 0.4 0.1 0.6-0.3 0.8 0.1 1.4 0.4 2 0.1 0.2 0.2 0.3 0.3 0.4-1.3 1.4-3 2.2-5 2.2z" />
                </g>
              </svg>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                    RSS Reader
                  </h1>
                </div>
              )}
            </div>
            
            <div className={`flex items-center gap-1 ${sidebarCollapsed ? 'flex-col' : ''}`}>
              {!sidebarCollapsed && (
                <button
                  onClick={() => navigate('/settings')}
                  onContextMenu={preventContextMenu}
                  className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title={t('sidebar.settings')}
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                onContextMenu={preventContextMenu}
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title={sidebarCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
              </button>
            </div>
          </div>
          {!sidebarCollapsed && <SearchBar />}
        </div>
        
        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto ${sidebarCollapsed ? 'px-2 py-3' : 'p-3'} scrollbar-hide`}>
          {/* Quick Navigation */}
          <div className="mb-6">
            {!sidebarCollapsed && (
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('sidebar.quickNav')}
                </span>
              </div>
            )}
            <div className="space-y-1">
              <Link
                to="/"
                onContextMenu={preventContextMenu}
                className={`flex items-center gap-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                  sidebarCollapsed ? 'justify-center px-2' : 'px-3'
                } ${
                  isActive('/') 
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={t('sidebar.allArticles')}
              >
                <Rss className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="font-medium truncate">{t('sidebar.allArticles')}</span>
                    {totalUnread > 0 && (
                      <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-primary-500 text-white rounded-full">
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                  </>
                )}
              </Link>
              
              <Link
                to="/unread"
                onContextMenu={preventContextMenu}
                className={`flex items-center gap-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                  sidebarCollapsed ? 'justify-center px-2' : 'px-3'
                } ${
                  isActive('/unread') 
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={t('sidebar.unreadArticles')}
              >
                <Inbox className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="font-medium truncate">{t('sidebar.unreadArticles')}</span>
                    {totalUnread > 0 && (
                      <span className="ml-auto px-2 py-0.5 text-xs font-semibold bg-primary-500 text-white rounded-full">
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                  </>
                )}
              </Link>
              
              <Link
                to="/starred"
                onContextMenu={preventContextMenu}
                className={`flex items-center gap-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                  sidebarCollapsed ? 'justify-center px-2' : 'px-3'
                } ${
                  isActive('/starred') 
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={t('sidebar.starredArticles')}
              >
                <Star className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span className="font-medium truncate">{t('sidebar.starredArticles')}</span>}
              </Link>
              
              <Link
                to="/favorites"
                onContextMenu={preventContextMenu}
                className={`flex items-center gap-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                  sidebarCollapsed ? 'justify-center px-2' : 'px-3'
                } ${
                  isActive('/favorites') 
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={t('sidebar.favoriteArticles')}
              >
                <Bookmark className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span className="font-medium truncate">{t('sidebar.favoriteArticles')}</span>}
              </Link>
            </div>
          </div>
          
          {/* Tags - Hide when collapsed for now */}
          {!sidebarCollapsed && tags.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('sidebar.tags')}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {tags.length}
                </span>
              </div>
              <div className="space-y-1">
                {tags.map(tag => (
                  <Link
                    key={tag.id}
                    to={`/tags/${tag.id}`}
                    onContextMenu={preventContextMenu}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                      isActive(`/tags/${tag.id}`) 
                        ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <TagIcon className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium truncate">{tag.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          
          {/* Group List */}
          <GroupList collapsed={sidebarCollapsed} />

          {/* Feeds */}
          <div>
            {!sidebarCollapsed && (
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {t('sidebar.feeds')}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {feeds.length}
                </span>
              </div>
            )}
            
            <div className="space-y-1">
              {sidebarCollapsed ? (
                // Collapsed: Show simple list of feed icons
                feeds.map(feed => (
                  <Link
                    key={feed.id}
                    to={`/feed/${feed.id}`}
                    onContextMenu={(e) => handleFeedContextMenu(e, feed)}
                    className={`flex items-center justify-center px-2 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                      isActive(`/feed/${feed.id}`) 
                        ? 'bg-primary-50 dark:bg-primary-900/30' 
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                    title={feed.title}
                  >
                    <FeedIcon feed={feed} />
                  </Link>
                ))
              ) : (
                // Expanded: Grouped feeds
                Object.entries(groupedFeeds).map(([group, groupFeeds]) => (
                  <div key={group} className="space-y-1">
                    {group !== t('sidebar.uncategorized') && (
                      <button
                        onClick={() => toggleGroup(group)}
                        onContextMenu={preventContextMenu}
                        className="flex items-center w-full px-2 py-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                      >
                        {collapsedGroups[group] ? (
                          <ChevronRight className="w-3 h-3 mr-1.5" />
                        ) : (
                          <ChevronDown className="w-3 h-3 mr-1.5" />
                        )}
                        {group}
                        <span className="ml-auto text-[10px] font-normal opacity-70">
                          {groupFeeds.reduce((sum, f) => sum + (f.unreadCount || 0), 0) || ''}
                        </span>
                      </button>
                    )}
                    
                    {(!collapsedGroups[group] || group === t('sidebar.uncategorized')) && (
                      <div className={group !== t('sidebar.uncategorized') ? 'pl-2 space-y-1' : 'space-y-1'}>
                        {groupFeeds.map(feed => (
                          <Link
                            key={feed.id}
                            to={`/feed/${feed.id}`}
                            onContextMenu={(e) => handleFeedContextMenu(e, feed)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group ${
                              isActive(`/feed/${feed.id}`) 
                                ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <FeedIcon feed={feed} />
                            <span className="font-medium truncate flex-1">{feed.title}</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.preventDefault()
                                  setEditingFeed(feed)
                                }}
                                onContextMenu={preventContextMenu}
                                className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                title={t('sidebar.edit')}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              {feed.unreadCount && feed.unreadCount > 0 && (
                                <span className="px-2 py-0.5 text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                                  {feed.unreadCount > 99 ? '99+' : feed.unreadCount}
                                </span>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              
              {feeds.length === 0 && !sidebarCollapsed && (
                <div className="px-3 py-8 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <Folder className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                    {t('sidebar.noFeeds')}
                  </p>
                  <button
                    onClick={() => setIsAddFeedOpen(true)}
                    onContextMenu={preventContextMenu}
                    className="text-sm text-primary-500 hover:text-primary-600 font-medium cursor-pointer"
                  >
                    {t('sidebar.addFirstFeed')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
        
        {/* Footer Actions */}
        <div className={`border-t border-slate-200 dark:border-slate-700/50 ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
          {sidebarCollapsed ? (
            <div className="flex flex-col gap-2 items-center">
              <button 
                onClick={() => navigate('/settings')}
                onContextMenu={preventContextMenu}
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title={t('sidebar.settings')}
              >
                <Settings className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsAddFeedOpen(true)}
                onContextMenu={preventContextMenu}
                disabled={!isTauriEnv}
                className="p-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-primary-500/25"
                title={t('sidebar.addFeed')}
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button 
                onClick={() => setIsAddFeedOpen(true)}
                onContextMenu={preventContextMenu}
                disabled={!isTauriEnv}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40"
              >
                <Plus className="w-4 h-4" />
                {t('sidebar.addFeed')}
              </button>
              <FeedUpdater />
            </div>
          )}
        </div>
      </aside>
      
      <AddFeedModal 
        isOpen={isAddFeedOpen} 
        onClose={() => setIsAddFeedOpen(false)} 
      />
      <EditFeedModal 
        isOpen={!!editingFeed}
        feed={editingFeed}
        onClose={() => setEditingFeed(null)}
      />
    </>
  )
}
