import path from 'node:path'
import { promises as fsp } from 'node:fs'
import {
  BrowserWindow,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  protocol,
  screen,
  shell
} from 'electron'
import type {
  AppInfo,
  CaptureCapabilities,
  ClipBegin,
  ClipFinish,
  ClipMeta,
  ControlState,
  CursorPoint,
  IpcResult,
  ImagePickResult,
  RecorderCommand,
  RecordItem,
  SourceInfo,
  SourceKind
} from '@shared/types'
import {
  getCapabilities,
  installDisplayMediaHandler,
  listSources,
  setPendingCapture,
  startCursorTracking,
  stopCursorTracking
} from './capture'
import {
  appendClip,
  beginClip,
  commitClip,
  discardClip,
  finishClip,
  initClipStorage,
  listRecords,
  openRecordFolder,
  outputDir,
  registerClipProtocol,
  removeRecord,
  revealRecord,
  saveClipToLibrary
} from './clips'

/** clip:// 只用于回放本地录制文件，需要 Range 与流式响应 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'clip',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let controlWindow: BrowserWindow | null = null
let recordingActive = false
/** 录制前主窗口的位置，录制结束后原样还回去 */
let parkedBounds: { x: number; y: number; width: number; height: number } | null = null

const CONTROL_WIDTH = 300
const CONTROL_HEIGHT = 76

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail(message: string): IpcResult<never> {
  return { ok: false, message }
}

