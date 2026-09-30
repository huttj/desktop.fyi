// Moving pictures: animated GIFs and videos on the board. An image shape's
// asset can be either; the shape draws whatever frame is current, so crop,
// resize, bindings and export treat it like any picture.
//
// A canvas only ever draws the first frame of an animated <img>, so GIFs are
// decoded here (parseGif / GifAnimator, pure and testable) and composed into a
// canvas of their own. Videos draw straight from a muted, looping <video>.
// Either kind plays only while the screen actually draws it: a player that
// goes a moment without being drawn (scrolled away, hidden, faded out) stops
// asking for frames and, for a video, pauses.
// Dependency-free ESM (see palette.js).

// ---- what an asset is ------------------------------------------------------

const VIDEO_EXT = /\.(webm|mp4|m4v|mov|ogv)(?:[?#]|$)/i
const GIF_EXT = /\.gif(?:[?#]|$)/i

export function isVideoAsset(asset) {
  if (!asset) return false
  if (asset.mime) return asset.mime.startsWith('video/')
  return /^data:video\//i.test(asset.src) || VIDEO_EXT.test(asset.src)
}
export function isGifAsset(asset) {
  if (!asset) return false
  if (asset.mime) return asset.mime === 'image/gif'
  return /^data:image\/gif/i.test(asset.src) || GIF_EXT.test(asset.src)
}

// the media type a file most likely is, when it doesn't say (a drop from a
// server that sends octet-stream, a file with no type)
export function guessMime(name = '', type = '') {
  if (type && type !== 'application/octet-stream') return type
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(name)?.[1]?.toLowerCase()
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    avif: 'image/avif', heic: 'image/heic', webm: 'video/webm', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', ogv: 'video/ogg',
  }[ext] || type || ''
}
export const isMediaType = (type) => /^(image|video)\//.test(type || '')

// ---- GIF -------------------------------------------------------------------

// The frames of a GIF, still compressed: { w, h, frames: [{ x, y, w, h,
// delay (ms), disposal, transparent (index or -1), palette, interlaced,
// minCodeSize, data }] }. Null when it isn't a GIF. A truncated file keeps
// the frames that arrived whole.
export function parseGif(input) {
  const u = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (u.length < 13) return null
  const sig = String.fromCharCode(u[0], u[1], u[2], u[3], u[4], u[5])
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  const w = u[6] | (u[7] << 8)
  const h = u[8] | (u[9] << 8)
  let p = 13
  let global = null
  if (u[10] & 0x80) {
    const n = 3 * (1 << ((u[10] & 7) + 1))
    global = u.subarray(p, p + n)
    p += n
  }
  // a run of sub-blocks, joined; p ends past the terminator
  const blocks = () => {
    const parts = []
    let len = 0
    while (p < u.length) {
      const size = u[p++]
      if (!size) return join(parts, len)
      if (p + size > u.length) return null
      parts.push(u.subarray(p, p + size))
      len += size
      p += size
    }
    return null
  }
  const frames = []
  let gce = null
  while (p < u.length) {
    const b = u[p++]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = u[p++]
      if (label === 0xf9 && p + 5 < u.length) {
        const flags = u[p + 1]
        gce = { disposal: (flags >> 2) & 7, transparent: flags & 1 ? u[p + 4] : -1, delay: (u[p + 2] | (u[p + 3] << 8)) * 10 }
      }
      if (blocks() === null) break
    } else if (b === 0x2c) {
      if (p + 9 > u.length) break
      const f = u[p + 8]
      const frame = {
        x: u[p] | (u[p + 1] << 8), y: u[p + 2] | (u[p + 3] << 8),
        w: u[p + 4] | (u[p + 5] << 8), h: u[p + 6] | (u[p + 7] << 8),
        interlaced: !!(f & 0x40), palette: global,
        delay: gce?.delay ?? 0, disposal: gce?.disposal ?? 0, transparent: gce?.transparent ?? -1,
      }
      p += 9
      if (f & 0x80) {
        const n = 3 * (1 << ((f & 7) + 1))
        frame.palette = u.subarray(p, p + n)
        p += n
      }
      frame.minCodeSize = u[p++]
      frame.data = blocks()
      gce = null
      if (!frame.data) break
      if (frame.palette && frame.w && frame.h) frames.push(frame)
    } else break
  }
  return { w, h, frames }
}

function join(parts, len) {
  if (parts.length === 1) return parts[0]
  const out = new Uint8Array(len)
  let o = 0
  for (const part of parts) { out.set(part, o); o += part.length }
  return out
}

// GIF's variable-width LZW: `count` palette indices out of `data`. A stream
// that ends early leaves the rest at 0.
export function lzwDecode(minCodeSize, data, count) {
  const out = new Uint8Array(count)
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const prefix = new Uint16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  for (let i = 0; i < clear; i++) suffix[i] = i
  let size = minCodeSize + 1, mask = (1 << size) - 1, avail = clear + 2
  let old = -1, first = 0, datum = 0, bits = 0, pos = 0, op = 0
  outer: while (op < count) {
    while (bits < size) {
      if (pos >= data.length) break outer
      datum |= data[pos++] << bits
      bits += 8
    }
    let code = datum & mask
    datum >>>= size
    bits -= size
    if (code === clear) {
      size = minCodeSize + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1
      continue
    }
    if (code === eoi) break
    if (old === -1) {
      if (code >= clear) break
      out[op++] = first = suffix[code]
      old = code
      continue
    }
    const inCode = code
    let top = 0
    if (code > avail) break // corrupt
    if (code === avail) { stack[top++] = first; code = old }
    while (code > eoi && top < 4096) { stack[top++] = suffix[code]; code = prefix[code] }
    first = suffix[code]
    stack[top++] = first
    if (avail < 4096) {
      prefix[avail] = old
      suffix[avail] = first
      avail++
      if ((avail & mask) === 0 && avail < 4096) { size++; mask = (1 << size) - 1 }
    }
    old = inCode
    while (top > 0 && op < count) out[op++] = stack[--top]
  }
  return out
}

// the row order of an interlaced frame: every 8th from 0, every 8th from 4,
// every 4th from 2, every 2nd from 1
function interlacedRows(h) {
  const rows = []
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y)
  return rows
}

// Plays a parsed GIF into an RGBA buffer the size of its screen, one frame
// per step(), honouring each frame's disposal. Pure: the browser side copies
// `pixels` onto a canvas.
export class GifAnimator {
  constructor(gif) {
    this.gif = gif
    this.w = gif.w
    this.h = gif.h
    this.pixels = new Uint8ClampedArray(gif.w * gif.h * 4)
    this.index = -1
    this._prev = null // what disposal 3 restores
  }
  get frameCount() { return this.gif.frames.length }
  // Composes the next frame and returns how long it shows, in ms. Browsers
  // play a delay of 0 or 10ms at 100ms; so does this.
  step() {
    const frames = this.gif.frames
    if (!frames.length) return Infinity
    const last = frames[this.index]
    if (last) this._dispose(last)
    this.index = (this.index + 1) % frames.length
    if (this.index === 0) { this.pixels.fill(0); this._prev = null }
    const f = frames[this.index]
    if (f.disposal === 3) this._prev = this.pixels.slice()
    this._draw(f)
    return f.delay <= 10 ? 100 : f.delay
  }
  _dispose(f) {
    if (f.disposal === 2) this._clear(f)
    else if (f.disposal === 3 && this._prev) this.pixels.set(this._prev)
  }
  _clear(f) {
    const W = this.w
    for (let y = f.y; y < Math.min(this.h, f.y + f.h); y++) {
      const row = (y * W + f.x) * 4
      this.pixels.fill(0, row, row + Math.max(0, Math.min(f.w, W - f.x)) * 4)
    }
  }
  _draw(f) {
    const idx = lzwDecode(f.minCodeSize, f.data, f.w * f.h)
    const rows = f.interlaced ? interlacedRows(f.h) : null
    const { pixels: px, w: W, h: H } = this
    const pal = f.palette
    const t = f.transparent
    for (let r = 0; r < f.h; r++) {
      const y = f.y + (rows ? rows[r] : r)
      if (y >= H) continue
      for (let c = 0; c < f.w; c++) {
        const x = f.x + c
        if (x >= W) break
        const i = idx[r * f.w + c]
        if (i === t) continue
        const o = (y * W + x) * 4
        px[o] = pal[i * 3]
        px[o + 1] = pal[i * 3 + 1]
        px[o + 2] = pal[i * 3 + 2]
        px[o + 3] = 255
      }
    }
  }
}

// ---- players (browser) -----------------------------------------------------

// A player is drawn through frame(wake): it returns what to draw now (or null
// while loading) and remembers that the screen still wants it. When a new
// frame is due it calls the latest `wake`, and the screen redraws.
const STALE_MS = 250
class Player {
  constructor() {
    this.drawnAt = 0
    this.wokeAt = 0
    this.wake = null
    this.paused = false // by the viewer; per player, never in the document
    this.running = false
  }
  // true while the screen has drawn it since it last asked to be drawn, or
  // only moments ago (the redraw it asked for may not have run yet)
  get wanted() { return this.drawnAt >= this.wokeAt || performance.now() - this.drawnAt < STALE_MS }
  // what the screen draws now; drawing it keeps it playing
  frame(wake) {
    this.drawnAt = performance.now()
    if (wake) this.wake = wake
    if (!this.running && !this.paused) this._start()
    return this.current()
  }
  _ping() {
    this.wokeAt = performance.now()
    this.wake?.()
  }
}

// the offstage shelf videos live on: some browsers won't decode frames for a
// video that isn't in the document
let shelf = null
function onShelf(v) {
  if (!shelf) {
    shelf = document.createElement('div')
    shelf.setAttribute('aria-hidden', 'true')
    shelf.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1'
    document.body.appendChild(shelf)
  }
  shelf.appendChild(v)
}

export class VideoPlayer extends Player {
  constructor(src, onReady) {
    super()
    this.kind = 'video'
    const v = (this.video = document.createElement('video'))
    v.muted = true
    v.loop = true
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    if (/^https?:/i.test(src) && !src.startsWith(location.origin)) v.crossOrigin = 'anonymous'
    v.addEventListener('loadeddata', () => { this.wake = this.wake || onReady; this._ping() })
    v.src = src
    onShelf(v)
  }
  get width() { return this.video.videoWidth }
  get height() { return this.video.videoHeight }
  get muted() { return this.video.muted }
  set muted(m) { this.video.muted = !!m }
  current() { return this.video.readyState >= 2 ? this.video : null }
  setPaused(p) {
    this.paused = !!p
    if (this.paused) { this.running = false; this.video.pause() } else this._start()
    this._ping()
  }
  _start() {
    this.running = true
    const v = this.video
    v.play()?.catch?.(() => { this.running = false })
    const tick = () => {
      if (!this.running) return
      if (!this.wanted) { this.running = false; v.pause(); return }
      this._ping()
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick)
      else setTimeout(tick, 33)
    }
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick)
    else setTimeout(tick, 33)
  }
  // the current frame as a still (for SVG, which can't hold a video)
  poster() {
    const v = this.video
    if (v.readyState < 2 || !v.videoWidth) return null
    try {
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
      return c.toDataURL('image/jpeg', 0.85)
    } catch { return null }
  }
  dispose() {
    this.running = false
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    this.video.remove()
  }
}

