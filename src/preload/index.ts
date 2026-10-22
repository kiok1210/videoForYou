import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  CaptureCapabilities,
  ClipBegin,
  ClipFinish,
  ClipMeta,
  ControlState,
  CursorPoint,
  ImagePickResult,
  IpcResult,
  RecorderCommand,
  RecordItem,
  SourceInfo,
  SourceKind
} from '@shared/types'

type Unsubscribe = () => void

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>

const api = {
  capture: {
    capabilities: (): Promise<IpcResult<CaptureCapabilities>> => invoke('capture:capabilities'),
    sources: (kinds: SourceKind[], thumbs = true): Promise<IpcResult<SourceInfo[]>> =>
      invoke('capture:sources', kinds, thumbs),
    /** 必须在 getDisplayMedia 之前调用，主进程靠它决定给哪块屏 */
    prepare: (payload: { sourceId: string; systemAudio: boolean }): Promise<IpcResult<boolean>> =>
      invoke('capture:prepare', payload)
  },
  cursor: {
    start: (): Promise<IpcResult<boolean>> => invoke('cursor:start'),
    stop: (): Promise<IpcResult<boolean>> => invoke('cursor:stop'),
    onPoint: (cb: (point: CursorPoint) => void): Unsubscribe => subscribe<CursorPoint>('cursor:point', cb)
  },
  clip: {
    begin: (ext: string): Promise<IpcResult<ClipBegin>> => invoke('clip:begin', ext),
    chunk: (id: string, data: Uint8Array): Promise<IpcResult<number>> => invoke('clip:chunk', id, data),
    finish: (id: string): Promise<IpcResult<ClipFinish>> => invoke('clip:finish', id),
    commit: (id: string, meta: ClipMeta): Promise<IpcResult<RecordItem | null>> =>
      invoke('clip:commit', id, meta),
    discard: (id: string): Promise<IpcResult<boolean>> => invoke('clip:discard', id),
    /** 录制结束后直接收进作品库，不弹对话框，保证「停止」一定能走完 */
    save: (id: string, meta: ClipMeta): Promise<IpcResult<RecordItem>> => invoke('clip:save', id, meta)
  },
  library: {
    list: (): Promise<IpcResult<RecordItem[]>> => invoke('library:list'),
    remove: (id: string, deleteFile = true): Promise<IpcResult<RecordItem[]>> =>
      invoke('library:remove', id, deleteFile),
    reveal: (filePath: string): Promise<IpcResult<boolean>> => invoke('library:reveal', filePath),
    openDir: (): Promise<IpcResult<string>> => invoke('library:openDir')
  },
  pickImages: (): Promise<IpcResult<ImagePickResult[]>> => invoke('dialog:image'),
  recorder: {
    setActive: (active: boolean): Promise<IpcResult<boolean>> => invoke('recorder:active', active),
    setHotkeys: (enabled: boolean): Promise<IpcResult<boolean>> => invoke('hotkeys:set', enabled),
    onCommand: (cb: (command: RecorderCommand) => void): Unsubscribe =>
      subscribe<RecorderCommand>('recorder:command', cb)
  },
  control: {
    setVisible: (visible: boolean): Promise<IpcResult<boolean>> => invoke('control:visible', visible),
    pushState: (state: ControlState): void => ipcRenderer.send('state:push', state),
    send: (command: RecorderCommand): void => ipcRenderer.send('control:command', command),
    onState: (cb: (state: ControlState) => void): Unsubscribe => subscribe<ControlState>('state:update', cb)
  },
  window: {
    minimize: (): Promise<IpcResult<boolean>> => invoke('window:minimize'),
    /** 录制期间把窗口挪出被录画面 / 录制结束后还原 */
    park: (payload: { parked: boolean; displayId?: string }): Promise<IpcResult<boolean>> =>
      invoke('window:park', payload),
    restore: (): Promise<IpcResult<boolean>> => invoke('window:restore'),
    /** 内容保护开关：开了之后任何抓屏都拍不到主窗口 */
    shield: (on: boolean): Promise<IpcResult<boolean>> => invoke('window:shield', on),
    /** 立刻把主窗口摆回桌面并聚焦 */
    reveal: (): Promise<IpcResult<boolean>> => invoke('window:reveal'),
    toggleMaximize: (): Promise<IpcResult<boolean>> => invoke('window:toggleMaximize'),
    isMaximized: (): Promise<IpcResult<boolean>> => invoke('window:isMaximized'),
    close: (): Promise<IpcResult<boolean>> => invoke('window:close'),
    onMaximized: (cb: (value: boolean) => void): Unsubscribe => subscribe<boolean>('window:maximized', cb)
  },
  app: {
    info: (): Promise<IpcResult<AppInfo>> => invoke('app:info')
  }
}

export type RecorderApi = typeof api

contextBridge.exposeInMainWorld('api', api)
