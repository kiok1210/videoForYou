import type { AudioSettings, OutputSettings, Overlay, StageSettings } from '@shared/types'

export const DEFAULT_STAGE: StageSettings = {
  size: 'native',
  fps: 30,
  fit: 'contain',
  background: 'graphite',
  padding: 0.02,
  radius: 18,
  shadow: true,
  mirror: false,
  effect: 'crisp',
  vignette: 0,
  grain: 0,
  zoomEnabled: false,
  zoomScale: 1.35,
  zoomSmooth: 0.12,
  cursorEnabled: true,
  cursorStyle: 'ring',
  cursorSize: 0.032,
  cursorColor: '#ff2d55',
  watermarkEnabled: false,
  watermarkText: 'musicForYou · bokeForYou',
  watermarkOpacity: 0.75,
  watermarkPosition: 'br'
}

export const DEFAULT_AUDIO: AudioSettings = {
  system: true,
  systemVolume: 1,
  mic: false,
  micDeviceId: '',
  micVolume: 1,
  micNoiseSuppression: true
}

export const DEFAULT_OUTPUT: OutputSettings = {
  format: 'mp4',
  bitrateMbps: 8,
  countdown: 3,
  // 默认靠内容保护把自家窗口排除出抓屏，主窗口留在桌面上随时能点
  parkWindow: false,
  floatingBar: true
}

export const OUTPUT_SIZES = [
  { id: 'native', name: '原始分辨率' },
  { id: '2160p', name: '4K 3840×2160' },
  { id: '1440p', name: '2K 2560×1440' },
  { id: '1080p', name: '1080P 1920×1080' },
  { id: '720p', name: '720P 1280×720' }
] as const

export const FRAME_RATES = [24, 30, 60]

export const BITRATES = [4, 6, 8, 12, 16, 24]

export const FIT_MODES = [
  { id: 'contain', name: '适应留边' },
  { id: 'cover', name: '铺满裁切' },
  { id: 'fill', name: '拉伸填满' }
] as const

const STORAGE_KEY = 'videoforyou.settings.v2'
/** v1 时期的「挪出画面」默认开启，会把主窗口整个移出桌面，升级时丢掉这一项并回到新默认值 */
const LEGACY_KEY = 'videoforyou.settings.v1'

interface Persisted {
  stage?: Partial<StageSettings>
  audio?: Partial<AudioSettings>
  output?: Partial<OutputSettings>
}

export function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Persisted

    const legacy = localStorage.getItem(LEGACY_KEY)
    if (!legacy) return {}
    const parsed = JSON.parse(legacy) as Persisted
    const output: Partial<OutputSettings> = { ...parsed.output }
    delete output.parkWindow
    const migrated: Persisted = { ...parsed, output }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    return migrated
  } catch {
    return {}
  }
}

export function persistSettings(payload: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 存储被禁用时保持静默，不影响录制
  }
}

/** 贴图预设：给演示 videoForYou / musicForYou / bokeForYou 时常用的几块 */
export const EMOJI_PALETTE = ['🔥', '✨', '🎵', '🎧', '📻', '⭐', '👀', '👉', '💡', '🎬', '❤️', '✅']

export const TEXT_PRESETS = ['点这里', '第 1 步', '音乐播放器', '播客合集', '关注不迷路', '支持拖拽调节']

export function createOverlay(patch: Partial<Overlay> & Pick<Overlay, 'kind' | 'label'>): Overlay {
  return {
    id: `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    x: 0.5,
    y: 0.5,
    scale: patch.kind === 'text' ? 0.05 : 0.16,
    aspect: patch.kind === 'text' ? 4 : 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    anim: 'none',
    color: '#ffffff',
    bgColor: patch.kind === 'text' ? 'rgba(12,14,20,0.72)' : 'transparent',
    bold: true,
    shape: 'rounded',
    mirror: false,
    border: true,
    ...patch
  }
}
