import { useEffect, useState } from 'react'

interface Props {
  title: string
  subtitle: string
  view: string
  onNavigate: (view: 'home' | 'library') => void
}

export function TitleBar(props: Props): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then((result) => setMaximized(Boolean(result.data)))
    return window.api.window.onMaximized(setMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="logo-dot" />
        <div>
          <strong>{props.title}</strong>
          <em>{props.subtitle}</em>
        </div>
      </div>

      <nav className="titlebar-nav">
        <button
          type="button"
          className={props.view === 'home' ? 'nav-item is-active' : 'nav-item'}
          onClick={() => props.onNavigate('home')}
        >
          录制
        </button>
        <button
          type="button"
          className={props.view === 'library' ? 'nav-item is-active' : 'nav-item'}
          onClick={() => props.onNavigate('library')}
        >
          作品库
        </button>
      </nav>

      <div className="titlebar-actions">
        <button type="button" className="win-btn" title="最小化" onClick={() => void window.api.window.minimize()}>
          <svg viewBox="0 0 12 12">
            <path d="M1 6h10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="win-btn"
          title={maximized ? '还原' : '最大化'}
          onClick={() => void window.api.window.toggleMaximize().then((result) => setMaximized(Boolean(result.data)))}
        >
          <svg viewBox="0 0 12 12">
            {maximized ? (
              <path d="M3 3h6v6H3z M1.5 1.5h6v1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
            ) : (
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.1" />
            )}
          </svg>
        </button>
        <button type="button" className="win-btn is-close" title="关闭" onClick={() => void window.api.window.close()}>
          <svg viewBox="0 0 12 12">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  )
}
