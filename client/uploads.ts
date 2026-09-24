/**
 * Quickdraw keeps pasted images in the document as data URLs. Those are too
 * big for the room socket and for SQLite rows, so before an image syncs it is
 * uploaded to R2 and the asset's `src` is swapped for the upload URL.
 * Uploads are named by content hash: the same image twice is a no-op.
 */

const inflight = new Map<string, Promise<string>>()

export function uploadDataUrl(dataUrl: string): Promise<string> {
  let p = inflight.get(dataUrl)
  if (!p) {
    p = upload(dataUrl)
    p.catch(() => inflight.delete(dataUrl))
    inflight.set(dataUrl, p)
  }
  return p
}

async function upload(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const bytes = await blob.arrayBuffer()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = Array.from(digest.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('')
  const url = `/api/uploads/${hash}.${extensionFor(blob.type)}`

  let delay = 600
  for (let attempt = 0; ; attempt++) {
    let status = 0
    try {
      const res = await fetch(url, { method: 'POST', body: bytes, headers: { 'content-type': blob.type } })
      status = res.status
      // 409: already there, which for a content-addressed name is success.
      if (res.ok || res.status === 409) return url
    } catch {
      /* network error: retry */
    }
    const fatal = status >= 400 && status < 500 && status !== 429
    if (fatal || attempt >= 3) throw new Error(`Upload failed (${status || 'network'})`)
    await new Promise((r) => setTimeout(r, delay))
    delay *= 2
  }
}

function extensionFor(mime: string) {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'img'
  }
}
