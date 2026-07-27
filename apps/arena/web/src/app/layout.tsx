import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegister } from '../components/ServiceWorkerRegister'
import { SyncStatusBadge } from '../components/SyncStatusBadge'
import { AppHeader } from '../components/AppHeader'

export const metadata: Metadata = {
  title: 'Sensei Arena',
  description: 'Gestão de campeonatos de judô — pesagem, chaves, mesa e placar',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <ServiceWorkerRegister />
        <AppHeader />
        {children}
        <SyncStatusBadge />
      </body>
    </html>
  )
}
