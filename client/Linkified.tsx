import { Fragment } from 'react'

// A full URL, a bare domain (hu.tt, desktop.fyi/@josh: letters-only top level, so 3.14 and e.g. stay words), or an @handle.
const TOKEN_RE = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]|(?<![\w@.\/])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]])?\b|(?<![\w/])@[a-z0-9][a-z0-9_]{1,19}\b)/gi

/** Text with its links live: URLs and bare domains open in a new tab, @handles go to that desktop. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(TOKEN_RE)
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>
        if (part.startsWith('@')) {
          return (
            <a key={i} href={`/${part.toLowerCase()}`}>
              {part}
            </a>
          )
        }
        const href = /^https?:\/\//i.test(part) ? part : `https://${part}`
        const ours = /^https?:\/\/(desktop\.fyi|localhost(:\d+)?)(\/|$)/i.test(href)
        return (
          <a key={i} href={href} {...(ours ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            {part.replace(/^https?:\/\//i, '')}
          </a>
        )
      })}
    </>
  )
}
