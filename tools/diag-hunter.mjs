import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 9522
const userDir = mkdtempSync(join(tmpdir(), 'shulgan-diag-'))
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
    window.step = (s) => {
      const n = Math.max(1, Math.round(s * 30));
      for (let i = 0; i < n; i++) {
        g.input.enabled = !g.cine && g.player.alive && !g.choiceDrop && !g.loreOpen && !g.finalOpen;
        g.update(1 / 30);
        g.input.endFrame();
      }
    };
    window.skip = () => { for (let i = 0; i < 6 && g.cine; i++) g.skipScene(); step(0.2); };
    window.go = (x, z) => { g.player.pos.set(x, 0, z); g.player.vel.set(0, 0, 0); step(0.4); };
    g.start(); g.endPrologue(); skip();
  `)

  // Teleport to hearth and take coal
  await evalCode(`
    go(43, 230.6);
    g.player.startInteract(() => g.takeEmber());
    step(1.5);
    skip();
  `)

  // Teleport to hunter
  const hunterState = await evalCode(`
    const h = g.levelData.markers.find(m => m.ch === 'h');
    go(h.x, h.z + 1.2);
    const int1 = g.findInteraction();
    return { hPos: { x: h.x, z: h.z }, int1: int1 ? int1.label : null };
  `)
  console.log('Hunter step 1:', hunterState)

  // Trigger first interaction (inspect hair)
  const afterHair = await evalCode(`
    const int1 = g.findInteraction();
    if (int1 && int1.run) int1.run();
    step(1.5);
    skip();
    const int2 = g.findInteraction();
    return { clueHair: g.clueFound.has('hair'), int2: int2 ? int2.label : null };
  `)
  console.log('Hunter step 2 (hair):', afterHair)

  // Trigger second interaction (take quiver & fang)
  const afterFang = await evalCode(`
    const int2 = g.findInteraction();
    if (int2 && int2.run) int2.run();
    step(1.5);
    return {
      hasFang: g.kit.keepsakes.has('fang'),
      arrows: g.kit.arrows,
      maxArrows: g.kit.maxArrows
    };
  `)
  console.log('Hunter step 3 (fang & arrows):', afterFang)

  // Now approach the stream bow
  const streamBow = await evalCode(`
    const b = g.level.droppedBow;
    go(b.pos.x, b.pos.z + 1.2);
    step(1.0);
    const intBow = g.findInteraction();
    return { bowPos: b.pos, taken: b.taken, intBow: intBow ? intBow.label : null };
  `)
  console.log('Stream bow step 1:', streamBow)

  const bowTaken = await evalCode(`
    const intBow = g.findInteraction();
    if (intBow && intBow.run) intBow.run();
    step(1.5);
    skip();
    step(1.0);
    return {
      hasBow: g.kit.bow,
      arrows: g.kit.arrows,
      maxArrows: g.kit.maxArrows
    };
  `)
  console.log('Stream bow step 2 (bow taken):', bowTaken)

  // Approach shaman birch ribbon
  const ribbonState = await evalCode(`
    const r = g.level.clues.ribbon;
    go(r.x + 0.4, r.z + 0.4);
    step(0.5);
    const intRibbon = g.findInteraction();
    if (intRibbon && intRibbon.run) intRibbon.run();
    step(1.5);
    skip();
    return {
      ribbonFound: g.clueFound.has('ribbon')
    };
  `)
  console.log('Ribbon step:', ribbonState)

  // Approach cold fire
  const coldFireState = await evalCode(`
    const cf = g.level.coldFires[0];
    go(cf.pos.x + 1.2, cf.pos.z);
    step(0.5);
    const intCf = g.findInteraction();
    if (intCf && intCf.run) intCf.run();
    step(1.5);
    return {
      cfPos: cf.pos,
      lit: cf.lit,
      checkpointDist: g.player.checkpoint.distanceTo(cf.pos)
    };
  `)
  console.log('Cold fire step:', coldFireState)

  // Test wolf pack and leader
  const wolfState = await evalCode(`
    const w = g.enemies.find(e => e.ledge);
    const wolves = g.enemies.filter(e => e.kind === 'wolf' && e.alive && !e.ledge);
    go(w.pos.x - 6, w.pos.z + 1);
    step(0.5);
    // Shoot leader
    g.player.weapon = 'bow';
    const hpBefore = w.hp;
    w.takeHit(40, 0, g.player.pos.x, g.player.pos.z, 0, false, 'arrow');
    step(0.5);
    const hpAfter1 = w.hp;
    w.takeHit(40, 0, g.player.pos.x, g.player.pos.z, 0, false, 'arrow');
    step(0.5);
    return {
      leaderHpBefore: hpBefore,
      leaderHpAfter1: hpAfter1,
      leaderDead: !w.alive,
      wolvesAlive: wolves.filter(x => x.alive).length,
      wolvesScared: wolves.every(x => x.state === 'flee' || !x.alive)
    };
  `)
  console.log('Wolf fight step:', wolfState)

  chrome.kill('SIGTERM')
  try { rmSync(userDir, { recursive: true, force: true }) } catch {}
}
main().catch(console.error)
