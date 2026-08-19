import { app } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Whale logo shown on the loading page. Packaged: resources/icon.png
// (extraResources); dev: build/icon.png in the project root (app path
// resolution differs between `electron-vite dev` and `electron out/main`,
// so probe both).
function logoDataUrl(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(here, '..', '..', 'build', 'icon.png'),
  ]
  for (const candidate of candidates) {
    try {
      return `data:image/png;base64,${readFileSync(candidate).toString('base64')}`
    } catch {
      // try the next candidate
    }
  }
  return ''
}

// Follows the system theme via prefers-color-scheme: light window on a
// light desktop, dark on dark.
const SHARED_STYLE = `:root{color-scheme:light dark}
body{margin:0;height:100vh;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;
background:#f5f6f8;color:#6d6e78;font-family:-apple-system,'PingFang SC',sans-serif;user-select:none;cursor:default}
@media (prefers-color-scheme:dark){body{background:#1e1f24;color:#9a9ba5}}`

export function loadingPage(): string {
  const logo = logoDataUrl()
  const logoHtml = logo
    ? `<img class="logo" src="${logo}" width="75" height="75" alt="">`
    : ''
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-desktop</title>
<style>${SHARED_STYLE}
.logo{border-radius:17px;animation:breathe 2.2s ease-in-out infinite}
@keyframes breathe{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.05);opacity:1}}
.dots{display:flex;gap:7px;margin-top:10px}
.dots i{width:6px;height:6px;border-radius:50%;background:#5b73e8;animation:blink 1.2s ease-in-out infinite}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,100%{opacity:.2;transform:translateY(0)}50%{opacity:1;transform:translateY(-4px)}}</style></head>
<body>${logoHtml}<div class="dots"><i></i><i></i><i></i></div></body></html>`)}`
}

export function errorPage(message: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-desktop</title>
<style>${SHARED_STYLE}
.error{color:#e5534b;max-width:70%;white-space:pre-wrap}</style></head>
<body><div class="error">服务启动失败：${message.replace(/</g, '&lt;')}</div>
<div>请查看日志后重启应用。</div></body></html>`)} `
}
