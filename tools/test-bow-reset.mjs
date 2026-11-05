import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9523
const userDir = mkdtempSync(join(tmpdir(), 'shulgan-bug-'))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDir}`,
  'about:blank'
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  await sleep(1000)
  let list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  let pg = list.find(t => t.type === 'page')
  let ws = new WebSocket(pg.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  })
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalCode = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(() => { const g = window.__game; ${expr} })()`, returnByValue: true })
    if (r.result?.exceptionDetails) {
      console.error('Eval error:', r.result.exceptionDetails)
    }
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    if (await evalCode('return !!(g && g.ready)')) break
  }

  await evalCode(`
    cancelAnimationFrame(g.raf);
    g.frame = () => {};
    g.start(); g.endPrologue();
  `)

  // Place player right at droppedBow
  const res = await evalCode(`
    const b = g.level.droppedBow;
    g.player.pos.set(b.pos.x, 0, b.pos.z + 1.0);
    const states = [];
    for (let frame = 0; frame < 20; frame++) {
      g.update(1 / 30);
      states.push({ f: frame, st: g.player.st.toFixed(3), state: g.player.state, bow: g.kit.bow });
    }
    return states;
  `)
  console.log('Frame states at droppedBow:', res.slice(0, 10))

  chrome.kill('SIGTERM')
  try { rmSync(userDir, { recursive: true, force: true }) } catch {}
}
main().catch(console.error)
