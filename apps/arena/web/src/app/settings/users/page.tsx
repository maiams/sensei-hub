'use client'

// User management screen — POST/GET /api/users already existed in
// @sensei-hub/core-server (shared with the Dojô) but no Arena screen used
// them. Only academy_admin+ can see or use this — the backend already
// enforces that on POST /users; this screen additionally hides itself for
// lower roles and treats a 403 as a normal "you can't do this" outcome
// rather than a crash, per CLAUDE.md ("frontend hiding is not
// authorization" — this is defense in depth, not the actual guard).

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../lib/api'
import { ARENA_ASSIGNABLE_ROLES, translateApiError, USER_ROLE_LABELS } from '../../../lib/labels'

interface UserDTO {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  createdAt: string
}

interface CreatedCredential {
  name: string
  email: string
  password: string
}

const AREA_EMAIL_RE = /^area(\d+)@arena\.local$/i

// Avoids visually ambiguous characters (0/O, 1/l/I) since this password gets
// hand-copied onto a sheet of paper for a mesário, not typed by the person
// who generated it.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generatePassword(length = 10): string {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('')
}

function nextAreaNumber(users: UserDTO[]): number {
  let max = 0
  for (const u of users) {
    const m = u.email.match(AREA_EMAIL_RE)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export default function UsersSettingsPage() {
  const router = useRouter()
  const [canManage, setCanManage] = useState<boolean | null>(null)
  const [users, setUsers] = useState<UserDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState<CreatedCredential[]>([])

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('scoreboard_operator')
  const [password, setPassword] = useState(() => generatePassword())

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<UserDTO[]>('/users')
      setUsers(data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setCanManage(false)
        return
      }
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível carregar os usuários.')
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const currentRole = getCurrentRole()
    const allowed = currentRole !== null && hasMinRole(currentRole as UserRole, 'academy_admin')
    setCanManage(allowed)
    if (allowed) void load()
  }, [router, load])

  const nextArea = useMemo(() => nextAreaNumber(users ?? []), [users])

  async function createUser(input: { name: string; email: string; role: string; password: string }) {
    setError(null)
    try {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(input) })
      setJustCreated((prev) => [...prev, { name: input.name, email: input.email, password: input.password }])
      await load()
      return true
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível criar o usuário.')
      return false
    }
  }

  async function handleCreateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    setCreating(true)
    const ok = await createUser({ name, email, role, password })
    setCreating(false)
    if (ok) {
      setName('')
      setEmail('')
      setPassword(generatePassword())
    }
  }

  async function handleQuickArea() {
    setError(null)
    setCreating(true)
    const num = String(nextArea).padStart(2, '0')
    const generatedPassword = generatePassword()
    await createUser({
      name: `Mesa ${num}`,
      email: `area${num}@arena.local`,
      role: 'scoreboard_operator',
      password: generatedPassword,
    })
    setCreating(false)
  }

  if (canManage === null) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-slate-400">Carregando…</p>
      </main>
    )
  }

  if (!canManage) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto max-w-xl">
          <p className="text-amber-400">Apenas administradores da academia podem gerenciar usuários.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="mt-1 text-slate-400">
            Crie contas para quem opera o evento — mesário, pesagem, recepção — e para quem gerencia o campeonato.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {justCreated.length > 0 && (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-4">
            <p className="mb-2 text-sm font-semibold text-emerald-300">
              Anote estas senhas agora — elas não ficam salvas em nenhum lugar visível depois disso.
            </p>
            <ul className="space-y-1.5">
              {justCreated.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-slate-950/60 px-3 py-2 text-sm">
                  <span className="font-medium text-white">{c.name}</span>
                  <span className="text-slate-400">{c.email}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-emerald-300">{c.password}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setJustCreated([])}
              className="mt-3 text-xs text-slate-400 underline decoration-dotted hover:text-slate-200"
            >
              Já anotei, pode limpar
            </button>
          </div>
        )}

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-1 font-semibold text-white">Usuário de mesa (atalho)</h2>
          <p className="mb-3 text-sm text-slate-400">
            Cria em um clique um usuário de mesário/placar pronto para entregar a quem vai operar a mesa {String(nextArea).padStart(2, '0')}
            {' '}(login <span className="font-mono">{`area${String(nextArea).padStart(2, '0')}@arena.local`}</span>). Ao
            entrar, essa conta vai direto para a operação de mesa.
          </p>
          <button
            type="button"
            onClick={handleQuickArea}
            disabled={creating}
            className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
          >
            + Criar usuário da mesa {String(nextArea).padStart(2, '0')}
          </button>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 font-semibold text-white">Novo usuário</h2>
          <form onSubmit={handleCreateSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Nome</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
                  placeholder="Ex: Recepção — turno da manhã"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
                  placeholder="pessoa@academia.com"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Papel</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                >
                  {ARENA_ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {USER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Senha (mín. 8 caracteres — visível para você anotar)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setPassword(generatePassword())}
                    className="whitespace-nowrap rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                  >
                    Gerar
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
            >
              {creating ? 'Criando…' : 'Criar usuário'}
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-white">Usuários da academia</h2>
          {!users && <p className="text-sm text-slate-400">Carregando…</p>}
          {users && users.length === 0 && <p className="text-sm text-slate-500">Nenhum usuário cadastrado ainda.</p>}
          {users && users.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Nome</th>
                    <th className="px-4 py-2">E-mail</th>
                    <th className="px-4 py-2">Papel</th>
                    <th className="px-4 py-2">Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-white">{u.name}</td>
                      <td className="px-4 py-2 text-slate-400">{u.email}</td>
                      <td className="px-4 py-2 text-slate-300">{USER_ROLE_LABELS[u.role] ?? u.role}</td>
                      <td className="px-4 py-2">
                        {u.active ? (
                          <span className="text-emerald-400">Sim</span>
                        ) : (
                          <span className="text-slate-500">Não</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
