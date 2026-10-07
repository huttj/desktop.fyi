import { error, IRequest } from 'itty-router'

// assets are stored in the bucket under the /uploads path
export function getAssetObjectName(uploadId: string) {
	return `uploads/${uploadId.replace(/[^a-zA-Z0-9_-]+/g, '_')}`
}

declare global {
	interface CacheStorage {
		default: Cache
	}
}

/** The most a picture or video on a desktop may weigh (Workers take request bodies up to 100 MB). */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024

// when a user uploads an asset, we store it in the bucket. we only allow pictures and videos.
// The client names uploads by content hash, so a repeat of the same file is a no-op.
export async function handleAssetUpload(request: IRequest, env: Env) {
	const objectName = getAssetObjectName(request.params.uploadId)

	const contentType = request.headers.get('content-type') ?? ''
	if (!/^(image|video)\//.test(contentType)) {
		return error(400, 'Invalid content type')
	}
	const length = Number(request.headers.get('content-length') ?? 0)
	if (length > MAX_UPLOAD_BYTES) {
		return error(413, 'That file is too large')
	}

	if (await env.UPLOADS.head(objectName)) {
		return error(409, 'Upload already exists')
	}

	await env.UPLOADS.put(objectName, request.body, {
		httpMetadata: request.headers,
	})

	return { ok: true }
}

/**
 * Long sides of the smaller copies of a picture that may be asked for (`?s=`).
 * The smallest is a placeholder of a few KB that shows at once; the board
 * draws each picture from the smallest copy sharp enough for its zoom.
 */
export const IMAGE_LEVELS = [64, 512, 1024] as const

/** Pictures that shrink. Not GIFs (they move), SVGs (they scale anyway) or videos. */
const SHRINKS = /^image\/(jpeg|png|webp|avif)$/

// served uploads never change (they are named by content hash), may be read from anywhere, and never run
function setAssetHeaders(headers: Headers) {
	// assets are immutable, so we can cache them basically forever:
	headers.set('cache-control', 'public, max-age=31536000, immutable')
	// we set CORS headers so all clients can access assets. we do this here so our `cors` helper in
	// worker.ts doesn't try to set extra cors headers on responses that have been read from the
	// cache, which isn't allowed by cloudflare.
	headers.set('access-control-allow-origin', '*')
	// Prevent XSS from user-uploaded SVGs (or any file served with an executable content-type).
	headers.set('content-security-policy', "default-src 'none'")
	headers.set('x-content-type-options', 'nosniff')
}

/**
 * A smaller copy of an uploaded picture, `size` pixels on its long side (never
 * bigger than the original), as WebP. Made with the Images binding the first
 * time it is asked for and kept in the bucket beside the original, so each
 * copy is made once. Anything that doesn't shrink, or a copy that can't be
 * made, sends the asker to the original.
 */
async function handleLevel(request: IRequest, env: Env, ctx: ExecutionContext, size: number) {
	const objectName = getAssetObjectName(request.params.uploadId)
	const original = () => new Response(null, { status: 302, headers: { location: `/api/uploads/${encodeURIComponent(request.params.uploadId)}` } })
	const cacheKey = new Request(request.url)
	const cached = await caches.default.match(cacheKey)
	if (cached) return cached

	const levelName = `levels/${objectName.slice('uploads/'.length)}@${size}`
	let bytes: ArrayBuffer
	let contentType: string
	const level = await env.UPLOADS.get(levelName)
	if (level) {
		bytes = await level.arrayBuffer()
		contentType = level.httpMetadata?.contentType ?? 'image/webp'
	} else {
		const source = await env.UPLOADS.get(objectName)
		if (!source) return error(404)
		if (!SHRINKS.test(source.httpMetadata?.contentType ?? '')) {
			await source.body.cancel()
			return original()
		}
		try {
			const out = await env.IMAGES.input(source.body)
				.transform({ width: size, height: size, fit: 'scale-down' })
				// the placeholder only has to hint at the picture: as few bytes as will do
				.output({ format: 'image/webp', quality: size <= 64 ? 40 : 80 })
			bytes = await new Response(out.image()).arrayBuffer()
			contentType = out.contentType()
		} catch (e) {
			console.error('could not make a smaller copy', objectName, size, e)
			return original()
		}
		ctx.waitUntil(env.UPLOADS.put(levelName, bytes, { httpMetadata: { contentType } }))
	}

	const headers = new Headers({ 'content-type': contentType })
	setAssetHeaders(headers)
	ctx.waitUntil(caches.default.put(cacheKey, new Response(bytes, { headers })))
	return new Response(bytes, { headers })
}

