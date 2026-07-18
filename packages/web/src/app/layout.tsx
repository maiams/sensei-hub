import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegister } from '../components/ServiceWorkerRegister'
import { SyncStatusBadge } from '../components/SyncStatusBadge'

export const metadata: Metadata = {
  title: 'Sensei Hub',
  description: 'Plataforma de gestão de academia e competições de judô',
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
        {children}
        <SyncStatusBadge />
      </body>
    </html>
  )
}
