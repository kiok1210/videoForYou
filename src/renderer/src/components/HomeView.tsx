import { useCallback, useEffect, useState } from 'react'
import type {
  AudioSettings,
  CaptureCapabilities,
  OutputSettings,
  SourceInfo,
  SourceKind,
  StageSettings
} from '@shared/types'
import { Btn, Field, Meter, Section, Segmented, Slider, Toggle } from './ui'
import { BITRATES } from '@/lib/settings'

interface Props {
  caps: CaptureCapabilities | null
  audio: AudioSettings
  output: OutputSettings
  /** 首页只做展示，详细构图到工作台里调 */
  stage?: StageSettings
  onStage?: (patch: Partial<StageSettings>) => void
  devices: { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }
  levels: { sys: number; mic: number }
  busy: boolean
  onPick: (source: SourceInfo) => void
  onAudio: (patch: Partial<AudioSettings>) => void
  onOutput: (patch: Partial<OutputSettings>) => void
}

export function HomeView(props: Props): React.JSX.Element {
  const { caps, audio, output, devices, levels, busy } = props
  const [kind, setKind] = useState<SourceKind>('screen')
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const result = await window.api.capture.sources([kind], true)
    setSources(result.ok && result.data ? result.data : [])
    setLoading(false)
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="home">
      <section className="home-main">
        <header className="home-head">
          <div>
            <h2>选择要录制的画面</h2>
            <p>录整块屏幕来演示 musicForYou / bokeForYou，留白、贴图、滤镜都能实时看到效果。</p>
          </div>
          <div className="home-head-actions">
            <Segmented
              value={kind}
              options={[
                { value: 'screen', label: '屏幕' },
                { value: 'window', label: '窗口' }
              ]}
              onChange={(value) => setKind(value as SourceKind)}
            />
            <Btn onClick={() => void load()} disabled={loading}>
              {loading ? '刷新中…' : '刷新'}
            </Btn>
          </div>
        </header>

        <div className="source-grid">
          {sources.map((source) => (
            <button
              type="button"
              key={source.id}
              className="source-card"
              disabled={busy}
              onClick={() => props.onPick(source)}
            >
              <span className="source-thumb">
                {source.thumbnail ? (
                  <img src={source.thumbnail} alt={source.name} />
                ) : (
                  <span className="source-fallback">{source.kind === 'screen' ? '显示器' : '窗口'}</span>
                )}
              </span>
              <span className="source-meta">
                {source.appIcon ? <img className="source-icon" src={source.appIcon} alt="" /> : null}
                <span className="source-name">{source.name}</span>
                {source.kind === 'screen' ? (
                  <em>
                    {source.displayBounds
                      ? `${source.displayBounds.width}×${source.displayBounds.height} @${Math.round(
                          source.scaleFactor * 100
                        )}%`
                      : '显示器'}
                  </em>
                ) : (
                  <em>窗口</em>
                )}
              </span>
            </button>
          ))}
          {!loading && sources.length === 0 ? <div className="empty">没有找到可录制的画面</div> : null}
        </div>
      </section>

      <aside className="home-side">
        <Section title="声音">
          <div className="stack">
            <Toggle
              label="系统声音"
              hint={caps?.systemAudio === false ? '当前系统不支持' : '录到软件里播放的音乐'}
              checked={audio.system && caps?.systemAudio !== false}
              disabled={caps?.systemAudio === false}
              onChange={(value) => props.onAudio({ system: value })}
            />
            {audio.system && caps?.systemAudio !== false ? (
              <>
                <Meter value={levels.sys} tone="sys" />
                <Slider
                  label="系统音量"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={audio.systemVolume}
                  onChange={(value) => props.onAudio({ systemVolume: value })}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
              </>
            ) : null}

            <div className="divider" />

            <Toggle
              label="麦克风"
              hint="边录边讲解"
              checked={audio.mic}
              onChange={(value) => props.onAudio({ mic: value })}
            />
            {audio.mic ? (
              <>
                <Meter value={levels.mic} tone="mic" />
                <label className="select">
                  <span>设备</span>
                  <select
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
                </label>
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
              </>
            ) : null}
          </div>
        </Section>

        <Section title="输出">
          <div className="stack">
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
            <Toggle
              label="录制时把主窗口挪出画面"
              hint="默认用内容保护排除，主窗口留在桌面可正常操作；开启后多屏移到别的屏、单屏移出桌面"
              checked={output.parkWindow}
              onChange={(value) => props.onOutput({ parkWindow: value })}
            />
            <Toggle
              label="显示悬浮控制条"
              hint="已开启内容保护，不会被录进去"
              checked={output.floatingBar}
              onChange={(value) => props.onOutput({ floatingBar: value })}
            />
            <div className="hint-box">
              录制中可用 <b>Ctrl+Shift+P</b> 暂停/继续、<b>Ctrl+Shift+S</b> 停止；悬浮条上的按钮同样有效。
            </div>
          </div>
        </Section>
      </aside>
    </div>
  )
}
