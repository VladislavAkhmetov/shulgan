// The harness of the scripted playthroughs (tools/playtest-chapter*.mjs): headless Chromium with software GL, driven over
// the DevTools protocol. The game loop is stopped; the simulation is stepped by hand at 1/30 s (Game.update, no render);
// input is synthetic; the test aims by itself. Every step returns true or a reason; any page error fails the run.
import { spawn, spawnSync } from 'node:child_process'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** helpers installed in the page once: stepping, input, teleports */
export const SETUP = `
  cancelAnimationFrame(g.raf); g.frame = () => {}
  window.key = (c, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: c }))
  window.mouse = (b, down) => g.renderer.domElement.dispatchEvent(new PointerEvent(down ? 'pointerdown' : 'pointerup', { button: b, bubbles: true }))
  window.step = (s) => { const n = Math.max(1, Math.round(s * 30)); for (let i = 0; i < n; i++) { g.input.enabled = !g.cine && g.player.alive && !g.choiceDrop && !g.loreOpen && !g.finalOpen; g.update(1 / 30); g.input.endFrame() } }
  window.tap = (c, s = 0.3) => { key(c, true); step(0.05); key(c, false); step(s) }
  window.skip = () => { for (let i = 0; i < 6 && g.cine; i++) g.skipScene(); step(0.2) }
  window.cell = (r, c) => ({ x: (c + 0.5) * 2, z: (r + 0.5) * 2 })
  window.go = (x, z) => { g.player.pos.set(x, 0, z); g.player.vel.set(0, 0, 0); step(0.4) }
  window.goCell = (r, c) => { const p = cell(r, c); go(p.x, p.z) }
  window.aim = (x, z) => g.player.aimPoint.set(x, 0, z)
  window.shoot = (x, z, fire = false) => { aim(x, z); step(0.1); if (g.player.weapon !== 'bow') tap('Digit2'); if (fire) tap('KeyF', 0.1); mouse(2, true); step(1.0); aim(x, z); mouse(0, true); step(0.05); mouse(0, false); step(0.05); mouse(2, false); step(0.6) }
  // the game aims at the mouse every frame: the test aims itself
  g.raycaster.ray.intersectPlane = () => null
  window.calm = () => { g.player.hp = g.player.maxHp; g.player.iframes = 2 }
  window.clear = (r = 16) => { for (const e of g.enemies) if (e.alive && e.kind !== 'boss' && e.pos.distanceTo(g.player.pos) < r) e.die() }
  g.start(); g.endPrologue(); skip()
  g.__playtest = true
  return true
`

/** run `steps` ([name, code][]) against the game at `url`; prints a line per step and exits with the result */
export async function playtest({ url, steps, title }) {
  const port = 9300 + Math.floor(Math.random() * 500)
  const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=320,180', 'about:blank'], { stdio: 'ignore' })
  // the chromium wrapper exits at once and the DevTools socket does not hold the event loop: a timer keeps node waiting
  const keep = setInterval(() => {}, 1000)
  const done = (code) => {
    clearInterval(keep)
    try {
      chrome.kill('SIGKILL')
    } catch {}
    // the wrapper has exited; the browser itself is found by its debugging port
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
  if (!ws) {
    console.log('chromium did not start')
    done(2)
  }
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const run = async (code, limit = 240000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: `(() => { const g = window.__game; ${code} })()`, returnByValue: true }), sleep(limit).then(() => ({ result: { exceptionDetails: { text: `no answer in ${limit / 1000} s` } } }))])
    return r.result?.exceptionDetails ? 'error: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text) : r.result?.result?.value
  }
  await send('Runtime.enable')
  await send('Page.navigate', { url })
  let ready = false
  for (let i = 0; i < 160 && !ready; i++) {
    await sleep(500)
    ready = (await run('return !!(g && g.ready)', 20000)) === true
  }
  if (!ready) {
    console.log('the game did not finish loading')
    for (const e of errors) console.log('PAGE ERROR', e.split('\n')[0])
    done(2)
  }
  // the models and recordings finish loading after the level is built: let the page settle before stopping its loop.
  // The dev server may reload the page once (dependency optimisation): then wait for the new game and start again.
  let settled = false
  for (let attempt = 0; attempt < 4 && !settled; attempt++) {
    await sleep(12000)
    for (let i = 0; i < 120; i++) {
      if ((await run('return !!(g && g.ready)', 20000)) === true) break
      await sleep(500)
    }
    await run(SETUP + '', 60000)
    await sleep(3000)
    settled = (await run('return !!(g && g.__playtest) && typeof window.step === "function"', 20000)) === true
  }
  if (!settled) {
    console.log('the page kept reloading')
    done(2)
  }
  let failed = 0
  for (const [name, code] of steps) {
    const t0 = Date.now()
    const r = await run(code)
    const pass = r === true
    if (!pass) failed++
    console.log(`${pass ? '  ok ' : 'FAIL '} ${name}${pass ? '' : ` → ${JSON.stringify(r)}`}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
  for (const e of errors) console.log('PAGE ERROR', e.split('\n')[0])
  console.log(failed || errors.length ? `\n${failed} step(s) failed, ${errors.length} page error(s)` : `\n${title} playthrough passed`)
  done(failed || errors.length ? 1 : 0)
}
