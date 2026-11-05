// Static checks of the chapter 1 map (docs/LEVELS.md): markers, reachability, zones.
// Run: pnpm check:chapter1   (node strips the TypeScript types of src/game/level/map.ts itself)
import { CELL, MAP, ZONES, parseLevel } from '../src/game/level/map.ts'

const L = parseLevel(MAP)
let failed = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`)
  if (!cond) failed++
}
const at = (ch: string) => L.markers.filter((m) => m.ch === ch)

console.log('markers')
const expect: [string, number, string][] = [
  ['P', 1, 'start'], ['e', 1, 'flooded yurt'], ['S', 1, 'old spring'], ['M', 1, "Susar's trap"], ['B', 1, 'Shurale'], ['T', 1, 'great oak'],
  ['D', 2, 'drops of living water'], ['Q', 1, 'old quiver'], ['h', 1, 'dead hunter'], ['s', 1, 'shaman birch'], ['N', 1, "raven's nest"],
  ['W', 1, 'pack leader'], ['J', 1, 'hunting blind'], ['C', 1, 'cold fire pit'], ['f', 1, 'camp fire'], ['k', 2, 'balbals'], ['q', 1, 'barrow'], ['A', 1, "Arslan's echo"],
]
for (const [ch, n, what] of expect) ok(at(ch).length === n, `${what} (${ch}) × ${n}: found ${at(ch).length}`)
ok(at('i').length >= 3, `arrows in trunks (i) ≥ 3: found ${at('i').length}`)
ok(at('v').length >= 3, `Azamat's threads (v) ≥ 3: found ${at('v').length}`)
ok(at('a').length >= 2, `phantoms (a) ≥ 2: found ${at('a').length}`)
ok(at('=').length > 0 && at('Z').length > 0 && at('O').length > 0, 'roots gate (=), dry thorns (Z), deadfall (O) present')
const digits = L.markers.filter((m) => /[0-9]/.test(m.ch)).map((m) => m.ch)
ok(new Set(digits).size === digits.length, `script triggers are unique: ${digits.sort().join('')}`)
// a few markers must not stand in water (fires, the trap, the spring)
for (const ch of ['C', 'f', 'M', 'S', 'P']) for (const m of at(ch)) ok(!L.water[m.row * L.cols + m.col], `${ch} at ${m.row},${m.col} is on dry ground`)

// ---------------------------------------------------------------- reachability
const idx = (c: number, r: number) => r * L.cols + c
function reach(blocked: Set<string>) {
  const seen = new Uint8Array(L.cols * L.rows)
  const p = at('P')[0]
  const q = [idx(p.col, p.row)]
  seen[q[0]] = 1
  while (q.length) {
    const cur = q.pop()!
    const c = cur % L.cols
    const r = (cur / L.cols) | 0
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nr < 0 || nc >= L.cols || nr >= L.rows) continue
      const ni = idx(nc, nr)
      if (seen[ni] || !L.walk[ni]) continue
      const ch = MAP[nr][nc]
      if (blocked.has(ch)) continue
      seen[ni] = 1
      q.push(ni)
    }
  }
  return seen
}
const near = (seen: Uint8Array, col: number, row: number) => {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (seen[idx(col + dc, row + dr)]) return true
  return false
}
const oak = at('T')[0]
const key = ['e', 'S', 'M', 'D', 'Q', 'h', 's', 'N', 'J', 'C', 'f', 'k', 'q', 'A', 'v', 'i']

console.log('reachability')
const viaFire = reach(new Set(['O']))
const viaDeadfall = reach(new Set(['Z']))
const neither = reach(new Set(['O', 'Z']))
ok(near(viaFire, oak.col, oak.row), 'the great oak is reachable through the burnt thorns (zone 9)')
ok(near(viaDeadfall, oak.col, oak.row), 'the great oak is reachable through the pushed deadfall (zone 10, east)')
ok(!near(neither, oak.col, oak.row), 'without fire or the deadfall the north stays closed')
for (const ch of key) for (const m of at(ch)) ok(near(viaFire, m.col, m.row) || near(viaDeadfall, m.col, m.row), `${ch} at ${m.row},${m.col} can be reached`)
// the pack leader stands on his ledge: reachable for arrows, not for the kylys
for (const m of at('W')) ok(near(viaFire, m.col, m.row), `pack leader W at ${m.row},${m.col} is within bowshot of the path`)

console.log('zones')
const zoneOf = (c: number, r: number) => ZONES.findIndex((z) => z.rects.some(([c0, r0, c1, r1]) => c >= c0 && c <= c1 && r >= r0 && r <= r1))
const counts = new Map<number, number>()
let outside = 0
let floor = 0
for (let r = 0; r < L.rows; r++)
  for (let c = 0; c < L.cols; c++) {
    if (!L.walk[idx(c, r)]) continue
    floor++
    const z = zoneOf(c, r)
    if (z < 0) outside++
    else counts.set(z, (counts.get(z) ?? 0) + 1)
  }
ok(ZONES.length === 12, `12 zones (docs/LEVELS.md): ${ZONES.length}`)
for (let z = 0; z < ZONES.length; z++) {
  const reachable = ZONES[z].rects.some(([c0, r0, c1, r1]) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (viaFire[idx(c, r)] || viaDeadfall[idx(c, r)]) return true
    return false
  })
  ok((counts.get(z) ?? 0) > 0 && reachable, `zone ${ZONES[z].n} «${ZONES[z].name}»: ${counts.get(z) ?? 0} floor cells, reachable`)
}
ok(outside / floor < 0.08, `floor outside any zone: ${outside} of ${floor} cells (${((outside / floor) * 100).toFixed(1)}%)`)
console.log(`map ${L.cols}×${L.rows} cells of ${CELL} m`)

if (failed) {
  console.log(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
