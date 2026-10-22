import { createReadStream, createWriteStream, promises as fsp } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { BrowserWindow, app, dialog, protocol, shell } from 'electron'
import type { ClipBegin, ClipFinish, ClipMeta, RecordItem } from '@shared/types'

interface Session {
  id: string
  filePath: string
  ext: string
  stream: WriteStream
  size: number
  closed: boolean
}

const sessions = new Map<string, Session>()

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

function tempDir(): string {
  return path.join(app.getPath('temp'), 'videoforyou-clips')
}

/** 默认落盘位置：系统「视频」目录下的 VideoForYou */
export function outputDir(): string {
  return path.join(app.getPath('videos'), 'VideoForYou')
}

function libraryFile(): string {
  return path.join(app.getPath('userData'), 'library.json')
}

/** 启动时清理上一次没来得及收走的临时分片文件 */
export async function initClipStorage(): Promise<void> {
  const dir = tempDir()
  await fsp.mkdir(dir, { recursive: true })
  await fsp.mkdir(outputDir(), { recursive: true })
  const files = await fsp.readdir(dir).catch(() => [] as string[])
  await Promise.all(files.map((file) => fsp.unlink(path.join(dir, file)).catch(() => undefined)))
}

/** 录制的落盘方式：边录边把分片写进临时文件，内存里不留整段视频 */
export async function beginClip(ext: string): Promise<ClipBegin> {
  await fsp.mkdir(tempDir(), { recursive: true })
  const id = randomUUID()
  const filePath = path.join(tempDir(), `${id}${ext}`)
  const stream = createWriteStream(filePath, { highWaterMark: 1 << 20 })
  await new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve())
    stream.once('error', (err) => reject(err))
  })
  sessions.set(id, { id, filePath, ext, stream, size: 0, closed: false })
  return { id, path: filePath }
}

export async function appendClip(id: string, chunk: ArrayBuffer | Uint8Array): Promise<number> {
  const session = sessions.get(id)
  if (!session || session.closed) return 0
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer)
  session.size += buffer.byteLength
  await new Promise<void>((resolve, reject) => {
    session.stream.write(buffer, (err) => (err ? reject(err) : resolve()))
  })
  return session.size
}

function endStream(session: Session): Promise<void> {
  if (session.closed) return Promise.resolve()
  session.closed = true
  return new Promise<void>((resolve) => {
    session.stream.end(() => resolve())
  })
}

export async function finishClip(id: string): Promise<ClipFinish> {
  const session = sessions.get(id)
  if (!session) throw new Error('录制会话不存在')
  await endStream(session)
  const stat = await fsp.stat(session.filePath).catch(() => null)
  return { id, path: session.filePath, size: stat?.size ?? session.size }
}

