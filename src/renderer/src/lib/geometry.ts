import type { CursorPoint, FitMode, Overlay, Rect } from '@shared/types'

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 把 srcW×srcH 按 contain/cover/fill 塞进 dstW×dstH，返回画布坐标下的矩形 */
export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: FitMode,
  offsetX = 0,
  offsetY = 0
): Rect {
  const safeSrcW = srcW > 0 ? srcW : 16
  const safeSrcH = srcH > 0 ? srcH : 9
  if (mode === 'fill') return { x: offsetX, y: offsetY, width: dstW, height: dstH }
  const scale =
    mode === 'cover'
      ? Math.max(dstW / safeSrcW, dstH / safeSrcH)
      : Math.min(dstW / safeSrcW, dstH / safeSrcH)
  const width = safeSrcW * scale
  const height = safeSrcH * scale
  return {
    x: offsetX + (dstW - width) / 2,
    y: offsetY + (dstH - height) / 2,
    width,
    height
  }
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2))
  ctx.beginPath()
  if (r <= 0.5) {
    ctx.rect(x, y, width, height)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/** 贴图在画布上的外框（x/y 为中心点） */
export function overlayBox(overlay: Overlay, canvasWidth: number, canvasHeight: number): Rect {
  const height = overlay.scale * canvasHeight
  const width = height * (overlay.aspect > 0 ? overlay.aspect : 1)
  return {
    x: overlay.x * canvasWidth,
    y: overlay.y * canvasHeight,
    width,
    height
  }
}

export interface CursorNorm {
  nx: number
  ny: number
  inside: boolean
}

/** 屏幕坐标 → 该显示器画面内的归一化坐标 */
export function normalizeCursor(point: CursorPoint, bounds: Rect): CursorNorm | null {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const nx = (point.x - bounds.x) / bounds.width
  const ny = (point.y - bounds.y) / bounds.height
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null
  const inside = nx >= -0.01 && nx <= 1.01 && ny >= -0.01 && ny <= 1.01
  return { nx: clamp(nx, 0, 1), ny: clamp(ny, 0, 1), inside }
}

/** 文字贴图的估算宽高比，只用于编辑框与被选中时的外框 */
export function textAspect(text: string): number {
  const lines = (text || '文字').split('\n')
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1)
  return clamp(longest * 0.62, 0.8, 24)
}

export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const num = Number.parseInt(full.slice(0, 6), 16)
  if (Number.isNaN(num)) return `rgba(255,255,255,${alpha})`
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r},${g},${b},${alpha})`
}
