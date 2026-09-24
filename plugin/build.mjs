import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build the plugin's client half into the factory-form bundle the kernel's
 * client module system consumes: window.__ModuleLoader__.load({id, factory}).
 * `react` stays external — the web frontend's staticModules seed table
 * provides it at runtime.
 */
const here = dirname(fileURLToPath(import.meta.url))
const result = await build({
  entryPoints: [join(here, 'src/client.cjs')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  write: false,
})

const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-desktop-open-external",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${result.outputFiles[0].text}
    return module.exports;
  }
});
`

mkdirSync(join(here, 'lib'), { recursive: true })
writeFileSync(join(here, 'lib/client.js'), wrapped)
console.log('built plugin/lib/client.js')
