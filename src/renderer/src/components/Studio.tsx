import { useState } from 'react'
import type {
  AudioSettings,
  CursorStyle,
  OutputSettings,
  Overlay,
  SourceInfo,
  StageSettings
} from '@shared/types'
import type { RecorderHandle } from '@/hooks/useRecorder'
import { BACKGROUNDS, CURSOR_STYLES, EFFECTS } from '@/lib/effects'
import {
  BITRATES,
  EMOJI_PALETTE,
  FIT_MODES,
  FRAME_RATES,
  OUTPUT_SIZES,
  TEXT_PRESETS,
  createOverlay
} from '@/lib/settings'
import { formatDuration, formatSize } from '@/lib/format'
import { textAspect } from '@/lib/geometry'
import { StageView } from './StageView'
import { Btn, Field, Meter, Section, Segmented, Slider, Toggle } from './ui'

type TabId = 'effect' | 'sticker' | 'cursor' | 'frame' | 'audio' | 'out'

const TABS: { id: TabId; name: string }[] = [
  { id: 'effect', name: '特效' },
  { id: 'sticker', name: '贴图' },
  { id: 'cursor', name: '鼠标' },
  { id: 'frame', name: '画面' },
  { id: 'audio', name: '声音' },
  { id: 'out', name: '输出' }
]

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement>
  source: SourceInfo | null
  aspect: number
  stage: StageSettings
  audio: AudioSettings
  output: OutputSettings
  overlays: Overlay[]
  selectedId: string | null
  devices: { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }
  camDevice: string
  recorder: RecorderHandle
  onStage: (patch: Partial<StageSettings>) => void
  onAudio: (patch: Partial<AudioSettings>) => void
  onOutput: (patch: Partial<OutputSettings>) => void
  onOverlays: (next: Overlay[]) => void
  onSelect: (id: string | null) => void
  onCamDevice: (deviceId: string) => void
  onBack: () => void
}

