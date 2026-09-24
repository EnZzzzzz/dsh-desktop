const React = require('react')

const h = React.createElement

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

exports.inject = ['slots']

exports.apply = (ctx) => {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({ name: 'settings.general.item', id: 'open-in-browser', order: 100 }, makeRow()),
  )
}
