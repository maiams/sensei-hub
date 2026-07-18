'use client'

import { useState, type FormEvent } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { BELT_OPTIONS, GENDER_OPTIONS, GUARDIAN_RELATIONSHIP_OPTIONS, isMinor, translateApiError } from '../lib/labels'

export interface AthleteFormValues {
  fullName: string
  preferredName: string
  gender: string
  birthDate: string
  nationality: string
  email: string
  phone: string
  cpf: string
  currentBelt: string
  federationNumber: string
  zempoNumber: string
  hasMedicalRestriction: boolean
  medicalNotes: string
  allergies: string
  termsAccepted: boolean
  imageAuthorizationAccepted: boolean
}

const EMPTY_VALUES: AthleteFormValues = {
  fullName: '',
  preferredName: '',
  gender: 'male',
  birthDate: '',
  nationality: 'Brazilian',
  email: '',
  phone: '',
  cpf: '',
  currentBelt: 'white',
  federationNumber: '',
  zempoNumber: '',
  hasMedicalRestriction: false,
  medicalNotes: '',
  allergies: '',
  termsAccepted: false,
  imageAuthorizationAccepted: false,
}

interface GuardianFormValues {
  name: string
  relationship: string
  phone: string
  email: string
  cpf: string
  termsAccepted: boolean
  imageAuthorizationAccepted: boolean
}

const EMPTY_GUARDIAN: GuardianFormValues = {
  name: '',
  relationship: 'mother',
  phone: '',
  email: '',
  cpf: '',
  termsAccepted: false,
  imageAuthorizationAccepted: false,
}

interface AthleteFormProps {
  mode: 'create' | 'edit'
  athleteId?: string
  initialValues?: Partial<AthleteFormValues>
  onSuccess: (athleteId: string) => void
}

function inputClass() {
  return 'w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-base text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
}

function labelClass() {
  return 'mb-1 block text-sm font-medium text-slate-300'
}

