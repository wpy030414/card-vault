import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CardMeta, CardOrigin } from '@cardvault/shared/types'
import { clamp } from '../lib/format'
import { IconCardBack, IconPlus } from './icons'

type Mode = 'idle' | 'dragging' | 'inertia' | 'snapping'
type Axis = 'undecided' | 'horizontal' | 'pull' | 'vertical'

interface Gesture {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  startT: number
  lastT: number
  cardIndex: number
  wasSpinning: boolean
  axis: Axis
}

interface PullState {
  card: CardMeta
  rect: { left: number; top: number; width: number; height: number }
  dy: number
}

interface FanLayout {
  /** 相邻两张牌之间的夹角 */
  step: number
  /** 卡面中心所在的圆半径 */
  radius: number
  /** 圆心在舞台中的纵向位置：位于扇面下方，像握着牌的手 */
  pivotY: number
  /** 同时铺在扇面上的牌数 */
  slotCount: number
}

const DEG_PER_PX = 0.3
const FALLBACK_LAYOUT: FanLayout = { step: 12, radius: 280, pivotY: 0, slotCount: 5 }

function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / Math.max(0.0001, to - from), 0, 1)
  return t * t * (3 - 2 * t)
}

function modulo(value: number, base: number): number {
  return ((value % base) + base) % base
}

interface RingStageProps {
  cards: CardMeta[]
  resetKey: number
  isExamining: boolean
  onExamine: (card: CardMeta, origin?: CardOrigin) => void
  onOpenUpload: () => void
}

