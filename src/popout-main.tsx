import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import { CloudSyncProvider } from './components/cloud/CloudSyncProvider'
import { TodoPopoutPage } from './components/widgets/TodoPopoutPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CloudSyncProvider>
      <TodoPopoutPage />
      <Toaster theme="light" />
    </CloudSyncProvider>
  </StrictMode>
)