export function AthleteForm({ mode, athleteId, initialValues, onSuccess }: AthleteFormProps) {
  const [values, setValues] = useState<AthleteFormValues>({ ...EMPTY_VALUES, ...initialValues })
  const [guardian, setGuardian] = useState<GuardianFormValues>(EMPTY_GUARDIAN)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const minor = mode === 'create' && isMinor(values.birthDate)

  function set<K extends keyof AthleteFormValues>(key: K, value: AthleteFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function setGuardianField<K extends keyof GuardianFormValues>(key: K, value: GuardianFormValues[K]) {
    setGuardian((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setFieldErrors({})

    const payload: Record<string, unknown> = {
      fullName: values.fullName,
      preferredName: values.preferredName || undefined,
      gender: values.gender,
      birthDate: values.birthDate,
      nationality: values.nationality || undefined,
      email: values.email || undefined,
      phone: values.phone || undefined,
      cpf: values.cpf || undefined,
      currentBelt: values.currentBelt,
      federationNumber: values.federationNumber || undefined,
      zempoNumber: values.zempoNumber || undefined,
      hasMedicalRestriction: values.hasMedicalRestriction,
      medicalNotes: values.medicalNotes || undefined,
      allergies: values.allergies || undefined,
      termsAccepted: values.termsAccepted,
      imageAuthorizationAccepted: values.imageAuthorizationAccepted,
    }

    if (mode === 'create' && minor) {
      payload['guardian'] = {
        name: guardian.name,
        relationship: guardian.relationship,
        phone: guardian.phone,
        email: guardian.email || undefined,
        cpf: guardian.cpf || undefined,
        termsAccepted: guardian.termsAccepted,
        imageAuthorizationAccepted: guardian.imageAuthorizationAccepted,
      }
    }

    try {
      const athlete =
        mode === 'create'
          ? await apiFetch<{ id: string }>('/athletes', { method: 'POST', body: JSON.stringify(payload) })
          : await apiFetch<{ id: string }>(`/athletes/${athleteId}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            })
      onSuccess(athlete.id)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translateApiError(err.message))
        if (err.fieldErrors) setFieldErrors(err.fieldErrors)
      } else {
        setError('Não foi possível salvar. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="space-y-5">
        <h2 className="text-lg font-semibold text-white">Dados pessoais</h2>

        <div>
          <label className={labelClass()} htmlFor="fullName">
            Nome completo
          </label>
          <input
            id="fullName"
            required
            minLength={2}
            maxLength={120}
            className={inputClass()}
            value={values.fullName}
            onChange={(e) => set('fullName', e.target.value)}
          />
          {fieldErrors['fullName']?.map((m) => (
            <p key={m} className="mt-1 text-sm text-red-400">{m}</p>
          ))}
        </div>

        <div>
          <label className={labelClass()} htmlFor="preferredName">
            Nome preferido / apelido
          </label>
          <input
            id="preferredName"
            maxLength={60}
            className={inputClass()}
            placeholder="Usado no check-in e no placar"
            value={values.preferredName}
            onChange={(e) => set('preferredName', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass()} htmlFor="gender">
              Gênero
            </label>
            <select
              id="gender"
              className={inputClass()}
              value={values.gender}
              onChange={(e) => set('gender', e.target.value)}
            >
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass()} htmlFor="birthDate">
              Data de nascimento
            </label>
            <input
              id="birthDate"
              type="date"
              required
              className={inputClass()}
              value={values.birthDate}
              onChange={(e) => set('birthDate', e.target.value)}
              disabled={mode === 'edit'}
            />
            {fieldErrors['birthDate']?.map((m) => (
              <p key={m} className="mt-1 text-sm text-red-400">{m}</p>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass()} htmlFor="cpf">
            CPF
          </label>
          <input
            id="cpf"
            className={inputClass()}
            placeholder="000.000.000-00"
            value={values.cpf}
            onChange={(e) => set('cpf', e.target.value)}
          />
          {fieldErrors['cpf']?.map((m) => (
            <p key={m} className="mt-1 text-sm text-red-400">{m}</p>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass()} htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              className={inputClass()}
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()} htmlFor="phone">
              Celular
            </label>
            <input
              id="phone"
              className={inputClass()}
              placeholder="(00) 90000-0000"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold text-white">Judô</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass()} htmlFor="currentBelt">
              Graduação atual
            </label>
            <select
              id="currentBelt"
              className={inputClass()}
              value={values.currentBelt}
              onChange={(e) => set('currentBelt', e.target.value)}
            >
              {BELT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass()} htmlFor="federationNumber">
              Registro FPJ
            </label>
            <input
              id="federationNumber"
              className={inputClass()}
              value={values.federationNumber}
              onChange={(e) => set('federationNumber', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()} htmlFor="zempoNumber">
              Registro Zempo (CBJ)
            </label>
            <input
              id="zempoNumber"
              className={inputClass()}
              value={values.zempoNumber}
              onChange={(e) => set('zempoNumber', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Saúde</h2>
        <p className="text-sm text-slate-500">Visível apenas para técnicos e administradores.</p>

        <label className="flex items-center gap-3 text-slate-200">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-slate-600 bg-slate-800"
            checked={values.hasMedicalRestriction}
            onChange={(e) => set('hasMedicalRestriction', e.target.checked)}
          />
          Possui restrição médica
        </label>

        <div>
          <label className={labelClass()} htmlFor="medicalNotes">
            Condições médicas relevantes
          </label>
          <textarea
            id="medicalNotes"
            className={inputClass()}
            rows={2}
            value={values.medicalNotes}
            onChange={(e) => set('medicalNotes', e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass()} htmlFor="allergies">
            Alergias
          </label>
          <textarea
            id="allergies"
            className={inputClass()}
            rows={2}
            value={values.allergies}
            onChange={(e) => set('allergies', e.target.value)}
          />
        </div>
      </section>

      {mode === 'create' && minor && (
        <section className="space-y-5 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Responsável legal</h2>
            <p className="text-sm text-amber-300">Obrigatório para atletas menores de 18 anos.</p>
          </div>

          <div>
            <label className={labelClass()} htmlFor="guardianName">
              Nome do responsável
            </label>
            <input
              id="guardianName"
              required={minor}
              className={inputClass()}
              value={guardian.name}
              onChange={(e) => setGuardianField('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass()} htmlFor="guardianRelationship">
                Parentesco
              </label>
              <select
                id="guardianRelationship"
                className={inputClass()}
                value={guardian.relationship}
                onChange={(e) => setGuardianField('relationship', e.target.value)}
              >
                {GUARDIAN_RELATIONSHIP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()} htmlFor="guardianPhone">
                Celular do responsável
              </label>
              <input
                id="guardianPhone"
                required={minor}
                className={inputClass()}
                value={guardian.phone}
                onChange={(e) => setGuardianField('phone', e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-3 text-slate-200">
            <input
              type="checkbox"
              required={minor}
              className="h-5 w-5 rounded border-slate-600 bg-slate-800"
              checked={guardian.termsAccepted}
              onChange={(e) => setGuardianField('termsAccepted', e.target.checked)}
            />
            O responsável aceita o termo de responsabilidade e a LGPD
          </label>

          <label className="flex items-center gap-3 text-slate-200">
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-slate-600 bg-slate-800"
              checked={guardian.imageAuthorizationAccepted}
              onChange={(e) => setGuardianField('imageAuthorizationAccepted', e.target.checked)}
            />
            O responsável autoriza uso de imagem
          </label>
        </section>
      )}

      <section className="space-y-4">
        <label className="flex items-center gap-3 text-slate-200">
          <input
            type="checkbox"
            required={!minor}
            className="h-5 w-5 rounded border-slate-600 bg-slate-800"
            checked={values.termsAccepted}
            onChange={(e) => set('termsAccepted', e.target.checked)}
          />
          {minor ? 'Termo de responsabilidade aceito (pelo responsável acima)' : 'Aceito o termo de responsabilidade'}
        </label>
        <label className="flex items-center gap-3 text-slate-200">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-slate-600 bg-slate-800"
            checked={values.imageAuthorizationAccepted}
            onChange={(e) => set('imageAuthorizationAccepted', e.target.checked)}
          />
          Autorizo uso de imagem
        </label>
      </section>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Salvando…' : mode === 'create' ? 'Cadastrar atleta' : 'Salvar alterações'}
      </button>
    </form>
  )
}
