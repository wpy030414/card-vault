import { useCallback, useEffect, useRef, useState } from 'react'

type PermissionState = 'unsupported' | 'prompt' | 'granted' | 'denied'

interface MotionEventIOS extends DeviceMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

interface OrientationEventIOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export interface TiltVector {
  /** -1 左 … 1 右 */
  x: number
  /** -1 上 … 1 下 */
  y: number
}

interface MotionHandlers {
  onShake: () => void
  onTilt?: (tilt: TiltVector) => void
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 晃动 + 陀螺仪：
 * - 用加速度差检测摇一摇；
 * - 用 deviceorientation 的 beta/gamma 推算手机姿态，驱动彩光位置；
 * - iOS 13+ 需要在用户手势里申请权限，因此把申请动作暴露给界面按钮。
 */
export function useMotionSensors(active: boolean, handlers: MotionHandlers) {
  const shakeRef = useRef(handlers.onShake)
  const tiltRef = useRef(handlers.onTilt)
  shakeRef.current = handlers.onShake
  tiltRef.current = handlers.onTilt

  const [permission, setPermission] = useState<PermissionState>(() => {
    if (typeof window === 'undefined') return 'unsupported'
    const hasMotion = 'DeviceMotionEvent' in window
    const hasOrientation = 'DeviceOrientationEvent' in window
    if (!hasMotion && !hasOrientation) return 'unsupported'
    // 没有触摸的桌面设备通常没有体感传感器，交给指针倾斜来驱动彩光
    if (navigator.maxTouchPoints === 0) return 'unsupported'
    const motionCtor = hasMotion ? (window.DeviceMotionEvent as unknown as MotionEventIOS) : null
    const orientationCtor = hasOrientation
      ? (window.DeviceOrientationEvent as unknown as OrientationEventIOS)
      : null
    const needsGesture =
      typeof motionCtor?.requestPermission === 'function' ||
      typeof orientationCtor?.requestPermission === 'function'
    return needsGesture ? 'prompt' : 'granted'
  })

  const lastSample = useRef<{ x: number; y: number; z: number; t: number } | null>(null)
  const lastShake = useRef(0)
  const lastSpike = useRef(0)
  const lastTilt = useRef<TiltVector | null>(null)

  const requestPermission = useCallback(async () => {
    if (permission === 'unsupported' || permission === 'granted') return
    const motionCtor =
      'DeviceMotionEvent' in window ? (window.DeviceMotionEvent as unknown as MotionEventIOS) : null
    const orientationCtor =
      'DeviceOrientationEvent' in window
        ? (window.DeviceOrientationEvent as unknown as OrientationEventIOS)
        : null
    const requests: Array<Promise<'granted' | 'denied'>> = []
    if (typeof motionCtor?.requestPermission === 'function') requests.push(motionCtor.requestPermission())
    if (typeof orientationCtor?.requestPermission === 'function') requests.push(orientationCtor.requestPermission())
    if (requests.length === 0) {
      setPermission('granted')
      return
    }
    try {
      const results = await Promise.all(requests)
      setPermission(results.every((result) => result === 'granted') ? 'granted' : 'denied')
    } catch {
      setPermission('denied')
    }
  }, [permission])

  useEffect(() => {
    if (!active || permission !== 'granted') return
    lastSample.current = null
    lastTilt.current = null

    const motionHandler = (event: DeviceMotionEvent) => {
      const raw =
        event.acceleration && event.acceleration.x != null ? event.acceleration : event.accelerationIncludingGravity
      if (!raw || raw.x == null || raw.y == null || raw.z == null) return
      const now = performance.now()
      const sample = { x: raw.x, y: raw.y, z: raw.z, t: now }
      const previous = lastSample.current
      lastSample.current = sample
      if (!previous) return
      const delta =
        Math.abs(sample.x - previous.x) + Math.abs(sample.y - previous.y) + Math.abs(sample.z - previous.z)
      const threshold = event.acceleration && event.acceleration.x != null ? 13 : 26
      if (delta >= threshold) {
        lastSpike.current = now
        if (now - lastShake.current > 850) {
          lastShake.current = now
          shakeRef.current()
        }
      } else if (now - lastSpike.current < 420 && delta >= threshold * 0.55 && now - lastShake.current > 850) {
        lastShake.current = now
        shakeRef.current()
      }
    }

    const orientationHandler = (event: DeviceOrientationEvent) => {
      const gamma = event.gamma
      const beta = event.beta
      if (gamma == null && beta == null) return
      // 竖握手机时 beta ≈ 45°，把这段范围映射到 -1…1
      const next: TiltVector = {
        x: clamp((gamma ?? 0) / 32, -1, 1),
        y: clamp(((beta ?? 45) - 42) / 32, -1, 1),
      }
      const previous = lastTilt.current
      const smoothed = previous
        ? { x: previous.x + (next.x - previous.x) * 0.38, y: previous.y + (next.y - previous.y) * 0.38 }
        : next
      lastTilt.current = smoothed
      tiltRef.current?.(smoothed)
    }

    window.addEventListener('devicemotion', motionHandler)
    window.addEventListener('deviceorientation', orientationHandler)
    return () => {
      window.removeEventListener('devicemotion', motionHandler)
      window.removeEventListener('deviceorientation', orientationHandler)
    }
  }, [active, permission])

  return { permission, requestPermission }
}
