import { useEffect, useRef, useState } from 'react'
import type { Overlay, RecorderStatus } from '@shared/types'
import { clamp } from '@/lib/geometry'
import { formatDuration } from '@/lib/format'

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement>
  overlays: Overlay[]
  selectedId: string | null
  /** 输出画面宽高比，用于让编辑框与画布对齐 */
  aspect: number
  status: RecorderStatus
  countdown: number
  elapsed: number
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<Overlay>) => void
}

/** 舞台按容器大小等比缩放，保证编辑框与画布坐标严格对齐 */
function useStageSize(aspect: number): {
  ref: React.RefObject<HTMLDivElement>
  size: { width: number; height: number }
} {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 640, height: 360 })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      const availableWidth = Math.max(120, rect.width - 24)
      const availableHeight = Math.max(68, rect.height - 24)
      let width = availableWidth
      let height = width / Math.max(0.01, aspect)
      if (height > availableHeight) {
        height = availableHeight
        width = height * Math.max(0.01, aspect)
      }
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [aspect])

  return { ref, size }
}

export function StageView(props: Props): React.JSX.Element {
  const { canvasRef, overlays, selectedId, status } = props
  const { ref: outerRef, size } = useStageSize(props.aspect)

  /** 贴图拖动：移动 / 缩放 / 旋转都换算成相对舞台的归一化坐标 */
  const beginPointer = (
    event: React.PointerEvent,
    overlay: Overlay,
    mode: 'move' | 'scale' | 'rotate'
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const element = outerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const stageRect = rect
    const centerX = stageRect.left + overlay.x * stageRect.width
    const centerY = stageRect.top + overlay.y * stageRect.height
    const startX = event.clientX
    const startY = event.clientY
    const startDistance = Math.hypot(startX - centerX, startY - centerY) || 1
    const startAngle = Math.atan2(startY - centerY, startX - centerX)

    const move = (moveEvent: PointerEvent): void => {
      if (mode === 'move') {
        props.onUpdate(overlay.id, {
          x: clamp((moveEvent.clientX - stageRect.left) / stageRect.width, 0, 1),
          y: clamp((moveEvent.clientY - stageRect.top) / stageRect.height, 0, 1)
        })
        return
      }
      if (mode === 'scale') {
        const distance = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY)
        props.onUpdate(overlay.id, { scale: clamp(overlay.scale * (distance / startDistance), 0.01, 1.5) })
        return
      }
      const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX)
      props.onUpdate(overlay.id, { rotation: overlay.rotation + ((angle - startAngle) * 180) / Math.PI })
    }

    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="stage-outer" ref={outerRef}>
      <div
        className="stage"
        style={{ width: size.width, height: size.height }}
        onPointerDown={() => props.onSelect(null)}
      >
        <canvas ref={canvasRef} className="stage-canvas" />

        <div className="stage-handles">
          {overlays
            .filter((overlay) => overlay.visible)
            .map((overlay) => {
              const widthPercent = (overlay.aspect * overlay.scale * 100) / props.aspect
              const heightPercent = overlay.scale * 100
              const active = overlay.id === selectedId
              return (
                <div
                  key={overlay.id}
                  role="button"
                  tabIndex={-1}
                  className={`ov-box${active ? ' is-active' : ''}`}
                  style={{
                    left: `${overlay.x * 100}%`,
                    top: `${overlay.y * 100}%`,
                    width: `${widthPercent}%`,
                    height: `${heightPercent}%`,
                    transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
                    opacity: overlay.opacity
                  }}
                  onPointerDown={(event) => {
                    props.onSelect(overlay.id)
                    beginPointer(event, overlay, 'move')
                  }}
                >
                  {active ? <span className="ov-tag">{overlay.label}</span> : null}
                  {active ? (
                    <>
                      <span
                        className="ov-handle is-scale"
                        onPointerDown={(event) => beginPointer(event, overlay, 'scale')}
                      />
                      <span
                        className="ov-handle is-rotate"
                        onPointerDown={(event) => beginPointer(event, overlay, 'rotate')}
                      />
                    </>
                  ) : null}
                </div>
              )
            })}
        </div>

        {status === 'preparing' ? <div className="stage-mask">正在准备画面…</div> : null}
        {status === 'countdown' ? (
          <div className="stage-mask is-countdown">
            <b>{props.countdown}</b>
            <span>准备开始</span>
          </div>
        ) : null}
        {status === 'recording' || status === 'paused' || status === 'finishing' ? (
          <div className={`rec-badge${status === 'recording' ? '' : ' is-paused'}`}>
            <span className="rec-dot" />
            {status === 'recording' ? '录制中' : status === 'paused' ? '已暂停' : '正在保存'}
            <b>{formatDuration(props.elapsed)}</b>
          </div>
        ) : null}
      </div>
    </div>
  )
}
