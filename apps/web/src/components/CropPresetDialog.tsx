import { useCallback, useEffect, useRef, useState } from 'react'
import type { CropPreset, CropQuad } from '@cardvault/shared/types'
import type { Quad } from '../lib/detectCard'
import { prepareImage, type PreparedImage } from '../lib/image'
import { CropEditor } from './CropEditor'
import {
  IconChevronLeft,
  IconClose,
  IconCrop,
  IconImage,
  IconPlus,
  IconTrash,
} from './icons'

interface CropPresetDialogProps {
  presets: CropPreset[]
  onClose: () => void
  onCreate: (input: { name: string; quad: CropQuad }) => Promise<void>
  onDelete: (preset: CropPreset) => Promise<void>
  notify: (message: string, kind?: 'ok' | 'error') => void
}

type View = 'list' | 'create'

export function CropPresetDialog({ presets, onClose, onCreate, onDelete, notify }: CropPresetDialogProps) {
  const [view, setView] = useState<View>('list')
  const [prepared, setPrepared] = useState<PreparedImage | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CropPreset | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  const resetCreate = useCallback(() => {
    setPrepared(null)
    setName('')
    setError('')
    setLoading(false)
  }, [])

  const goList = useCallback(() => {
    resetCreate()
    setView('list')
  }, [resetCreate])

  const openCreate = () => {
    resetCreate()
    setView('create')
  }

  const requestClose = useCallback(() => {
    if (view === 'create') {
      goList()
      return
    }
    onClose()
  }, [goList, onClose, view])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (pendingDelete) {
        setPendingDelete(null)
        return
      }
      requestClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingDelete, requestClose])

  const loadFile = async (file: File) => {
    setLoading(true)
    setError('')
    try {
      setPrepared(await prepareImage(file))
    } catch (err) {
      notify(err instanceof Error ? err.message : '图片读取失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const savePreset = async (quad: Quad) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('先给这个模式起一个名字')
      nameInput.current?.focus()
      return
    }
    setError('')
    try {
      await onCreate({ name: trimmed, quad: quad as CropQuad })
      notify(`裁切模式「${trimmed}」已保存`)
      goList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete(pendingDelete)
      notify(`已删除裁切模式「${pendingDelete.name}」`)
      setPendingDelete(null)
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => event.target === event.currentTarget && !pendingDelete && requestClose()}
    >
      <section className="sheet panel corner-flourish preset-sheet" role="dialog" aria-modal="true" aria-label="自定义裁切模式">
        <header className="sheet-head">
          <div className="sheet-heading">
            <span className="sheet-title">自定义裁切模式</span>
            <span className="sheet-sub">
              {view === 'create' ? '用一张示例照片定义四角的相对落点' : '同一拍摄位置下，四角落点可以直接复用'}
            </span>
          </div>
          <div className="sheet-head-actions">
            {view === 'create' ? (
              <button type="button" className="btn btn-ghost preset-head-btn" onClick={goList}>
                <IconChevronLeft size={14} />
                返回列表
              </button>
            ) : null}
            <button type="button" className="icon-btn" onClick={requestClose} aria-label="关闭">
              <IconClose size={17} />
            </button>
          </div>
        </header>

        <div className="sheet-body">
          {view === 'list' ? (
            presets.length === 0 ? (
              <div className="preset-empty">
                <span className="preset-empty-mark">
                  <IconCrop size={30} />
                </span>
                <p>还没有自定义裁切模式</p>
                <span>用一张示例照片框出四角并保存；之后同类照片在裁切页一键落点，不用每次重新拖。</span>
              </div>
            ) : (
              <div className="preset-list">
                {presets.map((preset) => (
                  <div className="preset-item" key={preset.id}>
                    <PresetThumb quad={preset.quad} />
                    <div className="preset-item-text">
                      <strong>{preset.name}</strong>
                      <span>
                        {quadSummary(preset.quad)} · 保存于 {formatSavedAt(preset.createdAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-btn preset-delete"
                      onClick={() => setPendingDelete(preset)}
                      aria-label={`删除模式 ${preset.name}`}
                      title="删除模式"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              <div className="field preset-name-field">
                <label htmlFor="preset-name">
                  模式名称
                  <em>{Array.from(name).length}/24</em>
                </label>
                <input
                  id="preset-name"
                  ref={nameInput}
                  value={name}
                  maxLength={24}
                  placeholder="例如：深色桌面 · 左上斜放"
                  autoComplete="off"
                  onChange={(event) => {
                    setName(event.target.value)
                    setError('')
                  }}
                />
              </div>

              {prepared ? (
                <CropEditor
                  prepared={prepared}
                  sideLabel="示例照片"
                  initialQuad={null}
                  presetMode
                  onBack={() => setPrepared(null)}
                  onSavePreset={savePreset}
                />
              ) : (
                <button
                  type="button"
                  className="preset-pick"
                  onClick={() => fileInput.current?.click()}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner" />
                      <span>读取图片…</span>
                    </>
                  ) : (
                    <>
                      <IconImage size={30} />
                      <span>选择一张示例照片</span>
                      <em>任何一张用这套固定位置拍的照片都可以</em>
                    </>
                  )}
                </button>
              )}

              {error ? (
                <p className="preset-error" role="alert">
                  {error}
                </p>
              ) : null}

              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void loadFile(file)
                }}
              />
            </>
          )}
        </div>

        {view === 'list' ? (
          <footer className="sheet-foot">
            <span className="sheet-note">{presets.length} / 60 · 只保存四角落点，不保存照片本身</span>
            <div className="sheet-foot-right">
              <button type="button" className="btn btn-gold" onClick={openCreate}>
                <IconPlus size={14} />
                新建模式
              </button>
            </div>
          </footer>
        ) : null}
      </section>

      {pendingDelete ? (
        <>
          <div className="confirm-scrim" onClick={() => setPendingDelete(null)} />
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除裁切模式">
            <h3>删除这个模式？</h3>
            <p className="confirm-dialog-text">
              「{pendingDelete.name}」的四角落点会被移除，已经收入的卡片不受影响。
            </p>
            <div className="confirm-dialog-actions">
              <button type="button" className="btn btn-ghost" autoFocus onClick={() => setPendingDelete(null)}>
                取消
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 小尺寸四角示意图：外框代表整张照片，折线代表保存的落点 */
function PresetThumb({ quad }: { quad: CropQuad }) {
  const width = 54
  const height = 70
  const padding = 7
  const points = quad
    .map(
      (point) =>
        `${(padding + point.x * (width - padding * 2)).toFixed(1)},${(padding + point.y * (height - padding * 2)).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg className="preset-thumb" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <rect x="0.5" y="0.5" width={width - 1} height={height - 1} rx="7" className="preset-thumb-frame" />
      <polygon points={points} className="preset-thumb-quad" />
    </svg>
  )
}

function quadSummary(quad: CropQuad): string {
  const xs = quad.map((point) => point.x)
  const ys = quad.map((point) => point.y)
  const width = Math.round((Math.max(...xs) - Math.min(...xs)) * 100)
  const height = Math.round((Math.max(...ys) - Math.min(...ys)) * 100)
  return `占画面 ${width}% × ${height}%`
}

function formatSavedAt(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}
