import './lib/api' // installs window.api before any store wires its listeners
import './index.css'
import 'highlight.js/styles/github-dark.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
