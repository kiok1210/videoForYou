import { desktopCapturer, screen, session } from 'electron'
import type { CaptureCapabilities, CursorPoint, Rect, SourceInfo, SourceKind } from '@shared/types'

interface PendingCapture {
  sourceId: string
  systemAudio: boolean
}

/**
 * 渲染进程调用 getDisplayMedia 之前，把「用户挑了哪个画面、要不要系统声音」放到这里，
 * setDisplayMediaRequestHandler 收到请求时按这份数据回话，从而绕过系统选择器。
 */
let pending: PendingCapture | null = null
let cursorTimer: NodeJS.Timeout | null = null

/** 系统声音回环：Windows 与 macOS 13+ 可用，Linux 只能靠麦克风 */
const LOOPBACK_SUPPORTED = process.platform === 'win32' || process.platform === 'darwin'

export function setPendingCapture(next: PendingCapture | null): void {
  pending = next
}

export function getCapabilities(): CaptureCapabilities {
  return {
    systemAudio: LOOPBACK_SUPPORTED,
    platform: process.platform,
    displays: screen.getAllDisplays().length
  }
}

/** 列出可录制的屏幕与窗口 */
export async function listSources(kinds: SourceKind[], withThumbnails: boolean): Promise<SourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: kinds,
    thumbnailSize: withThumbnails ? { width: 420, height: 236 } : { width: 0, height: 0 },
    fetchWindowIcons: withThumbnails
  })
  const displays = screen.getAllDisplays()
  return sources.map((source) => {
    const kind: SourceKind = source.id.startsWith('screen') ? 'screen' : 'window'
    const display =
      kind === 'screen' ? displays.find((item) => String(item.id) === source.display_id) ?? null : null
    const bounds: Rect | null = display ? { ...display.bounds } : null
    return {
      id: source.id,
      name: source.name,
      kind,
      thumbnail: withThumbnails && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
      appIcon:
        withThumbnails && source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      displayId: source.display_id ?? '',
      displayBounds: bounds,
      scaleFactor: display ? display.scaleFactor : 1
    }
  })
}

/** 录制类应用需要屏幕/麦克风/摄像头权限，统一放行，避免每次弹系统级对话框 */
function installPermissions(): void {
  const MEDIA = ['media', 'audioCapture', 'videoCapture', 'displayCapture']
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(MEDIA.includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => MEDIA.includes(permission))
}

/** 接管 getDisplayMedia：由渲染进程决定源，系统声音走 loopback */
export function installDisplayMediaHandler(): void {
  installPermissions()
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const wanted = pending
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    const source =
      (wanted ? sources.find((item) => item.id === wanted.sourceId) : undefined) ??
      sources.find((item) => item.id.startsWith('screen')) ??
      sources[0]
    if (!source) {
      callback({})
      return
    }
    const wantAudio = request.audioRequested && Boolean(wanted?.systemAudio) && LOOPBACK_SUPPORTED
    callback({
      video: { id: source.id, name: source.name },
      audio: wantAudio ? 'loopback' : undefined
    })
  })
}

/** 录制期间把真实鼠标位置推给渲染进程，用于画光标高亮与跟随放大 */
export function startCursorTracking(send: (point: CursorPoint) => void): void {
  stopCursorTracking()
  cursorTimer = setInterval(() => {
    const point = screen.getCursorScreenPoint()
    send({ x: point.x, y: point.y })
  }, 16)
}

export function stopCursorTracking(): void {
  if (cursorTimer) {
    clearInterval(cursorTimer)
    cursorTimer = null
  }
}
