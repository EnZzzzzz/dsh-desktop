// Minimal React stand-in for scripts/test-plugin-component.mjs: hooks backed by
// a per-instance hook list, memo semantics that honour deps, and a renderer
// that mirrors React's error behaviour (a throw abandons the whole subtree).
'use strict'

let current = null
let hookIndex = 0
const rerenderQueue = []

/** Minimal class-component base, like React.Component. */
class Component {
  constructor(props) { this.props = props }
  setState(partial) {
    const next = typeof partial === 'function' ? partial(this.state) : partial
    this.state = { ...this.state, ...next }
  }
}

function useHook(init) {
  if (current === null) throw new Error('hook called outside render')
  const i = hookIndex++
  if (current.hooks.length <= i) current.hooks[i] = init()
  return current.hooks[i]
}

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    // One level only, as React does: `flat(Infinity)` would also flatten the
    // `children` array inside element objects passed as a single child.
    children: children.flat(1),
  }),
  Fragment: function Fragment() {},
  Component,
  useState(initial) {
    const slot = useHook(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    slot.set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(value, slot.value)) return
      slot.value = value
      rerenderQueue.push(slot)
    }
    slot.owner = current
    return [slot.value, slot.set]
  },
  useRef(initial) {
    return useHook(() => ({ current: initial }))
  },
  useMemo(factory, deps) {
    // React hands the hook a zero-argument factory; the plugin's factories
    // tolerate that, but a fake/newer call site may pass arguments through.
    const slot = useHook(() => ({ deps: undefined, value: undefined }))
    const changed = slot.deps === undefined || deps === undefined
      || deps.length !== slot.deps.length
      || deps.some((d, i) => !Object.is(d, slot.deps[i]))
    if (changed) {
      slot.value = factory()
      slot.deps = deps
      // React's useMemo is a cache, not a memo-visibility boundary: a dev
      // strict-mode double render would still surface a throw here.
      if (typeof slot.value === 'function' && slot.value.length === 0) console.log
    }
    return slot.value
  },
  useEffect(fn) { useHook(() => { const s = { kind: 'effect', fn, ran: false }; s.owner = current; return s }) },
  useLayoutEffect(fn) { useHook(() => { const s = { kind: 'layout', fn, ran: false }; s.owner = current; return s }) },
  useSyncExternalStore(subscribe, getSnapshot) {
    useHook(() => ({ subscribe, getSnapshot }))
    return getSnapshot()
  },
}

let nextId = 1
const instances = new Map()

function renderElement(element, key) {
  if (element === null || element === undefined || typeof element === 'boolean') return null
  if (typeof element === 'string' || typeof element === 'number') return { text: String(element) }
  if (Array.isArray(element)) {
    return element.map((child, i) => renderElement(child, `${key}.${i}`)).filter(Boolean)
  }
  // React hands components `props.children` as element(s), never raw element
  // children: reify each child first, then pass 0/1/many through.
  const { type } = element
  const props = { ...element.props }
  // Element objects created by `createElement` always carry their own
  // normalized `children`; anything else here is already a render primitive.
  const childElements = element.children ?? []
  const children = childElements.map((c, i) => ({ child: c, key: `${key}.${i}` }))
  if (childElements.length > 0) {
    props.children = childElements.length === 1 ? childElements[0] : childElements
  }
  const renderChildren = () => children.map(({ child, key: k }) => renderElement(child, k)).filter(Boolean)
  if (type === React.Fragment || type.name === 'Fragment') {
    return renderChildren()
  }
  if (typeof type === 'function' && type.prototype && typeof type.prototype.render === 'function') {
    const cls = instances.get(key) ?? (() => {
      const created = new type(props)
      created.id = nextId++
      created.component = type
      created.key = key
      created.dirty = false
      if (created.state === undefined) created.state = null
      instances.set(key, created)
      return created
    })()
    cls.props = props
    if (cls.dirty && typeof type.getDerivedStateFromError === 'function' && cls.pendingError !== undefined) {
      cls.state = { ...cls.state, ...type.getDerivedStateFromError(cls.pendingError) }
      cls.pendingError = undefined
    }
    cls.dirty = false
    try {
      return renderElement(cls.render(), key)
    } catch (error) {
      if (typeof type.getDerivedStateFromError !== 'function') throw error
      cls.state = { ...cls.state, ...type.getDerivedStateFromError(error) }
      return renderElement(cls.render(), key)
    }
  }
  if (typeof type === 'function') {
    // Keyed by render path only: a numeric id key would collide with a sibling's key.
    const instance = instances.get(key)
      ?? (() => { const created = { id: nextId++, component: type, hooks: [], key, dirty: false }; instances.set(key, created); return created })()
    const previous = current
    current = instance
    hookIndex = 0
    let output
    try {
      output = type(props)
      return renderElement(output, key)
    } catch (error) {
      if (typeof type.getDerivedStateFromError !== 'function') throw error
      instance.pendingError = error
      instance.dirty = true
      instance.state = { ...instance.state, ...type.getDerivedStateFromError(error) }
      return renderElement(instance.render(), key)
    } finally {
      current = previous
    }
  }
  return {
    id: nextId++,
    component: 'host',
    tag: typeof type === 'string' ? type : type.name,
    props,
    children: renderChildren(),
  }
}

/** Walk the rendered tree, collecting host nodes matching a predicate. */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  if (node.text !== undefined) return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** Re-render every instance a state setter or effect marked pending. */
function flushPending() {
  const pending = rerenderQueue.splice(0)
  for (const slot of pending) {
    // The component instance is registered on first render; a setter runs
    // after that, so it is present.
    const owner = instances.get(slot.owner.key) ?? slot.owner
    owner.dirty = true
  }
  let tree = null
  let pass = 0
  do {
    const dirty = [...instances.values()].filter(i => i.dirty && typeof i.component === 'function')
    if (dirty.length === 0) break
    for (const instance of dirty) instance.dirty = false
    tree = renderElement(rootElement, 'root')
    pass += 1
  } while (pass < 50)
  return tree
}

let rootElement = null
function mountRoot(element) {
  rootElement = element
  return renderElement(element, 'root')
}

function find(node, predicate) {
  let found = null
  walk(node, (n) => { if (found === null && predicate(n)) found = n })
  return found
}

const plain = (text) => String(text).replace(/\s+/g, ' ').trim()
function collectText(node) {
  if (node === null || node === undefined) return ''
  if (typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(collectText).join(' ')
  if (node.text !== undefined) return node.text
  return (node.children ?? []).map(collectText).join(' ')
}
function labels(node) {
  const out = []
  walk(node, (n) => {
    if (n.text !== undefined || n.component === 'host' && !n.props?.['aria-label']) {
      if (n.text !== undefined) return
    }
    const label = n.props?.['aria-label']
    const text = plain(collectText(n))
    if (label) out.push(`${text || '·'} [${label}]`)
  })
  return [...new Set(out)]
}

const timers = []
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
globalThis.setInterval = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t }
globalThis.clearInterval = (t) => { const i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1) }

module.exports = {
  React,
  renderElement,
  mountRoot,
  flushPending,
  find,
  walk,
  labels,
  instances,
  rerenderQueue,
  timers,
  restoreTimers() { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval },
}
