/**
 * View derivation: fold the raw session-event stream (SDK `session.event`
 * notifications) into renderable chat items. Local structural types mirror the
 * dsh-session/dsh-llm vocabulary we consume; unknown event types degrade to a
 * collapsible raw view instead of breaking the transcript.
 */

export interface RawNotification {
  method: string
  params: Record<string, unknown>
}

export interface SessionEventEnvelope {
  type: string
  seq: number
  time: number
  data: unknown
}

export type ChatItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string; reasoning: string; streaming: boolean }
  | { kind: 'tool'; key: string; name: string; arguments: string; result?: string; isError?: boolean }
  | { kind: 'turn-end'; key: string; turn: number; reason: string }
  | { kind: 'note'; key: string; text: string }
  | { kind: 'raw'; key: string; eventType: string; json: string }

interface ContentBlockLike {
  type: string
  text?: string
}

function blocksText(content: unknown, blockType: string): string {
  if (!Array.isArray(content)) return ''
  return (content as ContentBlockLike[])
    .filter((b) => b?.type === blockType && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

interface StreamBucket {
  order: number
  text: string
  reasoning: string
}

/** Derive the chat transcript from one session's event envelopes, in seq order. */
export function deriveChatItems(events: SessionEventEnvelope[]): ChatItem[] {
  const items: ChatItem[] = []
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  // Provisional streaming buckets per (turn, step); dropped when the step's
  // assembled assistant/message lands.
  const streams = new Map<string, StreamBucket>()
  const finalizedSteps = new Set<string>()
  const toolIndex = new Map<string, number>()
  let order = 0

  for (const event of sorted) {
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'user/message': {
        const text = blocksText(data.content, 'text')
        if (text.trim()) items.push({ kind: 'user', key: `e${event.seq}`, text })
        break
      }
      case 'assistant/chunk': {
        const stepKey = `${data.turn}:${data.step}`
        if (finalizedSteps.has(stepKey)) break
        const chunk = data.chunk as { type: string; index?: number; text?: string }
        const bucketKey = `${stepKey}:${chunk.index ?? 0}`
        const bucket = streams.get(bucketKey) ?? { order: order++, text: '', reasoning: '' }
        if (chunk.type === 'text-delta' && chunk.text) bucket.text += chunk.text
        if (chunk.type === 'reasoning-delta' && chunk.text) bucket.reasoning += chunk.text
        streams.set(bucketKey, bucket)
        break
      }
      case 'assistant/message': {
        const stepKey = `${data.turn}:${data.step}`
        finalizedSteps.add(stepKey)
        const message = data.message as { content?: unknown }
        const text = blocksText(message?.content, 'text')
        const reasoning = blocksText(message?.content, 'reasoning')
        // Carry over any streamed reasoning the assembled message omits.
        let streamedReasoning = ''
        for (const [key, bucket] of streams) {
          if (key.startsWith(`${stepKey}:`)) {
            streamedReasoning += bucket.reasoning
            streams.delete(key)
          }
        }
        items.push({
          kind: 'assistant',
          key: `e${event.seq}`,
          text,
          reasoning: reasoning || streamedReasoning,
          streaming: false,
        })
        break
      }
      case 'tool/call': {
        toolIndex.set(String(data.callId), items.length)
        items.push({
          kind: 'tool',
          key: `e${event.seq}`,
          name: String(data.name ?? ''),
          arguments: String(data.arguments ?? ''),
        })
        break
      }
      case 'tool/result': {
        const message = data.message as { content?: Array<{ toolCallId?: string; content?: unknown; isError?: boolean }> }
        const block = message?.content?.[0]
        const idx = block?.toolCallId !== undefined ? toolIndex.get(String(block.toolCallId)) : undefined
        const resultText = blocksText(block?.content, 'text')
        const target = idx !== undefined ? items[idx] : undefined
        if (target?.kind === 'tool') {
          target.result = resultText
          target.isError = Boolean(block?.isError) || Boolean(data.error)
        } else {
          items.push({
            kind: 'tool',
            key: `e${event.seq}`,
            name: '(unknown tool)',
            arguments: '',
            result: resultText,
            isError: Boolean(block?.isError) || Boolean(data.error),
          })
        }
        break
      }
      case 'turn/end':
        items.push({ kind: 'turn-end', key: `e${event.seq}`, turn: Number(data.turn), reason: String(data.reason) })
        break
      // Lifecycle bookkeeping we intentionally do not render.
      case 'turn/start':
      case 'step/start':
      case 'step/end':
      case 'request/header':
      case 'request/context':
      case 'agent/inbox/spliced':
        break
      default:
        if (event.type.startsWith('assistant/') || event.type.startsWith('tool/')) break
        items.push({
          kind: 'raw',
          key: `e${event.seq}`,
          eventType: event.type,
          json: JSON.stringify(data, null, 2),
        })
    }
  }

  // Remaining (unfinalized) stream buckets are the live in-flight output.
  const live = [...streams.values()].sort((a, b) => a.order - b.order)
  for (const bucket of live) {
    items.push({
      kind: 'assistant',
      key: `stream${bucket.order}`,
      text: bucket.text,
      reasoning: bucket.reasoning,
      streaming: true,
    })
  }
  return items
}

/** Extract the session-log envelopes addressed to one session, in wire order. */
export function sessionEventsOf(notifications: RawNotification[], sessionId: string): SessionEventEnvelope[] {
  return notifications
    .filter((n) => n.method === 'session.event' && (n.params as { sessionId?: string }).sessionId === sessionId)
    .map((n) => (n.params as { event: SessionEventEnvelope }).event)
}

/** Latest whole-agent status for one session, if any was observed. */
export function sessionStatusOf(notifications: RawNotification[], sessionId: string): 'idle' | 'running' | null {
  for (let i = notifications.length - 1; i >= 0; i--) {
    const n = notifications[i]
    if (n.method === 'session.status' && (n.params as { sessionId?: string }).sessionId === sessionId) {
      return (n.params as { status: 'idle' | 'running' }).status
    }
  }
  return null
}

export function newSessionId(): string {
  return `session-${crypto.randomUUID().replaceAll('-', '')}`
}
