import type { CursorPoint, Overlay, Rect, StageSettings } from '@shared/types'
import { EFFECT_BY_ID } from './effects'
import { clamp, fitRect, hexToRgba, normalizeCursor, overlayBox, roundRectPath } from './geometry'

export interface FrameInput {
  screen: HTMLVideoElement | null
  camera: HTMLVideoElement | null
  cursor: CursorPoint | null
  displayBounds: Rect | null
  time: number
  dt: number
}

/**
 * 逐帧把「屏幕画面 + 滤镜 + 贴图 + 光标高亮」画到一块 canvas 上。
 * 这块 canvas 既是预览，也是 MediaRecorder 的画面来源，所见即所得。
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement

  private readonly ctx: CanvasRenderingContext2D
  private readonly images = new Map<string, HTMLImageElement>()
  private noise: HTMLCanvasElement | null = null
  private noisePattern: CanvasPattern | null = null
  private zoom = 1
  private zoomX = 0
  private zoomY = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('无法创建画布上下文')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
  }

  setSize(width: number, height: number): boolean {
    const w = Math.max(2, Math.round(width / 2) * 2)
    const h = Math.max(2, Math.round(height / 2) * 2)
    if (this.canvas.width === w && this.canvas.height === h) return false
    this.canvas.width = w
    this.canvas.height = h
    return true
  }

  /** 提前把用到的贴图加载进内存，避免录制中忽然读盘 */
  preload(overlays: Overlay[]): void {
    const wanted = new Set<string>()
    for (const overlay of overlays) {
      if (overlay.kind === 'image' && overlay.src) {
        wanted.add(overlay.src)
        if (!this.images.has(overlay.src)) {
          const image = new Image()
          image.decoding = 'async'
          image.src = overlay.src
          image.onload = () => undefined
          this.images.set(overlay.src, image)
        }
      }
    }
    for (const key of [...this.images.keys()]) {
      if (!wanted.has(key)) this.images.delete(key)
    }
  }

  draw(input: FrameInput, stage: StageSettings, overlays: Overlay[]): void {
    const { ctx, canvas } = this
    const W = canvas.width
    const H = canvas.height
    if (!W || !H) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'

    const screen = input.screen
    const ready = Boolean(screen && screen.readyState >= 2 && screen.videoWidth > 0)
    const srcW = ready && screen ? screen.videoWidth : 16
    const srcH = ready && screen ? screen.videoHeight : 9

    this.paintBackground(stage, screen, ready, srcW, srcH, W, H)

    const pad = Math.round(stage.padding * Math.min(W, H))
    const base = fitRect(srcW, srcH, W - pad * 2, H - pad * 2, stage.fit, pad, pad)

    // 跟随光标放大：光标先在整屏里定位，再用同一比例映射到画面矩形上
    const norm = input.cursor && input.displayBounds ? normalizeCursor(input.cursor, input.displayBounds) : null
    const wantZoom = stage.zoomEnabled && norm?.inside === true
    const target = wantZoom ? clamp(stage.zoomScale, 1, 3) : 1
    const zoomK = input.dt > 0 ? 1 - Math.pow(1 - clamp(stage.zoomSmooth, 0.03, 1), input.dt * 60) : 1
    this.zoom += (target - this.zoom) * zoomK
    if (Math.abs(this.zoom - 1) < 0.002) this.zoom = 1

    let box: Rect = base
    const zooming = this.zoom > 1 && norm !== null
    if (zooming && norm) {
      const cx = base.x + norm.nx * base.width
      const cy = base.y + norm.ny * base.height
      if (!this.zoomX && !this.zoomY) {
        this.zoomX = cx
        this.zoomY = cy
      }
      const follow = input.dt > 0 ? 1 - Math.pow(0.0015, input.dt) : 1
      this.zoomX += (cx - this.zoomX) * follow
      this.zoomY += (cy - this.zoomY) * follow
      const z = this.zoom
      box = {
        x: this.zoomX - (this.zoomX - base.x) * z,
        y: this.zoomY - (this.zoomY - base.y) * z,
        width: base.width * z,
        height: base.height * z
      }
    } else {
      this.zoomX = 0
      this.zoomY = 0
      box = base
    }

    const radius = (clamp(stage.radius, 0, 120) / 1080) * H
    const effect = EFFECT_BY_ID[stage.effect] ?? EFFECT_BY_ID.none

    if (stage.shadow) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.62)'
      ctx.shadowBlur = Math.max(10, H * 0.035)
      ctx.shadowOffsetY = Math.max(4, H * 0.012)
      roundRectPath(ctx, box.x, box.y, box.width, box.height, radius)
      ctx.fillStyle = '#05060a'
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    roundRectPath(ctx, box.x, box.y, box.width, box.height, radius)
    ctx.clip()
    if (ready && screen) {
      ctx.filter = effect.filter || 'none'
      if (stage.mirror) {
        ctx.translate(box.x + box.width, box.y)
        ctx.scale(-1, 1)
        ctx.drawImage(screen, 0, 0, box.width, box.height)
      } else {
        ctx.drawImage(screen, box.x, box.y, box.width, box.height)
      }
      ctx.filter = 'none'
    } else {
      ctx.fillStyle = '#12141b'
      ctx.fillRect(box.x, box.y, box.width, box.height)
    }
    ctx.restore()

    // 暗角与噪点
    if (stage.vignette > 0.01) {
      const gradient = ctx.createRadialGradient(
        W / 2,
        H / 2,
        Math.min(W, H) * 0.22,
        W / 2,
        H / 2,
        Math.max(W, H) * 0.72
      )
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(1, `rgba(0,0,0,${clamp(stage.vignette, 0, 1)})`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, W, H)
    }
    if (stage.grain > 0.01) {
      if (!this.noisePattern) this.noisePattern = this.buildNoise()
      if (this.noisePattern) {
        ctx.save()
        ctx.globalAlpha = clamp(stage.grain, 0, 1) * 0.4
        ctx.globalCompositeOperation = 'overlay'
        ctx.fillStyle = this.noisePattern
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
      }
    }

    for (const overlay of overlays) {
      if (!overlay.visible || overlay.opacity <= 0.01) continue
      this.drawOverlay(overlay, W, H, input.time, input.camera)
    }

    if (stage.watermarkEnabled && stage.watermarkText.trim()) {
      this.drawWatermark(stage, W, H)
    }

    if (stage.cursorEnabled && ready && norm?.inside) {
      this.drawCursor(box.x + norm.nx * box.width, box.y + norm.ny * box.height, stage, H, input.time)
    }
  }

  private paintBackground(
    stage: StageSettings,
    screen: HTMLVideoElement | null,
    ready: boolean,
    srcW: number,
    srcH: number,
    W: number,
    H: number
  ): void {
    const { ctx } = this
    if (stage.background === 'blur' && ready && screen) {
      const cover = fitRect(srcW, srcH, W, H, 'cover')
      const over = Math.round(Math.min(W, H) * 0.06)
      ctx.save()
      ctx.filter = 'blur(30px) brightness(0.58) saturate(1.15)'
      ctx.drawImage(
        screen,
        cover.x - over,
        cover.y - over,
        cover.width + over * 2,
        cover.height + over * 2
      )
      ctx.filter = 'none'
      ctx.restore()
      return
    }
    if (stage.background === 'white') {
      ctx.fillStyle = '#ffffff'
    } else if (stage.background === 'graphite') {
      ctx.fillStyle = '#15171e'
    } else if (stage.background === 'gradient') {
      const gradient = ctx.createLinearGradient(0, 0, W, H)
      gradient.addColorStop(0, '#1b2036')
      gradient.addColorStop(0.5, '#2b1d38')
      gradient.addColorStop(1, '#0d1220')
      ctx.fillStyle = gradient
    } else {
      ctx.fillStyle = '#000000'
    }
    ctx.fillRect(0, 0, W, H)
  }

  private buildNoise(): CanvasPattern | null {
    if (!this.noise) {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 160
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const image = ctx.createImageData(canvas.width, canvas.height)
      for (let i = 0; i < image.data.length; i += 4) {
        const value = 110 + Math.random() * 90
        image.data[i] = value
        image.data[i + 1] = value
        image.data[i + 2] = value
        image.data[i + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
      this.noise = canvas
    }
    return this.ctx.createPattern(this.noise, 'repeat')
  }

  private drawOverlay(overlay: Overlay, W: number, H: number, time: number, camera: HTMLVideoElement | null): void {
    const { ctx } = this
    const box = overlayBox(overlay, W, H)
    let x = box.x
    let y = box.y
    let spin = 0
    let scaleX = 1
    let scaleY = 1

    if (overlay.anim === 'float') y += Math.sin(time / 520) * box.height * 0.14
    if (overlay.anim === 'pulse') {
      const factor = 1 + Math.sin(time / 380) * 0.07
      scaleX = factor
      scaleY = factor
    }
    if (overlay.anim === 'shake') x += Math.sin(time / 90) * box.width * 0.025
    if (overlay.anim === 'spin') spin = (time / 2400) * Math.PI * 2

    ctx.save()
    ctx.globalAlpha = clamp(overlay.opacity, 0, 1)
    ctx.translate(x, y)
    ctx.rotate(((overlay.rotation * Math.PI) / 180) + spin)
    ctx.scale(scaleX, scaleY)

    if (overlay.kind === 'image') {
      const image = overlay.src ? this.images.get(overlay.src) : null
      if (image && image.complete && image.naturalWidth > 0) {
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = box.height * 0.12
        ctx.drawImage(image, -box.width / 2, -box.height / 2, box.width, box.height)
      } else {
        roundRectPath(ctx, -box.width / 2, -box.height / 2, box.width, box.height, box.height * 0.12)
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        ctx.fill()
      }
    } else if (overlay.kind === 'emoji') {
      ctx.font = `${box.height}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(overlay.text || '⭐', 0, 0)
    } else if (overlay.kind === 'text') {
      this.drawText(overlay, box)
    } else if (overlay.kind === 'camera') {
      this.drawCamera(overlay, box, H, camera)
    }

    ctx.restore()
  }

  private drawText(overlay: Overlay, box: Rect): void {
    const { ctx } = this
    const fontSize = Math.max(8, box.height)
    ctx.font = `${overlay.bold ? '700' : '600'} ${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = (overlay.text || '').split('\n')
    const lineHeight = fontSize * 1.28
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
    const boxWidth = widest + fontSize * 0.7
    const boxHeight = lines.length * lineHeight + fontSize * 0.34
    if (overlay.bgColor && overlay.bgColor !== 'transparent') {
      roundRectPath(ctx, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, fontSize * 0.32)
      ctx.fillStyle = overlay.bgColor
      ctx.fill()
    }
    ctx.fillStyle = overlay.color || '#ffffff'
    lines.forEach((line, index) => {
      ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight)
    })
  }

  private drawCamera(overlay: Overlay, box: Rect, canvasHeight: number, camera: HTMLVideoElement | null): void {
    const { ctx } = this
    const width = box.width
    const height = box.height
    const radius = overlay.shape === 'circle' ? Math.min(width, height) / 2 : overlay.shape === 'rounded' ? Math.min(width, height) * 0.14 : 0

    ctx.save()
    roundRectPath(ctx, -width / 2, -height / 2, width, height, radius)
    ctx.clip()
    ctx.fillStyle = '#0b0d12'
    ctx.fillRect(-width / 2, -height / 2, width, height)
    if (camera && camera.readyState >= 2 && camera.videoWidth > 0) {
      const inner = fitRect(camera.videoWidth, camera.videoHeight, width, height, 'cover', -width / 2, -height / 2)
      if (overlay.mirror) {
        ctx.translate(width, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(camera, inner.x, inner.y, inner.width, inner.height)
    }
    ctx.restore()

    if (overlay.border) {
      roundRectPath(ctx, -width / 2, -height / 2, width, height, radius)
      ctx.lineWidth = Math.max(2, canvasHeight * 0.0045)
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.stroke()
    }
  }

  private drawWatermark(stage: StageSettings, W: number, H: number): void {
    const { ctx } = this
    const fontSize = Math.max(12, Math.round(H * 0.028))
    ctx.save()
    ctx.globalAlpha = clamp(stage.watermarkOpacity, 0, 1)
    ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const margin = Math.round(H * 0.03)
    const textWidth = ctx.measureText(stage.watermarkText).width
    const padX = fontSize * 0.6
    const padY = fontSize * 0.4
    let x = W - margin - textWidth
    let baseline = H - margin
    if (stage.watermarkPosition === 'bl') x = margin
    if (stage.watermarkPosition === 'tl') {
      x = margin
      baseline = margin + fontSize
    }
    if (stage.watermarkPosition === 'tr') {
      x = W - margin - textWidth
      baseline = margin + fontSize
    }
    roundRectPath(ctx, x - padX, baseline - fontSize - padY, textWidth + padX * 2, fontSize + padY * 2, fontSize * 0.4)
    ctx.fillStyle = 'rgba(0,0,0,0.34)'
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    ctx.fillText(stage.watermarkText, x, baseline)
    ctx.restore()
  }

  private drawCursor(x: number, y: number, stage: StageSettings, H: number, time: number): void {
    const { ctx } = this
    const size = clamp(stage.cursorSize, 0.01, 0.2) * H
    const color = stage.cursorColor || '#ff2d55'
    ctx.save()
    ctx.translate(x, y)

    if (stage.cursorStyle === 'halo') {
      const pulse = 1 + Math.sin(time / 420) * 0.08
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.8 * pulse)
      gradient.addColorStop(0, hexToRgba(color, 0.5))
      gradient.addColorStop(1, hexToRgba(color, 0))
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(0, 0, size * 1.8 * pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    } else if (stage.cursorStyle === 'dot') {
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = size * 0.18
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, size, 0, Math.PI * 2)
      ctx.lineWidth = size * 0.24
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
    ctx.restore()
  }
}
