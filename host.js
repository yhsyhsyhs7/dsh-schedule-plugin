return {
  async apply(ctx) {
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    let plans = {}

    const workspaceRoot = sandboxPolicy ? sandboxPolicy.workspaceRoot : undefined
    const filePath = workspaceRoot
      ? String(workspaceRoot).replace(/[\\/]+$/, '') + '/.dsh-schedule.json'
      : null

    const isDateKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k)
    const normItem = (x) => {
      if (typeof x === 'string') return { start: '', end: '', text: x }
      if (x && typeof x === 'object') {
        return {
          start: typeof x.start === 'string' ? x.start : '',
          end: typeof x.end === 'string' ? x.end : '',
          text: typeof x.text === 'string' ? x.text : '',
        }
      }
      return { start: '', end: '', text: '' }
    }
    const normPlan = (obj) => {
      const out = {}
      for (const k of Object.keys(obj || {})) {
        if (!isDateKey(k)) continue
        const row = Array.isArray(obj[k]) ? obj[k] : []
        const items = row
          .map(normItem)
          .filter((it) => it.text.trim() !== '' || it.start !== '' || it.end !== '')
        if (items.length) out[k] = items
      }
      return out
    }
    const snapshot = () => {
      const out = {}
      for (const k of Object.keys(plans)) {
        out[k] = plans[k].map((it) => ({ start: it.start, end: it.end, text: it.text }))
      }
      return out
    }

    if (fs !== undefined && filePath) {
      try {
        const target = await fs.resolve(filePath)
        const info = await fs.stat(target)
        if (info !== undefined) {
          const text = await fs.readText(target)
          const parsed = JSON.parse(text)
          if (parsed && parsed.version === 2 && parsed.plans && typeof parsed.plans === 'object') {
            plans = normPlan(parsed.plans)
          } else {
            console.log('schedule: ignoring non-v2 data in ' + filePath)
          }
        }
      } catch (err) {
        console.error('schedule: failed to load ' + filePath + ': ' + String(err && err.message ? err.message : err))
      }
    }

    let writeChain = Promise.resolve()
    const persist = () => {
      if (fs === undefined || !filePath) return Promise.resolve(false)
      writeChain = writeChain.then(async () => {
        try {
          const target = await fs.resolve(filePath)
          const policy = sandboxPolicy ? sandboxPolicy.resolve() : undefined
          const content = JSON.stringify({ version: 2, plans: snapshot() }, null, 2)
          await fs.writeText(target, content, undefined, undefined, policy)
          return true
        } catch (err) {
          console.error('schedule: failed to persist: ' + String(err && err.message ? err.message : err))
          return false
        }
      })
      return writeChain
    }

    ctx.effect(() => harness.handle('plan.get', async () => ({ plans: snapshot() })))

    ctx.effect(() => harness.handle('plan.save', async (args) => {
      const date = args && typeof args.date === 'string' ? args.date : ''
      const input = args && Array.isArray(args.items) ? args.items : null
      if (!isDateKey(date) || !input) return { ok: false, persisted: false }
      const items = input
        .map(normItem)
        .filter((it) => it.text.trim() !== '' || it.start !== '' || it.end !== '')
      const next = Object.assign({}, plans)
      if (items.length) next[date] = items
      else delete next[date]
      plans = next
      const persisted = await persist()
      return { ok: true, persisted }
    }))
  },
}
