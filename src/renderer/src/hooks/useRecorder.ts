import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AudioSettings,
  ClipMeta,
  CursorPoint,
  OutputSettings,
  Overlay,
  RecordItem,
  RecorderStatus,
  SourceInfo,
  StageSettings
} from '@shared/types'
import { AudioMixer, extensionForMime, pickRecorderMime } from '@/lib/audio'
import { Compositor } from '@/lib/compositor'
import { clipUrl, timestampName } from '@/lib/format'

export interface LastClip {
  path: string
  size: number
  duration: number
  width: number
  height: number
  mime: string
  /** 已保存到磁盘时才有值；用户取消保存对话框时为 null */
  item: RecordItem | null
  url: string
}

export interface RecorderHandle {
  status: RecorderStatus
  elapsed: number
  countdown: number
  levels: { sys: number; mic: number }
  sourceSize: { width: number; height: number } | null
  outputSize: { width: number; height: number } | null
  devices: { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }
  last: LastClip | null
  prepare: (source: SourceInfo) => Promise<void>
  start: () => Promise<void>
  togglePause: () => void
  stop: () => Promise<void>
  reset: () => Promise<void>
  enableCamera: (deviceId: string) => Promise<void>
  disableCamera: () => void
  refreshDevices: () => Promise<void>
  saveLast: () => Promise<void>
  discardLast: () => Promise<void>
}

interface Options {
  canvasRef: React.RefObject<HTMLCanvasElement>
  stage: StageSettings
  audio: AudioSettings
  output: OutputSettings
  overlays: Overlay[]
  onNotice: (message: string) => void
}

const SIZE_PRESETS: Record<string, { width: number; height: number }> = {
  '2160p': { width: 3840, height: 2160 },
  '1440p': { width: 2560, height: 1440 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 }
}

function even(value: number): number {
  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded - 1
}

function resolveOutputSize(
  stage: StageSettings,
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  const preset = SIZE_PRESETS[stage.size]
  if (preset) return preset
  const scale = Math.min(1, 3840 / Math.max(1, sourceWidth))
  return {
    width: Math.max(2, even(sourceWidth * scale)),
    height: Math.max(2, even(sourceHeight * scale))
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err instanceof DOMException) return err.message
  return String(err)
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function waitForFrame(video: HTMLVideoElement, timeout = 4000): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(), timeout)
    function finish(): void {
      window.clearTimeout(timer)
      video.removeEventListener('loadeddata', finish)
      resolve()
    }
    video.addEventListener('loadeddata', finish)
  })
}

