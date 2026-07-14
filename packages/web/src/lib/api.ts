const ACCESS_TOKEN_KEY = 'sensei-hub:accessToken'
const REFRESH_TOKEN_KEY = 'sensei-hub:refreshToken'

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null
}

// Decodes the JWT payload for UI display only (e.g. hiding an edit button for a
// role that can't use it) — never trust this for authorization. The server
// re-verifies the signature and re-checks the role on every request.
export function getCurrentRole(): string | null {
  const token = getAccessToken()
  if (!token) return null
  try {
    const payloadB64 = token.split('.')[1]
    if (!payloadB64) return null
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { role?: string }
    return payload.role ?? null
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
  return new ApiError(body.error ?? 'Erro desconhecido', res.status, body.details?.fieldErrors)
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) return false

  const body = (await res.json()) as { accessToken: string; refreshToken: string }
  setTokens(body.accessToken, body.refreshToken)
  return true
}

// Access tokens last 15min — on a 401 we try one silent refresh-and-retry before
// giving up, since staff running a front-desk shift shouldn't have to re-login
// mid-event just because a token expired.
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  async function doFetch(): Promise<Response> {
    const token = getAccessToken()
    const headers = new Headers(options.headers)
    // Only set Content-Type when there's an actual JSON body — Fastify's body
    // parser rejects an empty body sent with Content-Type: application/json
    // (e.g. a DELETE with no payload) as invalid JSON, returning 400.
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(`/api${path}`, { ...options, headers })
  }

  let res = await doFetch()

  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      res = await doFetch()
    }
  }

  if (res.status === 401) {
    clearTokens()
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new ApiError('Sessão expirada', 401)
  }

  if (!res.ok) {
    throw await parseErrorBody(res)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
