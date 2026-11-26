/**
 * dsh-desktop built-in plugin — client half.
 *
 * Renders one hover button at the sidebar foot (`sidebar.footer.action`) that
 * is visible while the sidebar is collapsed to its 56px rail: hovering it
 * shows a floating, searchable Session list. Expanding the sidebar restores
 * the full Session browser, so the button retires itself.
 *
 * The occupant receives only the column state (`wide`); the Session data and
 * navigation come from the root standard hooks (`useSessions`,
 * `useSessionStatus`) every root slot is rendered with, and from the
 * `openSession` callback `apply` injects. The Session summary list excludes
 * subagent rows (`origin === 'subagent'`) already in `ids`.
 */
const React = require('react')

const h = React.createElement
const { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React

/** Stable empty id list shared by renders that have no snapshot yet. */
const EMPTY_IDS = []

/** Share of the rail's Session goal this floating list keeps to. */
const RECENT_LIMIT = 30
/** The shell's collapsed rail width (`SIDEBAR_COLLAPSED` in ui-layout). */
const RAIL_WIDTH = 56
/** Gap between the trigger and the settings row below it. */
const TRIGGER_GAP = 4

/** Keep the menu clear of the window edge. */
const VIEWPORT_MARGIN = 8
/** Open a few pixels below the button so the pointer can cross the gap. */
const ANCHOR_GAP = 4
/** Hide after leaving both the button and the menu, long enough to re-enter. */
const CLOSE_DELAY_MS = 220

const COPY = {
  zh: {
    trigger: '会话列表',
    title: '会话',
    current: '当前会话',
    search: '搜索会话',
    empty: '暂无会话',
    noMatch: '没有匹配的会话',
    running: '运行中',
    unread: '已完成，未查看',
    pending: '等待你处理',
    untitled: '未命名',
    today: '今天',
    yesterday: '昨天',
    week: '最近 7 天',
    earlier: '更早',
  },
  en: {
    trigger: 'Sessions',
    title: 'Sessions',
    current: 'Current',
    search: 'Search sessions',
    empty: 'No sessions yet',
    noMatch: 'No matching sessions',
    running: 'Running',
    unread: 'Finished, unread',
    pending: 'Waiting for you',
    untitled: 'Untitled',
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'Previous 7 days',
    earlier: 'Earlier',
  },
}

/** `ctx.locale.current` is the active language tag; match its base subtag. */
function copyFor(language) {
  const base = String(language || 'en').toLowerCase().split(/[-_]/)[0]
  return COPY[base] || COPY.en
}

function readLanguage(ctx) {
  try {
    return ctx.locale.getSnapshot().active
  } catch {
    return ''
  }
}

/** Theme tokens owned by the kernel; every color follows the active theme. */
const styleTagId = 'dsh-desktop-session-rail-menus'
const css = `
.dshd-rail-menu {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: min(70vh, 560px);
  padding: 6px;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-specific-popover-fill, var(--dsw-alias-bg-popover, #fff));
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
  font-size: 13px;
  line-height: 20px;
  outline: none;
}
.dshd-rail-menu-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 28px;
  padding: 0 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshd-rail-menu-count { font-variant-numeric: tabular-nums; opacity: 0.7; }
.dshd-rail-menu-search {
  flex: none;
  margin: 2px 2px 6px;
  height: 30px;
  padding: 0 9px;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-input, transparent);
  color: inherit;
  font: inherit;
  outline: none;
}
.dshd-rail-menu-search:focus { border-color: var(--dsw-alias-state-business-primary); }
.dshd-rail-menu-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.dshd-rail-menu-group {
  padding: 8px 6px 2px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  opacity: 0.85;
}
.dshd-rail-menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 4px 6px;
  box-sizing: border-box;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.dshd-rail-menu-row:hover { background: var(--dsw-alias-bg-l2-hover, rgba(127, 127, 127, 0.12)); }
.dshd-rail-menu-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshd-rail-menu-row[data-current='true'] { background: var(--dsw-alias-bg-l2-selected, rgba(127, 127, 127, 0.16)); }
.dshd-rail-menu-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshd-rail-menu-when {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
.dshd-rail-menu-meta {
  flex: none;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dshd-rail-menu-empty {
  padding: 18px 8px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}
.dshd-rail-menu-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary);
}
.dshd-rail-menu-dot[data-kind='running'] { background: var(--dsw-alias-state-business-primary); }
.dshd-rail-menu-dot[data-kind='unread'] { background: var(--dsw-alias-state-success-primary, #2e9e5b); }
.dshd-rail-menu-dot[data-kind='pending'] { background: var(--dsw-alias-state-warning-primary, #e0a02f); }
.dshd-rail-trigger {
  position: fixed;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-md);
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: var(--dsw-specific-sidebar-fill, transparent);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dshd-rail-trigger:hover,
.dshd-rail-trigger[aria-expanded='true'] { background: var(--dsw-alias-bg-l2-hover, rgba(127, 127, 127, 0.12)); }
.dshd-rail-trigger:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
`

/** One 18px glyph: three rows, for the menu and the rail button. */
function SessionsIcon({ size = 18 }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
  )
}

