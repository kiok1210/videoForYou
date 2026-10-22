export interface EffectPreset {
  id: string
  name: string
  /** 直接喂给 canvas 2D 的 filter */
  filter: string
}

/** 实时滤镜：录制时逐帧套在画面上，不需要后期转码 */
export const EFFECTS: EffectPreset[] = [
  { id: 'none', name: '原画', filter: 'none' },
  { id: 'crisp', name: '清晰', filter: 'contrast(1.07) saturate(1.08)' },
  { id: 'bright', name: '明亮', filter: 'brightness(1.09) saturate(1.12)' },
  { id: 'warm', name: '暖阳', filter: 'sepia(0.16) saturate(1.22) brightness(1.04)' },
  { id: 'cool', name: '冷调', filter: 'hue-rotate(-10deg) saturate(1.08) brightness(1.03)' },
  { id: 'film', name: '胶片', filter: 'sepia(0.32) contrast(1.07) saturate(0.92)' },
  { id: 'mono', name: '黑白', filter: 'grayscale(1) contrast(1.12)' },
  { id: 'vivid', name: '高饱和', filter: 'contrast(1.14) saturate(1.32) hue-rotate(-4deg)' },
  { id: 'dream', name: '柔光', filter: 'brightness(1.1) saturate(1.18) blur(0.5px)' },
  { id: 'night', name: '夜行', filter: 'brightness(0.92) contrast(1.13) saturate(1.12)' }
]

export const EFFECT_BY_ID: Record<string, EffectPreset> = Object.fromEntries(
  EFFECTS.map((effect) => [effect.id, effect])
)

export const BACKGROUNDS = [
  { id: 'black', name: '纯黑' },
  { id: 'graphite', name: '石板' },
  { id: 'white', name: '纯白' },
  { id: 'gradient', name: '渐变' },
  { id: 'blur', name: '模糊画面' }
] as const

export const CURSOR_STYLES = [
  { id: 'ring', name: '圆环' },
  { id: 'dot', name: '圆点' },
  { id: 'halo', name: '光晕' }
] as const
