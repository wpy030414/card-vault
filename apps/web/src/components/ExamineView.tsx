import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CardMeta, CardOrigin } from '@cardvault/shared/types'
import { formatDate } from '../lib/format'
import { useMotionSensors, type TiltVector } from '../hooks/useShake'
import { HoloToggle } from './HoloToggle'
import { IconCardBack, IconClose, IconEdit, IconMore, IconTrash } from './icons'

interface ExamineViewProps {
  card: CardMeta
  origin?: CardOrigin | null
  onClose: () => void
  onEdit: (card: CardMeta, patch: { title: string; cardDate: string; holo: boolean }) => Promise<void>
  onDelete: (card: CardMeta) => void
}

export function ExamineView({ card, origin, onClose, onEdit, onDelete }: ExamineViewProps) {
  const [flipped, setFlipped] = useState(false)
  const [holo, setHolo] = useState(false)
  const [closing, setClosing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(card.title)
  const [editDate, setEditDate] = useState(card.cardDate)
  const [editHolo, setEditHolo] = useState(card.holo)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const shellRef = useRef<HTMLDivElement>(null)
  const flipRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const holoTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const deleteTimer = useRef<number | undefined>(undefined)
  const pointerDown = useRef<{ x: number; y: number } | null>(null)
  const openedAt = useRef(performance.now())

  const aspect = card.front.width / Math.max(1, card.front.height)

  // 牌山 → 端详：从被点中的那张牌的位置、角度与大小，平滑长成端详的大卡
  useLayoutEffect(() => {
    if (!origin) return
    const anchor = anchorRef.current
    if (!anchor) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const finalRect = anchor.getBoundingClientRect()
    if (!finalRect.width || !finalRect.height) return
    const scale = Math.min(1.2, Math.max(0.2, origin.width / finalRect.width))
    const dx = origin.centerX - (finalRect.left + finalRect.width / 2)
    const dy = origin.centerY - (finalRect.top + finalRect.height / 2)
    anchor.style.transition = 'none'
    anchor.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${origin.angle.toFixed(2)}deg) scale(${scale.toFixed(3)})`
    void anchor.offsetWidth
    anchor.style.transition = 'transform 0.95s cubic-bezier(0.22, 0.7, 0.16, 1)'
    anchor.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)'
    const cleanup = () => {
      anchor.style.transition = ''
      anchor.style.transform = ''
    }
    anchor.addEventListener('transitionend', cleanup, { once: true })
    return () => anchor.removeEventListener('transitionend', cleanup)
  }, [origin])

  const triggerHolo = useCallback(() => {
    if (!card.holo) return
    setHolo(true)
    if (holoTimer.current) window.clearTimeout(holoTimer.current)
    holoTimer.current = window.setTimeout(() => setHolo(false), 2400)
  }, [card.holo])

  const applyMotionTilt = useCallback((tilt: TiltVector) => {
    const shell = shellRef.current
    if (!shell) return
    shell.style.setProperty('--hx', `${(50 + tilt.x * 42).toFixed(1)}%`)
    shell.style.setProperty('--hy', `${(44 + tilt.y * 38).toFixed(1)}%`)
    shell.style.setProperty('--hue', `${(tilt.x * 26).toFixed(1)}deg`)
    shell.style.setProperty('--rx', `${(-tilt.y * 6).toFixed(2)}deg`)
    shell.style.setProperty('--ry', `${(tilt.x * 10).toFixed(2)}deg`)
  }, [])

  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, 480)
  }, [closing, onClose])

  // 只有正面的卡：把「翻面」这一下变成小幅摇头，而不是弹提示
  const nudgeFlip = useCallback(() => {
    const el = flipRef.current
    if (!el) return
    el.classList.remove('is-nudging')
    void el.offsetWidth
    el.classList.add('is-nudging')
  }, [])

  const flip = useCallback(() => {
    if (!card.back) {
      nudgeFlip()
      return
    }
    setFlipped((value) => !value)
  }, [card.back, nudgeFlip])

  useEffect(() => {
    return () => {
      if (holoTimer.current) window.clearTimeout(holoTimer.current)
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current)
    }
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editing) {
          setEditing(false)
          return
        }
        if (confirmDelete) {
          setConfirmDelete(false)
          return
        }
        if (menuOpen) {
          setMenuOpen(false)
          return
        }
        close()
        return
      }
      if (editing || confirmDelete) return
      if (event.key.toLowerCase() === 'f') flip()
      else if (event.key.toLowerCase() === 'h') triggerHolo()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close, flip, triggerHolo, editing, confirmDelete, menuOpen])

  const { permission, requestPermission } = useMotionSensors(!closing, {
    onShake: triggerHolo,
    onTilt: applyMotionTilt,
  })

  const maybeRequestMotion = useCallback(() => {
    if (permission === 'prompt') void requestPermission()
  }, [permission, requestPermission])

  const sparks = useMemo(() => {
    let seed = 7
    for (const char of card.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    return Array.from({ length: 26 }, (_, index) => ({
      key: index,
      left: `${(random() * 92 + 4).toFixed(2)}%`,
      top: `${(random() * 92 + 4).toFixed(2)}%`,
      size: `${(2 + random() * 4.5).toFixed(1)}px`,
      duration: `${(1.2 + random() * 1.2).toFixed(2)}s`,
      delay: `${(random() * 0.7).toFixed(2)}s`,
    }))
  }, [card.id])

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const shell = shellRef.current
    if (!shell) return
    const rect = shell.getBoundingClientRect()
    const px = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5
    const py = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5
    shell.style.setProperty('--rx', `${(-py * 7).toFixed(2)}deg`)
    shell.style.setProperty('--ry', `${(px * 10).toFixed(2)}deg`)
    shell.style.setProperty('--hx', `${((px + 0.5) * 100).toFixed(1)}%`)
    shell.style.setProperty('--hy', `${((py + 0.5) * 100).toFixed(1)}%`)
    shell.style.setProperty('--hue', `${(px * 22).toFixed(1)}deg`)
  }

  const resetTilt = () => {
    const shell = shellRef.current
    if (!shell) return
    shell.style.setProperty('--rx', '0deg')
    shell.style.setProperty('--ry', '0deg')
    shell.style.setProperty('--hx', '50%')
    shell.style.setProperty('--hy', '40%')
    shell.style.setProperty('--hue', '0deg')
  }

  const openEdit = () => {
    setEditTitle(card.title)
    setEditDate(card.cardDate)
    setEditHolo(card.holo)
    setEditError('')
    setMenuOpen(false)
    setEditing(true)
  }

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    const title = editTitle.trim()
    if (!title) {
      setEditError('请填写卡片标题')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      setEditError('请选择日期')
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      await onEdit(card, { title, cardDate: editDate, holo: editHolo })
      setEditing(false)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = () => {
    if (deleting) return
    setConfirmDelete(false)
    setDeleting(true)
    deleteTimer.current = window.setTimeout(() => onDelete(card), 500)
  }

  return (
    <div
      className={`examine${closing ? ' is-closing' : ''}${origin ? ' is-from-fan' : ''}${deleting ? ' is-deleting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`端详 ${card.title}`}
    >
      <div className="examine-backdrop" />

      <div className="examine-tools">
        <button
          type="button"
          className="examine-menu-btn"
          aria-label="卡片菜单"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <IconMore size={19} />
        </button>
        {menuOpen ? (
          <>
            <button type="button" className="examine-menu-scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />
            <div className="examine-menu" role="menu">
              <button type="button" role="menuitem" onClick={openEdit}>
                <IconEdit size={15} />
                编辑
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmDelete(true)
                }}
              >
                <IconTrash size={15} />
                删除
              </button>
            </div>
          </>
        ) : null}
      </div>

      <button type="button" className="examine-close" onClick={close} aria-label="关闭端详">
        <IconClose size={19} />
      </button>

      <div className="examine-stage" onPointerMove={handleMove} onPointerLeave={resetTilt}>
        <div className="examine-card-anchor" ref={anchorRef}>
          <div
            ref={shellRef}
            className={`examine-card-shell${holo ? ' is-holo' : ''}${origin ? ' is-from-fan' : ''}`}
            style={{ '--ar': aspect } as React.CSSProperties}
          >
            <div
              ref={flipRef}
              className={`examine-flip${flipped ? ' is-flipped' : ''}`}
              onAnimationEnd={(event) => {
                if (event.animationName === 'card-nudge') event.currentTarget.classList.remove('is-nudging')
              }}
              onPointerDown={(event) => {
                pointerDown.current = { x: event.clientX, y: event.clientY }
                maybeRequestMotion()
              }}
              onClick={(event) => {
                const start = pointerDown.current
                pointerDown.current = null
                // iOS 只把 click / touchend 视为可申请体感权限的用户手势
                maybeRequestMotion()
                // 触摸端打开端详的那一下会产生一个同坐标的合成 click，别让它顺手翻面
                if (performance.now() - openedAt.current < 380) return
                if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return
                flip()
              }}
              role="img"
              aria-label={flipped ? `${card.title} 背面` : `${card.title} 正面`}
            >
              <div className="examine-face front">
                <img src={card.front.url} alt="" draggable={false} />
              </div>
              <div className="examine-face back">
                {card.back ? (
                  <img src={card.back.url} alt="" draggable={false} />
                ) : (
                  <div className="examine-back-mark" aria-hidden="true">
                    <span className="examine-back-emblem">
                      <IconCardBack />
                    </span>
                    <span>仅此一面</span>
                  </div>
                )}
              </div>
              {card.holo ? (
                <>
                  <div className="holo-foil" aria-hidden="true" />
                  <div className="holo-glare" aria-hidden="true" />
                  <div className="holo-sparkles" aria-hidden="true">
                    {sparks.map((spark) => (
                      <span
                        key={spark.key}
                        style={
                          {
                            left: spark.left,
                            top: spark.top,
                            '--size': spark.size,
                            '--dur': spark.duration,
                            '--delay': spark.delay,
                          } as React.CSSProperties
                        }
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="examine-meta">
          <span className="examine-side-label">{flipped ? '背面' : card.back ? '正面 · 轻点翻面' : '正面'}</span>
          <h2 className="examine-title">{card.title}</h2>
          <p className="examine-date">{formatDate(card.cardDate)}</p>
        </div>
      </div>

      {confirmDelete ? (
        <>
          <div className="examine-dialog-scrim" onClick={() => setConfirmDelete(false)} />
          <div className="examine-dialog" role="alertdialog" aria-label="删除卡片">
            <h3>删除这张卡？</h3>
            <p className="examine-dialog-text">删除后无法恢复。</p>
            <div className="examine-dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                取消
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                确认删除
              </button>
            </div>
          </div>
        </>
      ) : null}

      {editing ? (
        <>
          <div className="examine-dialog-scrim" onClick={() => setEditing(false)} />
          <form className="examine-dialog" onSubmit={saveEdit} role="dialog" aria-label="编辑卡片">
            <h3>编辑卡片</h3>
            <label>
              标题
              <input
                value={editTitle}
                maxLength={60}
                autoFocus
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </label>
            <label>
              日期
              <input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
            </label>
            <HoloToggle checked={editHolo} onChange={setEditHolo} />
            {editError ? <p className="examine-edit-error">{editError}</p> : null}
            <div className="examine-dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                取消
              </button>
              <button type="submit" className="btn btn-gold" disabled={editSaving}>
                {editSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </>
      ) : null}

    </div>
  )
}