function splitQuery(query) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

/** Compact local timestamp for a row: relative within a day, then date. */
function relativeTime(timestamp, now) {
  if (!Number.isFinite(timestamp)) return ''
  const delta = Math.max(0, now - timestamp)
  const minutes = Math.floor(delta / 60_000)
  const date = new Date(timestamp)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() === new Date(now).getFullYear()
    ? `${month}-${day}`
    : `${date.getFullYear()}-${month}-${day}`
}

/** Day bucket label, from local midnight boundaries. */
function dayBucket(timestamp, now) {
  if (!Number.isFinite(timestamp)) return 'earlier'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const midnight = startOfToday.getTime()
  if (timestamp >= midnight) return 'today'
  if (timestamp >= midnight - 86_400_000) return 'yesterday'
  if (timestamp >= midnight - 6 * 86_400_000) return 'week'
  return 'earlier'
}

function statusKind(status) {
  if (status === undefined || status === null) return ''
  if (status.pendingInteraction !== undefined) return 'pending'
  if (status.running === true) return 'running'
  if (status.completionUnread) return 'unread'
  return ''
}

function statusLabel(status, copy) {
  const kind = statusKind(status)
  return kind === '' ? '' : copy[kind]
}

function rowTitle(summary, copy) {
  const title = summary?.displayTitle || summary?.title
  return typeof title === 'string' && title !== '' ? title : copy.untitled
}

function rowCwd(summary) {
  return typeof summary?.cwd === 'string' ? summary.cwd : ''
}

function workspaceLabel(cwd) {
  if (cwd === '') return ''
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || cwd
}

/**
 * Park the fixed trigger in the collapsed rail, just above the Settings row.
 *
 * The shell's own rail controls stay centered because their container is
 * sized for the rail; the footer seat this entry lives in keeps its wide
 * geometry (the column only clips it), so the trigger cannot rely on its
 * parent's box. It positions against the rail's left edge instead — the width
 * is the shell's SIDEBAR_COLLAPSED constant — and reads the footer's top from
 * the nearby anchor row, which is already laid out at rail geometry.
 */
/** The clipping sidebar column: the nearest ancestor that hides overflow. */
function findRailColumn(node) {
  let current = node?.parentElement ?? null
  while (current !== null && current !== document.body) {
    const style = getComputedStyle(current)
    if (style.overflowX === 'hidden' || style.overflow === 'hidden') {
      const width = current.getBoundingClientRect().width
      if (width > 0) return current
    }
    current = current.parentElement
  }
  return null
}

function placeTrigger(trigger) {
  const rail = findRailColumn(trigger)
  if (rail === null) return
  const railRect = rail.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  const height = triggerRect.height || 36

  const settings = rail.querySelector('[class*="settingsArea"]')
  const settingsRect = settings?.getBoundingClientRect()
  const top = settingsRect !== undefined && settingsRect.height > 0
    ? settingsRect.top - height - TRIGGER_GAP
    : railRect.bottom - height - TRIGGER_GAP

  const left = railRect.left + (RAIL_WIDTH - triggerRect.width) / 2
  trigger.style.left = `${Math.round(left)}px`
  trigger.style.top = `${Math.round(top)}px`
}

