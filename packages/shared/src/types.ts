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
