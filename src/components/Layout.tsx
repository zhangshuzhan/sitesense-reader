import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useGlobalShortcuts } from '@/hooks/useKeyboardShortcuts'

export default function Layout() {
  useGlobalShortcuts()
  
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