/** Position the fixed menu against the rail button, inside the window. */
function placeMenu(trigger, menu) {
  const rect = trigger.getBoundingClientRect()
  const height = menu.offsetHeight
  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.top),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
  )
  menu.style.top = `${Math.round(top)}px`
  menu.style.left = `${Math.round(rect.right + ANCHOR_GAP)}px`
}

function SessionRow({ summary, current, status, copy, now, onSelect }) {
  const kind = statusKind(status)
  const cwd = workspaceLabel(rowCwd(summary))
  return h(
    'button',
    {
      type: 'button',
      className: 'dshd-rail-menu-row',
      title: rowCwd(summary) ? `${rowTitle(summary, copy)}\n${rowCwd(summary)}` : rowTitle(summary, copy),
      'data-current': current ? 'true' : 'false',
      'data-session-id': summary.id,
      'aria-current': current ? 'true' : undefined,
      // Always named: the visible title, plus status when there is one.
      'aria-label': kind === '' ? rowTitle(summary, copy) : `${rowTitle(summary, copy)} (${statusLabel(status, copy)})`,
      onClick: onSelect,
    },
    h('span', { className: 'dshd-rail-menu-title' }, rowTitle(summary, copy)),
    cwd === '' ? null : h('span', { className: 'dshd-rail-menu-meta' }, cwd),
    kind === ''
      ? null
      : h('span', {
        className: 'dshd-rail-menu-dot',
        'data-kind': kind,
        title: statusLabel(status, copy),
        'aria-hidden': 'true',
      }),
  )
}

function RailSessionMenu({
  menuRef,
  copy,
  items,
  total,
  currentId,
  statusOf,
  onSelect,
  onHover,
}) {
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const searchRef = useRef(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Focus the filter on open so typing narrows the list immediately.
  useEffect(() => { searchRef.current?.focus() }, [])

  const terms = splitQuery(query)
  const all = Array.isArray(items) ? items : EMPTY_IDS
  const visible = useMemo(() => {
    if (terms.length === 0) return all.slice(0, RECENT_LIMIT)
    return all.filter((summary) => {
      const haystack = `${rowTitle(summary, copy)}\n${rowCwd(summary)}`.toLowerCase()
      return terms.every(term => haystack.includes(term))
    }).slice(0, RECENT_LIMIT)
  }, [all, terms.join(' '), copy])

  let lastBucket = ''
  const rows = []
  for (const summary of visible) {
    const bucket = terms.length === 0 ? dayBucket(summary.updatedAt, now) : ''
    if (bucket !== '' && bucket !== lastBucket) {
      lastBucket = bucket
      rows.push(h('div', { className: 'dshd-rail-menu-group', key: `group-${bucket}` }, copy[bucket]))
    }
    rows.push(
      h(SessionRow, {
        key: summary.id,
        summary,
        current: summary.id === currentId,
        status: statusOf(summary.id),
        copy,
        now,
        onSelect: () => onSelect(summary.id),
      }),
    )
  }

  return h(
    'div',
    {
      ref: menuRef,
      className: 'dshd-rail-menu',
      role: 'dialog',
      'aria-label': copy.title,
      tabIndex: -1,
      onKeyDown: (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const buttons = [...event.currentTarget.querySelectorAll('.dshd-rail-menu-row')]
          if (buttons.length === 0) return
          const active = buttons.indexOf(event.target)
          const step = event.key === 'ArrowDown' ? 1 : -1
          const next = active === -1
            ? (step === 1 ? 0 : buttons.length - 1)
            : (active + step + buttons.length) % buttons.length
          buttons[next].focus()
          event.preventDefault()
        }
      },
    },
    h(
      'div',
      { className: 'dshd-rail-menu-head' },
      h('span', null, copy.title),
      h('span', { className: 'dshd-rail-menu-count' }, String(total)),
    ),
    h('input', {
      ref: searchRef,
      className: 'dshd-rail-menu-search',
      type: 'search',
      placeholder: copy.search,
      'aria-label': copy.search,
      value: query,
      onChange: (event) => setQuery(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter' && visible.length > 0) onSelect(visible[0].id)
      },
    }),
    h(
      'div',
      { className: 'dshd-rail-menu-list' },
      rows.length === 0
        ? h('div', { className: 'dshd-rail-menu-empty' }, terms.length === 0 ? copy.empty : copy.noMatch)
        : rows,
    ),
  )
}

