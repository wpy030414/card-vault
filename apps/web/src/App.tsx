import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from './api'
import { CropPresetDialog } from './components/CropPresetDialog'
import { ExamineView } from './components/ExamineView'
import { LoginScreen } from './components/LoginScreen'
import { UploadDialog } from './components/UploadDialog'
import { VaultScreen } from './components/VaultScreen'
import { IconVault } from './components/icons'
import type { CardMeta, CardOrigin, CropPreset, CropQuad, User } from '@cardvault/shared/types'

type AuthState = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; user: User }

interface Toast {
  id: number
  message: string
  kind: 'ok' | 'error'
}

const LOGIN_NOTICES: Record<string, string> = {
  expired: '二维码已过期，请重新扫码',
  denied: '已取消 QQ 授权',
  failed: '登录没有完成，请再试一次',
  qq_unconfigured: 'QQ 登录尚未配置，请参考 README 或 .env.example',
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [cards, setCards] = useState<CardMeta[]>([])
  const [cardsLoaded, setCardsLoaded] = useState(false)
  const [examineId, setExamineId] = useState<string | null>(null)
  const [examineOrigin, setExamineOrigin] = useState<CardOrigin | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [presets, setPresets] = useState<CropPreset[]>([])
  const [presetManagerOpen, setPresetManagerOpen] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const notice = useMemo(() => {
    const code = new URLSearchParams(window.location.search).get('login')
    return code ? (LOGIN_NOTICES[code] ?? null) : null
  }, [])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('login')) return
    const url = new URL(window.location.href)
    url.searchParams.delete('login')
    window.history.replaceState({}, '', url)
  }, [])

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ id: Date.now() + Math.random(), message, kind })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    let alive = true
    api
      .me()
      .then(({ user }) => {
        if (alive) setAuth({ status: 'authed', user })
      })
      .catch((error: unknown) => {
        if (!alive) return
        setAuth({ status: 'anon' })
        if (!(error instanceof ApiError && error.status === 401)) {
          notify(error instanceof Error ? error.message : '无法连接服务端', 'error')
        }
      })
    return () => {
      alive = false
    }
  }, [notify])

  const loadCards = useCallback(async () => {
    try {
      const result = await api.cards()
      setCards(result.cards)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth({ status: 'anon' })
        return
      }
      notify(error instanceof Error ? error.message : '藏品读取失败', 'error')
    } finally {
      setCardsLoaded(true)
    }
  }, [notify])

  const loadPresets = useCallback(async () => {
    try {
      const result = await api.cropPresets()
      setPresets(result.presets)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth({ status: 'anon' })
        return
      }
      notify(error instanceof Error ? error.message : '裁切模式读取失败', 'error')
    }
  }, [notify])

  useEffect(() => {
    if (auth.status !== 'authed') {
      setCardsLoaded(false)
      setPresets([])
      return
    }
    void loadCards()
    void loadPresets()
  }, [auth.status, loadCards, loadPresets])

  const handleAuthed = useCallback((user: User) => {
    setAuth({ status: 'authed', user })
    setCardsLoaded(false)
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // 本地状态仍然清掉，避免卡在旧会话里
    }
    setAuth({ status: 'anon' })
    setCards([])
    setCardsLoaded(false)
    setExamineId(null)
    setExamineOrigin(null)
    setUploadOpen(false)
    setPresets([])
    setPresetManagerOpen(false)
  }, [])

  const handleCreated = useCallback(
    (card: CardMeta) => {
      setCards((current) => [card, ...current])
      setUploadOpen(false)
      setResetKey((value) => value + 1)
      notify(`《${card.title}》已收入匣中`)
    },
    [notify],
  )

  const handlePresetCreate = useCallback(async (input: { name: string; quad: CropQuad }) => {
    const { preset } = await api.createCropPreset(input)
    setPresets((current) => [preset, ...current])
  }, [])

  const handlePresetDelete = useCallback(async (preset: CropPreset) => {
    await api.deleteCropPreset(preset.id)
    setPresets((current) => current.filter((item) => item.id !== preset.id))
  }, [])

  const handleUpdate = useCallback(
    async (card: CardMeta, patch: { title: string; cardDate: string; holo: boolean }) => {
      const result = await api.updateCard(card.id, patch)
      setCards((current) => current.map((item) => (item.id === card.id ? result.card : item)))
      notify('已保存')
    },
    [notify],
  )

  const handleDelete = useCallback(
    async (card: CardMeta) => {
      try {
        await api.deleteCard(card.id)
        setCards((current) => current.filter((item) => item.id !== card.id))
        setExamineId(null)
        setExamineOrigin(null)
        notify(`《${card.title}》已从匣中移除`)
      } catch (error) {
        notify(error instanceof Error ? error.message : '删除失败', 'error')
      }
    },
    [notify],
  )

  const examineCard = examineId ? (cards.find((card) => card.id === examineId) ?? null) : null

  if (auth.status === 'loading') {
    return <Boot caption="正在启封…" />
  }

  if (auth.status === 'anon') {
    return (
      <>
        <LoginScreen onAuthed={handleAuthed} notice={notice} />
        <ToastView toast={toast} />
      </>
    )
  }

  if (!cardsLoaded) {
    return <Boot caption="正在清点藏品…" />
  }

  return (
    <>
      <VaultScreen
        user={auth.user}
        cards={cards}
        isExamining={Boolean(examineCard)}
        resetKey={resetKey}
        onExamine={(card, origin) => {
          setExamineId(card.id)
          setExamineOrigin(origin ?? null)
        }}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenCropPresets={() => setPresetManagerOpen(true)}
        onLogout={() => void handleLogout()}
      />

      {examineCard ? (
        <ExamineView
          card={examineCard}
          origin={examineOrigin}
          onClose={() => {
            setExamineId(null)
            setExamineOrigin(null)
          }}
          onEdit={handleUpdate}
          onDelete={(card) => void handleDelete(card)}
        />
      ) : null}

      {uploadOpen ? (
        <UploadDialog
          presets={presets}
          onClose={() => setUploadOpen(false)}
          onCreated={handleCreated}
          notify={notify}
        />
      ) : null}

      {presetManagerOpen ? (
        <CropPresetDialog
          presets={presets}
          onClose={() => setPresetManagerOpen(false)}
          onCreate={handlePresetCreate}
          onDelete={handlePresetDelete}
          notify={notify}
        />
      ) : null}

      <ToastView toast={toast} />
    </>
  )
}

function Boot({ caption }: { caption: string }) {
  return (
    <div className="boot">
      <div className="boot-seal" aria-hidden="true">
        <IconVault size={40} />
      </div>
      <p className="boot-caption">{caption}</p>
    </div>
  )
}

function ToastView({ toast }: { toast: Toast | null }) {
  if (!toast) return null
  return (
    <div className="toast" data-kind={toast.kind} key={toast.id} role="status">
      {toast.message}
    </div>
  )
}
