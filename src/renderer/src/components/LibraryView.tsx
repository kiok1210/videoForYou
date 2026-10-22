import { useCallback, useEffect, useState } from 'react'
import type { RecordItem } from '@shared/types'
import { clipUrl, formatDateTime, formatDuration, formatSize } from '@/lib/format'
import { Btn, Empty } from './ui'

export function LibraryView(props: { onBack: () => void }): React.JSX.Element {
  const [records, setRecords] = useState<RecordItem[]>([])
  const [playing, setPlaying] = useState<RecordItem | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const result = await window.api.library.list()
    setRecords(result.ok && result.data ? result.data : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (item: RecordItem): Promise<void> => {
    const result = await window.api.library.remove(item.id, true)
    if (result.ok && result.data) setRecords(result.data)
    if (playing?.id === item.id) setPlaying(null)
  }

  return (
    <div className="library">
      <header className="library-head">
        <div>
          <h2>作品库</h2>
          <p>保存在本机的录制文件，删除会连同磁盘上的文件一起删掉。</p>
        </div>
        <div className="btn-row">
          <Btn onClick={() => void window.api.library.openDir()}>打开录制目录</Btn>
          <Btn onClick={() => void load()} disabled={loading}>
            刷新
          </Btn>
          <Btn onClick={props.onBack}>返回录制</Btn>
        </div>
      </header>

      <div className="library-body">
        <div className="library-list">
          {records.map((item) => (
            <button
              type="button"
              key={item.id}
              className={playing?.id === item.id ? 'record is-active' : 'record'}
              onClick={() => setPlaying(item)}
            >
              <span className="record-name">{item.name}</span>
              <span className="record-meta">
                {item.width}×{item.height} · {formatDuration(item.duration)} · {formatSize(item.size)}
              </span>
              <span className="record-time">{formatDateTime(item.createdAt)}</span>
            </button>
          ))}
          {!loading && records.length === 0 ? <Empty text="还没有录制文件" /> : null}
        </div>

        <div className="library-preview">
          {playing ? (
            <>
              <video src={clipUrl(playing.path)} controls autoPlay />
              <div className="library-preview-meta">
                <span title={playing.path}>{playing.path}</span>
                <span className="btn-row">
                  <Btn onClick={() => void window.api.library.reveal(playing.path)}>在文件夹中显示</Btn>
                  <Btn variant="danger" onClick={() => void remove(playing)}>
                    删除
                  </Btn>
                </span>
              </div>
            </>
          ) : (
            <Empty text="选择左侧的文件预览" />
          )}
        </div>
      </div>
    </div>
  )
}