// ---------------------------------------------------------------------------
// Settings row: open the token-authenticated Web UI in the system browser.
// ---------------------------------------------------------------------------

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '12px 0',
}

const titleStyle = {
  fontSize: '14px',
  lineHeight: '20px',
}

const descStyle = {
  fontSize: '12px',
  lineHeight: '18px',
  opacity: 0.6,
}

const actionsStyle = {
  display: 'flex',
  gap: '8px',
  flexShrink: 0,
}

const buttonStyle = {
  padding: '6px 16px',
  fontSize: '13px',
  borderRadius: '6px',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  opacity: 0.85,
}

function makeRow() {
  return function OpenInBrowserRow() {
    const [openState, setOpenState] = React.useState('idle')
    const [copyState, setCopyState] = React.useState('idle')
    const timer = React.useRef(null)
    React.useEffect(() => () => clearTimeout(timer.current), [])

    const scheduleReset = (setState) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setOpenState('idle')
        setCopyState('idle')
      }, 2000)
    }
    const onOpen = async () => {
      if (openState === 'pending') return
      setOpenState('pending')
      try {
        const response = await fetch('/api/dsh-desktop/open', { method: 'POST' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setOpenState('done')
      } catch {
        setOpenState('error')
      }
      scheduleReset()
    }
    const onCopy = async () => {
      if (copyState === 'pending') return
      setCopyState('pending')
      try {
        const response = await fetch('/api/dsh-desktop/url')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const { value: url } = await response.json()
        await navigator.clipboard.writeText(url)
        setCopyState('done')
      } catch {
        setCopyState('error')
      }
      scheduleReset()
    }

    const openLabel =
      openState === 'pending' ? '打开中…' : openState === 'done' ? '已打开' : openState === 'error' ? '失败，重试' : '打开'
    const copyLabel =
      copyState === 'pending' ? '复制中…' : copyState === 'done' ? '已复制' : copyState === 'error' ? '失败，重试' : '复制'

    return h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '在浏览器中打开'),
        h('div', { style: descStyle }, '在系统浏览器中打开带访问凭证的 Web 界面'),
      ),
      h(
        'div',
        { style: actionsStyle },
        h('button', { style: buttonStyle, onClick: onCopy, disabled: copyState === 'pending' }, copyLabel),
        h('button', { style: buttonStyle, onClick: onOpen, disabled: openState === 'pending' }, openLabel),
      ),
    )
  }
}

/**
 * Kernel entry boundaries drop the whole entry when one of its renders throws,
 * which is how the rail button disappears. This one keeps the button: a
 * failing menu reports upward so the entry can simply put the menu away.
 */
class MenuBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(error) {
    console.error('[dsh-desktop] rail session menu failed:', error)
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFailure?.()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * @param {{ wide: boolean }} props - column state from the sidebar foot seat.
 * @param {{ openSession: (id: string) => void, copy: object }} injected
 */
function SidebarRailSessions(props, injected) {
  const { wide } = props
  const { openSession, copy } = injected
  const useSessions = props.useSessions
  const useSessionStatus = props.useSessionStatus
  // The list snapshot is absent until the service publishes its first value;
  // every read below tolerates that, so hovering can never crash the entry
  // (a throwing render makes the kernel drop the whole slot, button included).
  const list = useSessions(state => state)
  const statuses = useSessionStatus(state => state)

  // Callback refs, not object refs: this is a plain function component, so a
  // `ref` object would never be populated on its host elements.
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const closeTimer = useRef(null)
  const [open, setOpen] = useState(false)

  const ids = Array.isArray(list?.ids) ? list.ids : EMPTY_IDS
  const byId = list?.byId ?? {}
  const items = useMemo(() => ids
    .map(id => byId[id])
    .filter(summary => summary !== undefined && summary.origin !== 'subagent')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [ids, byId])

  const currentId = useMemo(() => ids.find((id) => {
    const summary = byId[id]
    return summary !== undefined && (summary.retainedBy?.mainView ?? 0) > 0
  }), [ids, byId])

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }
  const openRef = useRef(false)
  openRef.current = open
  const openMenu = () => {
    cancelClose()
    setOpen(true)
  }