export class GifPlayer extends Player {
  constructor(gif) {
    super()
    this.kind = 'gif'
    this.anim = new GifAnimator(gif)
    this.canvas = document.createElement('canvas')
    this.canvas.width = gif.w
    this.canvas.height = gif.h
    this._ctx = this.canvas.getContext('2d')
    this._img = this._ctx.createImageData(gif.w, gif.h)
    this._delay = this._advance()
  }
  get width() { return this.anim.w }
  get height() { return this.anim.h }
  _advance() {
    const d = this.anim.step()
    this._img.data.set(this.anim.pixels)
    this._ctx.putImageData(this._img, 0, 0)
    return d
  }
  current() { return this.canvas }
  setPaused(p) {
    this.paused = !!p
    if (this.paused) { this.running = false; clearTimeout(this._timer) } else this._start()
    this._ping()
  }
  _start() {
    this.running = true
    const tick = () => {
      if (!this.running) return
      if (!this.wanted) { this.running = false; return }
      this._delay = this._advance()
      this._ping()
      this._timer = setTimeout(tick, this._delay)
    }
    this._timer = setTimeout(tick, this._delay)
  }
  poster() { return null }
  dispose() { this.running = false; clearTimeout(this._timer) }
}

// A GIF's player, or null when it has one frame (or can't be read: a picture
// elsewhere that won't share its bytes plays as a still).
export async function loadGif(src) {
  try {
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer())
    const gif = parseGif(bytes)
    return gif && gif.frames.length > 1 ? new GifPlayer(gif) : null
  } catch { return null }
}

