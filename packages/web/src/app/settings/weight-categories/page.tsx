'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, getCurrentRole, isLoggedIn } from '../../../lib/api'
import { WeightCategoryGrid } from '../../../components/WeightCategoryGrid'

interface GroupDTO {
  groupKey: string
  label: string
  gender: 'male' | 'female'
  categories: Array<{ label: string; maxKg: number | null }>
  isDefault: boolean
}

export default function WeightCategoriesSettingsPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<GroupDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Starts false so server and first client render match; the real value
  // (read from the JWT in localStorage) is only known after mount.
  const [canEdit, setCanEdit] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<GroupDTO[]>('/weight-categories')
      setGroups(data)
    } catch {
      setError('Não foi possível carregar as categorias.')
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    setCanEdit(role !== null && hasMinRole(role as UserRole, 'academy_admin'))
    void load()
  }, [router, load])

  const groupKeys = groups ? [...new Set(groups.map((g) => g.groupKey))] : []

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <Link href="/athletes" className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
            ← Voltar
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Categorias de peso</h1>
          <p className="mt-1 text-slate-400">
            Valores padrão (FPJ/CBJ 2026), editáveis por academia. Categorias de base variam bastante entre
            federações — ajuste conforme a sua.
          </p>
          {!canEdit && (
            <p className="mt-2 text-sm text-amber-400">
              Apenas administradores da academia podem editar. Você está vendo em modo leitura.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {!error && !groups && <p className="text-slate-400">Carregando…</p>}

        {groups &&
          groupKeys.map((groupKey) => {
            const groupRows = groups.filter((g) => g.groupKey === groupKey)
            const label = groupRows[0]?.label ?? groupKey
            return (
              <section key={groupKey}>
                <h2 className="mb-3 text-lg font-semibold text-white">{label}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {groupRows.map((g) => (
                    <WeightCategoryGrid
                      key={`${g.groupKey}:${g.gender}`}
                      groupKey={g.groupKey}
                      gender={g.gender}
                      initialCategories={g.categories}
                      initialIsDefault={g.isDefault}
                      canEdit={canEdit}
                    />
                  ))}
                </div>
              </section>
            )
          })}
      </div>
    </main>
  )
}
