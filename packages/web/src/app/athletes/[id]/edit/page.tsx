'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, isLoggedIn } from '../../../../lib/api'
import { AthleteForm, type AthleteFormValues } from '../../../../components/AthleteForm'

export default function EditAthletePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const athleteId = params.id

  const [initialValues, setInitialValues] = useState<Partial<AthleteFormValues> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const athlete = await apiFetch<Record<string, unknown>>(`/athletes/${athleteId}`)
      setInitialValues({
        fullName: (athlete.fullName as string) ?? '',
        preferredName: (athlete.preferredName as string) ?? '',
        gender: (athlete.gender as string) ?? 'male',
        birthDate: (athlete.birthDate as string) ?? '',
        nationality: (athlete.nationality as string) ?? 'Brazilian',
        email: (athlete.email as string) ?? '',
        phone: (athlete.phone as string) ?? '',
        cpf: (athlete.cpf as string) ?? '',
        currentBelt: (athlete.currentBelt as string) ?? 'white',
        federationNumber: (athlete.federationNumber as string) ?? '',
        hasMedicalRestriction: Boolean(athlete.hasMedicalRestriction),
        medicalNotes: (athlete.medicalNotes as string) ?? '',
        allergies: (athlete.allergies as string) ?? '',
        termsAccepted: Boolean(athlete.termsAccepted),
        imageAuthorizationAccepted: Boolean(athlete.imageAuthorizationAccepted),
      })
    } catch {
      setError('Não foi possível carregar o atleta.')
    }
  }, [athleteId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load()
  }, [router, load])

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href={`/athletes/${athleteId}`} className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar
        </Link>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Editar atleta</h1>
        {error && <p className="text-red-300">{error}</p>}
        {!error && !initialValues && <p className="text-slate-400">Carregando…</p>}
        {initialValues && (
          <AthleteForm
            mode="edit"
            athleteId={athleteId}
            initialValues={initialValues}
            onSuccess={(id) => router.replace(`/athletes/${id}`)}
          />
        )}
      </div>
    </main>
  )
}
