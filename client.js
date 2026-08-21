return {
  async apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const h = React.createElement
    const WEEK = ['日', '一', '二', '三', '四', '五', '六']
    const pad = (n) => (n < 10 ? '0' + n : String(n))
    const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    const parseKey = (key) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '')
      if (!m) return null
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    }
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
    const shiftKey = (key, n) => {
      const d = parseKey(key)
      return d ? keyOf(addDays(d, n)) : keyOf(new Date())
    }
    const todayKey = () => keyOf(new Date())
    const windowFrom = () => keyOf(addDays(new Date(), -14))
    const windowTo = () => keyOf(addDays(new Date(), 14))
    const clampKey = (key) => {
      const f = windowFrom()
      const t = windowTo()
      if (!key) return f
      if (key < f) return f
      if (key > t) return t
      return key
    }
    const fmtKey = (key) => {
      const d = parseKey(key)
      if (!d) return key
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEK[d.getDay()]
    }
    const normItem = (x) => {
      if (x == null) return { start: '', end: '', text: '' }
      if (typeof x === 'string') return { start: '', end: '', text: x }
      return {
        start: typeof x.start === 'string' ? x.start : '',
        end: typeof x.end === 'string' ? x.end : '',
        text: typeof x.text === 'string' ? x.text : '',
      }
    }
    const copyItem = (it) => ({ start: it.start, end: it.end, text: it.text })
    const nonEmpty = (it) => it.text.trim() !== '' || it.start !== '' || it.end !== ''
    const normMap = (obj) => {
      const out = {}
      for (const k of Object.keys(obj || {})) {
        if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(k)) continue
        const row = Array.isArray(obj[k]) ? obj[k] : []
        const items = row.map(normItem).filter(nonEmpty)
        if (items.length) out[k] = items
      }
      return out
    }

    const BALL_W = 48
    const PANEL_W = 360
    const panelWidth = () => {
      let vw = 0
      if (typeof window !== 'undefined') vw = window.innerWidth
      return vw > 0 ? Math.min(PANEL_W, Math.max(0, vw - 40)) : PANEL_W
    }
    const clampPos = (x, y, kind, w, h) => {
      let vw = 0
      let vh = 0
      if (typeof window !== 'undefined') { vw = window.innerWidth; vh = window.innerHeight }
      const minX = kind === 'ball' ? BALL_W : panelWidth()
      const maxX = vw > 0 ? vw : Infinity
      const maxY = vh > 0 ? Math.max(0, vh - h) : Infinity
      return {
        x: Math.max(minX, Math.min(Math.round(x), maxX)),
        y: Math.max(0, Math.min(Math.round(y), maxY)),
      }
    }
    const posStyle = (w) => (store.pos.x != null && store.pos.y != null)
      ? { left: (store.pos.x - w) + 'px', top: store.pos.y + 'px', right: 'auto', bottom: 'auto' }
      : undefined

    const store = {
      open: false,
      collapsed: false,
      pos: { x: null, y: null },
      editing: false,
      selectedKey: todayKey(),
      plans: null,
      drafts: null,
      listeners: new Set(),
      emit() { this.listeners.forEach((fn) => fn()) },
      subscribe(fn) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } },
    }

    host.call('plan.get').then((res) => {
      store.plans = normMap(res && res.plans)
      store.emit()
    }).catch(() => {
      store.plans = {}
      store.emit()
    })

    const timer = ctx.get('timer')
    if (timer !== undefined) {
      ctx.effect(() => {
        let last = todayKey()
        return timer.interval(() => {
          const now = todayKey()
          if (now !== last) {
            last = now
            store.selectedKey = clampKey(store.selectedKey)
            store.emit()
          }
        }, 60000)
      })
    }

    const basePlans = () => (store.plans && typeof store.plans === 'object' ? store.plans : {})
    const itemsOf = (key) => {
      const p = basePlans()
      return Array.isArray(p[key]) ? p[key] : []
    }
    const togglePanel = () => {
      store.open = !store.open
      store.emit()
    }
    const closePanel = () => { store.open = false; store.editing = false; store.drafts = null; store.emit() }
    const collapseToBall = () => { store.collapsed = true; store.emit() }
    const expandFromBall = () => {
      if (store.pos.x != null) {
        store.pos.x = Math.max(panelWidth(), store.pos.x)
      }
      store.collapsed = false
      store.emit()
    }
    const goTo = (key) => {
      const k = clampKey(key)
      if (k && k !== store.selectedKey) {
        store.selectedKey = k
        store.emit()
      }
    }
    const startEdit = () => { store.editing = true; store.drafts = {}; store.emit() }
    const cancelEdit = () => { store.editing = false; store.drafts = null; store.emit() }
    const draftFor = (key) => {
      if (!store.drafts) return []
      if (!store.drafts[key]) {
        store.drafts[key] = itemsOf(key).map(copyItem)
      }
      return store.drafts[key]
    }
    const saveEdit = () => {
      const key = store.selectedKey
      const items = ((store.drafts && store.drafts[key]) || []).map(copyItem).filter(nonEmpty)
      const next = Object.assign({}, basePlans())
      if (items.length) next[key] = items
      else delete next[key]
      store.plans = next
      if (store.drafts) delete store.drafts[key]
      store.emit()
      host.call('plan.save', { date: key, items }).catch(() => {})
    }

    let dragState = null
    let suppressClick = false
    const startDrag = (e, kind) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (kind === 'panel' && e.target && e.target.tagName === 'BUTTON') return
      const anchor = (kind === 'panel' && e.currentTarget.parentElement)
        ? e.currentTarget.parentElement
        : e.currentTarget
      const rect = anchor.getBoundingClientRect()
      if (store.pos.x == null || store.pos.y == null) {
        store.pos = { x: rect.right, y: rect.top }
      }
      dragState = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        baseRight: store.pos.x,
        baseTop: store.pos.y,
        w: rect.width,
        h: rect.height,
        moved: false,
      }
      suppressClick = false
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
    }
    const moveDrag = (e) => {
      if (!dragState) return
      const dx = e.clientX - dragState.startX
      const dy = e.clientY - dragState.startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true
      store.pos = clampPos(
        dragState.baseRight + dx,
        dragState.baseTop + dy,
        dragState.kind,
        dragState.w,
        dragState.h,
      )
      store.emit()
    }
    const endDrag = () => {
      if (!dragState) return
      suppressClick = dragState.moved
      dragState = null
    }
    const dragHandlers = (kind) => ({
      onPointerDown: (e) => startDrag(e, kind),
      onPointerMove: moveDrag,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    })

    const useStore = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
    }

    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'schedule-toggle' },
      (props) => {
        useStore()
        const wide = Boolean(props && props.wide)
        return h('button', {
          type: 'button',
          className: 'dsh-sched-toggle',
          'data-rail': wide ? 'false' : 'true',
          'data-open': store.open ? 'true' : 'false',
          'aria-label': '个人计划表',
          title: '个人计划表',
          onClick: togglePanel,
        }, [
          h('span', { className: 'dsh-sched-toggle-icon' }, '📋'),
          wide ? h('span', { className: 'dsh-sched-toggle-label' }, '计划表') : null,
        ])
      },
    ))

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'schedule-panel' },
      (props) => {
        useStore()
        if (!store.open) return null

        if (store.collapsed) {
          return h('div', {
            className: 'dsh-sched-ball',
            style: posStyle(BALL_W),
            title: '点击展开计划表；拖动可移动位置',
            'aria-label': '展开计划表',
            onClick: () => {
              if (suppressClick) { suppressClick = false; return }
              expandFromBall()
            },
            ...dragHandlers('ball'),
          }, '📋')
        }

        const key = store.selectedKey
        const isToday = key === todayKey()
        const items = itemsOf(key)

        const header = h('div', { className: 'dsh-sched-head', ...dragHandlers('panel') }, [
          h('div', null, [
            h('div', { className: 'dsh-sched-title' }, isToday ? '今日计划' : '计划'),
            h('div', { className: 'dsh-sched-date' }, fmtKey(key) + (isToday ? '（今天）' : '')),
          ]),
          h('div', { className: 'dsh-sched-actions' }, store.editing ? [
            h('button', { type: 'button', className: 'dsh-sched-btn', onClick: collapseToBall }, '缩小'),
            h('button', { type: 'button', className: 'dsh-sched-btn', onClick: cancelEdit }, '取消'),
            h('button', { type: 'button', className: 'dsh-sched-btn dsh-sched-btn-primary', onClick: saveEdit }, '保存'),
          ] : [
            h('button', { type: 'button', className: 'dsh-sched-btn', onClick: collapseToBall }, '缩小'),
            h('button', { type: 'button', className: 'dsh-sched-btn', onClick: startEdit }, '编辑'),
            h('button', { type: 'button', className: 'dsh-sched-btn', onClick: closePanel }, '关闭'),
          ]),
        ])

        const dateBar = h('div', { className: 'dsh-sched-datebar' }, [
          h('button', { type: 'button', className: 'dsh-sched-nav', 'aria-label': '前一天', onClick: () => goTo(shiftKey(key, -1)) }, '◀'),
          h('input', {
            type: 'date',
            className: 'dsh-sched-dateinput',
            value: key,
            min: windowFrom(),
            max: windowTo(),
            onChange: (e) => { if (e.target.value) goTo(e.target.value) },
          }),
          h('button', { type: 'button', className: 'dsh-sched-nav', 'aria-label': '后一天', onClick: () => goTo(shiftKey(key, 1)) }, '▶'),
          h('button', {
            type: 'button',
            className: 'dsh-sched-today' + (isToday ? ' dsh-sched-today-active' : ''),
            disabled: isToday,
            onClick: () => goTo(todayKey()),
          }, '今天'),
        ])

        let body
        if (store.editing) {
          const cur = draftFor(key)
          const setField = (i, field, value) => {
            const arr = draftFor(key)
            if (arr[i]) { arr[i][field] = value; store.emit() }
          }
          const addItem = () => { draftFor(key).push({ start: '', end: '', text: '' }); store.emit() }
          const removeItem = (i) => { const arr = draftFor(key); arr.splice(i, 1); store.emit() }
          body = h('div', { className: 'dsh-sched-body' }, [
            cur.map((it, i) => h('div', { key: i, className: 'dsh-sched-edit-item' }, [
              h('div', { className: 'dsh-sched-edit-time' }, [
                h('input', { type: 'time', className: 'dsh-sched-time-input', value: it.start, 'aria-label': '开始时间', onChange: (e) => setField(i, 'start', e.target.value) }),
                h('span', { className: 'dsh-sched-time-sep' }, '–'),
                h('input', { type: 'time', className: 'dsh-sched-time-input', value: it.end, 'aria-label': '结束时间', onChange: (e) => setField(i, 'end', e.target.value) }),
                h('button', { type: 'button', className: 'dsh-sched-del', 'aria-label': '删除', onClick: () => removeItem(i) }, '✕'),
              ]),
              h('input', { className: 'dsh-sched-input', value: it.text, placeholder: '输入计划内容…', onChange: (e) => setField(i, 'text', e.target.value) }),
            ])),
            cur.length === 0 ? h('div', { className: 'dsh-sched-empty' }, '这一天还没有计划') : null,
            h('button', { type: 'button', className: 'dsh-sched-btn dsh-sched-add', onClick: addItem }, '＋ 添加计划'),
            h('div', { className: 'dsh-sched-hint' }, '拖动标题可移动面板；「缩小」收起为悬浮球。点「保存」写入磁盘，切换日期不丢失其他日期的草稿'),
          ])
        } else {
          body = h('div', { className: 'dsh-sched-body' },
            items.length === 0
              ? h('div', { className: 'dsh-sched-empty' }, '这一天暂无计划，点击「编辑」添加')
              : items.map((it, i) => {
                  const timeText = [it.start, it.end].filter((t) => t && t.trim()).join(' - ')
                  return h('div', { key: i, className: 'dsh-sched-item' }, [
                    h('span', { className: 'dsh-sched-item-no' }, String(i + 1)),
                    timeText ? h('span', { className: 'dsh-sched-time' }, timeText) : null,
                    h('span', { className: 'dsh-sched-item-text' }, it.text || ''),
                  ])
                }))
        }

        return h('div', { className: 'dsh-sched-panel', style: posStyle(panelWidth()), role: 'dialog', 'aria-label': '个人计划表' }, [
          header,
          dateBar,
          body,
          h('div', { className: 'dsh-sched-window' }, '可查看与编辑今天前后 14 天的计划'),
        ])
      },
    ))

    styles.insert(`
.dsh-sched-toggle {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 32px; padding: 0 12px;
  border: none; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; white-space: nowrap;
}
.dsh-sched-toggle:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-sched-toggle[data-rail="true"] { justify-content: center; padding: 0; }
.dsh-sched-toggle[data-open="true"] { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh-sched-toggle-icon { font-size: 16px; line-height: 1; }
.dsh-sched-ball {
  position: fixed; top: 20px; right: 20px; z-index: 1000;
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  display: flex; align-items: center; justify-content: center;
  cursor: grab; user-select: none; touch-action: none;
  font-size: 22px; line-height: 1; color: var(--dsw-alias-brand-primary);
  pointer-events: auto;
}
.dsh-sched-ball:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-sched-ball:active { cursor: grabbing; }
.dsh-sched-panel {
  position: fixed; top: 20px; right: 20px; z-index: 1000;
  width: 360px; max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px); overflow-y: auto;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  pointer-events: auto;
  color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 1.5;
}
.dsh-sched-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 14px 16px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  cursor: grab; user-select: none; touch-action: none;
}
.dsh-sched-head:active { cursor: grabbing; }
.dsh-sched-title { font-size: 15px; font-weight: 600; }
.dsh-sched-date { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.dsh-sched-actions { display: flex; gap: 8px; }
.dsh-sched-datebar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-sched-nav {
  flex: none; width: 26px; height: 26px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border-radius: 8px; cursor: pointer; font-size: 12px; line-height: 1;
}
.dsh-sched-nav:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-sched-dateinput {
  flex: 1; min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 4px 6px; font-size: 12px; font-family: inherit;
}
.dsh-sched-today {
  flex: none; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.dsh-sched-today:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-sched-today:disabled { opacity: 0.5; cursor: default; }
.dsh-sched-today-active { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-sched-btn {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer;
}
.dsh-sched-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-sched-btn-primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-sched-body { padding: 10px 16px 12px; }
.dsh-sched-item { display: flex; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-sched-item:last-child { border-bottom: none; }
.dsh-sched-item-no {
  flex: none; width: 18px; height: 18px; border-radius: 50%;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 11px; display: flex; align-items: center; justify-content: center; margin-top: 1px;
}
.dsh-sched-time {
  flex: none; font-size: 12px; white-space: nowrap;
  color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2);
  padding: 1px 6px; border-radius: 6px; font-variant-numeric: tabular-nums;
}
.dsh-sched-item-text { flex: 1; word-break: break-word; }
.dsh-sched-empty { color: var(--dsw-alias-label-secondary); font-size: 13px; padding: 12px 0; text-align: center; }
.dsh-sched-edit-item {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; padding: 8px; margin-bottom: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-sched-edit-time { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.dsh-sched-time-input {
  flex: 1; min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 4px 6px; font-size: 12px; font-family: inherit;
}
.dsh-sched-time-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dsh-sched-time-sep { color: var(--dsw-alias-label-secondary); font-size: 12px; flex: none; }
.dsh-sched-input {
  flex: 1; min-width: 0; width: 100%; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 6px 10px; font-size: 13px; font-family: inherit;
}
.dsh-sched-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dsh-sched-del {
  flex: none; border: none; background: transparent; color: var(--dsw-alias-state-error-primary);
  cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 6px;
}
.dsh-sched-del:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-sched-add { margin-top: 4px; }
.dsh-sched-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 10px; }
.dsh-sched-window { padding: 0 16px 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
`)
  },
}
