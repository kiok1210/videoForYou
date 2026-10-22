import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ControlState, RecorderCommand } from '@shared/types'
import { formatDuration } from '@/lib/format'
import './control.css'

const IDLE: ControlState = { active: false, paused: false, elapsed: 0, sysLevel: 0, micLevel: 0, label: '' }

function Control(): React.JSX.Element {
  const [state, setState] = useState<ControlState>(IDLE)
  const [sent, setSent] = useState<RecorderCommand | null>(null)

  useEffect(() => window.api.control.onState(setState), [])

  // 指令发出后立刻给反馈：主窗口响应再快，用户看不到界面也等于没反应
  const send = (command: RecorderCommand): void => {
    window.api.control.send(command)
    setSent(command)
    window.setTimeout(() => setSent(null), 2400)
  }

  const stopping = sent === 'stop'

  return (
    <div className={`ctl${state.paused ? ' is-paused' : ''}${sent ? ' is-busy' : ''}`}>
      <div className="ctl-status">
        <span className="ctl-dot" />
        <div className="ctl-text">
          <b>{formatDuration(state.elapsed)}</b>
          <em>{stopping ? '正在收尾…' : sent === 'toggle-pause' ? '已发送' : state.paused ? '已暂停' : state.label || '录制中'}</em>
        </div>
      </div>

      <div className="ctl-meters">
        <span className="ctl-meter">
          <i style={{ width: `${Math.round(state.sysLevel * 100)}%` }} />
        </span>
        <span className="ctl-meter is-mic">
          <i style={{ width: `${Math.round(state.micLevel * 100)}%` }} />
        </span>
      </div>

      <div className="ctl-actions">
        <button type="button" disabled={sent === 'toggle-pause'} onClick={() => send('toggle-pause')}>
          {state.paused ? '继续' : '暂停'}
        </button>
        <button
          type="button"
          className="is-stop"
          disabled={sent === 'stop'}
          onClick={() => send('stop')}
        >
          {stopping ? '停止中…' : '停止'}
        </button>
        <button
          type="button"
          className="is-icon"
          title="把主窗口调回来"
          onClick={() => send('show-main')}
        >
          ⤢
        </button>
      </div>
    </div>
  )
}

const container = document.getElementById('root')
if (container) createRoot(container).render(<Control />)
