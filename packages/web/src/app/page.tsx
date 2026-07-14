import { redirect } from 'next/navigation'

async function getSetupStatus(): Promise<{ setupRequired: boolean }> {
  try {
    const res = await fetch('http://localhost:3001/api/setup/status', {
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

  // TODO: redirect to /dashboard once auth is in place on the frontend
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white">
      <h1 className="text-4xl font-bold tracking-tight">Sensei Hub</h1>
      <p className="mt-3 text-slate-400">Plataforma local de gestão de academia e competições de judô</p>
    </main>
  )
}