async function guard<T>(task: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return ok(await task())
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

function sendCommand(command: RecorderCommand): void {
  mainWindow?.webContents.send('recorder:command', command)
}

/* --------------------------------- 窗口 --------------------------------- */

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#07080c',
    title: 'VideoForYou 录屏工坊',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 录制时主窗口会被最小化，必须关掉后台节流，否则画面会停
      backgroundThrottling: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))
  mainWindow.on('closed', () => {
    mainWindow = null
    // 悬浮条必须一起收掉：只要还留着一个隐藏窗口，window-all-closed 就不会触发，
    // 进程会赖在后台占着单实例锁，用户再点图标就只是静默退出
    destroyControlWindow()
  })

  // 录制中直接关窗会丢掉还没落盘的分片，先停下来再退
  mainWindow.on('close', (event) => {
    if (!recordingActive || !mainWindow) return
    event.preventDefault()
    sendCommand('stop')
    setTimeout(() => {
      recordingActive = false
      mainWindow?.destroy()
    }, 1600)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function destroyControlWindow(): void {
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.destroy()
  controlWindow = null
}

/**
 * 悬浮控制条单独开窗，并打开内容保护：
 * Windows 下等效 WDA_EXCLUDEFROMCAPTURE，任何录屏软件（包括我们自己）都拍不到它。
 *
 * 只在需要时创建、不用就销毁。留着一个隐藏窗口会让「关掉主窗口」不触发
 * window-all-closed，进程会赖在后台占着单实例锁，用户就再也打不开这个应用了。
 */
function createControlWindow(): void {
  if (controlWindow && !controlWindow.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  controlWindow = new BrowserWindow({
    width: CONTROL_WIDTH,
    height: CONTROL_HEIGHT,
    x: Math.round(workArea.x + workArea.width / 2 - CONTROL_WIDTH / 2),
    y: Math.round(workArea.y + workArea.height - CONTROL_HEIGHT - 28),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 不设 focusable:false——某些 Windows 版本下无激活窗口收不到鼠标点击
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  controlWindow.setAlwaysOnTop(true, 'screen-saver')
  controlWindow.setContentProtection(true)
  controlWindow.setVisibleOnAllWorkspaces(true)
  controlWindow.on('closed', () => {
    controlWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const base = devUrl.endsWith('/') ? devUrl : `${devUrl}/`
    void controlWindow.loadURL(`${base}control.html`)
  } else {
    void controlWindow.loadFile(path.join(__dirname, '../renderer/control.html'))
  }
}

function showControlWindow(visible: boolean): void {
  if (!visible) {
    destroyControlWindow()
    return
  }
  createControlWindow()
  if (!controlWindow || controlWindow.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  controlWindow.setBounds({
    x: Math.round(workArea.x + workArea.width / 2 - CONTROL_WIDTH / 2),
    y: Math.round(workArea.y + workArea.height - CONTROL_HEIGHT - 28),
    width: CONTROL_WIDTH,
    height: CONTROL_HEIGHT
  })
  controlWindow.showInactive()
}

/* --------------------------------- IPC --------------------------------- */

function registerIpc(): void {
  ipcMain.handle('capture:capabilities', () => ok<CaptureCapabilities>(getCapabilities()))

  ipcMain.handle('capture:sources', (_event, kinds: SourceKind[], thumbs: boolean) =>
    guard<SourceInfo[]>(() => listSources(kinds?.length ? kinds : ['screen', 'window'], thumbs !== false))
  )

  ipcMain.handle('capture:prepare', (_event, payload: { sourceId: string; systemAudio: boolean }) =>
    guard(() => {
      setPendingCapture({
        sourceId: String(payload?.sourceId ?? ''),
        systemAudio: Boolean(payload?.systemAudio)
      })
      return true
    })
  )

  ipcMain.handle('cursor:start', () =>
    guard(() => {
      startCursorTracking((point: CursorPoint) => mainWindow?.webContents.send('cursor:point', point))
      return true
    })
  )
  ipcMain.handle('cursor:stop', () =>
    guard(() => {
      stopCursorTracking()
      return true
    })
  )

  ipcMain.handle('clip:begin', (_event, ext: string) =>
    guard<ClipBegin>(() => beginClip(String(ext ?? '.mp4')))
  )
  ipcMain.handle('clip:chunk', (_event, id: string, chunk: ArrayBuffer | Uint8Array) =>
    guard<number>(() => appendClip(String(id), chunk))
  )
  ipcMain.handle('clip:finish', (_event, id: string) => guard<ClipFinish>(() => finishClip(String(id))))
  ipcMain.handle('clip:save', (_event, id: string, meta: ClipMeta) =>
    guard<RecordItem>(() => {
      const target = meta?.name ? meta : { ...(meta ?? {}), name: `recording-${Date.now()}` }
      return saveClipToLibrary(String(id), target as ClipMeta)
    })
  )
  ipcMain.handle('clip:commit', (_event, id: string, meta: ClipMeta) =>
    guard<RecordItem | null>(() => {
      const target = meta?.name ? meta : { ...(meta ?? {}), name: `recording-${Date.now()}` }
      return commitClip(mainWindow, String(id), target as ClipMeta)
    })
  )
  ipcMain.handle('clip:discard', (_event, id: string) => guard<boolean>(() => discardClip(String(id))))

  ipcMain.handle('library:list', () => guard<RecordItem[]>(() => listRecords()))
  ipcMain.handle('library:remove', (_event, id: string, deleteFile: boolean) =>
    guard<RecordItem[]>(() => removeRecord(String(id), deleteFile !== false))
  )
  ipcMain.handle('library:reveal', (_event, filePath: string) =>
    guard<boolean>(() => revealRecord(String(filePath)))
  )
  ipcMain.handle('library:openDir', () => guard<string>(() => openRecordFolder()))

  ipcMain.handle('dialog:image', () =>
    guard<ImagePickResult[]>(async () => {
      const result = await dialog.showOpenDialog({
        title: '选择贴图',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
      })
      if (result.canceled) return []
      const picked: ImagePickResult[] = []
      for (const file of result.filePaths) {
        const buffer = await fsp.readFile(file).catch(() => null)
        if (!buffer) continue
        const image = nativeImage.createFromBuffer(buffer)
        const size = image.getSize()
        const ext = path.extname(file).toLowerCase()
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : 'image/png'
        picked.push({
          name: path.basename(file),
          dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
          aspect: size.width && size.height ? size.width / size.height : 1
        })
      }
      return picked
    })
  )

  ipcMain.handle('recorder:active', (_event, active: boolean) => {
    recordingActive = Boolean(active)
    return ok(true)
  })

  ipcMain.handle('hotkeys:set', (_event, enabled: boolean) =>
    guard(() => {
      globalShortcut.unregisterAll()
      if (!enabled) return false
      globalShortcut.register('CommandOrControl+Shift+P', () => sendCommand('toggle-pause'))
      globalShortcut.register('CommandOrControl+Shift+S', () => sendCommand('stop'))
      return true
    })
  )

  ipcMain.handle('control:visible', (_event, visible: boolean) => {
    showControlWindow(Boolean(visible))
    return ok(true)
  })

  ipcMain.on('state:push', (_event, state: ControlState) => {
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('state:update', state)
    if (!state.active) showControlWindow(false)
  })

  ipcMain.on('control:command', (_event, command: RecorderCommand) => {
    // 统一转给主窗口处理，渲染层才能带上提示与状态判断
    sendCommand(command)
  })

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
    return ok(true)
  })

  /**
   * 录制期间把主窗口挪出被录制的画面：多显示器时挪到另一块屏，单显示器时整体移出虚拟桌面。
   * 这里刻意不做最小化——窗口一隐藏，canvas 捕获就不再出帧，录出来的会是静止画面。
   */
  /**
   * 让主窗口远离录制的两种办法：
   * - shield：设置内容保护（WDA_EXCLUDEFROMCAPTURE），任何抓屏都拍不到它，窗口原地不动也能正常操作
   * - park：多显示器挪到另一块屏，单显示器整体移出虚拟桌面（内容保护失效时的兜底）
   */
  ipcMain.handle('window:shield', (_event, on: boolean) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return ok(false)
    win.setContentProtection(Boolean(on))
    return ok(true)
  })

  /** 收尾时立刻把主窗口摆回桌面并聚焦，保证进度和后续对话框用户看得见 */
  ipcMain.handle('window:reveal', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return ok(false)
    if (parkedBounds) {
      win.setBounds(parkedBounds)
      parkedBounds = null
    }
    win.setContentProtection(false)
    if (!win.isVisible()) win.show()
    if (win.isMinimized()) win.restore()
    win.focus()
    return ok(true)
  })

  ipcMain.handle('window:park', (_event, payload: { parked: boolean; displayId?: string }) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return ok(false)

    if (!payload?.parked) {
      if (parkedBounds) win.setBounds(parkedBounds)
      parkedBounds = null
      win.setContentProtection(false)
      return ok(true)
    }

    if (!parkedBounds) parkedBounds = win.getBounds()
    const displays = screen.getAllDisplays()
    const recorded = displays.find((item) => String(item.id) === String(payload?.displayId ?? ''))
    const other = displays.find((item) => String(item.id) !== String(recorded?.id ?? -1))

    if (recorded && other) {
      const width = Math.min(parkedBounds.width, other.workArea.width - 60)
      const height = Math.min(parkedBounds.height, other.workArea.height - 60)
      win.setBounds({
        x: other.workArea.x + Math.round((other.workArea.width - width) / 2),
        y: other.workArea.y + Math.round((other.workArea.height - height) / 2),
        width,
        height
      })
    } else {
      // 单显示器：放到虚拟桌面右边界之外，整块屏都录不到它
      const maxX = displays.reduce((max, item) => Math.max(max, item.bounds.x + item.bounds.width), 0)
      const minY = displays.reduce((min, item) => Math.min(min, item.bounds.y), 0)
      win.setPosition(maxX + 24, minY)
    }
    // 双保险：万一位置算错，内容保护也会让窗口不进入任何录屏画面
    win.setContentProtection(true)
    return ok(true)
  })
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return ok(false)
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return ok(mainWindow.isMaximized())
  })
  ipcMain.handle('window:restore', () => {
    if (!mainWindow) return ok(false)
    mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return ok(true)
  })
  ipcMain.handle('window:isMaximized', () => ok(mainWindow?.isMaximized() ?? false))
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
    return ok(true)
  })

  ipcMain.handle('app:info', () =>
    ok<AppInfo>({
      version: app.getVersion(),
      platform: process.platform,
      userData: app.getPath('userData'),
      outputDir: outputDir()
    })
  )

}

/* ------------------------------- 应用生命周期 ------------------------------- */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 已经有一个实例在跑：把它的窗口顶到前面；窗口被关掉过就重新开一个
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    await initClipStorage()
    registerClipProtocol()
    installDisplayMediaHandler()
    registerIpc()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // 进程要退的时候不留尾巴：快捷键、光标跟踪、隐藏的悬浮条全部收干净
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopCursorTracking()
    destroyControlWindow()
  })
}