// ---- reading imports -------------------------------------------------------

// a video's size, read from its metadata
export async function readVideoSize(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    await new Promise((res, rej) => {
      v.onloadedmetadata = res
      v.onerror = () => rej(new Error(`can't play ${blob.type || 'this video'}`))
      v.src = url
    })
    return { w: v.videoWidth || 640, h: v.videoHeight || 360 }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// The media a drag carries: files, else the address of a picture or video
// dragged out of another page (its HTML names the <img>/<video>), else a
// plain link. { files, urls } — either may be empty.
export function dataTransferMedia(dt) {
  if (!dt) return { files: [], urls: [] }
  const files = [...(dt.files || [])].filter((f) => isMediaType(guessMime(f.name, f.type)))
  if (files.length) return { files, urls: [] }
  const urls = []
  const html = dt.getData?.('text/html') || ''
  if (html) {
    for (const m of html.matchAll(/<(?:img|video|source)\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
      const u = decodeEntities(m[1] || m[2] || m[3])
      if (/^(https?:|data:(image|video)\/)/i.test(u)) urls.push(u)
    }
  }
  if (!urls.length) {
    const list = dt.getData?.('text/uri-list') || ''
    for (const line of list.split(/\r?\n/)) if (line && !line.startsWith('#') && /^https?:/i.test(line.trim())) urls.push(line.trim())
  }
  return { files, urls: [...new Set(urls)].slice(0, 20) }
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

// does a drag carry anything the board could take? (files, a link, a picture
// from another page, or words)
export function dragCarriesMedia(dt) {
  const types = [...(dt?.types || [])]
  return ['Files', 'text/uri-list', 'text/html', 'text/plain'].some((t) => types.includes(t))
}
