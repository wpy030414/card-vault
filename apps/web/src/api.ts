import type { AuthConfig, CardMeta, CropResult, QrStatus, User } from '@cardvault/shared/types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  if (res.status === 204) return undefined as T
  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!res.ok) {
    const obj = (payload ?? {}) as { error?: string; code?: string }
    throw new ApiError(res.status, obj.error ?? `请求失败（HTTP ${res.status}）`, obj.code)
  }
  return payload as T
}

export const api = {
  me: () => request<{ user: User }>('/api/me'),
  authConfig: () => request<AuthConfig>('/api/auth/config'),
  createQqQr: () =>
    request<{ token: string; image: string; expiresAt: number }>('/api/auth/qq/qr', { method: 'POST' }),
  pollQqQr: (token: string) =>
    request<{ status: QrStatus; user?: User }>(`/api/auth/qq/qr/${encodeURIComponent(token)}`),
  devLogin: () => request<{ user: User }>('/api/auth/dev/login', { method: 'POST' }),
  directLoginUrl: () => request<{ url: string }>('/api/auth/direct', { method: 'POST' }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  cards: () => request<{ cards: CardMeta[] }>('/api/cards'),
  createCard: (input: {
    title: string
    cardDate: string
    holo: boolean
    front: CropResult
    back: CropResult | null
  }) => request<{ card: CardMeta }>('/api/cards', { method: 'POST', body: JSON.stringify(input) }),
  updateCard: (id: string, input: { title: string; cardDate: string; holo: boolean }) =>
    request<{ card: CardMeta }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCard: (id: string) => request<void>(`/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