export function Studio(props: Props): React.JSX.Element {
  const { stage, audio, output, overlays, selectedId, recorder, devices } = props
  const [tab, setTab] = useState<TabId>('effect')
  const recording = recorder.status === 'recording' || recorder.status === 'paused' || recorder.status === 'finishing'
  const busy = recording || recorder.status === 'countdown'
  const selected = overlays.find((overlay) => overlay.id === selectedId) ?? null

  const updateOverlay = (id: string, patch: Partial<Overlay>): void => {
    props.onOverlays(overlays.map((overlay) => (overlay.id === id ? { ...overlay, ...patch } : overlay)))
  }

  const removeOverlay = (id: string): void => {
    props.onOverlays(overlays.filter((overlay) => overlay.id !== id))
    if (selectedId === id) props.onSelect(null)
  }

  const shiftOverlay = (id: string, delta: number): void => {
    const index = overlays.findIndex((overlay) => overlay.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= overlays.length) return
    const next = [...overlays]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    props.onOverlays(next)
  }

  const addImage = async (): Promise<void> => {
    const picked = await window.api.pickImages()
    if (!picked.ok || !picked.data?.length) return
    const created = picked.data.map((item) =>
      createOverlay({
        kind: 'image',
        label: item.name.slice(0, 12),
        src: item.dataUrl,
        aspect: item.aspect,
        scale: 0.2
      })
    )
    props.onOverlays([...overlays, ...created])
    props.onSelect(created[0].id)
  }

  const addText = (text = '点这里'): void => {
    const created = createOverlay({
      kind: 'text',
      label: text.slice(0, 8),
      text,
      aspect: textAspect(text),
      scale: 0.055,
      y: 0.78
    })
    props.onOverlays([...overlays, created])
    props.onSelect(created.id)
  }

  const addEmoji = (emoji: string): void => {
    const created = createOverlay({ kind: 'emoji', label: emoji, text: emoji, aspect: 1, scale: 0.12 })
    props.onOverlays([...overlays, created])
    props.onSelect(created.id)
  }

  const addCamera = (): void => {
    const created = createOverlay({
      kind: 'camera',
      label: '摄像头',
      aspect: 4 / 3,
      scale: 0.28,
      x: 0.86,
      y: 0.82,
      shape: 'rounded'
    })
    props.onOverlays([...overlays, created])
    props.onSelect(created.id)
  }

  const sizeText = recorder.outputSize
    ? `${recorder.outputSize.width}×${recorder.outputSize.height}`
    : recorder.sourceSize
      ? `${recorder.sourceSize.width}×${recorder.sourceSize.height}`
      : '—'

  return (
    <div className="studio">
      <div className="studio-main">
        <StageView
          canvasRef={props.canvasRef}
          overlays={overlays}
          selectedId={selectedId}
          aspect={props.aspect}
          status={recorder.status}
          countdown={recorder.countdown}
          elapsed={recorder.elapsed}
          onSelect={props.onSelect}
          onUpdate={updateOverlay}
        />

        <div className="control-bar">
          <div className="control-left">
            <Btn onClick={props.onBack}>
              ← 换画面
            </Btn>
            <span className="control-meta">
              {props.source?.name ?? '未选择'}
              <em>
                {sizeText} · {stage.fps}fps · {output.format.toUpperCase()}
              </em>
            </span>
          </div>

          <div className="control-center">
            {recorder.status === 'ready' || recorder.status === 'countdown' ? (
              <Btn variant="primary" size="md" onClick={() => void recorder.start()}>
                {recorder.status === 'countdown' ? '倒计时中…' : '开始录制'}
              </Btn>
            ) : null}
            {recorder.status === 'recording' ? (
              <>
                <Btn variant="solid" onClick={recorder.togglePause}>
                  暂停
                </Btn>
                <Btn variant="danger" onClick={() => void recorder.stop()}>
                  停止并保存
                </Btn>
              </>
            ) : null}
            {recorder.status === 'paused' ? (
              <>
                <Btn variant="primary" onClick={recorder.togglePause}>
                  继续录制
                </Btn>
                <Btn variant="danger" onClick={() => void recorder.stop()}>
                  停止并保存
                </Btn>
              </>
            ) : null}
            {recorder.status === 'finishing' ? <Btn disabled>正在保存…</Btn> : null}
            {recorder.status === 'idle' || recorder.status === 'preparing' ? (
              <Btn variant="primary" disabled>
                正在准备画面…
              </Btn>
            ) : null}
          </div>

          <div className="control-right">
            <span>{formatDuration(recorder.elapsed)}</span>
            <em>Ctrl+Shift+P 暂停 · Ctrl+Shift+S 停止</em>
          </div>
        </div>
      </div>

      <aside className="studio-side">
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === tab ? 'tab is-active' : 'tab'}
              onClick={() => setTab(item.id)}
            >
              {item.name}
            </button>
          ))}
        </nav>

        <div className="panel">
          {tab === 'effect' ? (
            <>
              <Section title="实时滤镜" extra={<span className="tip">录制中也能换</span>}>
                <div className="effect-grid">
                  {EFFECTS.map((effect) => (
                    <button
                      type="button"
                      key={effect.id}
                      className={effect.id === stage.effect ? 'effect is-active' : 'effect'}
                      onClick={() => props.onStage({ effect: effect.id })}
                    >
                      {effect.name}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="氛围">
                <Slider
                  label="暗角"
                  min={0}
                  max={1}
                  step={0.05}
                  value={stage.vignette}
                  onChange={(value) => props.onStage({ vignette: value })}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
                <Slider
                  label="噪点"
                  min={0}
                  max={1}
                  step={0.05}
                  value={stage.grain}
                  onChange={(value) => props.onStage({ grain: value })}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
              </Section>
              <Section title="水印">
                <Toggle
                  label="显示水印"
                  checked={stage.watermarkEnabled}
                  onChange={(value) => props.onStage({ watermarkEnabled: value })}
                />
                <Field label="水印文字">
                  <input
                    className="text-input"
                    value={stage.watermarkText}
                    onChange={(event) => props.onStage({ watermarkText: event.target.value })}
                    placeholder="musicForYou · bokeForYou"
                  />
                </Field>
                <Field label="位置">
                  <Segmented
                    block
                    value={stage.watermarkPosition}
                    options={[
                      { value: 'tl', label: '左上' },
                      { value: 'tr', label: '右上' },
                      { value: 'bl', label: '左下' },
                      { value: 'br', label: '右下' }
                    ]}
                    onChange={(value) => props.onStage({ watermarkPosition: value as StageSettings['watermarkPosition'] })}
                  />
                </Field>
                <Slider
                  label="不透明度"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={stage.watermarkOpacity}
                  onChange={(value) => props.onStage({ watermarkOpacity: value })}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
              </Section>
            </>
          ) : null}

          {tab === 'sticker' ? (
            <>
              <Section title="添加">
                <div className="btn-row">
                  <Btn onClick={() => void addImage()}>图片贴图</Btn>
                  <Btn onClick={() => addText()}>文字标注</Btn>
                  <Btn onClick={addCamera}>摄像头</Btn>
                </div>
                <div className="chip-grid">
                  {TEXT_PRESETS.map((text) => (
                    <button type="button" key={text} className="chip" onClick={() => addText(text)}>
                      {text}
                    </button>
                  ))}
                </div>
                <div className="emoji-grid">
                  {EMOJI_PALETTE.map((emoji) => (
                    <button type="button" key={emoji} className="emoji" onClick={() => addEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title={`图层（${overlays.length}）`}>
                {overlays.length === 0 ? <div className="empty">还没有贴图，点上面的按钮加一个</div> : null}
                <div className="layer-list">
                  {[...overlays].reverse().map((overlay) => (
                    <div
                      key={overlay.id}
                      className={overlay.id === selectedId ? 'layer is-active' : 'layer'}
                      onClick={() => props.onSelect(overlay.id)}
                    >
                      <span className="layer-name">
                        {overlay.kind === 'emoji' ? overlay.text : overlay.label}
                      </span>
                      <span className="layer-ops">
                        <button
                          type="button"
                          title="上移一层"
                          onClick={(event) => {
                            event.stopPropagation()
                            shiftOverlay(overlay.id, 1)
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="下移一层"
                          onClick={(event) => {
                            event.stopPropagation()
                            shiftOverlay(overlay.id, -1)
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title={overlay.visible ? '隐藏' : '显示'}
                          onClick={(event) => {
                            event.stopPropagation()
                            updateOverlay(overlay.id, { visible: !overlay.visible })
                          }}
                        >
                          {overlay.visible ? '👁' : '·'}
                        </button>
                        <button
                          type="button"
                          title="删除"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeOverlay(overlay.id)
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </Section>

              {selected ? (
                <Section title="调整选中图层">
                  {selected.kind === 'text' ? (
                    <>
                      <Field label="文字">
                        <textarea
                          className="text-input"
                          rows={2}
                          value={selected.text ?? ''}
                          onChange={(event) =>
                            updateOverlay(selected.id, {
                              text: event.target.value,
                              aspect: textAspect(event.target.value)
                            })
                          }
                        />
                      </Field>
                      <div className="btn-row">
                        <span className="color-field">
                          <span>文字色</span>
                          <input
                            type="color"
                            value={selected.color ?? '#ffffff'}
                            onChange={(event) => updateOverlay(selected.id, { color: event.target.value })}
                          />
                        </span>
                        <span className="color-field">
                          <span>底色</span>
                          <input
                            type="color"
                            value={selected.bgColor && selected.bgColor.startsWith('#') ? selected.bgColor : '#0c0e14'}
                            onChange={(event) => updateOverlay(selected.id, { bgColor: event.target.value })}
                          />
                        </span>
                        <Btn size="sm" onClick={() => updateOverlay(selected.id, { bgColor: 'transparent' })}>
                          去底色
                        </Btn>
                      </div>
                      <Toggle
                        label="加粗"
                        checked={selected.bold !== false}
                        onChange={(value) => updateOverlay(selected.id, { bold: value })}
                      />
                    </>
                  ) : null}

                  {selected.kind === 'camera' ? (
                    <>
                      <Field label="形状">
                        <Segmented
                          block
                          value={selected.shape ?? 'rounded'}
                          options={[
                            { value: 'circle', label: '圆形' },
                            { value: 'rounded', label: '圆角' },
                            { value: 'square', label: '方形' }
                          ]}
                          onChange={(value) =>
                            updateOverlay(selected.id, { shape: value as Overlay['shape'], aspect: value === 'circle' ? 1 : selected.aspect })
                          }
                        />
                      </Field>
                      <Field label="摄像头">
                        <select
                          className="select-input"
                          value={props.camDevice}
                          onChange={(event) => props.onCamDevice(event.target.value)}
                        >
                          <option value="">系统默认</option>
                          {devices.cams.map((device) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.label || '摄像头'}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Toggle
                        label="镜像"
                        checked={Boolean(selected.mirror)}
                        onChange={(value) => updateOverlay(selected.id, { mirror: value })}
                      />
                      <Toggle
                        label="白边"
                        checked={Boolean(selected.border)}
                        onChange={(value) => updateOverlay(selected.id, { border: value })}
                      />
                    </>
                  ) : null}

                  <Slider
                    label="大小"
                    min={0.02}
                    max={1}
                    step={0.005}
                    value={selected.scale}
                    onChange={(value) => updateOverlay(selected.id, { scale: value })}
                    format={(value) => `${Math.round(value * 100)}%`}
                  />
                  <Slider
                    label="旋转"
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round(selected.rotation)}
                    onChange={(value) => updateOverlay(selected.id, { rotation: value })}
                    format={(value) => `${value}°`}
                  />
                  <Slider
                    label="不透明度"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={selected.opacity}
                    onChange={(value) => updateOverlay(selected.id, { opacity: value })}
                    format={(value) => `${Math.round(value * 100)}%`}
                  />
                  <Field label="动画">
                    <Segmented
                      block
                      value={selected.anim}
                      options={[
                        { value: 'none', label: '无' },
                        { value: 'float', label: '浮动' },
                        { value: 'pulse', label: '呼吸' },
                        { value: 'shake', label: '抖动' },
                        { value: 'spin', label: '旋转' }
                      ]}
                      onChange={(value) => updateOverlay(selected.id, { anim: value as Overlay['anim'] })}
                    />
                  </Field>
                  <div className="hint-box">画面上直接拖动图层可以移动，右下角圆点缩放，上方圆点旋转。</div>
                </Section>
              ) : null}
            </>
          ) : null}

          {tab === 'cursor' ? (
            <>
              <Section title="鼠标高亮">
                <Toggle
                  label="显示光标高亮"
                  hint="录屏本身拍不到鼠标指针，这里补一个"
                  checked={stage.cursorEnabled}
                  onChange={(value) => props.onStage({ cursorEnabled: value })}
                />
                <Field label="样式">
                  <Segmented
                    block
                    value={stage.cursorStyle}
                    options={CURSOR_STYLES.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => props.onStage({ cursorStyle: value as CursorStyle })}
                  />
                </Field>
                <Slider
                  label="大小"
                  min={0.01}
                  max={0.12}
                  step={0.002}
                  value={stage.cursorSize}
                  onChange={(value) => props.onStage({ cursorSize: value })}
                  format={(value) => `${(value * 100).toFixed(1)}%`}
                />
                <span className="color-field">
                  <span>高亮颜色</span>
                  <input
                    type="color"
                    value={stage.cursorColor}
                    onChange={(event) => props.onStage({ cursorColor: event.target.value })}
                  />
                </span>
              </Section>
              <Section title="跟随放大">
                <Toggle
                  label="跟随鼠标放大"
                  hint="讲解细节时自动推近"
                  checked={stage.zoomEnabled}
                  onChange={(value) => props.onStage({ zoomEnabled: value })}
                />
                <Slider
                  label="放大倍数"
                  min={1.1}
                  max={3}
                  step={0.05}
                  value={stage.zoomScale}
                  onChange={(value) => props.onStage({ zoomScale: value })}
                  format={(value) => `${value.toFixed(2)}×`}
                />
                <Slider
                  label="跟随顺滑度"
                  min={0.03}
                  max={0.4}
                  step={0.01}
                  value={stage.zoomSmooth}
                  onChange={(value) => props.onStage({ zoomSmooth: value })}
                  format={(value) => value.toFixed(2)}
                />
              </Section>
            </>
          ) : null}

          {tab === 'frame' ? (
            <>
              <Section title="输出画质">
                <Field label="分辨率" hint={busy ? '录制中不能改' : undefined}>
                  <select
                    className="select-input"
                    value={stage.size}
                    disabled={busy}
                    onChange={(event) => props.onStage({ size: event.target.value as StageSettings['size'] })}
                  >
                    {OUTPUT_SIZES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="帧率">
                  <Segmented
                    block
                    value={String(stage.fps)}
                    options={FRAME_RATES.map((value) => ({ value: String(value), label: `${value} 帧` }))}
                    onChange={(value) => props.onStage({ fps: Number(value) })}
                  />
                </Field>
              </Section>
              <Section title="构图">
                <Field label="适配方式">
                  <Segmented
                    block
                    value={stage.fit}
                    options={FIT_MODES.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => props.onStage({ fit: value as StageSettings['fit'] })}
                  />
                </Field>
                <Field label="背景">
                  <Segmented
                    block
                    value={stage.background}
                    options={BACKGROUNDS.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => props.onStage({ background: value as StageSettings['background'] })}
                  />
                </Field>
                <Slider
                  label="四周留白"
                  min={0}
                  max={0.15}
                  step={0.005}
                  value={stage.padding}
                  onChange={(value) => props.onStage({ padding: value })}
                  format={(value) => `${(value * 100).toFixed(1)}%`}
                />
                <Slider
                  label="圆角"
                  min={0}
                  max={70}
                  step={1}
                  value={stage.radius}
                  onChange={(value) => props.onStage({ radius: value })}
                  format={(value) => `${value}px`}
                />
                <Toggle
                  label="投影"
                  checked={stage.shadow}
                  onChange={(value) => props.onStage({ shadow: value })}
                />
                <Toggle
                  label="水平镜像"
                  checked={stage.mirror}
                  onChange={(value) => props.onStage({ mirror: value })}
                />
              </Section>
            </>
          ) : null}

          {tab === 'audio' ? (
            <Section title="声音">
              <Toggle
                label="系统声音"
                checked={audio.system}
                onChange={(value) => props.onAudio({ system: value })}
              />
              <Meter value={recorder.levels.sys} tone="sys" />
              <Slider
                label="系统音量"
                min={0}
                max={1.5}
                step={0.05}
                value={audio.systemVolume}
                onChange={(value) => props.onAudio({ systemVolume: value })}
                format={(value) => `${Math.round(value * 100)}%`}
              />
              <div className="divider" />
              <Toggle label="麦克风" checked={audio.mic} onChange={(value) => props.onAudio({ mic: value })} />
              <Meter value={recorder.levels.mic} tone="mic" />
              <Field label="设备">
                <select
                  className="select-input"
                  value={audio.micDeviceId}
                  onChange={(event) => props.onAudio({ micDeviceId: event.target.value })}
                >
                  <option value="">系统默认</option>
                  {devices.mics.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || '麦克风'}
                    </option>
                  ))}
                </select>
              </Field>
              <Slider
                label="麦克风音量"
                min={0}
                max={1.5}
                step={0.05}
                value={audio.micVolume}
                onChange={(value) => props.onAudio({ micVolume: value })}
                format={(value) => `${Math.round(value * 100)}%`}
              />
              <Toggle
                label="降噪"
                checked={audio.micNoiseSuppression}
                onChange={(value) => props.onAudio({ micNoiseSuppression: value })}
              />
              <div className="hint-box">
                系统声音走系统回环，麦克风单独混音，两者互不影响，录音时也不会外放。
              </div>
            </Section>
          ) : null}

          {tab === 'out' ? (
            <>
              <Section title="录制文件">
                <Field label="格式">
                  <Segmented
                    block
                    value={output.format}
                    options={[
                      { value: 'mp4', label: 'MP4' },
                      { value: 'webm', label: 'WebM' }
                    ]}
                    onChange={(value) => props.onOutput({ format: value as 'mp4' | 'webm' })}
                  />
                </Field>
                <Field label="码率">
                  <Segmented
                    block
                    value={String(output.bitrateMbps)}
                    options={BITRATES.map((value) => ({ value: String(value), label: `${value}M` }))}
                    onChange={(value) => props.onOutput({ bitrateMbps: Number(value) })}
                  />
                </Field>
                <Field label="倒计时">
                  <Segmented
                    block
                    value={String(output.countdown)}
                    options={[
                      { value: '0', label: '立即' },
                      { value: '3', label: '3 秒' },
                      { value: '5', label: '5 秒' }
                    ]}
                    onChange={(value) => props.onOutput({ countdown: Number(value) })}
                  />
                </Field>
              </Section>
              <Section title="录制体验">
                <Toggle
                  label="录制时把主窗口挪出画面"
                  checked={output.parkWindow}
                  onChange={(value) => props.onOutput({ parkWindow: value })}
                />
                <Toggle
                  label="显示悬浮控制条"
                  checked={output.floatingBar}
                  onChange={(value) => props.onOutput({ floatingBar: value })}
                />
                <div className="hint-box">
                  录制中主窗口会被内容保护排除出画面，可直接在上面的按钮操作；悬浮条也随时可暂停、停止。
                  开启「挪出画面」后主窗口会移开，这时只能用悬浮条或 Ctrl+Shift+P/S。
                </div>
              </Section>
              {recorder.last ? (
                <Section title="上一次录制">
                  <div className="meta-line">
                    {recorder.last.width}×{recorder.last.height} · {formatSize(recorder.last.size)} ·{' '}
                    {formatDuration(recorder.last.duration)}
                  </div>
                  <div className="btn-row">
                    <Btn onClick={() => void recorder.saveLast()}>
                      {recorder.last.item ? '在文件夹中显示' : '保存到文件'}
                    </Btn>
                    <Btn variant="danger" onClick={() => void recorder.discardLast()}>
                      删除
                    </Btn>
                  </div>
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
