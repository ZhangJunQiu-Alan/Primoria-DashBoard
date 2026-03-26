import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import { TodoPopoutPage } from './components/widgets/TodoPopoutPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TodoPopoutPage />
    <Toaster theme="light" />
  </StrictMode>
)
