import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AudioSettings,
  CaptureCapabilities,
  OutputSettings,
  Overlay,
  SourceInfo,
  StageSettings
} from '@shared/types'
import { useRecorder } from '@/hooks/useRecorder'
import { DEFAULT_AUDIO, DEFAULT_OUTPUT, DEFAULT_STAGE, loadPersisted, persistSettings } from '@/lib/settings'
import { TitleBar } from '@/components/TitleBar'
import { HomeView } from '@/components/HomeView'
import { Studio } from '@/components/Studio'
import { ResultView } from '@/components/ResultView'
import { LibraryView } from '@/components/LibraryView'

type View = 'home' | 'studio' | 'result' | 'library'

/** 录制中切页面会把画布卸载掉，录制会停摆，先挡一下 */
const RECORDING_STATUSES = ['countdown', 'recording', 'paused', 'finishing'] as const

export default function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const persisted = useMemo(() => loadPersisted(), [])
  const [stage, setStage] = useState<StageSettings>({ ...DEFAULT_STAGE, ...persisted.stage })
  const [audio, setAudio] = useState<AudioSettings>({ ...DEFAULT_AUDIO, ...persisted.audio })
  const [output, setOutput] = useState<OutputSettings>({ ...DEFAULT_OUTPUT, ...persisted.output })
  const [overlays, setOverlays] = useState<Overlay[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [camDevice, setCamDevice] = useState('')
  const [view, setView] = useState<View>('home')
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [caps, setCaps] = useState<CaptureCapabilities | null>(null)
  const [toast, setToast] = useState('')

  const notice = useCallback((message: string) => setToast(message), [])

  const recorder = useRecorder({ canvasRef, stage, audio, output, overlays, onNotice: notice })
  const locked = RECORDING_STATUSES.includes(recorder.status as (typeof RECORDING_STATUSES)[number])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    void window.api.capture.capabilities().then((result) => {
      if (result.ok && result.data) setCaps(result.data)
    })
  }, [])

  useEffect(() => {
    persistSettings({ stage, audio, output })
  }, [stage, audio, output])

  // 有摄像头贴图才打开摄像头，避免一直占着摄像头
  const cameraCount = overlays.filter((overlay) => overlay.kind === 'camera').length
  useEffect(() => {
    if (cameraCount > 0) void recorder.enableCamera(camDevice)
    else recorder.disableCamera()
  }, [cameraCount, camDevice, recorder.enableCamera, recorder.disableCamera])

  const aspect = useMemo(() => {
    const size = recorder.outputSize ?? recorder.sourceSize
    if (!size || size.height <= 0) return 16 / 9
    return size.width / size.height
  }, [recorder.outputSize, recorder.sourceSize])

  // 录制结束自动跳到结果页（同一段录像不重复跳）
  const handledUrl = useRef<string | null>(null)
  useEffect(() => {
    const last = recorder.last
    if (!last || handledUrl.current === last.url) return
    handledUrl.current = last.url
    setView('result')
  }, [recorder.last])

  const patchStage = useCallback((patch: Partial<StageSettings>) => {
    setStage((current) => ({ ...current, ...patch }))
  }, [])
  const patchAudio = useCallback((patch: Partial<AudioSettings>) => {
    setAudio((current) => ({ ...current, ...patch }))
  }, [])
  const patchOutput = useCallback((patch: Partial<OutputSettings>) => {
    setOutput((current) => ({ ...current, ...patch }))
  }, [])

  const pickSource = async (next: SourceInfo): Promise<void> => {
    setSource(next)
    setView('studio')
    try {
      await recorder.prepare(next)
      // 重新取流后摄像头贴图需要重新打开
      if (overlays.some((overlay) => overlay.kind === 'camera')) await recorder.enableCamera(camDevice)
    } catch {
      // 错误已经通过 onNotice 提示，回到选择页让用户再试
      setView('home')
    }
  }

  const navigate = (next: 'home' | 'library'): void => {
    if (locked) {
      notice('录制中，请先停止或暂停')
      return
    }
    setView(next)
  }

  const backToHome = async (): Promise<void> => {
    if (locked) {
      notice(recorder.status === 'paused' ? '已暂停：先点「继续录制」收尾或再停一次' : '正在录制，请先点「停止并保存」')
      return
    }
    await recorder.reset()
    setSource(null)
    setView('home')
  }

  const recordAgain = async (): Promise<void> => {
    if (recorder.last && !recorder.last.item) {
      const ok = window.confirm('这段录制还没有保存到文件，确定丢弃并重新录制吗？')
      if (!ok) return
    }
    handledUrl.current = null
    await recorder.reset()
    setSource(null)
    setView('home')
  }

  return (
    <div className="app">
      <TitleBar
        title="VideoForYou 录屏工坊"
        subtitle="桌面录制 · 系统声音 · 特效贴图"
        view={view}
        onNavigate={navigate}
      />

      <div className="app-body">
        {view === 'home' ? (
          <HomeView
            caps={caps}
            audio={audio}
            output={output}
            stage={stage}
            devices={recorder.devices}
            levels={recorder.levels}
            busy={recorder.status === 'preparing'}
            onPick={(next) => void pickSource(next)}
            onAudio={patchAudio}
            onOutput={patchOutput}
            onStage={patchStage}
          />
        ) : null}

        {view === 'studio' ? (
          <Studio
            canvasRef={canvasRef}
            source={source}
            aspect={aspect}
            stage={stage}
            audio={audio}
            output={output}
            overlays={overlays}
            selectedId={selectedId}
            devices={recorder.devices}
            camDevice={camDevice}
            recorder={recorder}
            onStage={patchStage}
            onAudio={patchAudio}
            onOutput={patchOutput}
            onOverlays={setOverlays}
            onSelect={setSelectedId}
            onCamDevice={setCamDevice}
            onBack={() => void backToHome()}
          />
        ) : null}

        {view === 'result' && recorder.last ? (
          <ResultView
            last={recorder.last}
            onSave={() => void recorder.saveLast()}
            onDiscard={async () => {
              await recorder.discardLast()
              handledUrl.current = null
              setView('home')
            }}
            onAgain={() => void recordAgain()}
            onLibrary={() => setView('library')}
            onReveal={(filePath) => void window.api.library.reveal(filePath)}
          />
        ) : null}

        {view === 'library' ? <LibraryView onBack={() => navigate('home')} /> : null}
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
