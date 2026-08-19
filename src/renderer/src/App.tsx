import { useEffect, useMemo, useRef, useState } from 'react'
import type { HarnessState, Settings } from '../../shared/ipc'
import { deriveChatItems, newSessionId, sessionEventsOf, sessionStatusOf, type ChatItem, type RawNotification } from './events'

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<HarnessState>({ status: 'stopped' })
  const [sessionId, setSessionId] = useState(newSessionId)
  const [notifications, setNotifications] = useState<RawNotification[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    void window.dsh.getSettings().then(setSettings)
    void window.dsh.getState().then(setState)
    const offNotification = window.dsh.onNotification((n) => {
      setNotifications((prev) => [...prev, n])
    })
    const offState = window.dsh.onState(setState)
    return () => {
      offNotification()
      offState()
    }
  }, [])

  const items = useMemo(
    () => deriveChatItems(sessionEventsOf(notifications, sessionId)),
    [notifications, sessionId],
  )
  const sessionStatus = useMemo(() => sessionStatusOf(notifications, sessionId), [notifications, sessionId])

  const busy = state.status === 'running' || state.status === 'starting'

  const send = async (text: string): Promise<void> => {
    setSendError(null)
    // No local echo: the accepted prompt comes back as a user/message event.
    try {
      await window.dsh.send(sessionId, text)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    }
  }

  const newSession = (): void => {
    setSessionId(newSessionId())
    setNotifications([])
    setSendError(null)
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">dsh-desktop</span>
        <span className={`status-pill status-${state.status}`}>
          {statusLabel(state, sessionStatus)}
        </span>
        <span className="topbar-meta" title={settings?.workspaceCwd || undefined}>
          {settings?.workspaceCwd || '未选择工作区'}
        </span>
        <span className="spacer" />
        <button onClick={newSession} disabled={busy} title="开始新会话">
          新会话
        </button>
        <button onClick={() => setShowSettings(true)}>设置</button>
      </header>

      {settings && !settings.apiKey && (
        <div className="banner">
          尚未配置 DeepSeek API Key — 点击右上角「设置」填写后才能开始对话。
        </div>
      )}
      {(state.error || sendError) && (
        <div className="banner banner-error">{state.error ?? sendError}</div>
      )}

      <MessageList items={items} />
      <Composer busy={busy} canSend={Boolean(settings?.apiKey)} onSend={send} onStop={() => void window.dsh.stop()} />

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(next) => {
            setSettings(next)
            setShowSettings(false)
          }}
        />
      )}
    </div>
  )
}

function statusLabel(state: HarnessState, sessionStatus: 'idle' | 'running' | null): string {
  switch (state.status) {
    case 'starting':
      return '运行时启动中…'
    case 'running':
      return '运行中'
    case 'ready':
      return sessionStatus === 'running' ? '运行中' : '就绪'
    case 'error':
      return '错误'
    default:
      return '未启动'
  }
}

function MessageList({ items }: { items: ChatItem[] }): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
  }, [items])

  if (items.length === 0) {
    return (
      <main className="messages messages-empty">
        <p>DeepSeek Harness 桌面客户端</p>
        <p className="dim">输入消息开始对话。运行时会在首次发送时启动（需要几秒）。</p>
      </main>
    )
  }
  return (
    <main className="messages">
      {items.map((item) => (
        <ChatItemView key={item.key} item={item} />
      ))}
      <div ref={bottomRef} />
    </main>
  )
}

function ChatItemView({ item }: { item: ChatItem }): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return (
        <div className="row row-user">
          <div className="bubble bubble-user">{item.text}</div>
        </div>
      )
    case 'assistant':
      return (
        <div className="row row-assistant">
          <div className="bubble bubble-assistant">
            {item.reasoning && (
              <details className="reasoning">
                <summary>思考过程</summary>
                <pre>{item.reasoning}</pre>
              </details>
            )}
            <span className="assistant-text">{item.text}</span>
            {item.streaming && <span className="cursor">▍</span>}
          </div>
        </div>
      )
    case 'tool':
      return (
        <div className="row row-assistant">
          <details className={`tool-card${item.isError ? ' tool-error' : ''}`}>
            <summary>
              <span className="tool-name">{item.name}</span>
              <span className="tool-state">{item.result === undefined ? '执行中…' : item.isError ? '失败' : '完成'}</span>
            </summary>
            <div className="tool-body">
              <div className="tool-section-label">参数</div>
              <pre>{prettyJson(item.arguments)}</pre>
              {item.result !== undefined && (
                <>
                  <div className="tool-section-label">结果</div>
                  <pre>{item.result}</pre>
                </>
              )}
            </div>
          </details>
        </div>
      )
    case 'turn-end':
      if (item.reason === 'completed') return null
      return <div className="turn-end">本轮结束：{item.reason}</div>
    case 'note':
      return <div className="note">{item.text}</div>
    case 'raw':
      return (
        <details className="raw-event">
          <summary>{item.eventType}</summary>
          <pre>{item.json}</pre>
        </details>
      )
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function Composer(props: {
  busy: boolean
  canSend: boolean
  onSend: (text: string) => Promise<void>
  onStop: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || props.busy) return
    setText('')
    await props.onSend(value)
    ref.current?.focus()
  }

  return (
    <footer className="composer">
      <textarea
        ref={ref}
        value={text}
        placeholder={props.canSend ? '输入消息，Enter 发送，Shift+Enter 换行' : '请先在设置中配置 API Key'}
        disabled={!props.canSend}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {props.busy ? (
        <button className="stop-button" onClick={props.onStop} title="协议不支持逐轮取消：停止将重启运行时">
          停止
        </button>
      ) : (
        <button className="send-button" disabled={!props.canSend || !text.trim()} onClick={() => void submit()}>
          发送
        </button>
      )}
    </footer>
  )
}

function SettingsDialog(props: {
  settings: Settings
  onClose: () => void
  onSave: (settings: Settings) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(props.settings)

  const save = async (): Promise<void> => {
    const saved = await window.dsh.setSettings({
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim() || 'deepseek-v4-flash',
      workspaceCwd: draft.workspaceCwd,
      maxTokens: draft.maxTokens && draft.maxTokens > 0 ? draft.maxTokens : undefined,
    })
    props.onSave(saved)
  }

  return (
    <div className="dialog-backdrop" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <label>
          DeepSeek API Key
          <input
            type="password"
            value={draft.apiKey}
            placeholder="sk-…"
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
        </label>
        <label>
          模型
          <input
            type="text"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </label>
        <label>
          单次输出 token 上限（留空为默认）
          <input
            type="number"
            min={1}
            value={draft.maxTokens ?? ''}
            onChange={(e) => setDraft({ ...draft, maxTokens: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
        <label>
          工作区目录
          <div className="workspace-picker">
            <input
              type="text"
              value={draft.workspaceCwd}
              placeholder="agent 读写文件的根目录"
              onChange={(e) => setDraft({ ...draft, workspaceCwd: e.target.value })}
            />
            <button
              onClick={() => {
                void window.dsh.pickWorkspace().then((path) => {
                  if (path) setDraft((d) => ({ ...d, workspaceCwd: path }))
                })
              }}
            >
              选择…
            </button>
          </div>
        </label>
        <p className="dim">修改设置会重启运行时子进程；API Key 仅保存在本机应用数据目录。</p>
        <div className="dialog-actions">
          <button onClick={props.onClose}>取消</button>
          <button className="primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
