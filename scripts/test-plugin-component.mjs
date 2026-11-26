// Harness for plugin/src/client.cjs — regression test for "hovering the rail
// button makes it disappear", which the kernel reproduces as a crashed slot
// entry: `SlotErrorBoundary` drops the whole entry and leaves its anchor.
//
// Renders the component with a small React stand-in (scripts/fake-react.cjs),
// fires the real hover/open events against several session-list states, and
// fails when any render throws. Run: node scripts/test-plugin-component.mjs
import Module from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = process.env.PLUGIN_SRC || join(here, '../plugin/src/client.cjs')

// The plugin bundle does `require('react')`. Redirect that one specifier to the
// stand-in: the module is loaded through a wrapped `createRequire`, which is
// how the bundle's own `require` is obtained here.
const fakeReactPath = join(here, 'fake-react.cjs')
const realCreateRequire = Module.createRequire
const fake = await import(fakeReactPath)
const { React, mountRoot, flushPending, find, labels, instances, rerenderQueue, restoreTimers } = fake

// The plugin receives one `react` instance for the whole module, exactly like
// the browser module table does; reuse the object the harness imports.
const requireCjs = realCreateRequire(import.meta.url)
const pluginRequire = spec => spec === 'react' ? React : requireCjs(spec)

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok    ${name}`)
  else {
    failures += 1
    console.log(`  FAIL  ${name}${detail ? '\n        ' + String(detail).split('\n').slice(0, 6).join('\n        ') : ''}`)
  }
}

// ------------------------------------------------------------- data fixtures
const now = Date.now()
/** One SessionSummary row; `title` absent means the host never titled it. */
const summary = (id, over = {}) => {
  const row = {
    id,
    displayTitle: `会话 ${id}`,
    cwd: '/Volumes/DataDrive/proj/my/dsh-desktop',
    running: false,
    blank: false,
    updatedAt: now - (over.age ?? 0),
    retainedBy: { referenceCount: 0, retainedBy: {} },
    ...over,
  }
  delete row.age
  return row
}
const makeList = (rows) => ({ ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])) })

const mainRow = summary('s1', { age: 60_000, retainedBy: { mainView: 1 } })
const normal = {
  list: makeList([
    mainRow,
    summary('s2', { age: 3_600_000, displayTitle: '' }),
    summary('s3', { age: 2 * 86_400_000, cwd: '/tmp/other' }),
    summary('s4', { age: 20 * 86_400_000 }),
  ]),
  statuses: new Map([
    ['s2', { running: true, pendingInteraction: undefined, completionUnread: false }],
    ['s3', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false }],
    ['s4', { running: false, pendingInteraction: undefined, completionUnread: true }],
  ]),
}
const sparse = {
  list: makeList([summary('s5'), summary('s6', { age: 5_000, cwd: '' })]),
  statuses: new Map(),
}

// --------------------------------------------------------------- mounting
function mount(plugin, state) {
  const registered = []
  const styleTags = []
  globalThis.document = {
    getElementById: id => styleTags.find(tag => tag.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '', remove() {} }),
    head: { appendChild: (tag) => { tag.id = 'dsh-desktop-rail-session-menu-styles'; styleTags.push(tag) } },
  }
  let openedSession
  plugin.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(_name, callback) { return callback() },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
    get: name => name === 'uiWorkspace'
      ? { openSession(id) { openedSession = id } }
      : undefined,
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
  })
  // `state.opened` reads through to the last call, not a snapshot.
  Object.defineProperty(state, 'opened', { get: () => openedSession, configurable: true })
  return { component: registered[0]?.component, registration: registered[0]?.options, styleTags }
}

/** Render the way the kernel does: a throw abandons the whole slot entry. */
function renderEntry(component, state, wide) {
  const props = {
    wide,
    useSessions: selector => selector(state.list),
    useSessionStatus: selector => selector(state.statuses),
  }
  try {
    return { tree: mountRoot(React.createElement(component, props)), crashed: false }
  } catch (error) {
    return { tree: null, crashed: true, error }
  }
}

/** Apply queued state updates and re-render, like React committing a setState. */
function commit(component, state, wide) {
  try {
    flushPending()
    return { tree: mountRoot(React.createElement(component, {
      wide,
      useSessions: selector => selector(state.list),
      useSessionStatus: selector => selector(state.statuses),
    })), crashed: false }
  } catch (error) {
    return { tree: null, crashed: true, error }
  }
}

const tick = async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }

// Load the CJS plugin source with a private `require`, as the browser bundle
// receives one from the module loader.
const pluginModule = { exports: {} }
new Function('require', 'module', 'exports', readFileSync(src, 'utf8'))(
  pluginRequire, pluginModule, pluginModule.exports,
)
const plugin = pluginModule.exports
console.log('plugin exports:', Object.keys(plugin), '| inject:', plugin.inject)

// 1. Registration contract.
{
  const state = { ...normal }
  const { component, registration, styleTags } = mount(plugin, state)
  check('exports apply/inject', typeof plugin.apply === 'function' && Array.isArray(plugin.inject))
  check('registers into sidebar.footer.action', registration?.name === 'sidebar.footer.action')
  check('id and order', registration?.id === 'dsh-desktop-rail-sessions' && registration?.order === 100)
  check('style tag installed', styleTags.length === 1)
  const css = styleTags[0]?.textContent ?? ''
  check('style has menu + trigger rules', css.includes('.dshd-rail-menu') && css.includes('.dshd-rail-trigger'))
  // The fake createElement can't be typed into, so keep the component for later.
  globalThis.__component = component
}

const component = globalThis.__component

// 2. Expanded sidebar renders nothing.
{
  instances.clear()
  const result = renderEntry(component, { ...normal }, true)
  check('expanded sidebar: no crash', !result.crashed, result.error?.stack)
  check('expanded sidebar: renders nothing', result.tree === null)
}

// 3. Collapsed rail closed state.
let trigger = null
{
  instances.clear()
  const state = { ...normal }
  const result = renderEntry(component, state, false)
  check('collapsed rail: no crash', !result.crashed, result.error?.stack)
  trigger = result.tree && find(result.tree, n => n.tag === 'button')
  check('collapsed rail: trigger present', trigger !== null, JSON.stringify(result.tree && labels(result.tree)))
  check('collapsed rail: accessible name', trigger?.props?.['aria-label'] === '会话列表')
  check('collapsed rail: aria-expanded=false', trigger?.props?.['aria-expanded'] === 'false')
}

// 4. THE REGRESSION: opening the menu must not throw, in every data state.
const openCases = [
  ['normal data', normal, () => normal.statuses],
  ['sessions without status rows', sparse, () => sparse.statuses],
  ['empty session list', { list: makeList([]), statuses: new Map() }, () => new Map()],
  ['missing status snapshot', normal, () => undefined],
  ['missing session list snapshot', undefined, () => normal.statuses],
]
for (const [name, data, statusesOf] of openCases) {
  instances.clear()
  rerenderQueue.length = 0
  const state = { list: data?.list, statuses: statusesOf() }
  const mounted = mount(plugin, state)
  const component = mounted.component
  const closed = renderEntry(component, state, false)
  if (closed.crashed) { check(`open (${name})`, false, closed.error?.stack); continue }
  const triggerNode = find(closed.tree, n => n.tag === 'button')
  try { triggerNode.props.onClick() } catch (error) {
    check(`open (${name})`, false, `trigger onClick threw: ${error?.stack}`)
    continue
  }
  const opened = commit(component, state, false)
  check(`open (${name}): no crash`, !opened.crashed, opened.error?.stack)
  if (opened.crashed) continue

  const names = labels(opened.tree)
  const rows = []
  const collectRows = (nodes) => (nodes ?? []).forEach((n) => {
    if (n.tag === 'button' && n.props?.className === 'dshd-rail-menu-row') rows.push(n)
    collectRows(n.children)
  })
  collectRows(opened.tree)
  check(`open (${name}): trigger still rendered`, find(opened.tree, n => n.tag === 'button' && n.props?.['aria-label'] === '会话列表') !== null)
  check(`open (${name}): search field rendered`, find(opened.tree, n => n.tag === 'input') !== null)
  if (name === 'normal data') {
    const rowNames = rows.map(r => String(r.props['aria-label'] ?? ''))
    check('open: one row per session', rows.length === 4, JSON.stringify(rowNames))
    check('open: lists every session in recency order',
      rowNames[0]?.includes('会话 s1') && rowNames[1]?.includes('未命名')
      && rowNames[2]?.includes('会话 s3') && rowNames[3]?.includes('会话 s4'), JSON.stringify(rowNames))
    check('open: unnamed session labelled 未命名', rowNames.some(n => n.includes('未命名')), JSON.stringify(rowNames))
    check('open: day grouping shown', names.some(n => n.includes('今天')), JSON.stringify(names))
    check('open: current session marked', rows.find(r => r.props['data-session-id'] === 's1')?.props['data-current'] === 'true')
    check('open: status dots rendered', find(opened.tree, n => n.component === 'host' && n.props?.['data-kind']) !== null)
    rows.find(r => r.props['data-session-id'] === 's3').props.onClick()
    check('open: row click opens that session', state.opened === 's3', String(state.opened))
  }
  if (name === 'empty session list') {
    check('open: empty message', names.some(n => n.includes('暂无会话')), JSON.stringify(names))
  }
  await tick()
}
restoreTimers()

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
