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

// when a user downloads an asset, we retrieve it from the bucket. we also cache the response for performance.
export async function handleAssetDownload(request: IRequest, env: Env, ctx: ExecutionContext) {
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

	// assets are immutable, so we can cache them basically forever:
	headers.set('cache-control', 'public, max-age=31536000, immutable')
	headers.set('etag', object.httpEtag)
	// videos seek by range (Safari won't play one at all without)
	headers.set('accept-ranges', 'bytes')

	// we set CORS headers so all clients can access assets. we do this here so our `cors` helper in
	// worker.ts doesn't try to set extra cors headers on responses that have been read from the
	// cache, which isn't allowed by cloudflare.
	headers.set('access-control-allow-origin', '*')

	// Prevent XSS from user-uploaded SVGs (or any file served with an executable content-type).
	headers.set('content-security-policy', "default-src 'none'")
	headers.set('x-content-type-options', 'nosniff')

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
