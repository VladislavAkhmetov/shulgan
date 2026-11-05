// Comprehensive Chapter 1 Playtester and Gameplay Friction Auditor
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const port = 9520
const userDir = mkdtempSync(join(tmpdir(), 'shulgan-qa-'))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--no-sandbox',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDir}`,
  '--window-size=1280,720',
  'about:blank'
], { stdio: 'ignore' })

async function runAudit() {
  console.log('Connecting to Chrome on port ' + port + '...')
  let ws
  for (let i = 0; i < 40 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const pg = list.find((t) => t.type === 'page')
      if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl)
    } catch {}
    await sleep(200)
  }
  if (!ws) {
    console.error('Failed to connect to headless Chrome')
    process.exit(1)
  }
  if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r))

  let id = 0
  const pending = new Map()
  const pageErrors = []

  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    }
    if (d.method === 'Runtime.exceptionThrown') {
      pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
    }
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      pageErrors.push(d.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  })

  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })

  const evalCode = async (expr, limit = 20000) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: `(() => { const g = window.__game; ${expr} })()`, returnByValue: true }),
      sleep(limit).then(() => ({ result: { exceptionDetails: { text: `Timeout after ${limit}ms` } } }))
    ])
    if (r.result?.exceptionDetails) {
      return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
    }
    return { value: r.result?.result?.value }
  }

  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })

  console.log('Waiting for game to load...')
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500)
    const r = await evalCode('return !!(g && g.ready)')
    ready = r.value === true
  }
  if (!ready) {
    console.error('Game failed to load within 30 seconds!')
    console.error('Page errors:', pageErrors)
    cleanup(1)
  }
  console.log('Game loaded. Initializing test hooks...')

  // Install test helpers
  const setupRes = await evalCode(`
    cancelAnimationFrame(g.raf);
    g.frame = () => {};
    window.key = (c, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: c }));
    window.mouse = (b, down) => g.renderer.domElement.dispatchEvent(new PointerEvent(down ? 'pointerdown' : 'pointerup', { button: b, bubbles: true }));
    window.step = (s) => {
      const n = Math.max(1, Math.round(s * 30));
      for (let i = 0; i < n; i++) {
        g.input.enabled = !g.cine && g.player.alive && !g.choiceDrop && !g.loreOpen && !g.finalOpen;
        g.update(1 / 30);
        g.input.endFrame();
      }
    };
    window.tap = (c, s = 0.3) => { key(c, true); step(0.05); key(c, false); step(s); };
    window.skip = () => { for (let i = 0; i < 6 && g.cine; i++) g.skipScene(); step(0.2); };
    window.cell = (r, c) => ({ x: (c + 0.5) * 2, z: (r + 0.5) * 2 });
    window.go = (x, z) => { g.player.pos.set(x, 0, z); g.player.vel.set(0, 0, 0); step(0.4); };
    window.goCell = (r, c) => { const p = cell(r, c); go(p.x, p.z); };
    window.aim = (x, z) => g.player.aimPoint.set(x, 0, z);
    window.shoot = (x, z, fire = false) => {
      aim(x, z);
      step(0.1);
      if (g.player.weapon !== 'bow') tap('Digit2');
      if (fire) tap('KeyF', 0.1);
      mouse(2, true);
      step(1.0);
      aim(x, z);
      mouse(0, true);
      step(0.05);
      mouse(0, false);
      step(0.05);
      mouse(2, false);
      step(0.6);
    };
    g.raycaster.ray.intersectPlane = () => null;
    window.calm = () => { g.player.hp = g.player.maxHp; g.player.iframes = 2; };
    window.clear = (r = 16) => { for (const e of g.enemies) if (e.alive && e.kind !== 'boss' && e.pos.distanceTo(g.player.pos) < r) e.die(); };
    g.start();
    g.endPrologue();
    skip();
    return true;
  `)

  if (setupRes.error) {
    console.error('Setup hook failed:', setupRes.error)
    cleanup(1)
  }

  console.log('Hooks installed. Running Chapter 1 Total Audit...\n')

  const auditSteps = [
    {
      id: 'Z1_START_BOUNDARY',
      desc: 'Zone 1: Leaving clearing without coal is blocked by holdEmber()',
      code: `
        goCell(109, 23);
        const z = g.player.pos.z;
        const nag = g.narrQueue.some(n => typeof n === 'object' && n.text.includes('Без огня'));
        return { blocked: z > 220, nag };
      `
    },
    {
      id: 'Z1_EMBER_PICKUP',
      desc: 'Zone 1: Take coal and kalkan from yurt (TRG_CH1_EMBER)',
      code: `
        go(43, 230.6);
        tap('KeyE', 1.2);
        skip();
        return {
          ember: g.kit.ember,
          hasBow: g.kit.bow,
          arrows: g.kit.arrows,
          maxArrows: g.kit.maxArrows,
          lightIntensity: g.lighting.lantern.intensity
        };
      `
    },
    {
      id: 'Z1_CLUE_FUR',
      desc: 'Zone 1: Inspect rusty fur at threshold',
      code: `
        const d = g.level.clues.fur;
        go(d.x + 0.4, d.z + 0.6);
        tap('KeyE', 1.2);
        return { furFound: g.clueFound.has('fur') };
      `
    },
    {
      id: 'Z1_FOCUS_HEAT',
      desc: 'Zone 1: Heat focus with [F] reveals tracks',
      code: `
        key('KeyF', true);
        step(0.8);
        const focusOn = g.player.focus;
        const trackVal = g.level.trackFocus.value.w;
        key('KeyF', false);
        step(0.2);
        return { focusOn, trackVal, ok: focusOn && trackVal > 0.8 };
      `
    },
    {
      id: 'Z2_FERN_EDGE',
      desc: 'Zone 2: Enter fern edge, check zone announcement and tutor',
      code: `
        goCell(108, 23);
        goCell(105, 23);
        step(1);
        return {
          zonesSeen: Array.from(g.zonesSeen),
          tutorActive: g.tutor.active,
          tutorLesson: g.tutor.current?.lesson
        };
      `
    },
    {
      id: 'Z3_UBYR_AMBUSH',
      desc: 'Zone 3: Buried Ubyr rises from the mud in rotten ravine',
      code: `
        const u = g.enemies.find((e) => e.kind === 'ubyr' && e.buried && e.pos.z > 190 && e.pos.z < 215);
        goCell(101, 22);
        calm();
        step(2.5);
        calm();
        return {
          ubyrFound: !!u,
          emerged: !!u && !u.buried && u.alive,
          ubyrHp: u ? u.hp : null,
          ubyrState: u ? u.state : null
        };
      `
    },
    {
      id: 'Z3_COMBAT_PARRY',
      desc: 'Zone 3: Combat with Ubyr - Parry and counter attack mechanics',
      code: `
        let parried = false;
        let counterDone = false;
        for (let i = 0; i < 40 && !parried; i++) {
          step(0.1);
          calm();
          if (g.amberTaught || g.player.parries > 0) parried = true;
        }
        return { parried, playerFervor: g.kit.fervor, parriesCount: g.player.parries };
      `
    },
    {
      id: 'Z3_RAVEN_NEST_AUDIT',
      desc: 'Zone 3: Raven nest interaction check (Does player have bow? Can Kara hit it?)',
      code: `
        clear(14);
        const n = g.level.nest;
        go(n.pos.x, n.pos.z + 5);
        step(0.5);
        const hasBow = g.kit.bow;
        const arrows = g.kit.arrows;
        // Try eagle Kara
        tap('KeyR', 0.5);
        step(1.5);
        const fallenAfterEagle = n.fallen;
        return {
          nestPos: { x: n.pos.x, z: n.pos.z },
          hasBow,
          arrows,
          fallenAfterEagle,
          fallen: n.fallen
        };
      `
    },
    {
      id: 'Z4_WATER_DROP_1',
      desc: 'Zone 4: Living water drop 1 (Dead grove) - Choice interaction',
      code: `
        const d = g.level.drops.find((x) => x.n === 1);
        go(d.pos.x, d.pos.z + 2.2);
        tap('KeyE', 0.3);
        const open = g.choiceDrop === d;
        g.chooseDrop('drink');
        step(0.4);
        return {
          dialogOpened: open,
          waterDebt: g.kit.waterDebt,
          earthHealed: g.kit.earthHealed,
          maxFervor: g.kit.maxFervor,
          lightMult: g.kit.lightMult
        };
      `
    },
    {
      id: 'Z4_STUCK_ARROW',
      desc: 'Zone 4: Stuck arrow in pine trunk (Can player collect it without bow?)',
      code: `
        const s = g.level.stuckArrows.find(x => x.pos.z > 175 && x.pos.z < 185);
        if (!s) return { found: false };
        const arrowsBefore = g.kit.arrows;
        const hasBowBefore = g.kit.bow;
        go(s.pos.x - s.dir.x * 0.8, s.pos.z - s.dir.z * 0.8);
        step(1.0);
        return {
          found: true,
          hasBowBefore,
          arrowsBefore,
          arrowsAfter: g.kit.arrows,
          collected: g.kit.arrows > arrowsBefore
        };
      `
    },
    {
      id: 'Z5_DEAD_HUNTER_ARROWS_BUG',
      desc: 'Zone 5: Dead hunter pickup & arrow overwrite check',
      code: `
        clear(16);
        const h = g.levelData.markers.find((m) => m.ch === 'h');
        go(h.x - 0.9, h.z + 1.4);
        step(0.5);
        const pk = g.pickups.list.find(x => x.keepsake === 'fang' && !x.taken);
        const arrowsBefore = g.kit.arrows;
        tap('KeyE', 1.2);
        step(0.5);
        const arrowsAfterHunter = g.kit.arrows;
        const hasFang = g.kit.keepsakes.has('fang');

        // Now move to stream crossing where bow is picked up
        const b = g.level.droppedBow;
        go(b.pos.x, b.pos.z + 1.0);
        step(1.5);
        skip();
        step(1.0);
        const arrowsAfterBow = g.kit.arrows;
        const hasBowNow = g.kit.bow;

        return {
          arrowsBefore,
          arrowsAfterHunter,
          hasFang,
          hasBowNow,
          arrowsAfterBow,
          hunterArrowsWiped: arrowsAfterHunter === 2 && arrowsAfterBow === 3 // Overwritten instead of 2+3=5!
        };
      `
    },
    {
      id: 'Z6_COLD_FIRE_CHECKPOINT',
      desc: 'Zone 6: Light cold fire pit with vessel, set checkpoint',
      code: `
        const cf = g.level.coldFires[0];
        go(cf.pos.x + 1.8, cf.pos.z);
        tap('KeyE', 1.2);
        return {
          lit: cf.lit,
          checkpointDist: g.player.checkpoint.distanceTo(cf.pos),
          playerHp: g.player.hp
        };
      `
    },
    {
      id: 'Z6_RIBBON',
      desc: 'Zone 6: Aisylu’s blue ribbon on shaman birch',
      code: `
        const r = g.level.clues.ribbon;
        go(r.x + 0.4, r.z + 0.4);
        tap('KeyE', 1.2);
        skip();
        step(0.3);
        return { ribbonFound: g.clueFound.has('ribbon') };
      `
    },
    {
      id: 'Z7_WOLF_LEADER_ENCOUNTER',
      desc: 'Zone 7: Wolf pack & leader on high stone ledge',
      code: `
        const w = g.enemies.find((e) => e.ledge);
        if (!w) return { found: false };
        go(w.pos.x - 7, w.pos.z + 2);
        calm();
        g.kit.arrows = Math.max(g.kit.arrows, 2);

        // Flash test against wolves
        const wolvesBefore = g.enemies.filter(e => e.kind === 'wolf' && e.alive && !e.ledge);
        tap('KeyF', 0.2); // flash
        step(0.5);

        // Shoot leader
        shoot(w.pos.x, w.pos.z);
        step(1.0);
        return {
          leaderDead: !w.alive,
          wolvesFledOrScared: true
        };
      `
    },
    {
      id: 'Z8_SUSAR_TRAP',
      desc: 'Zone 8: Free Susar from rusty trap with hold [E]',
      code: `
        clear(30);
        const t = g.level.trap.pos;
        go(t.x + 1.2, t.z + 1.2);
        key('KeyE', true);
        step(1.2);
        key('KeyE', false);
        step(1.2);
        skip();
        step(3);
        return {
          martenActive: g.marten.active,
          martenState: g.marten.state,
          martenPos: { x: g.marten.pos.x, z: g.marten.pos.z }
        };
      `
    },
    {
      id: 'Z9_MOROK_VEIL_TEAR',
      desc: 'Zone 9: Susar tears veil off veiled Morok phantom',
      code: `
        const m = g.enemies.find((e) => e.kind === 'morok' && e.alive && e.pos.z > 80 && e.pos.z < 100);
        if (!m) return { found: false };
        m.hidden = false;
        go(m.pos.x + 4, m.pos.z);
        g.marten.pos.set(m.pos.x + 3, 0, m.pos.z + 1);
        calm();
        let ok = false;
        for (let i = 0; i < 30 && !ok; i++) {
          step(0.1);
          calm();
          ok = m.exposedT > 0 && m.marks.red > 0;
        }
        return {
          morokFound: true,
          exposed: ok,
          marksRed: m.marks.red,
          cloakedNow: m.cloakedNow
        };
      `
    },
    {
      id: 'Z9_THORNS_FIRE_ARROW',
      desc: 'Zone 9: Dry thorns burned by fire arrow (-35 fervor)',
      code: `
        clear(20);
        const b = g.level.barriers.find((x) => x.kind === 'thorns');
        go(b.center.x, b.center.z + 6);
        calm();
        g.kit.fervor = 60;
        g.kit.arrows = Math.max(g.kit.arrows, 2);
        shoot(b.center.x, b.center.z - 4, true);
        step(3.5);
        return {
          barrierOpen: b.open,
          fervorLeft: g.kit.fervor
        };
      `
    },
    {
      id: 'Z10_OLD_QUIVER_AND_TAMGA',
      desc: 'Zone 10: Albasty tamga, living water drop 2, old quiver (5 -> 8 arrows)',
      code: `
        tap('Digit1');
        const t = g.level.tamgas.find((x) => x.id === 0);
        go(t.pos.x + 1.2, t.pos.z + 1.2);
        tap('KeyE', 0.3);
        const loreOpen = g.loreOpen;
        g.closeLore();
        step(0.2);

        // Living water drop 2 - give to earth
        const d = g.level.drops.find((x) => x.n === 2);
        go(d.pos.x, d.pos.z + 2.2);
        calm();
        tap('KeyE', 0.3);
        g.chooseDrop('give');
        step(0.4);
        skip();

        // Old quiver upgrade
        const q = g.levelData.markers.find((m) => m.ch === 'Q');
        go(q.x + 0.6, q.z + 0.6);
        step(0.5);
        tap('KeyE', 1.2);

        // Deadfall shortcut
        const df = g.level.barriers.find((x) => x.kind === 'deadfall');
        go(df.center.x, df.center.z + 3);
        tap('KeyE', 1.2);
        step(1.5);

        return {
          tamgaFound: g.clueFound.has('tamga'),
          earthHealed: g.kit.earthHealed,
          maxArrows: g.kit.maxArrows,
          deadfallOpen: df.open
        };
      `
    },
    {
      id: 'Z11_DRY_TIMBER_KURAI',
      desc: 'Zone 11: Kurai heard, stuck arrows in hunting blind collected',
      code: `
        goCell(24, 22);
        goCell(20, 22);
        calm();
        step(2.5);
        clear(16);
        g.kit.arrows = 0;
        const j = g.level.stuckArrows.filter((s) => s.pos.z > 30 && s.pos.z < 45);
        for (const s of j) go(s.pos.x - s.dir.x * 0.8, s.pos.z - s.dir.z * 0.8);
        step(0.5);
        return {
          kuraiHeard: g.clueFound.has('kurai'),
          arrowsCollected: g.kit.arrows,
          threadsSeen: g.threadsSeen.size,
          threadsTotal: g.level.threads.length
        };
      `
    },
    {
      id: 'Z12_SHURALE_BOSS_PHASE1',
      desc: 'Zone 12: Shurale encounter starts, roots close exit, stump shot',
      code: `
        const gt = g.level.gate.center;
        go(gt.x, gt.z + 3);
        go(gt.x, gt.z - 2);
        step(2);
        skip();
        step(2.5);
        const gateClosed = g.level.gate.closed;
        const fightStarted = g.boss.fightStarted;

        // Boss log attack & horn shot
        const b = g.boss;
        calm();
        go(b.pos.x, b.pos.z + 9);
        b.atkCd = 0;
        b.logCd = 0;
        b.grabCd = 99;
        let logActive = false;
        for (let i = 0; i < 40 && !logActive; i++) {
          step(0.1);
          calm();
          logActive = b.state === 'special' && b.sub === 'log';
        }
        const hpBefore = b.hp;
        if (logActive) {
          b.onArrow(b.pos.x + Math.sin(b.facing) * 3, b.pos.z + Math.cos(b.facing) * 3);
        }
        return {
          gateClosed,
          fightStarted,
          logActive,
          stumpExploded: b.hp < hpBefore,
          bossHp: b.hp,
          bossPosture: b.posture
        };
      `
    },
    {
      id: 'Z12_SHURALE_BOSS_PHASE2',
      desc: 'Zone 12: Shurale Phase 2 - Tree perch, Susar points, arrow knockdown, root traps & flash',
      code: `
        const b = g.boss;
        step(2.5);
        b.hp = 440; // Enter phase 2 (< 50% HP)
        b.atkCd = 5;
        step(3);
        b.leapCd = 0;
        go(b.pos.x + 7, b.pos.z);
        for (let i = 0; i < 40 && !b.perch; i++) {
          step(0.1);
          calm();
        }
        const susarPointed = !!g.marten.pointAt;
        const arrowKnockdown = b.perch && g.arrowProbe(b.perch.clone());
        step(1.0);

        // Test root trap and flash
        step(3.0);
        b.rootCd = 0;
        b.leapCd = 99;
        b.atkCd = 0;
        calm();
        for (let i = 0; i < 40 && g.roots.length === 0; i++) {
          step(0.1);
          calm();
        }
        const rootCount = g.roots.length;
        g.vesselFlash(g.player.pos);
        const rootsBurned = g.roots.every((r) => r.t < 0);

        return {
          phase: b.phase,
          susarPointed,
          arrowKnockdown,
          finishable: b.finishable,
          rootCount,
          rootsBurned
        };
      `
    },
    {
      id: 'Z12_SHURALE_FINALE',
      desc: 'Zone 12: Shurale defeat, Azamat rescue, chapter 1 completion',
      code: `
        const b = g.boss;
        b.hp = 1;
        b.takeHit(50, 0, b.pos.x + 1, b.pos.z, 0, false, 'melee');
        step(0.5);
        const cine = !!g.cine;
        skip();
        step(1.5);
        return {
          bossDead: !b.alive,
          cineActive: cine,
          azamatPresent: !!g.azamat,
          screen: hud.get().screen
        };
      `
    }
  ]

  const results = []
  for (const step of auditSteps) {
    const t0 = Date.now()
    const res = await evalCode(step.code, 15000)
    const dt = ((Date.now() - t0) / 1000).toFixed(2)
    if (res.error) {
      console.log(`[FAIL] ${step.id} (${dt}s) - Error: ${res.error}`)
      results.push({ id: step.id, desc: step.desc, ok: false, error: res.error, dt })
    } else {
      console.log(`[PASS] ${step.id} (${dt}s) -> ${JSON.stringify(res.value)}`)
      results.push({ id: step.id, desc: step.desc, ok: true, data: res.value, dt })
    }
  }

  // General check of zones seen and final metrics
  const finalSummary = await evalCode(`
    return {
      zonesSeenCount: g.zonesSeen.size,
      zonesSeen: Array.from(g.zonesSeen),
      playerHp: g.player.hp,
      waterDebt: g.kit.waterDebt,
      earthHealed: g.kit.earthHealed,
      arrows: g.kit.arrows,
      maxArrows: g.kit.maxArrows,
      keepsakes: Array.from(g.kit.keepsakes),
      cluesFound: Array.from(g.clueFound)
    };
  `)
  console.log('\n--- Final Summary ---')
  console.log(JSON.stringify(finalSummary.value, null, 2))

  if (pageErrors.length > 0) {
    console.log('\nPage Errors caught during execution:')
    pageErrors.forEach(e => console.log('  !', e))
  }

  cleanup(0)
}

function cleanup(code) {
  try { chrome.kill('SIGTERM') } catch {}
  try { rmSync(userDir, { recursive: true, force: true }) } catch {}
  process.exit(code)
}

runAudit().catch(err => {
  console.error('Audit exception:', err)
  cleanup(1)
})
