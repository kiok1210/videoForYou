import type { ReactNode } from 'react'

export function Btn(props: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'solid' | 'danger'
  disabled?: boolean
  title?: string
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const { children, onClick, variant = 'ghost', disabled, title, size = 'md' } = props
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

export function Toggle(props: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  hint?: string
  disabled?: boolean
}): React.JSX.Element {
  const { checked, onChange, label, hint, disabled } = props
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label ? (
        <span className="toggle-text">
          {label}
          {hint ? <em>{hint}</em> : null}
        </span>
      ) : null}
    </label>
  )
}

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
}): React.JSX.Element {
  const { label, value, min, max, step = 1, onChange, format } = props
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function Segmented(props: {
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
  block?: boolean
}): React.JSX.Element {
  const { value, options, onChange, block } = props
  return (
    <div className={`segmented${block ? ' is-block' : ''}`}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={option.value === value ? 'seg is-active' : 'seg'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Field(props: { label: string; children: ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div className="field">
      <div className="field-label">{props.label}</div>
      {props.children}
      {props.hint ? <div className="field-hint">{props.hint}</div> : null}
    </div>
  )
}

export function Section(props: {
  title: string
  children: ReactNode
  extra?: ReactNode
}): React.JSX.Element {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{props.title}</h3>
        {props.extra}
      </header>
      <div className="section-body">{props.children}</div>
    </section>
  )
}

export function Meter(props: { value: number; tone: 'sys' | 'mic' }): React.JSX.Element {
  const width = `${Math.round(Math.min(1, Math.max(0, props.value)) * 100)}%`
  return (
    <div className={`meter meter-${props.tone}`}>
      <span style={{ width }} />
    </div>
  )
}

export function Empty(props: { text: string }): React.JSX.Element {
  return <div className="empty">{props.text}</div>
}
