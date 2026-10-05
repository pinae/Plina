import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppQueryProvider } from './AppQueryProvider'
import { AuthGate } from './components/AuthGate/AuthGate.tsx'
import { CssBaseline } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { appTheme } from './theme.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppQueryProvider>
      {/* The login page looks like the app; only a logged-in user gets to
          the app itself (README: Accounts). */}
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <AuthGate>
          <App />
        </AuthGate>
      </ThemeProvider>
    </AppQueryProvider>
  </StrictMode>,
)
