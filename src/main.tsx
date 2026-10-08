import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Platform } from './Platform.tsx'
import './styles/index.css'
import './styles/dcdc.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Platform />
  </StrictMode>,
)
