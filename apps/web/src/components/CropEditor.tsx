import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DetectionResult, Point, Quad } from '../lib/detectCard'
import { detectCard, warpCrop, type PreparedImage } from '../lib/image'
import { clamp } from '../lib/format'
import type { CropResult } from '@cardvault/shared/types'
import { IconChevronLeft, IconChevronRight, IconImage, IconSparkle } from './icons'

interface CropEditorProps {
  prepared: PreparedImage
  sideLabel: string
  initialQuad: Quad | null
  onBack: () => void
  onConfirm: (crop: CropResult, quad: Quad) => void
}

interface DragState {
  kind: 'corner' | 'move'
  index: number
  startX: number
  startY: number
  origin: Quad
}

const FULL_QUAD: Quad = [
  { x: 0.004, y: 0.004 },
  { x: 0.996, y: 0.004 },
  { x: 0.996, y: 0.996 },
  { x: 0.004, y: 0.996 },
]

export function CropEditor({ prepared, sideLabel, initialQuad, onBack, onConfirm }: CropEditorProps) {
  const [quad, setQuad] = useState<Quad | null>(initialQuad)
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [busy, setBusy] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const initialRef = useRef(initialQuad)
  initialRef.current = initialQuad

  useEffect(() => {
    if (initialRef.current) {
      setQuad(initialRef.current)
      setDetection(null)
      return
    }
    const result = detectCard(prepared)
    setQuad(result.quad)
    setDetection(result)
  }, [prepared])

  useLayoutEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const measure = () => setAvailableWidth(element.clientWidth - 28)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const aspect = prepared.width / Math.max(1, prepared.height)
  const maxHeight = Math.min(window.innerHeight * 0.52, 560)
  const boxWidth = Math.max(120, Math.min(Math.max(140, availableWidth), maxHeight * aspect))
  const boxHeight = boxWidth / aspect

  const corners: Point[] = (quad ?? FULL_QUAD).map((point) => ({
    x: point.x * boxWidth,
    y: point.y * boxHeight,
  }))

  const linePath = `M${corners[0]!.x} ${corners[0]!.y} L${corners[1]!.x} ${corners[1]!.y} L${corners[2]!.x} ${corners[2]!.y} L${corners[3]!.x} ${corners[3]!.y} Z`
  const maskPath = `M0 0 H${boxWidth} V${boxHeight} H0 Z ${linePath}`

  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const topMid = mid(corners[0]!, corners[1]!)
  const bottomMid = mid(corners[3]!, corners[2]!)
  const leftMid = mid(corners[0]!, corners[3]!)
  const rightMid = mid(corners[1]!, corners[2]!)

  const rerunDetection = useCallback(() => {
    setDetecting(true)
    setError('')
    window.setTimeout(() => {
      try {
        const result = detectCard(prepared)
        setQuad(result.quad)
        setDetection(result)
        if (!result.auto) setError('没有识别到明确的卡片边缘，请手动拖动四角')
      } catch {
        setError('识别失败，请手动调整四角')
      } finally {
        setDetecting(false)
      }
    }, 30)
  }, [prepared])

  const beginDrag = (event: React.PointerEvent, kind: 'corner' | 'move', index: number) => {
    if (!quad) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      kind,
      index,
      startX: event.clientX,
      startY: event.clientY,
      origin: quad.map((point) => ({ ...point })) as Quad,
    }
    try {
      svgRef.current?.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    event.preventDefault()
    const dx = (event.clientX - drag.startX) / Math.max(1, boxWidth)
    const dy = (event.clientY - drag.startY) / Math.max(1, boxHeight)
    if (drag.kind === 'corner') {
      setQuad(
        drag.origin.map((point, index) =>
          index === drag.index
            ? { x: clamp(point.x + dx, 0, 1), y: clamp(point.y + dy, 0, 1) }
            : point,
        ) as Quad,
      )
    } else {
      const xs = drag.origin.map((point) => point.x)
      const ys = drag.origin.map((point) => point.y)
      const safeDx = clamp(dx, -Math.min(...xs), 1 - Math.max(...xs))
      const safeDy = clamp(dy, -Math.min(...ys), 1 - Math.max(...ys))
      setQuad(drag.origin.map((point) => ({ x: point.x + safeDx, y: point.y + safeDy })) as Quad)
    }
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const confirm = async () => {
    if (!quad || busy) return
    setBusy(true)
    setError('')
    await new Promise((resolve) => window.setTimeout(resolve, 40))
    try {
      const crop = warpCrop(prepared, quad)
      onConfirm(crop, quad)
    } catch {
      setError('拉正卡面时出错了，请重试或调整四角')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="crop-head">
        <div className="crop-side">
          {sideLabel}
          <small>拖动四角贴合卡面</small>
        </div>
        <div className="crop-toolbar">
          <span className="detect-badge" data-auto={detection?.auto ?? false}>
            {detection?.auto ? `自动识别 · ${Math.round(detection.confidence * 100)}%` : '手动框选'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={rerunDetection} disabled={detecting}>
            <IconSparkle size={13} />
            {detecting ? '识别中…' : '重新识别'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuad(FULL_QUAD)
              setDetection(null)
            }}
          >
            <IconImage size={13} />
            整图
          </button>
        </div>
      </div>

      <div className="crop-frame-wrap" ref={wrapRef}>
        <div className="crop-frame" style={{ width: boxWidth, height: boxHeight }}>
          <img src={prepared.previewUrl} alt="待裁切的卡片照片" draggable={false} />
          <svg
            ref={svgRef}
            className="crop-svg"
            viewBox={`0 0 ${boxWidth} ${boxHeight}`}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <path className="crop-mask" d={maskPath} fillRule="evenodd" pointerEvents="none" />
            <path className="crop-line" d={linePath} pointerEvents="none" />
            <line className="crop-third" x1={topMid.x} y1={topMid.y} x2={bottomMid.x} y2={bottomMid.y} pointerEvents="none" />
            <line className="crop-third" x1={leftMid.x} y1={leftMid.y} x2={rightMid.x} y2={rightMid.y} pointerEvents="none" />
            <polygon
              points={corners.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="rgba(0,0,0,0.001)"
              style={{ cursor: 'move' }}
              onPointerDown={(event) => beginDrag(event, 'move', 0)}
            />
            {corners.map((point, index) => (
              <g
                key={index}
                onPointerDown={(event) => beginDrag(event, 'corner', index)}
                style={{ cursor: 'grab' }}
                aria-hidden="true"
              >
                <circle className="crop-handle-halo" cx={point.x} cy={point.y} r={20} />
                <circle className="crop-handle" cx={point.x} cy={point.y} r={8.5} />
              </g>
            ))}
          </svg>
          {busy ? (
            <div className="crop-busy">
              <span className="spinner" />
              <span>正在把卡面拉正…</span>
            </div>
          ) : null}
        </div>
      </div>

      <p className="crop-tip">
        自动识别框住的是照片里最大的一块近似矩形。四角可以随意拖动，透视、倾斜都会被拉正。
      </p>
      {error ? (
        <p className="crop-tip" style={{ color: '#e5a491' }} role="status">
          {error}
        </p>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 18 }}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <IconChevronLeft size={15} />
          上一步
        </button>
        <button type="button" className="btn btn-gold" onClick={() => void confirm()} disabled={busy || !quad}>
          下一步
          <IconChevronRight size={15} />
        </button>
      </div>
    </>
  )
}