export function RingStage({ cards, resetKey, isExamining, onExamine, onOpenUpload }: RingStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Array<HTMLDivElement | null>>([])
  const progressTextRef = useRef<HTMLSpanElement>(null)
  const [layout, setLayout] = useState<FanLayout>(FALLBACK_LAYOUT)
  const [pull, setPull] = useState<PullState | null>(null)

  const physics = useRef({
    angle: 0,
    velocity: 0,
    mode: 'idle' as Mode,
    from: 0,
    target: 0,
    start: 0,
    duration: 0,
    raf: 0,
    last: 0,
  })
  const gestureRef = useRef<Gesture | null>(null)
  const layoutRef = useRef(layout)
  const cardsRef = useRef(cards)
  const examineRef = useRef(isExamining)
  const onExamineRef = useRef(onExamine)
  layoutRef.current = layout
  cardsRef.current = cards
  examineRef.current = isExamining
  onExamineRef.current = onExamine

  /* 把整扇牌看成一圈平铺在屏幕平面上的环：
     圆心在扇面下方，牌心沿圆弧排布，牌面再绕圆心转过同样的角度。
     因此每张牌都是正面朝向镜头，只是像手牌一样错开、叠压。 */
  const apply = useCallback((angle: number) => {
    const deck = deckRef.current
    const { step, radius, slotCount } = layoutRef.current
    const count = cardsRef.current.length
    if (deck) {
      deck.dataset.angle = angle.toFixed(3)
      deck.dataset.step = step.toFixed(3)
    }
    if (count === 0) return

    const position = step > 0 ? angle / step : 0
    const center = (slotCount - 1) / 2
    const total = count
    if (total > 0 && progressTextRef.current) {
      const current = modulo(Math.round(position), total) + 1
      const label = `${current}/${total}`
      if (progressTextRef.current.textContent !== label) progressTextRef.current.textContent = label
    }

    for (let index = 0; index < slotRefs.current.length; index++) {
      const el = slotRefs.current[index]
      if (!el) continue
      const continuous = center + index + position
      const wrapped = modulo(continuous, count)
      // 把循环队列在边界处拆成有符号槽位：左侧离场为负、右侧离场为正，
      // 这样牌离开扇面时会沿弧线继续滑出并淡出，而不是瞬间消失。
      const hiddenRight = Math.max(0, count - slotCount)
      const threshold = slotCount + hiddenRight / 2
      const slotPos = wrapped <= threshold ? wrapped : wrapped - count
      const angleOfCard = (slotPos - center) * step
      // 槽位边界落在第一张/最后一张牌外半格，静止时边缘牌是完整的，
      // 离开时才沿着弧线继续滑出并淡出
      const firstSlot = slotCount % 2 === 1 ? 0 : 0.5
      const edgeDistance = Math.min(slotPos - (firstSlot - 0.5), firstSlot + slotCount - 0.5 - slotPos)
      const presence = smoothstep(0, 0.5, Math.max(0, edgeDistance))
      const shown = presence > 0.002

      el.dataset.cardAngle = angleOfCard.toFixed(3)
      const transform = `rotate(${angleOfCard.toFixed(3)}deg) translateY(${-radius}px) scale(${(1 - (1 - presence) * 0.1).toFixed(3)})`
      if (el.style.transform !== transform) el.style.transform = transform
      // 像手牌一样左侧压右侧：按槽位（而不是按“中间牌最大”）决定叠放
      const zIndex = String(100 + Math.round(slotPos))
      if (el.style.zIndex !== zIndex) el.style.zIndex = zIndex
      const opacity = shown ? presence.toFixed(3) : '0'
      if (el.style.opacity !== opacity) el.style.opacity = opacity
      const pointerEvents = presence > 0.35 ? '' : 'none'
      if (el.style.pointerEvents !== pointerEvents) el.style.pointerEvents = pointerEvents
      const visibility = shown ? 'visible' : 'hidden'
      if (el.style.visibility !== visibility) el.style.visibility = visibility
    }
  }, [])

  const ensureLoop = useCallback(() => {
    const p = physics.current
    if (p.raf) return
    p.last = performance.now()
    p.raf = requestAnimationFrame((now) => tickRef.current(now))
  }, [])

  const beginSnap = useCallback((duration?: number) => {
    const p = physics.current
    const currentStep = layoutRef.current.step
    if (!Number.isFinite(currentStep) || currentStep <= 0) return
    const target = Math.round(p.angle / currentStep) * currentStep
    p.mode = 'snapping'
    p.from = p.angle
    p.target = target
    p.start = performance.now()
    p.duration = duration ?? clamp(520 + Math.abs(target - p.angle) * 1.3, 460, 1000)
    p.velocity = 0
  }, [])

  const requestSnap = useCallback(
    (duration?: number) => {
      beginSnap(duration)
      ensureLoop()
    },
    [beginSnap, ensureLoop],
  )

  const tickRef = useRef<(now: number) => void>(() => undefined)
  tickRef.current = (now: number) => {
    const p = physics.current
    p.raf = 0
    const dt = Math.min(0.05, Math.max(0, (now - (p.last || now)) / 1000))
    p.last = now
    if (p.mode === 'inertia') {
      p.angle += p.velocity * dt
      p.velocity *= Math.exp(-dt * 1.75)
      if (Math.abs(p.velocity) < 8) {
        beginSnap()
      }
      apply(p.angle)
    } else if (p.mode === 'snapping') {
      const t = clamp((now - p.start) / p.duration, 0, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      p.angle = p.from + (p.target - p.from) * eased
      apply(p.angle)
      if (t >= 1) {
        p.angle = p.target
        p.mode = 'idle'
        apply(p.angle)
        return
      }
    } else {
      return
    }
    p.raf = requestAnimationFrame((next) => tickRef.current(next))
  }

  // 量取舞台尺寸：扇面铺多宽、圆心放在哪里、相邻牌错开多少度
  useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      const world = worldRef.current
      if (!stage || !world) return
      const rect = stage.getBoundingClientRect()
      const cardW = world.offsetWidth || 160
      const count = cardsRef.current.length

      const narrow = rect.width < 560
      const maxSlots = rect.width < 900 ? 5 : 7
      const slotCount = Math.max(1, Math.min(count || 1, maxSlots))
      // 牌要大、要离人近：可视槽位少而大，整扇牌铺满屏幕
      const targetSpan = narrow ? 30 : 96
      const spreadStep = count > 1 ? targetSpan / Math.max(1, Math.min(count, maxSlots) - 1) : targetSpan
      const step = count <= 1 ? 360 : clamp(spreadStep, narrow ? 10 : 14, narrow ? 18 : 26)
      // 圆心略低于屏幕底部，弧线从下方把大牌托起来
      const pivotY = Math.round(rect.height * 0.97)
      const topMargin = narrow ? 180 : 140
      const radius = Math.round(
        clamp(pivotY - topMargin - (cardW * 1.4) / 2, cardW * 0.82, Math.max(cardW * 0.82, rect.height * 0.82)),
      )
      setLayout({ step, radius, pivotY, slotCount })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (stageRef.current) observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [cards.length])

  useLayoutEffect(() => {
    slotRefs.current.length = cards.length
    apply(physics.current.angle)
  }, [apply, layout, cards.length])

  useEffect(() => {
    const p = physics.current
    if (p.raf) cancelAnimationFrame(p.raf)
    p.raf = 0
    p.velocity = 0
    setPull(null)
    const cycle = layoutRef.current.step * cardsRef.current.length
    // 归位到最近一圈的等价角度，新牌会从牌山里转到中间
    const target = cycle > 0 ? Math.round(p.angle / cycle) * cycle : 0
    if (Math.abs(target - p.angle) > 0.5) {
      p.mode = 'snapping'
      p.from = p.angle
      p.target = target
      p.start = performance.now()
      p.duration = 760
      ensureLoop()
    } else {
      p.angle = target
      p.mode = 'idle'
      apply(p.angle)
    }
    return () => {
      if (p.raf) cancelAnimationFrame(p.raf)
      p.raf = 0
    }
  }, [resetKey, apply, ensureLoop])

  const openCard = useCallback((card: CardMeta, index: number) => {
    const stage = stageRef.current
    const cardNode = stage?.querySelector<HTMLElement>(`[data-card-index="${index}"] .ring-card`)
    const box = cardNode?.getBoundingClientRect()
    const slot = cardNode?.closest<HTMLElement>('.ring-slot')
    const angle = Number(slot?.dataset.cardAngle ?? 0)
    if (!box) {
      onExamineRef.current(card)
      return
    }
    onExamineRef.current(card, {
      centerX: box.left + box.width / 2,
      centerY: box.top + box.height / 2,
      width: cardNode?.offsetWidth || box.width,
      height: cardNode?.offsetHeight || box.height,
      angle: Number.isFinite(angle) ? angle : 0,
    })
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (examineRef.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target as HTMLElement
    // 圆环舞台铺满整屏，按钮/输入框的点击不能被舞台的指针捕获吞掉
    if (target.closest('button, a, input, textarea, label, [data-no-ring]')) return
    const cardEl = target.closest<HTMLElement>('[data-card-index]')
    const cardIndex = cardEl ? Number(cardEl.dataset.cardIndex) : -1
    const p = physics.current
    const wasSpinning = p.mode === 'inertia' || p.mode === 'snapping' || Math.abs(p.velocity) > 30
    if (p.mode !== 'idle' || p.raf) {
      if (p.raf) cancelAnimationFrame(p.raf)
      p.raf = 0
      p.mode = 'idle'
      p.velocity = 0
    }
    try {
      stageRef.current?.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    const now = performance.now()
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startT: now,
      lastT: now,
      cardIndex: Number.isFinite(cardIndex) ? cardIndex : -1,
      wasSpinning,
      axis: 'undecided',
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const now = performance.now()
    const dx = event.clientX - gesture.lastX
    const totalDx = event.clientX - gesture.startX
    const totalDy = event.clientY - gesture.startY

    if (gesture.axis === 'undecided' && (Math.abs(totalDx) > 8 || Math.abs(totalDy) > 8)) {
      if (Math.abs(totalDy) > Math.abs(totalDx) * 1.15) {
        if (totalDy < 0 && gesture.cardIndex >= 0 && gesture.cardIndex < cardsRef.current.length) {
          gesture.axis = 'pull'
          const cardNode = stageRef.current?.querySelector<HTMLElement>(
            `[data-card-index="${gesture.cardIndex}"] .ring-card`,
          )
          const rect = cardNode?.getBoundingClientRect()
          const card = cardsRef.current[gesture.cardIndex]
          if (rect && card) setPull({ card, rect, dy: totalDy })
        } else {
          gesture.axis = 'vertical'
        }
      } else {
        gesture.axis = 'horizontal'
        stageRef.current?.classList.add('is-dragging')
      }
    }

    if (gesture.axis === 'horizontal') {
      if (cardsRef.current.length <= 1) {
        gesture.lastX = event.clientX
        gesture.lastY = event.clientY
        gesture.lastT = now
        return
      }
      const p = physics.current
      p.angle += dx * DEG_PER_PX
      const elapsed = Math.max(1, now - gesture.lastT)
      const instant = (dx / elapsed) * 1000 * DEG_PER_PX
      p.velocity = clamp(p.velocity * 0.55 + instant * 0.45, -1400, 1400)
      apply(p.angle)
    } else if (gesture.axis === 'pull') {
      setPull((current) => (current ? { ...current, dy: totalDy } : current))
      const progress = clamp(-totalDy / 200, 0, 1)
      const stage = stageRef.current
      if (stage) {
        stage.style.opacity = String(1 - progress * 0.55)
        stage.style.filter = `blur(${(progress * 3).toFixed(2)}px)`
      }
    }

    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    gesture.lastT = now
  }

  const finishGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    const stage = stageRef.current
    stage?.classList.remove('is-dragging')
    if (stage) {
      stage.style.opacity = ''
      stage.style.filter = ''
    }
    try {
      stage?.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }

    const totalDx = event.clientX - gesture.startX
    const totalDy = event.clientY - gesture.startY
    const elapsed = performance.now() - gesture.startT

    if (cancelled) {
      if (gesture.axis === 'horizontal') requestSnap()
      setPull(null)
      return
    }

    if (gesture.axis === 'undecided') {
      if (elapsed < 340 && Math.hypot(totalDx, totalDy) < 10) {
        if (gesture.wasSpinning) {
          requestSnap(820)
        } else if (gesture.cardIndex >= 0) {
          const card = cardsRef.current[gesture.cardIndex]
          if (card) openCard(card, gesture.cardIndex)
        }
      } else if (gesture.wasSpinning) {
        requestSnap(700)
      }
      return
    }

    if (gesture.axis === 'horizontal') {
      const p = physics.current
      if (performance.now() - gesture.lastT > 120) p.velocity = 0
      if (Math.abs(p.velocity) > 30) {
        p.mode = 'inertia'
        ensureLoop()
      } else {
        requestSnap()
      }
    } else if (gesture.axis === 'pull') {
      const progress = clamp(-totalDy / 200, 0, 1)
      if (progress >= 0.42 && gesture.cardIndex >= 0) {
        const card = cardsRef.current[gesture.cardIndex]
        if (card) openCard(card, gesture.cardIndex)
      }
      setPull(null)
    }
  }

  const pullProgress = pull ? clamp(-pull.dy / 200, 0, 1) : 0

  return (
    <>
      <div
        ref={stageRef}
        className="ring-stage"
        style={
          {
            '--pivot-y': `${layout.pivotY}px`,
            '--fan-radius': `${layout.radius}px`,
            '--fan-step': `${layout.step}deg`,
          } as React.CSSProperties
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishGesture(event, false)}
        onPointerCancel={(event) => finishGesture(event, true)}
        aria-label="卡片圆环，左右拨动旋转，上滑端详卡片"
      >
        <div className="ring-aura" aria-hidden="true" />
        <div className="ring-track" aria-hidden="true" />
        <div className="ring-world" ref={worldRef}>
          <div className="ring-deck" ref={deckRef} data-angle="0" data-step={String(layout.step)}>
            {cards.map((card, index) => (
              <div
                key={card.id}
                data-card-index={index}
                className="ring-slot"
                style={{ '--arrival-index': index } as React.CSSProperties}
                ref={(el) => {
                  slotRefs.current[index] = el
                }}
              >
                <div
                  className="ring-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`端详 ${card.title}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openCard(card, index)
                    }
                  }}
                >
                  <div className="ring-face front">
                    <img src={card.front.url} alt="" draggable={false} />
                  </div>
                  <div className="ring-face back" aria-hidden="true">
                    <span className="card-back-seal">
                      <IconCardBack />
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {cards.length === 0 ? (
          <div className="empty-state">
            <div className="empty-plaque">
              <div className="empty-icon" aria-hidden="true">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 3" />
                  <path d="M12 8v8M8 12h8" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="empty-title">匣中尚无藏品</h2>
              <p className="empty-text">收入第一张卡片吧。可以只拍正面，也可以正反两面一起收进来。</p>
              <button type="button" className="btn btn-gold" onClick={onOpenUpload}>
                <IconPlus size={15} /> 收录第一张卡
              </button>
            </div>
          </div>
        ) : (
          <div className="ring-progress">
            <span className="ring-progress-count" ref={progressTextRef}>
              1/{cards.length}
            </span>
          </div>
        )}
      </div>

      {pull ? (
        <div
          className="pull-ghost"
          style={{
            left: pull.rect.left,
            top: pull.rect.top,
            width: pull.rect.width,
            height: pull.rect.height,
            transform: `translate3d(0, ${pull.dy * 0.92}px, 0) scale(${1 + pullProgress * 0.18})`,
            opacity: pullProgress > 0.02 ? 1 : 0,
          }}
          aria-hidden="true"
        >
          <img src={pull.card.front.url} alt="" />
        </div>
      ) : null}
    </>
  )
}
