/** A handle is a desktop's address: desktop.fyi/@handle. Shared by the form and the API. */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,19}$/
export const RESERVED_HANDLES = new Set(['feed', 'login', 'admin', 'api', 'me', 'settings', 'about', 'help', 'new', 'export', 'assets', 'uploads'])
