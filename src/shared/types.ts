/** 主进程与渲染进程共用的类型定义 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type SourceKind = 'screen' | 'window'

/** 可录制的画面源（一个显示器或一个窗口） */
export interface SourceInfo {
  id: string
  name: string
  kind: SourceKind
  thumbnail: string
  appIcon: string | null
  /** 仅屏幕源有值：所属显示器 id */
  displayId: string
  /** 仅屏幕源有值：显示器在虚拟桌面中的位置（DIP） */
  displayBounds: Rect | null
  scaleFactor: number
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  message?: string
}

export interface CaptureCapabilities {
  /** 是否支持系统声音回环（Windows / macOS 13+） */
  systemAudio: boolean
  platform: string
  displays: number
}

/** 屏幕坐标（DIP） */
export interface CursorPoint {
  x: number
  y: number
}

export interface ClipBegin {
  id: string
  path: string
}

export interface ClipFinish {
  id: string
  path: string
  size: number
}

export interface ClipMeta {
  name: string
  duration: number
  width: number
  height: number
  mime: string
}

export interface RecordItem extends ClipMeta {
  id: string
  path: string
  size: number
  createdAt: number
}

/** 悬浮控制条上显示的状态 */
export interface ControlState {
  active: boolean
  paused: boolean
  elapsed: number
  sysLevel: number
  micLevel: number
  label: string
}

export type RecorderCommand = 'toggle-pause' | 'stop' | 'show-main' | 'cancel'

export type RecorderStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'finishing'

/* ------------------------------ 画面与输出设置 ------------------------------ */

export type FitMode = 'contain' | 'cover' | 'fill'
export type BackgroundId = 'black' | 'graphite' | 'white' | 'gradient' | 'blur'
export type OutputSizeId = 'native' | '2160p' | '1440p' | '1080p' | '720p'
export type CursorStyle = 'ring' | 'dot' | 'halo'

export interface StageSettings {
  /** 输出分辨率 */
  size: OutputSizeId
  fps: number
  /** 画面如何塞进输出画布 */
  fit: FitMode
  background: BackgroundId
  /** 画面四周留白，占短边的比例 */
  padding: number
  /** 圆角，按 1080 高度换算的像素 */
  radius: number
  shadow: boolean
  mirror: boolean
  effect: string
  vignette: number
  grain: number
  zoomEnabled: boolean
  zoomScale: number
  zoomSmooth: number
  cursorEnabled: boolean
  cursorStyle: CursorStyle
  /** 光标大小，占画面高度的比例 */
  cursorSize: number
  cursorColor: string
  watermarkEnabled: boolean
  watermarkText: string
  watermarkOpacity: number
  watermarkPosition: 'br' | 'bl' | 'tr' | 'tl'
}

export interface AudioSettings {
  system: boolean
  systemVolume: number
  mic: boolean
  micDeviceId: string
  micVolume: number
  micNoiseSuppression: boolean
}

export interface OutputSettings {
  format: 'mp4' | 'webm'
  bitrateMbps: number
  /** 开始录制前的倒计时秒数，0 表示立即开始 */
  countdown: number
  /**
   * 录制时把主窗口挪出被录制的画面（多屏挪到另一块屏，单屏直接移出桌面）。
   * 不能最小化：窗口一隐藏，canvas 捕获就不出帧了。
   */
  parkWindow: boolean
  /** 录制时显示悬浮控制条（已开启内容保护，不会被录进去） */
  floatingBar: boolean
}

/* ---------------------------------- 贴图 ---------------------------------- */

export type OverlayKind = 'image' | 'text' | 'emoji' | 'camera'
export type OverlayAnim = 'none' | 'float' | 'pulse' | 'spin' | 'shake'
export type CameraShape = 'circle' | 'rounded' | 'square'

export interface Overlay {
  id: string
  kind: OverlayKind
  label: string
  /** 归一化坐标（0~1，相对输出画面中心） */
  x: number
  y: number
  /** 高度占画面高度的比例；文字类型表示字号占比 */
  scale: number
  /** 宽高比，用于编辑框与图片/摄像头的等比绘制 */
  aspect: number
  rotation: number
  opacity: number
  visible: boolean
  anim: OverlayAnim
  /** 图片贴图的数据地址 */
  src?: string
  text?: string
  color?: string
  bgColor?: string
  bold?: boolean
  shape?: CameraShape
  mirror?: boolean
  border?: boolean
}

export interface ImagePickResult {
  name: string
  dataUrl: string
  aspect: number
}

export interface AppInfo {
  version: string
  platform: string
  userData: string
  outputDir: string
}
