export interface User {
  id: string
  nickname: string
  avatarUrl: string | null
}

export interface CardImageMeta {
  width: number
  height: number
  url: string
}

export interface CardMeta {
  id: string
  title: string
  cardDate: string
  createdAt: number
  /** 是否带镀层：开启后端详卡面才有镭射彩光 */
  holo: boolean
  front: CardImageMeta
  back: CardImageMeta | null
}

export interface CropResult {
  dataUrl: string
  width: number
  height: number
}

export interface AuthConfig {
  qqEnabled: boolean
  devAuth: boolean
  publicUrl: string
}

export type QrStatus = 'pending' | 'scanned' | 'authorized' | 'expired'

export interface CardOrigin {
  centerX: number
  centerY: number
  width: number
  height: number
  angle: number
}

/** 归一化坐标（0..1），与图片像素尺寸无关 */
export interface CropPoint {
  x: number
  y: number
}

/** 四角落点，顺序固定：左上、右上、右下、左下 */
export type CropQuad = [CropPoint, CropPoint, CropPoint, CropPoint]

/** 用户保存的自定义裁切模式：同一拍摄位置下复用四角的相对落点 */
export interface CropPreset {
  id: string
  name: string
  quad: CropQuad
  createdAt: number
}
