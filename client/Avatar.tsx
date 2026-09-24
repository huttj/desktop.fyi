import { colorFor, initialsOf } from './people'

/** A person as a circle: their photo, or their initials on their colour. */
export function Avatar({ id, name, avatar, className = '' }: { id: string; name: string; avatar: string | null; className?: string }) {
  const style = { background: colorFor(id) }
  return avatar ? (
    <img className={`Avatar ${className}`} src={avatar} alt={name} title={name} style={style} draggable={false} />
  ) : (
    <span className={`Avatar ${className}`} title={name} style={style}>
      {initialsOf(name)}
    </span>
  )
}
