// Open /tools/focus-benchmark.html on the running Vite server. Uses the actual browser/GPU and real RAF.
// Private Game hooks match the existing playtest harness; this page never changes saved progress.
import { Game } from '../src/game/Game.ts'

const report = document.querySelector('#report')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const g = new Game(document.querySelector('#game'))
const rows = []
let active = null
let previousStamp = 0
let previousPhase = null

const percentile = (a, q) => {
  const sorted = a.slice().sort((x, y) => x - y)
  return +(sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0).toFixed(2)
}
const key = (down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'KeyF' }))
const draw = (status) => {
  report.textContent = [
    'Фокус жара: реальный RAF, без программного GL',
    `GPU: ${g.debugGpu}`,
    `Буфер: ${g.renderer.domElement.width}×${g.renderer.domElement.height}`,
    status,
    '',
    'Режим | кадров | кадр p50 / p95 / max, мс | CPU max, мс | новые программы',
    ...rows.map((r) => `${r.name} | ${r.frames} | ${r.p50} / ${r.p95} / ${r.max} | ${r.cpuMax} | ${r.programs}`),
  ].join('\n')
}

try {
  const deadline = performance.now() + 30000
  while (!g.ready || !g.player?.anim) {
    if (performance.now() > deadline) throw new Error('Hero GLB did not become ready in 30 s')
    await wait(100)
  }
  g.start()
  g.endPrologue()
  g.skipScene()
  g.kit.ember = true
  g.player.pos.set(43, 0, 230.6)
  g.player.vel.set(0, 0, 0)
  g.audio.setVolume(0)

  const drawDirect = g.renderer.renderBufferDirect
  g.renderer.renderBufferDirect = function (...args) {
    const before = this.info.programs.length
    drawDirect.apply(this, args)
    if (active && this.info.programs.length > before) {
      const object = args[4]
      const path = []
      for (let parent = object; parent; parent = parent.parent) if (parent.name) path.unshift(parent.name)
      active.draws.add(`${args[3].type} ${object.type} ${path.join('/')} cast:${object.castShadow} side:${args[3].side}`)
    }
  }

  const frame = g.frame
  g.frame = (now) => {
    const before = g.renderer.info.programs.length
    const start = performance.now()
    frame(now)
    const cpu = performance.now() - start
    if (active) {
      active.cpu.push(cpu)
      if (g.player.focus) active.focusedFrames++
      active.focusIntensity = Math.max(active.focusIntensity, g.lighting.focus.intensity)
      active.programs += g.renderer.info.programs.length - before
      for (const program of g.renderer.info.programs.slice(before)) {
        const source = g.renderer.getContext().getShaderSource(program.vertexShader) || ''
        const flags = ['USE_SKINNING', 'USE_INSTANCING', 'USE_MAP', 'USE_ALPHATEST'].filter((flag) => source.includes(`#define ${flag}`))
        active.programNames.add([program.cacheKey.split(',')[0], ...flags].join(':'))
      }
      if (previousPhase === active) active.intervals.push(now - previousStamp)
    }
    previousStamp = now
    previousPhase = active
  }
  await wait(2500)

  const sample = async (name, action = () => {}, duration = 2200) => {
    draw(`Проверка: ${name}`)
    active = { cpu: [], intervals: [], programs: 0, programNames: new Set(), draws: new Set(), focusedFrames: 0, focusIntensity: 0 }
    action()
    await wait(duration)
    const data = active
    active = null
    const row = {
      name, frames: data.cpu.length,
      p50: percentile(data.intervals, 0.5), p95: percentile(data.intervals, 0.95), max: percentile(data.intervals, 1),
      cpuMax: percentile(data.cpu, 1), programs: data.programs, programNames: [...data.programNames], draws: [...data.draws],
      focusedFrames: data.focusedFrames, focusIntensity: +data.focusIntensity.toFixed(2),
    }
    rows.push(row)
    console.info('[focus-benchmark:row]', JSON.stringify(row))
    draw(`Готово: ${name}`)
  }

  await sample('Обычный свет')
  await sample('Первое удержание F', () => key(true), 3000)
  key(false)
  await wait(1500)
  await sample('Повторное удержание F', () => key(true), 3000)
  key(false)
  await wait(1500)
  await sample('Без тени щита', () => g.setDebugShieldShadow(false))
  g.setDebugShieldShadow(true)
  await wait(500)
  await sample('Замороженная тень огня', () => { g.debugShadowFrozen = true })
  g.debugShadowFrozen = false
  g.lighting.lantern.shadow.needsUpdate = true
  await wait(500)
  // Warm this optional shader configuration before measuring its steady state.
  g.lighting.lantern.castShadow = false
  await wait(1500)
  await sample('Без тени огня')
  g.lighting.lantern.castShadow = true
  cancelAnimationFrame(g.raf)
  const focusRows = rows.filter((row) => row.name.includes('удержание F'))
  const passed = focusRows.every((row) => row.programs === 0 && row.focusedFrames > 0 && row.focusIntensity > 50)
  console.info('[focus-benchmark:result]', JSON.stringify({ passed, gpu: g.debugGpu, width: g.renderer.domElement.width, height: g.renderer.domElement.height, rows }))
  draw(passed ? 'ПРОЙДЕНО: фокус работает, новых программ при F нет. CPU — не отдельное GPU-время.' : 'НЕ ПРОЙДЕНО: см. результаты и console.')
  if (!passed) console.error('[focus-benchmark:error] Focus did not activate without compiling new programs')
} catch (error) {
  key(false)
  report.textContent = String(error.stack || error)
  console.error('[focus-benchmark:error]', String(error.stack || error))
}
window.addEventListener('pagehide', () => g.dispose(), { once: true })
