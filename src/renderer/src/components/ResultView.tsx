import { useState } from 'react'
import type { LastClip } from '@/hooks/useRecorder'
import { formatDuration, formatSize } from '@/lib/format'
import { Btn } from './ui'

interface Props {
  last: LastClip
  onSave: () => void
  onDiscard: () => void
  onAgain: () => void
  onLibrary: () => void
  onReveal: (filePath: string) => void
}

export function ResultView(props: Props): React.JSX.Element {
  const { last } = props
  const [failed, setFailed] = useState(false)

  return (
    <div className="result">
      <div className="result-player">
        {failed ? (
          <div className="result-fallback">
            <p>本地预览没能解码这个文件</p>
            <p className="dim">文件本身是好的，保存后用系统播放器打开即可，也可以直接上传。</p>
            <Btn onClick={() => props.onReveal(last.path)}>在文件夹中显示</Btn>
          </div>
        ) : (
          <video src={last.url} controls autoPlay onError={() => setFailed(true)} />
        )}
      </div>
      <aside className="result-side">
        <h2>{last.item ? '已保存' : '录制完成'}</h2>
        <div className="meta-line">
          {last.width}×{last.height} · {formatDuration(last.duration)} · {formatSize(last.size)}
        </div>
        <div className="path-line" title={last.path}>
          {last.item ? last.path : '还没存盘：文件暂存在系统临时目录'}
        </div>

        <div className="btn-col">
          <Btn variant="primary" onClick={props.onSave}>
            {last.item ? '在文件夹中显示' : '保存到文件…'}
          </Btn>
          <Btn onClick={() => props.onReveal(last.path)}>打开所在位置</Btn>
          <Btn onClick={props.onLibrary}>去作品库</Btn>
          <Btn onClick={props.onAgain}>再录一段</Btn>
          <Btn variant="danger" onClick={props.onDiscard}>
            删除这段
          </Btn>
        </div>

        <div className="hint-box">
          想直接发抖音的话，MP4 格式的录制文件不用再转码；贴图、滤镜、鼠标高亮都已经烧进画面里了。
        </div>
      </aside>
    </div>
  )
}
