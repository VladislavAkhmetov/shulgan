// Static checks of the chapter 2 and 3 maps (docs/LEVELS.md): markers, reachability from the start (deep water stops the
// feet; the spirit veil and the drawbridge hold until opened), every key place reachable, zones cover the floor.
// Run: pnpm check:chapters
import { parseLevel, type Zone } from '../src/game/level/map.ts'
import { MAP2, ZONES2 } from '../src/game/level/map2.ts'
import { MAP3, ZONES3 } from '../src/game/level/map3.ts'

let failed = 0
const check = (ok: boolean, what: string) => {
  if (!ok) failed++
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`)
}

function analyse(name: string, map: string[], zones: Zone[], need: Record<string, number>, closed: string[], places: string[]) {
  console.log(`\n${name}`)
  const L = parseLevel(map)
  check(map.every((r) => r.length === L.cols), `${L.rows}×${L.cols}, every row the same width`)
  const count = (ch: string) => L.markers.filter((m) => m.ch === ch).length
  for (const [ch, n] of Object.entries(need)) check(count(ch) === n, `marker ${ch}: ${count(ch)} (want ${n})`)
  const at = (c: number, r: number) => map[r]?.[c] ?? '#'
  const reach = (open: Set<string>) => {
    const start = L.markers.find((m) => m.ch === 'P')!
    const seen = new Uint8Array(L.cols * L.rows)
    const q = [start.row * L.cols + start.col]
    seen[q[0]] = 1
    for (let h = 0; h < q.length; h++) {
      const r = Math.floor(q[h] / L.cols)
      const c = q[h] % L.cols
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc
        const nr = r + dr
        const i = nr * L.cols + nc
        if (nc < 0 || nr < 0 || nc >= L.cols || nr >= L.rows || seen[i] || !L.walk[i]) continue
        if (closed.includes(at(nc, nr)) && !open.has(at(nc, nr))) continue
        seen[i] = 1
        q.push(i)
      }
    }
    return seen
  }
  const shut = reach(new Set())
  const all = reach(new Set(closed))
  const reachable = (ch: string, s: Uint8Array) => L.markers.filter((m) => m.ch === ch).every((m) => s[m.row * L.cols + m.col])
  for (const ch of places) check(reachable(ch, all), `every ${ch} reachable once the way is open`)
  if (closed.length) check(!reachable(places[places.length - 1], shut), `without opening ${closed.join(' ')} the end is closed`)
  // floor that is neither reachable nor a pillar/islet marker in deep water
  const stray = L.markers.length ? [...L.walk.keys()].filter((i) => L.walk[i] && !all[i] && !'oV{'.includes(at(i % L.cols, Math.floor(i / L.cols)))) : []
  check(stray.length === 0, `no unreachable floor (${stray.length})`)
  let out = 0
  for (let r = 0; r < L.rows; r++)
    for (let c = 0; c < L.cols; c++) {
      if (!L.walk[r * L.cols + c]) continue
      if (!zones.some((z) => z.rects.some(([c0, r0, c1, r1]) => c >= c0 && c <= c1 && r >= r0 && r <= r1))) out++
    }
  check(out === 0, `${zones.length} zones, floor outside zones: ${out}`)
  for (const z of zones) check(z.rects.some(([c0, r0, c1, r1]) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (all[r * L.cols + c]) return true; return false }), `zone ${z.n} «${z.name}» has reachable floor`)
}

analyse('chapter 2 «Курганы у Чёрных вод»', MAP2, ZONES2, { P: 1, D: 2, E: 2, o: 4, G: 2, R: 2, V: 1, '@': 5, '}': 1, n: 1, j: 1, F: 1, '=': 3, C: 2, S: 1 }, ['!', '_'], ['E', 'G', 'R', 'D', 'j', 'F', '@', '}'])
analyse('chapter 3 «Чрево Горы»', MAP3, ZONES3, { P: 1, D: 1, Y: 1, '&': 1, X: 1, '{': 1, '@': 1, '=': 3, S: 1 }, [], ['Y', '&', 'E', '^', 'D', 'X', '@'])
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
