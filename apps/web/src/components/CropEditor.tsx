import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CropPreset } from '@cardvault/shared/types'
import type { Point, Quad } from '../lib/detectCard'
import { detectCard, warpCrop, type PreparedImage } from '../lib/image'
import { clamp } from '../lib/format'
import type { CropResult } from '@cardvault/shared/types'
import { IconChevronLeft, IconChevronRight, IconCrop, IconImage, IconSparkle } from './icons'

interface CropEditorProps {
  prepared: PreparedImage
  sideLabel: string
  initialQuad: Quad | null
  /** 拉到裁切页时展示的自定义模式；点一下即把四角落到保存的相对位置 */
  presets?: CropPreset[]
  /** 定义模式：只保存四角，不做透视拉正 */
  presetMode?: boolean
  onBack: () => void
  onConfirm?: (crop: CropResult, quad: Quad) => void
  onSavePreset?: (quad: Quad) => Promise<void> | void
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

export function CropEditor({
  prepared,
  sideLabel,
  initialQuad,
  presets,
  presetMode = false,
  onBack,
  onConfirm,
  onSavePreset,
}: CropEditorProps) {
  const [quad, setQuad] = useState<Quad | null>(initialQuad)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [busy, setBusy] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const initialRef = useRef(initialQuad)
  initialRef.current = initialQuad

  useEffect(() => {
    if (initialRef.current) {
      setQuad(initialRef.current)
      return
    }
    try {
      setQuad(detectCard(prepared).quad)
    } catch {
      setQuad(FULL_QUAD)
    }
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
    setAppliedPresetId(null)
    window.setTimeout(() => {
      try {
        const result = detectCard(prepared)
        setQuad(result.quad)
        if (!result.auto) setError('没有识别到明确的卡片边缘，请拖动四角或套用自定义模式')
      } catch {
        setError('识别失败，请手动调整四角')
      } finally {
        setDetecting(false)
      }
    }, 30)
  }, [prepared])

  const applyPreset = (preset: CropPreset) => {
    setQuad(preset.quad.map((point) => ({ ...point })) as Quad)
    setAppliedPresetId(preset.id)
    setError('')
  }

  const beginDrag = (event: React.PointerEvent, kind: 'corner' | 'move', index: number) => {
    if (!quad) return
    event.preventDefault()
    event.stopPropagation()
    setAppliedPresetId(null)
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
    if (presetMode && !onSavePreset) return
    setBusy(true)
    setError('')
    await new Promise((resolve) => window.setTimeout(resolve, 40))
    try {
      if (presetMode) {
        await onSavePreset?.(quad)
      } else {
        const crop = warpCrop(prepared, quad)
        onConfirm?.(crop, quad)
      }
    } catch {
      if (!presetMode) setError('拉正卡面时出错了，请重试或调整四角')
    } finally {
      setBusy(false)
    }
  }

  const presetChoices = presetMode ? [] : (presets ?? [])

  return (
    <>
      <div className="crop-head">
        <div className="crop-side">
          {sideLabel}
          <small>{presetMode ? '拖动四角框出示意位置' : '拖动四角贴合卡面'}</small>
        </div>
        <div className="crop-toolbar">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={rerunDetection}
            disabled={detecting}
          >
            <IconSparkle size={13} />
            {detecting ? '识别中…' : '重新识别'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuad(FULL_QUAD)
              setAppliedPresetId(null)
            }}
          >
            <IconImage size={13} />
            整图
          </button>
          {presetChoices.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn btn-ghost crop-preset-btn${appliedPresetId === preset.id ? ' is-active' : ''}`}
              title={`套用自定义裁切模式「${preset.name}」`}
              aria-pressed={appliedPresetId === preset.id}
              data-preset-id={preset.id}
              onClick={() => applyPreset(preset)}
            >
              <IconCrop size={13} />
              <span className="crop-preset-name">{preset.name}</span>
            </button>
          ))}
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
            <line
              className="crop-third"
              x1={topMid.x}
              y1={topMid.y}
              x2={bottomMid.x}
              y2={bottomMid.y}
              pointerEvents="none"
            />
            <line
              className="crop-third"
              x1={leftMid.x}
              y1={leftMid.y}
              x2={rightMid.x}
              y2={rightMid.y}
              pointerEvents="none"
            />
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
              <span>{presetMode ? '正在保存模式…' : '正在把卡面拉正…'}</span>
            </div>
          ) : null}
        </div>
      </div>

      <p className="crop-tip">
        {presetMode
          ? '以这张示例照片为准框出四角。保存后，同一拍摄位置的照片都能一键落到相同的相对位置。'
          : '自动识别框住的是照片里最大的一块近似矩形。四角可以随意拖动，透视、倾斜都会被拉正；「整图」右侧的模式会直接落好四角。'}
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
        <button
          type="button"
          className="btn btn-gold"
          onClick={() => void confirm()}
          disabled={busy || !quad}
        >
          {presetMode ? '保存模式' : '下一步'}
          <IconChevronRight size={15} />
        </button>
      </div>
    </>
  )
}
