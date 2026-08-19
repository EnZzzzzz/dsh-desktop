/**
 * Smoke test for the dsh-desktop runtime: spawn the dsh-jsonrpc-agent bin with
 * our runtime/cordis.yml through the official SDK and perform the initialize
 * handshake. When DEEPSEEK_API_KEY is present, also run one real turn.
 *
 * Usage: node scripts/smoke.mjs
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const bin = require.resolve('@deepseek-ai/dsh-sdk-jsonrpc-demo/bin')
const config = join(root, 'runtime', 'cordis.yml')

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)
console.log(`[smoke] bin: ${bin}`)
console.log(`[smoke] config: ${config}`)
console.log(`[smoke] DEEPSEEK_API_KEY: ${hasKey ? 'set' : 'NOT set — handshake only'}`)

const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath,
    args: [bin, config],
    cwd: root,
    env: {
      ...process.env,
      DSH_CWD: root,
      DSH_SESSION_ROOT: join(root, '.sessions'),
    },
  },
  provider: 'deepseek-official',
  model: process.env.DSH_MODEL ?? 'deepseek-v4-flash',
})

try {
  await harness.start()
  console.log('[smoke] initialize handshake: OK')

  if (hasKey) {
    console.log('[smoke] running one turn: "Reply with exactly: pong"')
    const result = await harness.run('Reply with exactly: pong', {
      onNotification: (n) => {
        if (n.method === 'session.status') console.log(`[smoke] status: ${JSON.stringify(n.params)}`)
      },
    })
    console.log(`[smoke] finalResponse: ${JSON.stringify(result.finalResponse)}`)
    console.log(`[smoke] events: ${result.events.length}, notifications: ${result.notifications.length}`)
  }
} finally {
  await harness.close()
  console.log('[smoke] runtime closed cleanly')
}
