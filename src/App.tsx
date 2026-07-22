import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import Layout from './components/Layout'
import ArticleList from './components/ArticleList'
import EmptyView from './components/EmptyView'
import AllArticles from './pages/AllArticles'
import StarredArticles from './pages/StarredArticles'
import UnreadArticles from './pages/UnreadArticles'
import FavoriteArticles from './pages/FavoriteArticles'
import TaggedArticles from './pages/TaggedArticles'
import GroupView from './pages/GroupView'
import ToastContainer from './components/ToastContainer'
import GlobalContextMenu from './components/GlobalContextMenu'
import { ContextMenuProvider } from './components/ContextMenu'
import { useSettingsStore } from './stores/settingsStore'
import { useDisableDefaultContextMenu } from './hooks/useDisableDefaultContextMenu'
import { useExternalNavigationGuard } from './hooks/useExternalNavigationGuard'
import AppRuntimeBridge from './components/AppRuntimeBridge'

const ArticleView = lazy(() => import('./components/ArticleView'))
const SearchResults = lazy(() => import('./pages/SearchResults'))
const Settings = lazy(() => import('./pages/Settings'))
const EastmoneyReportsPanel = lazy(() => import('./components/EastmoneyReportsPanel'))

function RouteFallback() {
  return <div className="h-full bg-white dark:bg-slate-900" />
}

function LazyElement({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route
          path="settings"
          element={
            <LazyElement>
              <Settings />
            </LazyElement>
          }
        />

        <Route path="/" element={<AllArticles />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route path="unread" element={<UnreadArticles />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route path="starred" element={<StarredArticles />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route path="favorites" element={<FavoriteArticles />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route path="tags/:tagId" element={<TaggedArticles />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route path="group/:groupId" element={<GroupView />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route path="feed/:feedId" element={<ArticleList />}>
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>

        <Route
          path="eastmoney/:category"
          element={
            <LazyElement>
              <EastmoneyReportsPanel />
            </LazyElement>
          }
        />

        <Route
          path="search"
          element={
            <LazyElement>
              <SearchResults />
            </LazyElement>
          }
        >
          <Route index element={<EmptyView />} />
          <Route
            path="article/:articleId"
            element={
              <LazyElement>
                <ArticleView />
              </LazyElement>
            }
          />
        </Route>
      </Route>
    </Routes>
  )
}

function App() {
  const { fontSize } = useSettingsStore()
  useDisableDefaultContextMenu()
  useExternalNavigationGuard()
  
  useEffect(() => {
    // 应用字体大小设置
    document.documentElement.setAttribute('data-font-size', fontSize)
  }, [fontSize])
  
  return (
    <ContextMenuProvider>
      <BrowserRouter>
        <AppRuntimeBridge />
        <AppRoutes />
        <ToastContainer />
        <GlobalContextMenu />
      </BrowserRouter>
    </ContextMenuProvider>
  )
}

export default App