/** 弹保存对话框并把临时文件搬到用户选的位置；取消则返回 null，临时文件保留 */
export async function commitClip(win: BrowserWindow | null, id: string, meta: ClipMeta): Promise<RecordItem | null> {
  const session = sessions.get(id)
  if (!session) throw new Error('录制会话不存在')
  await endStream(session)
  const safeName = (meta.name || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  const options = {
    title: '保存录制文件',
    defaultPath: path.join(outputDir(), `${safeName}${session.ext}`),
    filters: [
      { name: session.ext === '.mp4' ? 'MP4 视频' : 'WebM 视频', extensions: [session.ext.replace('.', '')] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  const target = result.filePath
  await fsp.mkdir(path.dirname(target), { recursive: true })
  try {
    await fsp.rename(session.filePath, target)
  } catch {
    // 跨盘符时 rename 会失败，退回复制
    await fsp.copyFile(session.filePath, target)
    await fsp.unlink(session.filePath).catch(() => undefined)
  }
  sessions.delete(id)

  const stat = await fsp.stat(target).catch(() => null)
  const item: RecordItem = {
    id: randomUUID(),
    name: path.basename(target),
    path: target,
    size: stat?.size ?? session.size,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    mime: meta.mime || 'video/mp4',
    createdAt: Date.now()
  }
  await addRecord(item)
  return item
}

/**
 * 录制结束直接收进作品库，不弹保存对话框。
 * 停止时必须确定性地完成——对话框有可能挂在看不见的窗口上，用户会以为卡死。
 */
export async function saveClipToLibrary(id: string, meta: ClipMeta): Promise<RecordItem> {
  const session = sessions.get(id)
  if (!session) throw new Error('录制会话不存在')
  await endStream(session)

  const safeName = (meta.name || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  await fsp.mkdir(outputDir(), { recursive: true })
  let target = path.join(outputDir(), `${safeName}${session.ext}`)
  let index = 1
  while (await fsp.stat(target).catch(() => null)) {
    index += 1
    target = path.join(outputDir(), `${safeName}-${index}${session.ext}`)
  }

  try {
    await fsp.rename(session.filePath, target)
  } catch {
    await fsp.copyFile(session.filePath, target)
    await fsp.unlink(session.filePath).catch(() => undefined)
  }
  sessions.delete(id)

  const stat = await fsp.stat(target).catch(() => null)
  const item: RecordItem = {
    id: randomUUID(),
    name: path.basename(target),
    path: target,
    size: stat?.size ?? session.size,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    mime: meta.mime || 'video/mp4',
    createdAt: Date.now()
  }
  await addRecord(item)
  return item
}

/** 放弃这次录制（临时文件直接删） */
export async function discardClip(id: string): Promise<boolean> {
  const session = sessions.get(id)
  if (!session) return false
  await endStream(session)
  sessions.delete(id)
  await fsp.unlink(session.filePath).catch(() => undefined)
  return true
}

/* --------------------------------- 作品库 --------------------------------- */

async function readLibrary(): Promise<RecordItem[]> {
  const raw = await fsp.readFile(libraryFile(), 'utf8').catch(() => '')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { records?: RecordItem[] }
    return Array.isArray(parsed.records) ? parsed.records : []
  } catch {
    return []
  }
}

async function writeLibrary(records: RecordItem[]): Promise<void> {
  await fsp.mkdir(path.dirname(libraryFile()), { recursive: true })
  await fsp.writeFile(libraryFile(), JSON.stringify({ records }, null, 2), 'utf8')
}

async function addRecord(item: RecordItem): Promise<void> {
  const records = await readLibrary()
  await writeLibrary([item, ...records.filter((row) => row.path !== item.path)].slice(0, 200))
}

export async function listRecords(): Promise<RecordItem[]> {
  const records = await readLibrary()
  // 顺手剔除已被用户在资源管理器里删掉的文件
  const alive: RecordItem[] = []
  for (const record of records) {
    const stat = await fsp.stat(record.path).catch(() => null)
    if (stat) alive.push({ ...record, size: stat.size })
  }
  if (alive.length !== records.length) await writeLibrary(alive)
  return alive
}

export async function removeRecord(id: string, deleteFile: boolean): Promise<RecordItem[]> {
  const records = await readLibrary()
  const target = records.find((record) => record.id === id)
  if (target && deleteFile) await fsp.unlink(target.path).catch(() => undefined)
  await writeLibrary(records.filter((record) => record.id !== id))
  return listRecords()
}

export function revealRecord(filePath: string): boolean {
  if (!filePath) return false
  shell.showItemInFolder(filePath)
  return true
}

export async function openRecordFolder(): Promise<string> {
  const dir = outputDir()
  await fsp.mkdir(dir, { recursive: true })
  await shell.openPath(dir)
  return dir
}

/**
 * 用 clip:// 自定义协议回放本地文件。
 * 渲染进程没法直接读 file://（跨源会被拦），统一从这里走，顺便支持进度条拖动。
 */
export function registerClipProtocol(): void {
  protocol.handle('clip', async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!filePath || !path.isAbsolute(filePath)) return new Response('Bad Request', { status: 400 })

    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat) return new Response('Not Found', { status: 404 })

    const total = stat.size
    const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    const range = request.headers.get('Range')
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      let start = match?.[1] ? Number(match[1]) : 0
      let end = match?.[2] ? Number(match[2]) : total - 1
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= total) end = total - 1
      if (start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
      }
      const slice = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(slice) as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${total}`
        }
      })
    }

    const full = createReadStream(filePath)
    return new Response(Readable.toWeb(full) as ReadableStream, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(total) }
    })
  })
}
