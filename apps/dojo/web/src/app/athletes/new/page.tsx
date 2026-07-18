'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isLoggedIn } from '../../../lib/api'
import { AthleteForm } from '../../../components/AthleteForm'

export default function NewAthletePage() {
  const router = useRouter()

  useEffect(() => {
    if (!isLoggedIn()) router.replace('/login')
  }, [router])

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/athletes" className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar
        </Link>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Cadastrar atleta</h1>
        <AthleteForm mode="create" onSuccess={(id) => router.replace(`/athletes/${id}`)} />
      </div>
    </main>
  )
}
