import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AuthConfig, User } from '@cardvault/shared/types'

type Phase = 'loading' | 'ready' | 'scanned' | 'expired' | 'error'

const DUST = [
  { left: '12%', top: '22%', dur: '13s', delay: '0s', drift: '28px' },
  { left: '24%', top: '68%', dur: '16s', delay: '1.8s', drift: '-36px' },
  { left: '38%', top: '12%', dur: '11s', delay: '0.6s', drift: '18px' },
  { left: '57%', top: '78%', dur: '14s', delay: '2.4s', drift: '42px' },
  { left: '68%', top: '28%', dur: '17s', delay: '1.2s', drift: '-24px' },
  { left: '79%', top: '62%', dur: '12s', delay: '3.1s', drift: '32px' },
  { left: '88%', top: '16%', dur: '15s', delay: '0.9s', drift: '-18px' },
  { left: '46%', top: '52%', dur: '19s', delay: '2.8s', drift: '24px' },
  { left: '8%', top: '48%', dur: '14s', delay: '3.8s', drift: '36px' },
]

export function LoginScreen({ onAuthed, notice }: { onAuthed: (user: User) => void; notice: string | null }) {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [configError, setConfigError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .authConfig()
      .then((value) => {
        if (alive) setConfig(value)
      })
      .catch((error: unknown) => {
        if (alive) setConfigError(error instanceof Error ? error.message : '无法连接服务端')
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <main className="login-scene">
      <div className="login-dust" aria-hidden="true">
        {DUST.map((item, index) => (
          <span
            key={index}
            style={
              {
                left: item.left,
                top: item.top,
                '--dur': item.dur,
                '--delay': item.delay,
                '--drift': item.drift,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="login-single">
        {configError ? (
          <div className="qr-card">
            <p className="qr-title">匣门暂未开启</p>
            <p className="qr-notice">{configError}，请确认 API 服务已启动。</p>
          </div>
        ) : (
          <QrLoginPanel config={config} onAuthed={onAuthed} notice={notice} />
        )}
      </div>
    </main>
  )
}

function QrLoginPanel({
  config,
  onAuthed,
  notice,
}: {
  config: AuthConfig | null
  onAuthed: (user: User) => void
  notice: string | null
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [qr, setQr] = useState<{ token: string; image: string; expiresAt: number } | null>(null)
  const [message, setMessage] = useState('')
  const [devBusy, setDevBusy] = useState(false)
  const onAuthedRef = useRef(onAuthed)
  onAuthedRef.current = onAuthed

  const start = useCallback(async () => {
    setPhase('loading')
    setMessage('')
    setQr(null)
    try {
      const result = await api.createQqQr()
      setQr(result)
      setPhase('ready')
    } catch (error) {
      setPhase('error')
      setMessage(error instanceof Error ? error.message : '二维码获取失败')
    }
  }, [])

  useEffect(() => {
    void start()
  }, [start])

  // 桌面端直接向自己的服务端轮询；服务端拿着 qrsig 去问腾讯
  useEffect(() => {
    if (!qr) return
    let cancelled = false
    let inFlight = false
    let timer: number | undefined
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const result = await api.pollQqQr(qr.token)
        if (cancelled) return
        if (result.status === 'authorized' && result.user) {
          if (timer) window.clearInterval(timer)
          onAuthedRef.current(result.user)
          return
        }
        if (result.status === 'expired') {
          if (timer) window.clearInterval(timer)
          setPhase('expired')
          return
        }
        if (result.status === 'scanned') {
          setPhase('scanned')
        } else {
          setPhase((current) => (current === 'scanned' ? current : 'ready'))
        }
      } catch {
        // 网络抖动时保持当前状态，下一轮继续
      } finally {
        inFlight = false
      }
    }
    void poll()
    timer = window.setInterval(poll, 1600)
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [qr])

  // 腾讯二维码约两分钟有效，本地也做一次兜底
  useEffect(() => {
    if (!qr) return
    const remaining = Math.max(0, qr.expiresAt - Date.now())
    const timer = window.setTimeout(() => setPhase('expired'), remaining)
    return () => window.clearTimeout(timer)
  }, [qr])

  const devLogin = async () => {
    setDevBusy(true)
    try {
      const { user } = await api.devLogin()
      onAuthed(user)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '开发登录失败')
      setDevBusy(false)
    }
  }

  const statusText =
    phase === 'loading'
      ? '正在向腾讯 QQ 取码…'
      : phase === 'scanned'
        ? '已扫码，请在手机上确认登录'
        : phase === 'expired'
          ? '二维码已过期，请刷新'
          : phase === 'error'
            ? message || '二维码获取失败'
            : '等待手机 QQ 扫码…'

  const tone = phase === 'error' || phase === 'expired' ? 'error' : 'pending'

  return (
    <div className="qr-card">
      <span className="qr-tape" aria-hidden="true" />
      {config?.devAuth ? <span className="qr-dev-badge">DEV 本地模式</span> : null}
      <p className="qr-title">使用 QQ 登录 CardVault</p>

      <div className={`qr-frame${phase === 'loading' ? ' is-busy' : ''}`}>
        {qr ? <img className="qq-qr-image" src={qr.image} alt="QQ 登录二维码" draggable={false} /> : null}
        {phase === 'loading' ? <span className="qr-skeleton">正在向 QQ 取码…</span> : null}
        {phase !== 'loading' && phase !== 'expired' && phase !== 'error' ? (
          <span className="qr-scanline" aria-hidden="true" />
        ) : null}
      </div>

      <div className="qr-status" data-tone={tone}>
        <span className="status-dot" aria-hidden="true" />
        <span>{statusText}</span>
      </div>

      <div className="qr-actions">
        {phase === 'expired' || phase === 'error' ? (
          <button type="button" className="btn btn-paper" onClick={() => void start()}>
            刷新二维码
          </button>
        ) : null}
        {config?.devAuth ? (
          <button type="button" className="btn qr-dev-link" disabled={devBusy} onClick={() => void devLogin()}>
            {devBusy ? '正在开启…' : '开发模式直接进入'}
          </button>
        ) : null}
      </div>

      {notice || (phase === 'error' && message) ? (
        <p className="qr-notice">{notice ?? message}</p>
      ) : null}
    </div>
  )
}