// when a user downloads an asset, we retrieve it from the bucket. we also cache the response for performance.
export async function handleAssetDownload(request: IRequest, env: Env, ctx: ExecutionContext) {
	const size = Number(new URL(request.url).searchParams.get('s'))
	if ((IMAGE_LEVELS as readonly number[]).includes(size)) return handleLevel(request, env, ctx, size)

	const objectName = getAssetObjectName(request.params.uploadId)

	// if we have a cached response for this request (automatically handling ranges etc.), return it
	const cacheKey = new Request(request.url, { headers: request.headers })
	const cachedResponse = await caches.default.match(cacheKey)
	if (cachedResponse) {
		return cachedResponse
	}

	// if not, we try to fetch the asset from the bucket
	const object = await env.UPLOADS.get(objectName, {
		range: request.headers,
		onlyIf: request.headers,
	})

	if (!object) {
		return error(404)
	}

	// write the relevant metadata to the response headers
	const headers = new Headers()
	object.writeHttpMetadata(headers)

	setAssetHeaders(headers)
	headers.set('etag', object.httpEtag)
	// videos seek by range (Safari won't play one at all without)
	headers.set('accept-ranges', 'bytes')

	// cloudflare doesn't set the content-range header automatically in writeHttpMetadata, so we
	// need to do it ourselves.
	let contentRange
	if (object.range) {
		if ('suffix' in object.range) {
			const start = object.size - object.range.suffix
			const end = object.size - 1
			contentRange = `bytes ${start}-${end}/${object.size}`
		} else {
			const start = object.range.offset ?? 0
			const end = object.range.length ? start + object.range.length - 1 : object.size - 1
			if (start !== 0 || end !== object.size - 1) {
				contentRange = `bytes ${start}-${end}/${object.size}`
			}
		}
	}

	if (contentRange) {
		headers.set('content-range', contentRange)
	}

	// make sure we get the correct body/status for the response
	const body = 'body' in object && object.body ? object.body : null
	const status = body ? (contentRange ? 206 : 200) : 304

	// we only cache complete (200) responses
	if (status === 200) {
		const [cacheBody, responseBody] = body!.tee()
		ctx.waitUntil(caches.default.put(cacheKey, new Response(cacheBody, { headers, status })))
		return new Response(responseBody, { headers, status })
	}

	return new Response(body, { headers, status })
}

/**
 * A picture or video dragged out of another page, fetched here because most sites won't hand
 * their bytes to a page on another origin. Only pictures and videos come back, and never more
 * than an upload may weigh; the client uploads them like any file of its own.
 */
export async function handleMediaFetch(request: IRequest) {
	const raw = new URL(request.url).searchParams.get('url') ?? ''
	let target: URL
	try {
		target = new URL(raw)
	} catch {
		return error(400, 'Not an address')
	}
	if (target.protocol !== 'https:' && target.protocol !== 'http:') return error(400, 'Not a web address')
	let res: Response
	try {
		res = await fetch(target.toString(), { headers: { accept: 'image/*,video/*;q=0.9,*/*;q=0.1' }, redirect: 'follow' })
	} catch {
		return error(502, 'That address could not be reached')
	}
	if (!res.ok || !res.body) return error(502, `That address answered ${res.status}`)
	const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
	if (!/^(image|video)\//.test(contentType)) return error(415, 'That address is not a picture or video')
	const length = Number(res.headers.get('content-length') ?? 0)
	if (length > MAX_UPLOAD_BYTES) return error(413, 'That file is too large')
	// a server that doesn't say how big it is still gets cut off at the limit
	let seen = 0
	const cap = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			seen += chunk.byteLength
			if (seen > MAX_UPLOAD_BYTES) controller.error(new Error('too large'))
			else controller.enqueue(chunk)
		},
	})
	return new Response(res.body.pipeThrough(cap), {
		headers: { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
	})
}
