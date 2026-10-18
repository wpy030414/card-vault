import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Quad } from '../lib/detectCard'
import { prepareImage, type PreparedImage } from '../lib/image'
import { todayIso } from '../lib/format'
import type { CardMeta, CropPreset, CropResult } from '@cardvault/shared/types'
import { CropEditor } from './CropEditor'
import { HoloToggle } from './HoloToggle'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconImage,
  IconPlus,
  IconUpload,
} from './icons'

type Step = 'pick' | 'crop' | 'details'
type Side = 'front' | 'back'

interface UploadDialogProps {
  presets: CropPreset[]
  onClose: () => void
  onCreated: (card: CardMeta) => void
  notify: (message: string, kind?: 'ok' | 'error') => void
}

const STEP_META: Record<Step, { title: string; sub: string; index: number }> = {
  pick: { title: '收录新卡', sub: '选择卡面照片 · 正面必填，背面可选', index: 0 },
  crop: { title: '拉正卡面', sub: '自动寻找卡片边缘 · 可套用自定义模式', index: 1 },
  details: { title: '题名入匣', sub: '写下一个名字与一段日期', index: 2 },
}

export function UploadDialog({ presets, onClose, onCreated, notify }: UploadDialogProps) {
  const [step, setStep] = useState<Step>('pick')
  const [cropSide, setCropSide] = useState<Side>('front')
  const [front, setFront] = useState<PreparedImage | null>(null)
  const [back, setBack] = useState<PreparedImage | null>(null)
  const [frontCrop, setFrontCrop] = useState<CropResult | null>(null)
  const [backCrop, setBackCrop] = useState<CropResult | null>(null)
  const [frontQuad, setFrontQuad] = useState<Quad | null>(null)
  const [backQuad, setBackQuad] = useState<Quad | null>(null)
  const [loadingSlot, setLoadingSlot] = useState<Side | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso())
  const [holo, setHolo] = useState(false)

  const frontInput = useRef<HTMLInputElement>(null)
  const backInput = useRef<HTMLInputElement>(null)

  const dirty = Boolean(front || back || title.trim())
  const meta = STEP_META[step]

  const loadFile = useCallback(
    async (side: Side, file: File) => {
      setLoadingSlot(side)
      setError('')
      try {
        const prepared = await prepareImage(file)
        if (side === 'front') {
          setFront(prepared)
          setFrontCrop(null)
          setFrontQuad(null)
        } else {
          setBack(prepared)
          setBackCrop(null)
          setBackQuad(null)
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : '图片读取失败', 'error')
      } finally {
        setLoadingSlot(null)
      }
    },
    [notify],
  )

  const removeSide = (side: Side) => {
    if (side === 'front') {
      setFront(null)
      setFrontCrop(null)
      setFrontQuad(null)
    } else {
      setBack(null)
      setBackCrop(null)
      setBackQuad(null)
      if (cropSide === 'back') {
        setCropSide('front')
        if (step === 'crop') setStep('pick')
      }
    }
  }

  const requestClose = useCallback(() => {
    if (saving) return
    if (dirty) {
      const confirmed = window.confirm('放弃这次收录？已选的图片与填写的内容不会保存。')
      if (!confirmed) return
    }
    onClose()
  }, [dirty, onClose, saving])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [requestClose])

  const startCrop = () => {
    if (!front) return
    setError('')
    setCropSide('front')
    setStep('crop')
  }

  const handleCrop = (crop: CropResult, quad: Quad) => {
    if (cropSide === 'front') {
      setFrontCrop(crop)
      setFrontQuad(quad)
      if (back && !backCrop) {
        setCropSide('back')
        return
      }
      setStep('details')
    } else {
      setBackCrop(crop)
      setBackQuad(quad)
      setStep('details')
    }
  }

  const save = async () => {
    if (saving) return
    if (!frontCrop) {
      setCropSide('front')
      setStep('crop')
      return
    }
    if (!title.trim()) {
      setError('给这张卡起一个名字吧')
      return
    }
    if (!date) {
      setError('请选择卡片的日期')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { card } = await api.createCard({
        title: title.trim(),
        cardDate: date,
        holo,
        front: frontCrop,
        back: backCrop,
      })
      onCreated(card)
    } catch (err) {
      setError(err instanceof Error ? err.message : '收入失败，请重试')
      setSaving(false)
    }
  }

  const cropPrepared = cropSide === 'front' ? front : back

  return (
    <div className="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && requestClose()}>
      <section className="sheet panel corner-flourish" aria-modal="true" role="dialog" aria-label="收录新卡">
        <header className="sheet-head">
          <div className="sheet-heading">
            <span className="sheet-title">{meta.title}</span>
            <span className="sheet-sub">{meta.sub}</span>
          </div>
          <div className="sheet-head-actions">
            <div className="step-pills" aria-hidden="true">
              {(['pick', 'crop', 'details'] as Step[]).map((item, index) => (
                <span
                  key={item}
                  className={`step-pill${index === meta.index ? ' is-active' : ''}${index < meta.index ? ' is-done' : ''}`}
                >
                  <i>{index + 1}</i>
                  {item === 'pick' ? '选图' : item === 'crop' ? '裁切' : '题名'}
                </span>
              ))}
            </div>
            <button type="button" className="icon-btn" onClick={requestClose} aria-label="关闭">
              <IconClose size={17} />
            </button>
          </div>
        </header>

        <div className="sheet-body">
          {step === 'pick' ? (
            <>
              <div className="pick-lead">
                <h3>把卡面交给匣子</h3>
                <p>平放在光线均匀的桌面上拍，自动识别会更稳。也可以从相册里挑一张。</p>
              </div>

              <div className="pick-grid">
                {(['front', 'back'] as Side[]).map((side) => {
                  const image = side === 'front' ? front : back
                  const label = side === 'front' ? '正面' : '背面'
                  const inputRef = side === 'front' ? frontInput : backInput
                  return (
                    <div
                      key={side}
                      className={`pick-slot${image ? ' is-filled' : ''}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        const file = event.dataTransfer.files[0]
                        if (file) void loadFile(side, file)
                      }}
                    >
                      {image ? (
                        <>
                          <img src={image.previewUrl} alt={`${label}预览`} />
                          <span className="pick-slot-badge">{label}</span>
                          <div className="pick-slot-actions">
                            <button type="button" onClick={() => inputRef.current?.click()}>
                              更换
                            </button>
                            <button type="button" onClick={() => removeSide(side)}>
                              移除
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pick-slot-empty"
                          onClick={() => inputRef.current?.click()}
                          style={{ width: '100%', height: '100%' }}
                        >
                          {side === 'front' ? <IconImage size={30} /> : <IconPlus size={26} />}
                          <span className="pick-slot-label">
                            {label}
                            {side === 'front' ? '' : ' · 可选'}
                          </span>
                          <span className="pick-slot-hint">
                            {side === 'front' ? '点击选择或拖入图片' : '只有一面就留空'}
                          </span>
                        </button>
                      )}
                      {loadingSlot === side ? (
                        <div className="crop-busy">
                          <span className="spinner" />
                          <span>读取图片…</span>
                        </div>
                      ) : null}
                      <input
                        ref={inputRef}
                        className="visually-hidden"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file) void loadFile(side, file)
                        }}
                      />
                    </div>
                  )
                })}
              </div>

              <p className="pick-note">
                图片会上传到你自己的 SQLite 数据库。支持 JPEG / PNG / WebP；相机直出的 HEIC 若无法解码，请先在相册里导出为 JPEG。
              </p>
            </>
          ) : null}

          {step === 'crop' && cropPrepared ? (
            <CropEditor
              key={cropSide}
              prepared={cropPrepared}
              sideLabel={cropSide === 'front' ? '正面' : '背面'}
              initialQuad={cropSide === 'front' ? frontQuad : backQuad}
              presets={presets}
              onBack={() => setStep('pick')}
              onConfirm={handleCrop}
            />
          ) : null}

          {step === 'details' ? (
            <div className="details-grid">
              <div className="details-preview">
                {frontCrop ? (
                  <figure>
                    <div className="thumb">
                      <img src={frontCrop.dataUrl} alt="正面裁切预览" />
                    </div>
                    <figcaption>正面</figcaption>
                  </figure>
                ) : null}
                {backCrop ? (
                  <figure>
                    <div className="thumb">
                      <img src={backCrop.dataUrl} alt="背面裁切预览" />
                    </div>
                    <figcaption>背面</figcaption>
                  </figure>
                ) : null}
              </div>

              <div className="details-form">
                <div className="field">
                  <label htmlFor="card-title">
                    卡片题名
                    <em>{Array.from(title).length}/60</em>
                  </label>
                  <input
                    id="card-title"
                    value={title}
                    maxLength={60}
                    placeholder="例如：初版青眼白龙"
                    onChange={(event) => {
                      setTitle(event.target.value)
                      setError('')
                    }}
                    autoComplete="off"
                  />
                </div>

                <div className="field">
                  <label htmlFor="card-date">
                    日期
                    <em>收录或发行的日子</em>
                  </label>
                  <input
                    id="card-date"
                    type="date"
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value)
                      setError('')
                    }}
                  />
                </div>

                <HoloToggle checked={holo} onChange={setHolo} />

                <p className="details-note">
                  收录后，这张卡会出现在圆环里。轻点停驻，上滑即可端详；有背面的卡可以轻点翻面，晃动手机还能看见彩光。
                </p>

                {error ? (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {step !== 'crop' ? (
          <footer className="sheet-foot">
            <span className="sheet-note">
              {step === 'pick' ? '正面必填 · 背面可选 · 建议单张不超过 32MB' : '藏品只会在登录后可见'}
            </span>
            <div className="sheet-foot-right">
              {step === 'details' ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setStep('crop')
                    setCropSide(back && backCrop ? 'back' : 'front')
                  }}
                >
                  <IconChevronLeft size={15} />
                  上一步
                </button>
              ) : null}
              {step === 'pick' ? (
                <button type="button" className="btn btn-gold" onClick={startCrop} disabled={!front || loadingSlot !== null}>
                  开始裁切
                  <IconChevronRight size={15} />
                </button>
              ) : (
                <button type="button" className="btn btn-gold" onClick={() => void save()} disabled={saving}>
                  <IconUpload size={15} />
                  {saving ? '正在收入匣中…' : '收入匣中'}
                </button>
              )}
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  )
}
