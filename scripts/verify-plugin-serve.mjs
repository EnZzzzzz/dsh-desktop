// Read-only check: fetch the running UI's boot manifest, pull the combo bundle
// containing the built-in plugin, evaluate it in a sandbox loader, and run
// apply() against a fake ctx to confirm the slot registration.
const base = process.argv[2] || 'http://127.0.0.1:49982'
const token = process.argv[3]
if (!token) throw new Error('usage: node scripts/verify-plugin-serve.mjs <base> <token>')

const exchange = await fetch(`${base}/?token=${token}`, { redirect: 'manual' })
const cookie = exchange.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
const html = await (await fetch(base + '/', { headers: { cookie } })).text()
const combos = [...new Set([...html.matchAll(/plugins\/\?\?[^"'\s<>]+/g)].map(m => m[0].replace(/&amp;/g, '&')))]
console.log('combos in boot manifest:', combos.length)

let found = false
for (const combo of combos) {
  const text = await (await fetch(base + '/' + combo, { headers: { cookie } })).text()
  if (!text.includes('dsh-desktop-open-external')) continue
  found = true
  const registered = new Map()
  // The bundle defines a class component (its menu error boundary), so the
  // stub must expose Component.
  class Component {
    constructor(props) { this.props = props; this.state = {} }
  }
  const react = {
    createElement: () => null, Fragment: 'F', Component, useEffect() {}, useLayoutEffect() {},
    useMemo() {}, useRef() {}, useState() {}, useSyncExternalStore() {},
  }
  const req = name => name === 'react' ? react : new Proxy({}, { get: () => () => null })
  new Function('window', text)({ __ModuleLoader__: { load(d) { registered.set(d.id, d) } } })
  const mod = registered.get('dsh-desktop-open-external').factory(req)
  console.log('bundle bytes:', text.length, '| modules:', registered.size)
  console.log('exports:', Object.keys(mod), '| inject:', mod.inject)
  const trace = []
  globalThis.document = { getElementById: () => null, createElement: () => ({ remove() {}, textContent: '' }), head: { appendChild() {} } }
  mod.apply({
    effect(fn, label) { fn(); trace.push('effect(' + label + ')'); return () => {} },
    slots: {
      inject(name, cb) { trace.push('inject(' + name + ')'); return cb() },
      register(options, component) {
        trace.push(`register(${options.name} id=${options.id} order=${options.order} component=${typeof component})`)
        return () => {}
      },
    },
    get: name => name === 'uiWorkspace' ? { openSession() {} } : undefined,
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
  })
  console.log('apply trace:\n  ' + trace.join('\n  '))
}
if (!found) console.log('plugin absent from every combo (host has not composed the new build)')
