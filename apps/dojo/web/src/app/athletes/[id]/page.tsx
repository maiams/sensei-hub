'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, ApiError, isLoggedIn } from '../../../lib/api'
import {
  ATHLETE_STATUS_LABELS,
  BELT_LABELS,
  BELT_OPTIONS,
  GENDER_LABELS,
  GUARDIAN_RELATIONSHIP_LABELS,
  formatDate,
  translateApiError,
} from '../../../lib/labels'

interface AthleteDetail {
  id: string
  enrollmentNumber: string
  fullName: string
  preferredName?: string
  gender: string
  birthDate: string
  email?: string
  phone?: string
  cpf?: string
  currentBelt: string
  federationNumber?: string
  zempoNumber?: string
  latestWeightKg?: number
  status: string
  hasMedicalRestriction: boolean
  medicalNotes?: string
  allergies?: string
}

interface BeltRecord {
  id: string
  belt: string
  grantedAt: string
  notes?: string
}

interface WeightRecord {
  id: string
  weightKg: number
  source: string
  recordedAt: string
  correctionReason?: string
}

interface Guardian {
  name: string
  relationship: string
  phone: string
}

export default function AthleteProfilePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const athleteId = params.id

  const [athlete, setAthlete] = useState<AthleteDetail | null>(null)
  const [belts, setBelts] = useState<BeltRecord[]>([])
  const [weights, setWeights] = useState<WeightRecord[]>([])
  const [guardian, setGuardian] = useState<Guardian | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [athleteData, beltData, weightData] = await Promise.all([
        apiFetch<AthleteDetail>(`/athletes/${athleteId}`),
        apiFetch<BeltRecord[]>(`/athletes/${athleteId}/belts`),
        apiFetch<WeightRecord[]>(`/athletes/${athleteId}/weights`),
      ])
      setAthlete(athleteData)
      setBelts(beltData)
      setWeights(weightData)

      try {
        const g = await apiFetch<Guardian>(`/athletes/${athleteId}/guardian`)
        setGuardian(g)
      } catch {
        setGuardian(null)
      }
    } catch {
      setError('Não foi possível carregar o atleta.')
    } finally {
      setLoading(false)
    }
  }, [athleteId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load()
  }, [router, load])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-slate-400">Carregando…</p>
      </main>
    )
  }

  if (error || !athlete) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-red-300">{error ?? 'Atleta não encontrado.'}</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <Link href="/athletes" className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
            ← Voltar
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{athlete.fullName}</h1>
              {athlete.preferredName && <p className="text-slate-400">"{athlete.preferredName}"</p>}
            </div>
            <Link
              href={`/athletes/${athlete.id}/edit`}
              className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Editar
            </Link>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
          <Field label="Matrícula" value={athlete.enrollmentNumber} />
          <Field label="Status" value={ATHLETE_STATUS_LABELS[athlete.status] ?? athlete.status} />
          <Field label="Nascimento" value={formatDate(athlete.birthDate)} />
          <Field label="Gênero" value={GENDER_LABELS[athlete.gender] ?? athlete.gender} />
          <Field label="Graduação" value={BELT_LABELS[athlete.currentBelt] ?? athlete.currentBelt} />
          <Field label="Peso atual" value={athlete.latestWeightKg ? `${athlete.latestWeightKg} kg` : '—'} />
          <Field label="Registro FPJ" value={athlete.federationNumber ?? '—'} />
          <Field label="Registro Zempo (CBJ)" value={athlete.zempoNumber ?? '—'} />
          <Field label="E-mail" value={athlete.email ?? '—'} />
          <Field label="Celular" value={athlete.phone ?? '—'} />
        </section>

        {athlete.hasMedicalRestriction && (
          <section className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
            <p className="font-semibold text-amber-300">Possui restrição médica</p>
            {athlete.medicalNotes && <p className="mt-2 text-sm text-amber-100">{athlete.medicalNotes}</p>}
            {athlete.allergies && (
              <p className="mt-2 text-sm text-amber-100">
                <span className="font-medium">Alergias:</span> {athlete.allergies}
              </p>
            )}
          </section>
        )}

        {guardian && (
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
            <h2 className="mb-2 font-semibold text-white">Responsável</h2>
            <p className="text-slate-300">
              {guardian.name} ({GUARDIAN_RELATIONSHIP_LABELS[guardian.relationship] ?? guardian.relationship}) ·{' '}
              {guardian.phone}
            </p>
          </section>
        )}

        <BeltSection athleteId={athleteId} belts={belts} onAdded={load} />
        <WeightSection athleteId={athleteId} weights={weights} onAdded={load} />
      </div>
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-white">{value}</p>
    </div>
  )
}

function BeltSection({
  athleteId,
  belts,
  onAdded,
}: {
  athleteId: string
  belts: BeltRecord[]
  onAdded: () => void
}) {
  const [belt, setBelt] = useState('white')
  const [grantedAt, setGrantedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/athletes/${athleteId}/belts`, {
        method: 'POST',
        body: JSON.stringify({ belt, grantedAt }),
      })
      setGrantedAt('')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível registrar a graduação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 font-semibold text-white">Histórico de faixa</h2>
      <ul className="mb-4 space-y-1 text-sm">
        {belts.length === 0 && <li className="text-slate-500">Nenhum registro.</li>}
        {belts.map((b) => (
          <li key={b.id} className="flex justify-between text-slate-300">
            <span>{BELT_LABELS[b.belt] ?? b.belt}</span>
            <span className="text-slate-500">{formatDate(b.grantedAt)}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <select
          value={belt}
          onChange={(e) => setBelt(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
        >
          {BELT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          required
          value={grantedAt}
          onChange={(e) => setGrantedAt(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          Registrar
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  )
}

function WeightSection({
  athleteId,
  weights,
  onAdded,
}: {
  athleteId: string
  weights: WeightRecord[]
  onAdded: () => void
}) {
  const [weightKg, setWeightKg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/athletes/${athleteId}/weights`, {
        method: 'POST',
        body: JSON.stringify({ weightKg: Number(weightKg) }),
      })
      setWeightKg('')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível registrar o peso.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 font-semibold text-white">Histórico de peso</h2>
      <ul className="mb-4 space-y-1 text-sm">
        {weights.length === 0 && <li className="text-slate-500">Nenhum registro.</li>}
        {weights.map((w) => (
          <li key={w.id} className="flex justify-between text-slate-300">
            <span>
              {w.weightKg} kg {w.source === 'corrected' && <em className="text-amber-400">(corrigido)</em>}
            </span>
            <span className="text-slate-500">{formatDate(w.recordedAt)}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <input
          type="number"
          step="0.1"
          min="0"
          max="300"
          required
          placeholder="Peso (kg)"
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
          className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          Registrar
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  )
}
