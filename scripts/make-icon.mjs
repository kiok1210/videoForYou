/**
 * 生成应用图标 build/icon.ico（无第三方依赖）。
 * 画面：深色圆角方块 + 中央红色录制圆点 + 外圈光环，对应「录制」这件事。
 * 输出 256/128/64/48/32/16 六个尺寸打进同一个 ico，Windows 缩略图不会糊。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZES = [256, 128, 64, 48, 32, 16]

/* ------------------------------- 绘图 ------------------------------- */

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const mix = (a, b, t) => a + (b - a) * t

/** 圆角矩形的覆盖度（带一点抗锯齿），返回 0~1 */
function roundedCoverage(x, y, size, radius) {
  const inset = size * 0.02
  const left = inset
  const top = inset
  const right = size - inset
  const bottom = size - inset
  const r = radius
  const cx = Math.min(Math.max(x, left + r), right - r)
  const cy = Math.min(Math.max(y, top + r), bottom - r)
  const dist = Math.hypot(x - cx, y - cy)
  if (x < left || x > right || y < top || y > bottom) return 0
  if (x >= left + r && x <= right - r) return 1
  if (y >= top + r && y <= bottom - r) return 1
  return clamp01(r + 0.5 - dist)
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.22
  const dot = size * 0.21
  const ringOuter = size * 0.33
  const ringWidth = Math.max(1, size * 0.035)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const i = (y * size + x) * 4
      const cover = roundedCoverage(px, py, size, radius)
      if (cover <= 0) continue

      // 背景：自上而下的深灰蓝渐变
      const t = py / size
      let r = mix(30, 10, t)
      let g = mix(34, 12, t)
      let b = mix(46, 18, t)

      const d = Math.hypot(px - cx, py - cy)

      // 外圈光环
      const ringEdge = Math.abs(d - ringOuter)
      if (ringEdge < ringWidth) {
        const a = clamp01(1 - ringEdge / ringWidth) * 0.55
        r = mix(r, 255, a)
        g = mix(g, 255, a)
        b = mix(b, 255, a)
      }

      // 中央录制圆点，边缘 1px 抗锯齿
      const dotEdge = clamp01(dot + 0.5 - d)
      if (dotEdge > 0) {
        r = mix(r, 255, dotEdge)
        g = mix(g, 55 + 20 * (1 - d / dot), dotEdge)
        b = mix(b, 95, dotEdge)
      }

      const addr = i
      pixels[addr] = Math.round(r)
      pixels[addr + 1] = Math.round(g)
      pixels[addr + 2] = Math.round(b)
      pixels[addr + 3] = Math.round(cover * 255)
    }
  }
  return pixels
}

/* ------------------------------ PNG 编码 ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer, seed = 0) {
  let c = seed ^ -1
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, payload) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ------------------------------ ICO 封装 ------------------------------ */

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16
  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry[0] = image.size >= 256 ? 0 : image.size
    entry[1] = image.size >= 256 ? 0 : image.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += image.png.length
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

/* -------------------------------- 执行 -------------------------------- */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'build', 'icon.ico')
mkdirSync(path.dirname(target), { recursive: true })

const images = SIZES.map((size) => ({ size, png: encodePng(size, render(size)) }))
const ico = encodeIco(images)
writeFileSync(target, ico)

// 顺手留一张 256 的 png，方便以后做宣传图
writeFileSync(path.join(root, 'build', 'icon.png'), images[0].png)

console.log(`icon.ico ${ico.length} bytes @ ${SIZES.join('/')}`)
console.log(`icon.png ${images[0].png.length} bytes @ 256`)
