import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sensei Hub',
  description: 'Plataforma de gestão de academia e competições de judô',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
