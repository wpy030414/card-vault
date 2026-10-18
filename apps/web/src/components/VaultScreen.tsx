import { useEffect, useState } from 'react'
import type { CardMeta, CardOrigin, User } from '@cardvault/shared/types'
import { RingStage } from './RingStage'
import { IconCrop, IconLogout, IconMore, IconPlus } from './icons'

interface VaultScreenProps {
  user: User
  cards: CardMeta[]
  isExamining: boolean
  resetKey: number
  onExamine: (card: CardMeta, origin?: CardOrigin) => void
  onOpenUpload: () => void
  onOpenCropPresets: () => void
  onLogout: () => void
}

export function VaultScreen({
  user,
  cards,
  isExamining,
  resetKey,
  onExamine,
  onOpenUpload,
  onOpenCropPresets,
  onLogout,
}: VaultScreenProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isExamining) return
      if (menuOpen) {
        if (event.key === 'Escape') {
          if (logoutConfirm) setLogoutConfirm(false)
          else setMenuOpen(false)
        }
        return
      }
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onOpenUpload()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isExamining, logoutConfirm, menuOpen, onOpenUpload])

  const closeMenu = () => {
    setMenuOpen(false)
    setLogoutConfirm(false)
  }

  return (
    <div className={`vault${isExamining ? ' is-examining' : ''}`}>
      <header className="vault-topbar">
        <div className="vault-brand">
          <span className="vault-brand-name">CardVault</span>
        </div>

        <div className="user-chip">
          <UserAvatar user={user} />
          {user.nickname !== '人' ? <span className="user-name">{user.nickname}</span> : null}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMenuOpen(true)}
            title="菜单"
            aria-label="收藏匣菜单"
          >
            <IconMore size={15} />
          </button>
        </div>
      </header>

      <RingStage
        cards={cards}
        resetKey={resetKey}
        isExamining={isExamining}
        onExamine={onExamine}
        onOpenUpload={onOpenUpload}
      />

      {cards.length > 0 ? (
        <button type="button" className="add-fab" onClick={onOpenUpload} aria-label="收录新卡" title="收录新卡">
          <IconPlus size={22} />
        </button>
      ) : null}

      {menuOpen ? (
        <>
          <div className="confirm-scrim" onClick={closeMenu} />
          {logoutConfirm ? (
            <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="退出登录">
              <h3>要离开收藏匣吗？</h3>
              <p className="confirm-dialog-text">退出后需要重新扫码才能回来，匣里的卡片不会有任何变化。</p>
              <div className="confirm-dialog-actions">
                <button type="button" className="btn btn-ghost" autoFocus onClick={() => setLogoutConfirm(false)}>
                  取消
                </button>
                <button type="button" className="btn btn-danger" onClick={onLogout}>
                  退出登录
                </button>
              </div>
            </div>
          ) : (
            <div className="confirm-dialog vault-menu-dialog" role="dialog" aria-modal="true" aria-label="收藏匣菜单">
              <h3>收藏匣</h3>
              <div className="vault-menu-list">
                <button
                  type="button"
                  className="vault-menu-item"
                  onClick={() => {
                    closeMenu()
                    onOpenCropPresets()
                  }}
                >
                  <IconCrop size={16} />
                  <span>
                    <strong>自定义裁切模式</strong>
                    <em>保存四角落点，同类照片一键套用</em>
                  </span>
                </button>
                <button type="button" className="vault-menu-item" onClick={() => setLogoutConfirm(true)}>
                  <IconLogout size={16} />
                  <span>
                    <strong>退出登录</strong>
                    <em>服务端上的藏品不受影响</em>
                  </span>
                </button>
              </div>
              <div className="confirm-dialog-actions">
                <button type="button" className="btn btn-ghost" onClick={closeMenu}>
                  关闭
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function UserAvatar({ user }: { user: User }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [user.avatarUrl])
  if (user.avatarUrl && !failed) {
    return (
      <span className="user-avatar">
        <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span className="user-avatar" aria-hidden="true">
      {Array.from(user.nickname)[0] ?? 'C'}
    </span>
  )
}
