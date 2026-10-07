import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  eyebrow?: string
  /** 'side' = narrow panel on the right; 'sheet' = wide bottom sheet for tables. */
  variant?: 'side' | 'sheet'
  onClose: () => void
  children: ReactNode
}

/**
 * On-demand detail panel. Non-modal: the circuit, cursor and playback stay usable behind it,
 * so opening details never loses the student's place in the simulation. Esc closes it.
 */
export function Drawer({ title, eyebrow, variant = 'side', onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [title])
  return (
    <aside ref={ref} tabIndex={-1} className={`drawer drawer--${variant}`} role="dialog" aria-modal="false" aria-label={title}>
      <header className="drawer-head">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="drawer-title">{title}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={`Close ${title}`} title="Close (Esc)">
          ✕
        </button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  )
}
