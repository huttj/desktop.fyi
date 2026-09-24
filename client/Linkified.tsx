import { Fragment } from 'react'

const TOKEN_RE = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]|(?<![\w/])@[a-z0-9][a-z0-9_]{1,19}\b)/gi

/** Text with its links live: URLs open in a new tab, @handles go to that desktop. */
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
        const ours = /^https?:\/\/(desktop\.fyi|localhost(:\d+)?)(\/|$)/i.test(part)
        return (
          <a key={i} href={part} {...(ours ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            {part.replace(/^https?:\/\//i, '')}
          </a>
        )
      })}
    </>
  )
}
