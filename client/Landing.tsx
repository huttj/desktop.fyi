import { CloseButton } from './CloseButton'

/** The welcome card. It sits over the public room; dismissing it leaves you looking around. */
export function Landing({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="Card Card--landing Modal-card">
      {onDismiss && <CloseButton onClose={onDismiss} />}
      <h1 className="Wordmark">desktop.fyi</h1>
      <p className="Landing-lede">An infinite desktop for whatever you paste. Friends can drop things onto it. Everything fades unless somebody keeps it alive.</p>
      <ul className="Landing-rules">
        <li>Paste anything: text, links, pictures, sketches.</li>
        <li>After a day things start to fade. After three they hide. After a week they are gone.</li>
        <li>Moving, editing, or adding next to something keeps it (and its neighbours) fresh.</li>
        <li>Follow people to see what they make, and what is about to disappear.</li>
      </ul>
      <a className="Button" href="/login">
        Sign in with email
      </a>
      {onDismiss && (
        <button type="button" className="Button Button--ghost Landing-look" onClick={onDismiss}>
          Just look around
        </button>
      )}
    </div>
  )
}