export function useRecorder(options: Options): RecorderHandle {
  const { canvasRef, overlays, onNotice } = options

  // 录制中改设置要立刻生效，所以统一从 ref 里读最新值
  const stageRef = useRef(options.stage)
  const audioRef = useRef(options.audio)
  const outputRef = useRef(options.output)
  const overlaysRef = useRef(overlays)
  const noticeRef = useRef(onNotice)
  stageRef.current = options.stage
  audioRef.current = options.audio
  outputRef.current = options.output
  overlaysRef.current = overlays
  noticeRef.current = onNotice

  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [levels, setLevels] = useState({ sys: 0, mic: 0 })
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [outputSize, setOutputSize] = useState<{ width: number; height: number } | null>(null)
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({
    mics: [],
    cams: []
  })
  const [last, setLast] = useState<LastClip | null>(null)

  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micDeviceRef = useRef('')
  const camStreamRef = useRef<MediaStream | null>(null)
  const camDeviceRef = useRef('')
  const mixerRef = useRef<AudioMixer | null>(null)
  const compositorRef = useRef<Compositor | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const captureStreamRef = useRef<MediaStream | null>(null)
  const clipRef = useRef<string | null>(null)
  const sourceRef = useRef<SourceInfo | null>(null)
  const cursorRef = useRef<CursorPoint | null>(null)
  const statusRef = useRef<RecorderStatus>('idle')
  const cancelRef = useRef(false)
  const startedAtRef = useRef(0)
  const pausedAtRef = useRef(0)
  const pausedTotalRef = useRef(0)
  const lastFrameRef = useRef(0)
  const meterAtRef = useRef(0)
  const videoSizeRef = useRef({ width: 1920, height: 1080 })
  const outputSizeRef = useRef({ width: 1920, height: 1080 })
  const mimeRef = useRef('video/mp4')
  const writesRef = useRef<Promise<void>>(Promise.resolve())
  const writeErrorRef = useRef<string | null>(null)

  const notice = useCallback((message: string) => noticeRef.current(message), [])

  const updateStatus = useCallback((next: RecorderStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const elapsedSeconds = useCallback((now: number): number => {
    if (!startedAtRef.current) return 0
    const paused = pausedTotalRef.current + (pausedAtRef.current ? now - pausedAtRef.current : 0)
    return Math.max(0, (now - startedAtRef.current - paused) / 1000)
  }, [])

  const ensureScreenVideo = useCallback((): HTMLVideoElement => {
    if (!screenVideoRef.current) {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      screenVideoRef.current = video
    }
    return screenVideoRef.current
  }, [])

  const ensureCameraVideo = useCallback((): HTMLVideoElement => {
    if (!cameraVideoRef.current) {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      cameraVideoRef.current = video
    }
    return cameraVideoRef.current
  }, [])

  const ensureMixer = useCallback(async (): Promise<AudioMixer> => {
    if (!mixerRef.current) mixerRef.current = new AudioMixer()
    await mixerRef.current.resume()
    return mixerRef.current
  }, [])

  const syncMic = useCallback(async (): Promise<void> => {
    const mixer = mixerRef.current
    if (!mixer) return
    const audio = audioRef.current
    if (!audio.mic) {
      mixer.remove('mic')
      stopStream(micStreamRef.current)
      micStreamRef.current = null
      micDeviceRef.current = ''
      return
    }
    const needNew =
      !micStreamRef.current ||
      micDeviceRef.current !== audio.micDeviceId ||
      micStreamRef.current.getAudioTracks().length === 0
    if (needNew) {
      stopStream(micStreamRef.current)
      micStreamRef.current = null
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: audio.micDeviceId ? { exact: audio.micDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: audio.micNoiseSuppression,
            autoGainControl: true
          },
          video: false
        })
        micStreamRef.current = stream
        micDeviceRef.current = audio.micDeviceId
      } catch (err) {
        notice(`麦克风打开失败：${errorText(err)}`)
        return
      }
    }
    if (micStreamRef.current) mixer.add(micStreamRef.current, audio.micVolume, 'mic')
  }, [notice])

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        mics: list.filter((item) => item.kind === 'audioinput' && item.deviceId),
        cams: list.filter((item) => item.kind === 'videoinput' && item.deviceId)
      })
    } catch {
      setDevices({ mics: [], cams: [] })
    }
  }, [])

  const teardown = useCallback(async (): Promise<void> => {
    stopStream(screenStreamRef.current)
    stopStream(micStreamRef.current)
    stopStream(camStreamRef.current)
    stopStream(captureStreamRef.current)
    screenStreamRef.current = null
    micStreamRef.current = null
    camStreamRef.current = null
    captureStreamRef.current = null
    micDeviceRef.current = ''
    camDeviceRef.current = ''
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    mixerRef.current?.dispose()
    mixerRef.current = null
    compositorRef.current = null
    recorderRef.current = null
    sourceRef.current = null
    cursorRef.current = null
    await window.api.cursor.stop()
    await window.api.control.setVisible(false)
    await window.api.recorder.setActive(false)
    await window.api.recorder.setHotkeys(false)
    await window.api.window.park({ parked: false })
    await window.api.window.shield(false)
  }, [])

  /** getDisplayMedia 走主进程注册的 handler；被拦时退回 Chromium 桌面捕获约束 */
  const acquireScreen = useCallback(
    async (
      source: SourceInfo,
      wantSystem: boolean
    ): Promise<{ stream: MediaStream; systemAudio: boolean }> => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: stageRef.current.fps, max: 60 } },
          audio: wantSystem
        })
        if (!stream.getVideoTracks().length) throw new Error('没有拿到画面轨道')
        return { stream, systemAudio: stream.getAudioTracks().length > 0 }
      } catch (err) {
        console.warn('[capture] getDisplayMedia 失败，改用桌面捕获约束', err)
        const legacy = {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
              maxFrameRate: stageRef.current.fps
            }
          }
        } as unknown as MediaStreamConstraints
        const stream = await navigator.mediaDevices.getUserMedia(legacy)
        let systemAudio = false
        if (wantSystem) {
          try {
            const audioOnly = {
              audio: { mandatory: { chromeMediaSource: 'desktop' } },
              video: false
            } as unknown as MediaStreamConstraints
            const audioStream = await navigator.mediaDevices.getUserMedia(audioOnly)
            const track = audioStream.getAudioTracks()[0]
            if (track) {
              stream.addTrack(track)
              systemAudio = true
            }
          } catch {
            systemAudio = false
          }
        }
        return { stream, systemAudio }
      }
    },
    []
  )

  const prepare = useCallback(
    async (source: SourceInfo): Promise<void> => {
      await teardown()
      updateStatus('preparing')
      cancelRef.current = false
      sourceRef.current = source
      try {
        const caps = await window.api.capture.capabilities()
        const loopback = caps.ok ? Boolean(caps.data?.systemAudio) : false
        const audio = audioRef.current
        const wantSystem = audio.system && loopback
        if (audio.system && !loopback) notice('当前系统不支持录制系统声音，可在「声音」里改用麦克风')

        const prepared = await window.api.capture.prepare({ sourceId: source.id, systemAudio: wantSystem })
        if (!prepared.ok) throw new Error(prepared.message ?? '画面准备失败')

        const { stream, systemAudio } = await acquireScreen(source, wantSystem)
        screenStreamRef.current = stream

        const video = ensureScreenVideo()
        video.srcObject = new MediaStream(stream.getVideoTracks())
        video.muted = true
        await video.play()
        await waitForFrame(video)

        videoSizeRef.current = {
          width: video.videoWidth || 1920,
          height: video.videoHeight || 1080
        }
        setSourceSize({ ...videoSizeRef.current })

        const systemTrack = stream.getAudioTracks()[0] ?? null
        if (audio.system && !systemTrack) {
          notice(systemAudio ? '系统声音未就绪' : '没有拿到系统声音：可改用麦克风，或检查系统默认输出设备')
        }
        if (systemTrack || audio.mic) {
          const mixer = await ensureMixer()
          if (systemTrack) mixer.add(new MediaStream([systemTrack]), audio.systemVolume, 'system')
          await syncMic()
        }

        if (stageRef.current.cursorEnabled || stageRef.current.zoomEnabled) await window.api.cursor.start()

        updateStatus('ready')
        await refreshDevices()
      } catch (err) {
        await teardown()
        updateStatus('idle')
        notice(`画面准备失败：${errorText(err)}`)
        throw err
      }
    },
    [acquireScreen, ensureMixer, ensureScreenVideo, notice, refreshDevices, syncMic, teardown, updateStatus]
  )

  const finalize = useCallback(async (): Promise<void> => {
    const id = clipRef.current
    const duration = elapsedSeconds(performance.now())
    const size = outputSizeRef.current
    try {
      if (!id) return
      await writesRef.current
      if (writeErrorRef.current) notice(`部分数据写入失败：${writeErrorRef.current}`)
      const finished = await window.api.clip.finish(id)
      if (!finished.ok || !finished.data) {
        notice(finished.message ?? '录制文件写入失败')
        return
      }
      // 兜底再摆一次：万一没收尾前窗口还在屏幕外
      await window.api.window.reveal()
      const tempPath = finished.data.path
      const totalSize = finished.data.size
      if (totalSize <= 0) {
        // 一帧都没采到：常见于编码器没起来，直接收尾，别给用户一个空文件
        notice('没有采集到画面数据：可换个帧率或输出格式再试')
        await window.api.clip.discard(id)
        clipRef.current = null
        return
      }
      const meta: ClipMeta = {
        name: timestampName(),
        duration,
        width: size.width,
        height: size.height,
        mime: mimeRef.current
      }
      // 直接收进作品库，不再弹保存对话框：
      // 对话框挂在窗口上，一旦窗口位置不对就看不见，用户只能干等
      let item: RecordItem | null = null
      const saved = await window.api.clip.save(id, meta)
      if (saved.ok && saved.data) {
        clipRef.current = null
        item = saved.data
      } else {
        notice(saved.message ?? '自动保存失败，可在结果页再存一次')
      }
      setLast({
        path: item?.path ?? tempPath,
        size: item?.size ?? totalSize,
        duration,
        width: size.width,
        height: size.height,
        mime: mimeRef.current,
        item,
        url: clipUrl(item?.path ?? tempPath)
      })
    } catch (err) {
      notice(`收尾失败：${errorText(err)}`)
    } finally {
      await teardown()
      updateStatus('idle')
    }
  }, [elapsedSeconds, notice, teardown, updateStatus])

  const start = useCallback(async (): Promise<void> => {
    const canvas = canvasRef.current
    const screenVideo = screenVideoRef.current
    if (!canvas || !screenVideo) {
      notice('还没有选好要录制的画面')
      return
    }
    const stage = stageRef.current
    const output = outputRef.current
    const compositor = compositorRef.current ?? new Compositor(canvas)
    compositorRef.current = compositor
    compositor.preload(overlaysRef.current)

    const size = resolveOutputSize(stage, videoSizeRef.current.width, videoSizeRef.current.height)
    compositor.setSize(size.width, size.height)
    outputSizeRef.current = size
    setOutputSize(size)

    const mime = pickRecorderMime(output.format)
    mimeRef.current = mime || 'video/webm'
    if (output.format === 'mp4' && !mime.includes('mp4')) {
      notice('当前内核不支持 MP4 录制，已自动改用 WebM')
    }

    const begin = await window.api.clip.begin(extensionForMime(mimeRef.current))
    if (!begin.ok || !begin.data) {
      notice(begin.message ?? '无法创建录制文件')
      return
    }
    clipRef.current = begin.data.id
    writesRef.current = Promise.resolve()
    writeErrorRef.current = null

    const mixer = mixerRef.current
    const canvasStream = canvas.captureStream(stage.fps)
    captureStreamRef.current = canvasStream
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()]
    if (mixer) tracks.push(...mixer.output.getAudioTracks())
    const combined = new MediaStream(tracks)

    const recorderOptions: MediaRecorderOptions = {
      videoBitsPerSecond: Math.round(output.bitrateMbps * 1_000_000)
    }
    if (mime) recorderOptions.mimeType = mime
    if (mixer) recorderOptions.audioBitsPerSecond = 160_000

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(combined, recorderOptions)
    } catch (err) {
      notice(`录制器启动失败：${errorText(err)}`)
      await window.api.clip.discard(begin.data.id)
      clipRef.current = null
      return
    }
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      const blob = event.data
      const id = clipRef.current
      if (!blob || blob.size === 0) return
      if (!id) return
      writesRef.current = writesRef.current
        .then(() => blob.arrayBuffer())
        .then((buffer) => window.api.clip.chunk(id, new Uint8Array(buffer)))
        .then((result) => {
          if (!result.ok) writeErrorRef.current = result.message ?? '写入失败'
        })
        .catch((err: unknown) => {
          writeErrorRef.current = errorText(err)
        })
    }
    recorder.onerror = () => notice('录制过程中出现异常，已尽量保留已写入的部分')
    recorder.onstop = () => {
      void finalize()
    }

    // 倒计时，期间允许取消
    for (let index = output.countdown; index > 0; index -= 1) {
      if (cancelRef.current) {
        cancelRef.current = false
        await window.api.clip.discard(begin.data.id)
        clipRef.current = null
        stopStream(captureStreamRef.current)
        captureStreamRef.current = null
        recorderRef.current = null
        updateStatus('ready')
        return
      }
      setCountdown(index)
      updateStatus('countdown')
      await sleep(1000)
    }
    setCountdown(0)
    if (cancelRef.current) {
      cancelRef.current = false
      await window.api.clip.discard(begin.data.id)
      clipRef.current = null
      updateStatus('ready')
      return
    }

    startedAtRef.current = performance.now()
    pausedAtRef.current = 0
    pausedTotalRef.current = 0
    lastFrameRef.current = 0
    setElapsed(0)
    recorder.start(1000)
    updateStatus('recording')
    await window.api.recorder.setActive(true)
    await window.api.recorder.setHotkeys(true)
    if (output.floatingBar) await window.api.control.setVisible(true)
    // 先给自己的窗口加内容保护：万一它还在被录的画面里，抓屏也拍不到
    await window.api.window.shield(true)
    // 内容保护不可靠时才整体挪出画面；最小化会让 canvas 停止出帧，绝不能最小化
    if (output.parkWindow) {
      await window.api.window.park({ parked: true, displayId: sourceRef.current?.displayId })
    }
  }, [canvasRef, finalize, notice, updateStatus])

  const togglePause = useCallback((): void => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      pausedAtRef.current = performance.now()
      updateStatus('paused')
    } else if (recorder.state === 'paused') {
      pausedTotalRef.current += performance.now() - pausedAtRef.current
      pausedAtRef.current = 0
      recorder.resume()
      updateStatus('recording')
    }
  }, [updateStatus])

  const stop = useCallback(async (): Promise<void> => {
    if (statusRef.current === 'countdown' || statusRef.current === 'ready') {
      cancelRef.current = true
      return
    }
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    updateStatus('finishing')
    await window.api.recorder.setHotkeys(false)
    // 先把主窗口摆回桌面再收尾：否则移出画面的窗口跟着挡住了进度，用户会以为按钮失灵
    await window.api.window.reveal()
    await window.api.cursor.stop()
    recorder.stop()
  }, [updateStatus])

  const reset = useCallback(async (): Promise<void> => {
    const id = clipRef.current
    if (id) {
      await window.api.clip.discard(id)
      clipRef.current = null
    }
    setLast(null)
    setElapsed(0)
    setCountdown(0)
    setSourceSize(null)
    setOutputSize(null)
    await teardown()
    updateStatus('idle')
  }, [teardown, updateStatus])

  const enableCamera = useCallback(
    async (deviceId: string): Promise<void> => {
      if (camStreamRef.current && camDeviceRef.current === deviceId) return
      stopStream(camStreamRef.current)
      camStreamRef.current = null
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        })
        camStreamRef.current = stream
        camDeviceRef.current = deviceId
        const video = ensureCameraVideo()
        video.srcObject = stream
        video.muted = true
        await video.play()
        await waitForFrame(video, 2000)
      } catch (err) {
        notice(`摄像头打开失败：${errorText(err)}`)
      }
    },
    [ensureCameraVideo, notice]
  )

  const disableCamera = useCallback((): void => {
    stopStream(camStreamRef.current)
    camStreamRef.current = null
    camDeviceRef.current = ''
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
  }, [])

  const saveLast = useCallback(async (): Promise<void> => {
    const current = last
    const id = clipRef.current
    if (!current) return
    if (current.item) {
      await window.api.library.reveal(current.item.path)
      return
    }
    if (!id) {
      notice('临时文件已丢失，无法保存')
      return
    }
    const committed = await window.api.clip.commit(id, {
      name: timestampName(),
      duration: current.duration,
      width: current.width,
      height: current.height,
      mime: current.mime
    })
    if (committed.ok && committed.data) {
      clipRef.current = null
      setLast({
        ...current,
        item: committed.data,
        path: committed.data.path,
        size: committed.data.size,
        url: clipUrl(committed.data.path)
      })
      notice(`已保存到 ${committed.data.path}`)
    } else if (!committed.ok) {
      notice(committed.message ?? '保存失败')
    }
  }, [last, notice])

  const discardLast = useCallback(async (): Promise<void> => {
    const current = last
    if (!current) return
    if (current.item) {
      await window.api.library.remove(current.item.id, true)
    } else if (clipRef.current) {
      await window.api.clip.discard(clipRef.current)
    }
    clipRef.current = null
    setLast(null)
  }, [last])

  /* --------------------------- 逐帧合成：预览即录制 --------------------------- */

  useEffect(() => {
    const draw = (now: number): void => {
      const stage = stageRef.current
      const canvas = canvasRef.current
      if (statusRef.current === 'idle' || !canvas) return
      if (!compositorRef.current) compositorRef.current = new Compositor(canvas)
      const compositor = compositorRef.current
      const minGap = (1000 / Math.max(1, stage.fps)) * 0.72
      if (now - lastFrameRef.current < minGap) return
      const dt = lastFrameRef.current ? Math.min(0.25, (now - lastFrameRef.current) / 1000) : 0.016
      lastFrameRef.current = now

      const size = resolveOutputSize(stage, videoSizeRef.current.width, videoSizeRef.current.height)
      outputSizeRef.current = size
      compositor.setSize(size.width, size.height)
      compositor.draw(
        {
          screen: screenVideoRef.current,
          camera: cameraVideoRef.current,
          cursor: cursorRef.current,
          displayBounds: sourceRef.current?.displayBounds ?? null,
          time: now,
          dt
        },
        stage,
        overlaysRef.current
      )

      if (now - meterAtRef.current > 100) {
        meterAtRef.current = now
        const mixer = mixerRef.current
        const sys = mixer?.level('system') ?? 0
        const mic = mixer?.level('mic') ?? 0
        setLevels({ sys, mic })
        const recording = statusRef.current === 'recording' || statusRef.current === 'paused'
        const value = elapsedSeconds(now)
        // 收尾阶段停在最后一点，别让计时继续跳，看着像卡住
        if (recording) setElapsed(value)
        window.api.control.pushState({
          active: recording,
          paused: statusRef.current === 'paused',
          elapsed: value,
          sysLevel: sys,
          micLevel: mic,
          label: sourceRef.current?.name ?? ''
        })
      }
    }

    let raf = 0
    const loop = (now: number): void => {
      draw(now)
      raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    // 主窗口被最小化时 rAF 可能停摆，这条定时器负责把画面续上
    const timer = window.setInterval(() => draw(performance.now()), 8)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearInterval(timer)
    }
  }, [canvasRef, elapsedSeconds])

  useEffect(() => {
    compositorRef.current?.preload(overlays)
  }, [overlays])

  // 光标位置由主进程推送
  useEffect(() => window.api.cursor.onPoint((point) => {
    cursorRef.current = point
  }), [])

  // 悬浮控制条与全局快捷键下发的指令
  useEffect(
    () =>
      window.api.recorder.onCommand((command) => {
        if (command === 'toggle-pause') togglePause()
        else if (command === 'stop') void stop()
        else if (command === 'show-main') {
          void (async () => {
            await window.api.window.restore()
            notice('主窗口已回到桌面：如果正在录屏，它会被录进画面里')
          })()
        }
      }),
    [notice, stop, togglePause]
  )

  // 设置变化时同步音频图（录音中的麦克风、音量都能即时改）
  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer || statusRef.current === 'idle') return
    void (async () => {
      await syncMic()
      const audio = audioRef.current
      const track = screenStreamRef.current?.getAudioTracks()[0] ?? null
      if (audio.system && track) {
        mixer.add(new MediaStream([track]), audio.systemVolume, 'system')
      } else {
        mixer.remove('system')
      }
    })()
  }, [
    options.audio.system,
    options.audio.mic,
    options.audio.micDeviceId,
    options.audio.micVolume,
    options.audio.systemVolume,
    options.audio.micNoiseSuppression,
    syncMic
  ])

  // 光标高亮/跟随放大是按需开启的，运行中切换也要立刻生效
  useEffect(() => {
    if (statusRef.current === 'idle') return
    if (options.stage.cursorEnabled || options.stage.zoomEnabled) void window.api.cursor.start()
    else {
      cursorRef.current = null
      void window.api.cursor.stop()
    }
  }, [options.stage.cursorEnabled, options.stage.zoomEnabled])

  useEffect(() => {
    void refreshDevices()
    return () => {
      void teardown()
    }
  }, [refreshDevices, teardown])

  return {
    status,
    elapsed,
    countdown,
    levels,
    sourceSize,
    outputSize,
    devices,
    last,
    prepare,
    start,
    togglePause,
    stop,
    reset,
    enableCamera,
    disableCamera,
    refreshDevices,
    saveLast,
    discardLast
  }
}
