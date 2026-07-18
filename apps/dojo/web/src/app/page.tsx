import { redirect } from 'next/navigation'
import Link from 'next/link'

async function getSetupStatus(): Promise<{ setupRequired: boolean }> {
  try {
    const res = await fetch('http://localhost:3101/api/setup/status', {
      cache: 'no-store',
    })
    if (!res.ok) return { setupRequired: false }
    return (await res.json()) as { setupRequired: boolean }
  } catch {
    // Server not reachable yet — show loading screen instead of crashing
    return { setupRequired: false }
  }
}

export default async function HomePage() {
  const { setupRequired } = await getSetupStatus()

  if (setupRequired) {
    redirect('/setup')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white">
      <h1 className="text-4xl font-bold tracking-tight">Sensei Dojô</h1>
      <p className="mt-3 text-slate-400">Gestão local de academia de judô — atletas, faixas e acompanhamento</p>
      <Link
        href="/login"
        className="mt-8 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
      >
        Entrar
      </Link>
    </main>
  )
}
