import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/ui/eagleDemoMotion.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
const { EAGLE_DEMOS, sampleEagleDemo } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const targets = [[2.6, 0, 1.2], [-3.4, 0, -2.2], [4.6, 0, -3.4]]
const clips = new Set(['flight_flap', 'climb', 'soar', 'circle_left', 'circle_right', 'dive', 'talon_strike', 'pull_up', 'talon_grip', 'beak_call'])
let samples = 0
for (const demo of EAGLE_DEMOS) for (const target of targets) {
  for (let i = 0; i <= 1200; i++) {
    const state = sampleEagleDemo(demo.id, demo.duration * i / 1200, target)
    assert(state.position.every(Number.isFinite), `${demo.id}: invalid position`)
    assert(Number.isFinite(state.heading) && Number.isFinite(state.pitch), `${demo.id}: invalid rotation`)
    assert(state.position[1] >= 0, `${demo.id}: below the ground`)
    assert(state.clipTime >= 0 && Number.isFinite(state.clipTime), `${demo.id}: invalid clip time`)
    assert(clips.has(state.clip), `${demo.id}: missing animation ${state.clip}`)
    samples++
  }
  if (['game', 'dive_attack', 'sweep_attack', 'grab_attack'].includes(demo.id)) {
    const contact = sampleEagleDemo(demo.id, 0, target).contact
    const state = sampleEagleDemo(demo.id, contact, target)
    assert(Math.hypot(state.position[0] - target[0], state.position[2] - target[2]) < 1e-6, `${demo.id}: misses selected target`)
    assert(Math.abs(state.position[1] - 1.75) < 1e-6, `${demo.id}: wrong contact height`)
    assert(['talon_strike', 'talon_grip'].includes(state.clip), `${demo.id}: no talons at contact`)
  }
}
for (const mode of ['circle_left', 'circle_right']) {
  const duration = EAGLE_DEMOS.find((d) => d.id === mode).duration
  const a = sampleEagleDemo(mode, 0, targets[0]), b = sampleEagleDemo(mode, duration, targets[0])
  assert(Math.hypot(...a.position.map((v, i) => v - b.position[i])) < 1e-6, `${mode}: circle does not close`)
}
for (const [boundary, label] of [[.7, 'rise/circle'], [2, 'circle/dive'], [2.5, 'dive/leave']]) {
  const a = sampleEagleDemo('game', boundary - .000001, targets[0]), b = sampleEagleDemo('game', boundary, targets[0])
  assert(Math.hypot(...a.position.map((v, i) => v - b.position[i])) < .001, `${label}: position jumps`)
}
const lifted = sampleEagleDemo('grab_attack', 3, targets[0])
assert(lifted.targetLift > 2.4, 'grab: target never leaves the ground')
assert.equal(sampleEagleDemo('grab_attack', 4, targets[0]).targetLift, 0, 'grab: target does not land')
console.log(`Eagle prototype: ${EAGLE_DEMOS.length} modes, ${samples} samples; contacts, circles, phase continuity and target release passed.`)