  useEffect(() => () => cancelClose(), [])

  // The rail only exists while collapsed: expanding the column brings the
  // full browser back, so the floating list retires with it.
  useEffect(() => {
    if (wide) setOpen(false)
  }, [wide])

  // Park the trigger in the rail and keep it there through the collapse
  // animation, window resizes, and any change in the footer's height.
  useLayoutEffect(() => {
    if (wide) return undefined
    const trigger = triggerRef.current
    if (trigger === null) return undefined
    let frame = 0
    const place = () => {
      frame = 0
      if (trigger.isConnected) placeTrigger(trigger)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(place)
    }
    schedule()
    // The rail slides and crossfades for ~150ms; follow it to its resting spot.
    const settle = setTimeout(schedule, 220)
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (observer !== null) observer.observe(trigger.parentElement ?? trigger)
    return () => {
      clearTimeout(settle)
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [wide])

  // Keep the fixed menu anchored while it is on screen.
  useLayoutEffect(() => {
    if (!open || menuRef.current === null || triggerRef.current === null) return undefined
    const menu = menuRef.current
    const trigger = triggerRef.current
    const reposition = () => { if (menu.isConnected) placeMenu(trigger, menu) }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition)
    observer?.observe(menu)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      observer?.disconnect()
    }
  }, [open])

  // Click outside (or any window blur) closes; Escape closes from anywhere.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    const onBlur = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  if (wide) return null

  const select = (id) => {
    setOpen(false)
    openSession(id)
  }

  const assignTrigger = (node) => { triggerRef.current = node }
  const assignMenu = (node) => { menuRef.current = node }
  return h(
    React.Fragment,
    null,
    h(
      'button',
      {
        ref: assignTrigger,
        type: 'button',
        className: 'dshd-rail-trigger',
        'data-dsh-rail-sessions': '',
        'aria-label': copy.trigger,
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        onPointerEnter: openMenu,
        onPointerOver: openMenu,
        onPointerLeave: scheduleClose,
        onFocus: (event) => { if (event.target.matches(':focus-visible')) openMenu() },
        onClick: () => { if (openRef.current) setOpen(false); else openMenu() },
      },
      h(SessionsIcon),
    ),
    open
      ? h(
        MenuBoundary,
        { key: 'menu', onFailure: () => setOpen(false) },
        h(
          'div',
          { onPointerEnter: cancelClose, onPointerLeave: scheduleClose },
          h(RailSessionMenu, {
            menuRef: assignMenu,
            copy,
            items,
            total: items.length,
            currentId,
            statusOf: (id) => statuses?.get(id),
            onSelect: select,
            onHover: cancelClose,
          }),
        ),
      )
      : null,
  )
}

exports.inject = ['slots', 'uiWorkspace', 'locale']

exports.apply = (ctx) => {
  // Style tag is shared by every mount; remove it when the plugin unloads.
  ctx.effect(() => {
    if (typeof document === 'undefined' || document.getElementById(styleTagId) !== null) return () => {}
    const tag = document.createElement('style')
    tag.id = styleTagId
    tag.textContent = css
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-desktop: rail session menu styles')

  // General settings: open (or copy) the token URL of this Web UI. The host
  // half serves both routes; the desktop shell hands the URL to the system
  // browser itself, so the page only calls these endpoints.
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({ name: 'settings.general.item', id: 'open-in-browser', order: 100 }, makeRow()),
  )

  ctx.slots.inject('sidebar.footer.action', () => {
    // The copy is read once per declaration lifetime: a language switch
    // re-registers the row, which is cheaper than hoisting locale state.
    const injected = {
      openSession: (id) => { ctx.get('uiWorkspace').openSession(id) },
      copy: copyFor(readLanguage(ctx)),
    }
    return ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'dsh-desktop-rail-sessions', order: 100 },
      props => SidebarRailSessions(props, injected),
    )
  })
}
