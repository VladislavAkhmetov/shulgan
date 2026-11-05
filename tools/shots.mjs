// Screenshots of a chapter at 1280×800 for a visual check (headless Chromium, software GL), using the playtest harness's
// helpers. Run: node tools/shots.mjs <chapter> '[["name","code"],...]'   → /tmp/<name>.png   (dev server on :3000)
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { SETUP } from './playtest-harness.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const keep = setInterval(() => {}, 1000)
const port = 9700 + Math.floor(Math.random() * 200)
spawn('chromium', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' })
const quit = (code) => {
  clearInterval(keep)
  spawnSync('pkill', ['-9', '-f', `remote-debugging-port=${port}`])
  process.exit(code)
}
let ws
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const pg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
    if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl)
  } catch {}
  await sleep(250)
}
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
  }
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.log('CONSOLE', d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 1500))
  if (d.method === 'Runtime.exceptionThrown') console.log('EXC', d.params.exceptionDetails.exception?.description?.slice(0, 500))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const run = async (code) => {
  const r = await send('Runtime.evaluate', { expression: `(() => { const g = window.__game; ${code} })()`, returnByValue: true })
  return r.result?.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description ?? '').slice(0, 300) : r.result?.result?.value
}
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
const ch = process.argv[2]
await send('Page.navigate', { url: 'http://localhost:3000/' + (ch === '1' ? '' : '#chapter=' + ch) })
for (let attempt = 0; attempt < 3; attempt++) {
  for (let i = 0; i < 120; i++) {
    if ((await run('return !!(g && g.ready)')) === true) break
    await sleep(500)
  }
  await sleep(12000)
  await run(SETUP)
  await sleep(2000)
  if ((await run('return !!(g && g.__playtest)')) === true) break
}
for (const [name, code] of JSON.parse(process.argv[3])) {
  console.log(name, await run(code + '; window.R = () => { for (let i = 0; i < 3; i++) g.render(1 / 30) }; g.narrQueue = []; g.curNarr = null; g.hintQueue = []; g.curHint = null; g.zoneCard = null; step(0.1); R(); return true'))
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`/tmp/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
quit(0)
