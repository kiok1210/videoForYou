interface Channel {
  source: MediaStreamAudioSourceNode
  gain: GainNode
  analyser: AnalyserNode
  buffer: Float32Array<ArrayBuffer>
}

/**
 * 把系统声音与麦克风混成一路，交给 MediaRecorder。
 * 注意：只连到 MediaStreamDestination，不连扬声器，避免把自己的声音再录进去。
 */
export class AudioMixer {
  readonly ctx: AudioContext
  readonly destination: MediaStreamAudioDestinationNode

  private channels = new Map<string, Channel>()

  constructor() {
    this.ctx = new AudioContext()
    this.destination = this.ctx.createMediaStreamDestination()
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  get output(): MediaStream {
    return this.destination.stream
  }

  add(stream: MediaStream, volume: number, tag: string): void {
    if (this.channels.has(tag)) {
      this.setVolume(tag, volume)
      return
    }
    const source = this.ctx.createMediaStreamSource(stream)
    const gain = this.ctx.createGain()
    gain.gain.value = volume
    const analyser = this.ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.6
    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(this.destination)
    this.channels.set(tag, { source, gain, analyser, buffer: new Float32Array(analyser.fftSize) })
  }

  setVolume(tag: string, volume: number): void {
    const channel = this.channels.get(tag)
    if (channel) channel.gain.gain.value = Math.max(0, Math.min(2, volume))
  }

  /** 0~1 的音量条，用于界面与悬浮条 */
  level(tag: string): number {
    const channel = this.channels.get(tag)
    if (!channel) return 0
    channel.analyser.getFloatTimeDomainData(channel.buffer)
    let sum = 0
    for (let i = 0; i < channel.buffer.length; i += 1) sum += channel.buffer[i] * channel.buffer[i]
    const rms = Math.sqrt(sum / channel.buffer.length)
    // 人眼对小声不敏感，做个平方根拉伸
    return Math.min(1, Math.sqrt(rms) * 1.9)
  }

  remove(tag: string): void {
    const channel = this.channels.get(tag)
    if (!channel) return
    try {
      channel.source.disconnect()
      channel.gain.disconnect()
      channel.analyser.disconnect()
    } catch {
      // 断开失败无所谓，窗口一关音频图就没了
    }
    this.channels.delete(tag)
  }

  dispose(): void {
    for (const tag of [...this.channels.keys()]) this.remove(tag)
    void this.ctx.close().catch(() => undefined)
  }
}

export function pickRecorderMime(format: 'mp4' | 'webm'): string {
  const mp4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  const preferred = format === 'mp4' ? [...mp4, ...webm] : [...webm, ...mp4]
  for (const type of preferred) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export function extensionForMime(mime: string): string {
  return mime.includes('mp4') ? '.mp4' : '.webm'
}
