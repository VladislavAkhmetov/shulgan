import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EAGLE_DEMOS, sampleEagleDemo, type EagleDemoMode, type Point3 } from './eagleDemoMotion'

type View = 'game' | 'close' | 'side' | 'top'
type Settings = { mode: EagleDemoMode; paused: boolean; speed: number; skeleton: boolean; path: boolean; repeat: boolean; target: number; view: View }
type Api = { choose: (mode: EagleDemoMode) => void; seek: (time: number) => void; restart: () => void; view: (view: View) => void; target: () => void }
const TARGETS: Point3[] = [[2.6, 0, 1.2], [-3.4, 0, -2.2], [4.6, 0, -3.4]]

export function EagleViewer() {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const settings = useRef<Settings>({ mode: 'game', paused: false, speed: 1, skeleton: false, path: true, repeat: true, target: 0, view: 'game' })
  const [mode, setMode] = useState<EagleDemoMode>('game')
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [skeleton, setSkeleton] = useState(false)
  const [path, setPath] = useState(true)
  const [repeat, setRepeat] = useState(true)
  const [view, setView] = useState<View>('game')
  const [target, setTarget] = useState(0)
  const [time, setTime] = useState(0)
  const [phase, setPhase] = useState('Загрузка модели')
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Загрузка беркута…')
  const demo = EAGLE_DEMOS.find((d) => d.id === mode)!

  function choose(id: EagleDemoMode) {
    settings.current.mode = id; settings.current.paused = false
    setMode(id); setPaused(false); api.current?.choose(id)
  }
  function togglePause() { settings.current.paused = !settings.current.paused; setPaused(settings.current.paused) }
  function changeView(next: View) { settings.current.view = next; setView(next); api.current?.view(next) }
  function changeTarget(index: number) { settings.current.target = index; setTarget(index); api.current?.target() }

  useEffect(() => {
    const el = host.current!
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#111d2a'); scene.fog = new THREE.Fog('#111d2a', 37, 75)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    const camera = new THREE.PerspectiveCamera(32, 1, .05, 120)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.minDistance = .7; controls.maxDistance = 65
    const followOffset = new THREE.Vector3(3, 2, 4), followTarget = new THREE.Vector3(), followDelta = new THREE.Vector3()
    let model: THREE.Group | null = null
    function cameraView(next: View) {
      if (next === 'game') { camera.position.set(17, 31, 17); controls.target.set(0, 4, 0) }
      else {
        if (next === 'close') followOffset.set(2.7, 1.3, 3.5)
        else if (next === 'side') followOffset.set(4, .45, .01)
        else followOffset.set(0, 5.2, .001)
        if (model) followTarget.copy(model.position); else followTarget.set(0, 2, 0)
        controls.target.copy(followTarget); camera.position.copy(followTarget).add(followOffset)
      }
      controls.update()
    }
    scene.add(new THREE.HemisphereLight(0xb5cee5, 0x3e3524, 2))
    const key = new THREE.DirectionalLight(0xffe0af, 3.2)
    key.position.set(6, 16, 10); key.castShadow = true; key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, far: 55 })
    key.shadow.bias = -.0002; scene.add(key)
    const rim = new THREE.DirectionalLight(0x9ebdff, 2); rim.position.set(-8, 10, -6); scene.add(rim)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(28, 80), new THREE.MeshStandardMaterial({ color: 0x27382f, roughness: 1 }))
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
    const grid = new THREE.GridHelper(32, 32, 0x5b6557, 0x39483e); grid.position.y = .005
    const gridMat = grid.material as THREE.LineBasicMaterial; gridMat.transparent = true; gridMat.opacity = .22; scene.add(grid)
    const bark = new THREE.MeshStandardMaterial({ color: 0x322c29, roughness: 1 })
    const needles = new THREE.MeshStandardMaterial({ color: 0x172b2a, roughness: 1 })
    const stone = new THREE.MeshStandardMaterial({ color: 0x47504c, roughness: 1 })
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996, radius = 13 + (i % 4) * 1.2
      const tree = new THREE.Group(); tree.position.set(Math.sin(a) * radius, 0, Math.cos(a) * radius)
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .22, 5 + i % 3, 7), bark); trunk.position.y = 2.5; tree.add(trunk)
      for (let j = 0; j < 3; j++) {
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.6 - j * .3, 3.3, 7), needles)
        crown.position.y = 3.5 + j * 1.3 + i % 3; tree.add(crown)
      }
      scene.add(tree)
      if (i % 3 === 0) {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(.7, 0), stone)
        rock.position.set(tree.position.x * .72, .35, tree.position.z * .72); rock.scale.set(1.4, .7, 1); scene.add(rock)
      }
    }
    const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(6, .018, 6, 100), new THREE.MeshBasicMaterial({ color: 0x8f9268, transparent: true, opacity: .35 }))
    orbitRing.rotation.x = Math.PI / 2; orbitRing.position.y = .02; scene.add(orbitRing)
    function person(material: THREE.MeshStandardMaterial, isHero = false) {
      const group = new THREE.Group()
      for (const [geometry, x, y, z] of [
        [new THREE.CapsuleGeometry(.24, .55, 5, 10), 0, 1, 0], [new THREE.SphereGeometry(.18, 12, 10), 0, 1.63, 0],
        [new THREE.CapsuleGeometry(.095, .55, 4, 8), -.13, .4, 0], [new THREE.CapsuleGeometry(.095, .55, 4, 8), .13, .4, 0],
      ] as [THREE.BufferGeometry, number, number, number][]) {
        const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh)
      }
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.08, .45, 4, 8), material)
      arm.position.set(-.36, 1.3, .1); arm.rotation.z = -.85; arm.castShadow = true; group.add(arm)
      const arm2 = arm.clone(); arm2.position.x = .35; arm2.rotation.z = .15; group.add(arm2)
      if (isHero) { const cloak = new THREE.Mesh(new THREE.ConeGeometry(.4, .95, 8), material); cloak.position.set(0, 1, -.12); group.add(cloak) }
      return group
    }
    scene.add(person(new THREE.MeshStandardMaterial({ color: 0x496e7c, roughness: .9 }), true))
    const targets = TARGETS.map((point, index) => {
      const material = new THREE.MeshStandardMaterial({ color: 0x80534b, roughness: .9 })
      const group = person(material); group.position.set(...point); scene.add(group)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.56, .035, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffc574, transparent: true, opacity: .8 }))
      ring.rotation.x = Math.PI / 2; ring.position.set(point[0], .03, point[2]); scene.add(ring)
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#d9d2c3'; ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`Мишень ${index + 1}`, 128, 29)
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }))
      label.scale.set(1.6, .4, 1); label.position.y = 2.25; group.add(label)
      const hp = new THREE.Mesh(new THREE.PlaneGeometry(.85, .055), new THREE.MeshBasicMaterial({ color: 0xd38f6f, side: THREE.DoubleSide }))
      hp.position.y = 2.04; group.add(hp)
      return { group, material, ring, hp }
    })
    const revealRing = new THREE.Mesh(new THREE.TorusGeometry(1, .025, 6, 100), new THREE.MeshBasicMaterial({ color: 0xffd18e, transparent: true, opacity: 0 }))
    revealRing.rotation.x = Math.PI / 2; revealRing.position.y = .05; scene.add(revealRing)
    const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xe7b776, dashSize: .16, gapSize: .13, transparent: true, opacity: .48 }))
    scene.add(pathLine)
    function updatePath() {
      const conf = EAGLE_DEMOS.find((d) => d.id === settings.current.mode)!
      const points = Array.from({ length: 121 }, (_, i) => new THREE.Vector3(...sampleEagleDemo(conf.id, i / 120 * conf.duration, TARGETS[settings.current.target]).position))
      pathLine.geometry.dispose(); pathLine.geometry = new THREE.BufferGeometry().setFromPoints(points); pathLine.computeLineDistances()
    }
    let disposed = false, raf = 0, playhead = 0, duration = 3.9, lastUi = 0
    let helper: THREE.SkeletonHelper | null = null, mixer: THREE.AnimationMixer | null = null
    let active: THREE.AnimationAction | null = null, previous: THREE.AnimationAction | null = null, fade = 1, snap = true
    const actions = new Map<string, THREE.AnimationAction>()
    const loops = new Set(['flight_flap', 'climb', 'soar', 'circle_left', 'circle_right'])
    function restart() { playhead = 0; snap = true; setTime(0) }
    api.current = {
      choose: (id) => { settings.current.mode = id; duration = EAGLE_DEMOS.find((d) => d.id === id)!.duration; restart(); updatePath() },
      restart, seek: (t) => { playhead = Math.max(0, Math.min(duration, t)); snap = true; setTime(playhead) }, view: cameraView,
      target: () => { restart(); updatePath() },
    }
    cameraView('game'); updatePath()
    function disposeModel(root: THREE.Object3D) {
      const textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.geometry) geometries.add(mesh.geometry)
        if (mesh.material) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(mat); for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value)
        }
      })
      geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose())
    }
    new GLTFLoader().load('/models/berkut_rig.glb', (gltf) => {
      if (disposed) { disposeModel(gltf.scene); return }
      model = gltf.scene
      let bones = 0, triangles = 0
      model.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh
        if (mesh.isSkinnedMesh) {
          bones = Math.max(bones, mesh.skeleton.bones.length); triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3
          mesh.frustumCulled = false; mesh.castShadow = true
        }
      })
      scene.add(model); helper = new THREE.SkeletonHelper(model)
      const mat = helper.material as THREE.LineBasicMaterial
      mat.depthTest = false; mat.transparent = true; mat.opacity = .8; helper.renderOrder = 10; scene.add(helper)
      mixer = new THREE.AnimationMixer(model)
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip))
      setStatus(`${bones} кости · ${Math.round(triangles).toLocaleString('ru-RU')} треугольников · ${gltf.animations.length} клипов`); setReady(true)
    }, undefined, () => { if (!disposed) setStatus('Не удалось загрузить беркута. Обновите просмотр.') })
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
    const onPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(targets.map((t) => t.group), true)[0]
      if (!hit) return
      const index = targets.findIndex((t) => t.group === hit.object || t.group.getObjectById(hit.object.id))
      if (index >= 0) { settings.current.target = index; setTarget(index); restart(); updatePath() }
    }
    renderer.domElement.addEventListener('pointerdown', onPointer)
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,select,textarea,button') || event.ctrlKey || event.metaKey || event.altKey) return
      const keys: Record<string, EagleDemoMode> = { KeyE: 'game', Digit1: 'flap', Digit2: 'soar', Digit3: 'circle_left', KeyQ: 'dive_attack', KeyF: 'sweep_attack', KeyG: 'grab_attack' }
      if (keys[event.code]) { event.preventDefault(); choose(keys[event.code]) }
      else if (event.code === 'Space') { event.preventDefault(); togglePause() }
      else if (event.code === 'KeyR') { event.preventDefault(); restart() }
    }
    window.addEventListener('keydown', onKey)
    const resize = () => { renderer.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix() }
    const observer = new ResizeObserver(resize); observer.observe(el); resize()
    const clock = new THREE.Clock()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(clock.getDelta(), .05), opts = settings.current
      if (model && mixer) {
        if (!opts.paused) {
          playhead += dt * opts.speed
          if (playhead > duration + (opts.repeat ? .55 : 0)) {
            if (opts.repeat) { playhead = 0; snap = true }
            else { playhead = duration; opts.paused = true; setPaused(true) }
          }
        }
        const t = Math.min(duration, playhead), motion = sampleEagleDemo(opts.mode, t, TARGETS[opts.target])
        const next = actions.get(motion.clip)!
        if (active !== next || snap) { previous = snap ? null : active; active = next; next.reset().play(); fade = snap ? 1 : 0 }
        if (!opts.paused) fade = Math.min(1, fade + dt * opts.speed / .1)
        actions.forEach((a) => { a.enabled = a === active || a === previous; a.setEffectiveWeight(0) })
        if (previous) previous.setEffectiveWeight(1 - fade)
        active.setEffectiveWeight(previous ? fade : 1)
        const clipDuration = active.getClip().duration
        active.time = loops.has(motion.clip) ? motion.clipTime % clipDuration : Math.min(motion.clipTime, clipDuration - .00001)
        mixer.update(0); snap = false
        model.position.set(...motion.position); model.rotation.set(motion.pitch, motion.heading, 0, 'YXZ'); model.updateMatrixWorld(true)
        if (helper) helper.visible = opts.skeleton
        const hitAge = motion.contact === null ? -1 : t - motion.contact
        for (const [i, enemy] of targets.entries()) {
          const selected = i === opts.target, impact = selected && hitAge >= 0 && hitAge < .6 ? 1 - hitAge / .6 : 0
          enemy.group.position.set(...TARGETS[i])
          if (selected && opts.mode === 'grab_attack') {
            const offset = t < 3.1 ? motion.targetLift / 2.5 : 1
            enemy.group.position.x += offset * .7; enemy.group.position.z += offset * .5; enemy.group.position.y = motion.targetLift
          }
          enemy.group.rotation.z = impact * .15 * Math.sin(hitAge * 32)
          enemy.material.emissive.setHex(impact ? 0xff9f45 : motion.reveal ? 0xb37b35 : 0x000000); enemy.material.emissiveIntensity = impact ? impact * 2 : .28
          enemy.ring.visible = selected; enemy.ring.scale.setScalar(1 + impact * .6)
          enemy.hp.scale.x = selected && hitAge >= 0 ? .62 : 1; enemy.hp.quaternion.copy(camera.quaternion)
        }
        const revealAge = t - .7
        revealRing.visible = opts.mode === 'game' && revealAge >= 0 && revealAge < 1.2; revealRing.scale.setScalar(1 + Math.max(0, revealAge) / 1.2 * 23)
        ;(revealRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, .8 * (1 - revealAge / 1.2))
        if (opts.view !== 'game') {
          followTarget.lerp(model.position, 1 - Math.exp(-9 * dt)); followDelta.copy(followTarget).sub(controls.target)
          camera.position.add(followDelta); controls.target.copy(followTarget)
        }
        pathLine.visible = opts.path
        if (clock.elapsedTime - lastUi > .08) { setTime(t); setPhase(motion.phase); lastUi = clock.elapsedTime }
      }
      controls.update(); renderer.render(scene, camera)
    }
    loop()
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointer); window.removeEventListener('keydown', onKey)
      mixer?.stopAllAction(); if (model && mixer) mixer.uncacheRoot(model)
      controls.dispose(); disposeModel(scene); renderer.dispose(); el.removeChild(renderer.domElement); api.current = null
    }
  }, [])

  const button = (on: boolean) => `rounded-lg border px-3 py-2.5 text-left text-[13px] leading-tight transition disabled:opacity-35 ${on ? 'border-[#d8b575] bg-[#d8b575] text-[#15202b]' : 'border-white/10 bg-white/[.035] text-[#d9d2c3] hover:border-white/30 hover:bg-white/10'}`
  return <div className="flex h-full w-full flex-col overflow-hidden bg-[#101a25] text-[#d9d2c3] md:flex-row">
    <aside className="order-2 max-h-[44%] shrink-0 overflow-y-auto border-t border-white/10 bg-[#111c28] p-4 md:order-1 md:max-h-none md:w-[284px] md:border-r md:border-t-0">
      <p className="text-[10px] uppercase tracking-[.23em] text-[#d8b575]">Аманат · полигон спутника</p>
      <h1 className="mt-1 text-3xl">Ҡара / Беркут</h1>
      <a href="/" className="mt-3 inline-block rounded-lg border border-[#d8b575]/30 px-3 py-2 text-xs text-[#d8b575] hover:bg-white/10">Перейти в игру →</a>
      <p className="mt-2 text-xs leading-relaxed text-white/45">Полетать, выбрать цель и сравнить атаки.</p>
      {([['flight', 'Полёт'], ['attack', 'Варианты атаки'], ['detail', 'Рассмотреть движения']] as const).map(([group, title]) => <section key={group} className="mt-4">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-white/35">{title}</h2>
        <div className="grid grid-cols-2 gap-2">{EAGLE_DEMOS.filter((d) => d.group === group).map((d) => <button key={d.id} disabled={!ready} aria-pressed={mode === d.id} className={`${button(mode === d.id)} ${d.id === 'game' ? 'col-span-2' : ''}`} onClick={() => choose(d.id)}>{d.label}</button>)}</div>
      </section>)}
      <p className="mt-3 text-xs leading-relaxed text-white/55">{demo.description}</p>
      <section className="mt-4">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-white/35">Цель атаки</h2>
        <div className="grid grid-cols-3 gap-2">{TARGETS.map((_, i) => <button key={i} className={button(target === i)} aria-pressed={target === i} onClick={() => changeTarget(i)}>Цель {i + 1}</button>)}</div>
        <p className="mt-2 text-[11px] text-white/35">Или нажмите на мишень на поляне.</p>
      </section>
      <p className="mt-4 text-[10px] leading-relaxed text-white/25">{status}</p>
    </aside>
    <main className="relative order-1 min-h-[280px] min-w-0 flex-1 md:order-2">
      <div ref={host} className="absolute inset-0" />
      <div className="absolute left-4 right-4 top-4 flex flex-wrap items-start justify-between gap-3">
        <div className="rounded-lg border border-white/10 bg-[#101b27]/90 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[.18em] text-[#d8b575]">{ready ? 'Сейчас' : 'Подготовка'}</div>
          <div className="mt-1 text-base" role="status">{phase}</div>
          <div className="mt-1 text-[11px] text-white/40">{demo.label} · цель {target + 1}</div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-[#101b27]/90 p-1">{([['game', 'Как в игре'], ['close', 'Крупно'], ['side', 'Сбоку'], ['top', 'Сверху']] as [View, string][]).map(([id, label]) => <button key={id} className={`rounded px-3 py-2 text-xs ${view === id ? 'bg-white/15 text-[#f0d09a]' : 'text-white/50 hover:text-white'}`} aria-pressed={view === id} onClick={() => changeView(id)}>{label}</button>)}</div>
      </div>
      {!ready && <div className="absolute inset-0 flex items-center justify-center bg-[#101a25]/65"><p className="rounded-lg bg-[#111c28] px-6 py-4 text-sm">{status}</p></div>}
      <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/10 bg-[#101b27]/95 p-3">
        <div className="flex items-center gap-3">
          <button disabled={!ready} className={button(false)} onClick={togglePause}>{paused ? '▶ Пуск' : 'Ⅱ Пауза'}</button>
          <button disabled={!ready} aria-label="Повторить с начала" title="С начала · R" className={button(false)} onClick={() => { api.current?.restart(); settings.current.paused = false; setPaused(false) }}>↺</button>
          <input disabled={!ready} aria-label="Время анимации" type="range" min="0" max={demo.duration} step=".01" value={Math.min(time, demo.duration)} onChange={(e) => { settings.current.paused = true; setPaused(true); api.current?.seek(Number(e.target.value)) }} className="min-w-10 flex-1 accent-[#d8b575]" />
          <span className="w-[78px] text-[11px] tabular-nums text-white/50">{time.toFixed(2)} / {demo.duration.toFixed(2)} с</span>
          <select aria-label="Скорость воспроизведения" value={speed} onChange={(e) => { const n = Number(e.target.value); settings.current.speed = n; setSpeed(n) }} className="rounded bg-[#293647] px-2 py-1.5 text-xs">{[.25, .5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pt-2 text-[11px] text-white/50">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={repeat} onChange={(e) => { settings.current.repeat = e.target.checked; setRepeat(e.target.checked) }} className="accent-[#d8b575]" />Повтор</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={skeleton} onChange={(e) => { settings.current.skeleton = e.target.checked; setSkeleton(e.target.checked) }} className="accent-[#d8b575]" />Скелет</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={path} onChange={(e) => { settings.current.path = e.target.checked; setPath(e.target.checked) }} className="accent-[#d8b575]" />Траектория</label>
          <span className="ml-auto hidden text-white/25 xl:block">E — вылет · Q / F / G — атаки · пробел — пауза · мышь — камера</span>
        </div>
      </div>
    </main>
  </div>
}
