/** 前后端共享的常量 */

export const APP_NAME = 'CardVault'

/** 会话 Cookie 名；服务端签发、续期与清理都用它 */
export const SESSION_COOKIE = 'cv_session'

/** 单张卡面图片的体积上限（服务端与前端预检共用） */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
