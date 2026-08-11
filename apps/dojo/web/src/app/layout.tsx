import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppHeader } from '../components/AppHeader'

export const metadata: Metadata = {
  title: 'Sensei Dojô',
  description: 'Turmas, aulas e presença da sua academia de judô',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppHeader />
        {children}
      </body>
    </html>
  )
}
