import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadMarten, type MartenBody, type MartenPose } from '../game/actors/martenRig'
import { WolfRig } from '../game/actors/wolfRig'
import { WOLF_CLIPS } from '../game/actors/models'
import type { Clip } from '../game/actors/rig'

/** the companion's poses as the game drives them: [pose, speed m/s, turn rad/s] */
const MARTEN_POSES: Record<string, [MartenPose, number, number]> = {
  'в капкане': ['trapped', 0, 0],
  сидит: ['sit', 0, 0],
  стойка: ['alert', 0, 0],
  нюхает: ['sniff', 0, 0],
  затаилась: ['crouch', 0, 0],
  стоит: ['stand', 0, 0],
  шаг: ['stand', 1.3, 0],
  рысь: ['stand', 3, 0],
  галоп: ['stand', 6.5, 0],
  поворот: ['stand', 4, 1.6],
  клубок: ['curl', 0, 0],
  свернуться: ['curl', 0, 0],
  развернуться: ['stand', 0, 0],
  'поворот вправо': ['stand', 4, -1.6],
}

const WOLF_POSES = ['стоит', 'шаг', 'галоп', 'поворот влево', 'поворот вправо', 'атака', 'ранение', 'оглушение', 'испуг', 'смерть']

/**
 * Asset check at /#viewer (the hero) or /#viewer=<name> (public/models/<name>.glb): even studio light,
 * turntable, outfits and clips when the file has them.
 * For reviewing new Mixamo/Hunyuan deliveries before they go into the game (docs/EQUIPMENT.md).
 */
export function ModelViewer({ src = 'hero_rig' }: { src?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ setOutfit: (o: string | null) => void; play: (c: string) => void } | null>(null)
  const skeletonToggle = useRef<(() => void) | null>(null)
  const cameraView = useRef<((view: 'angle' | 'top' | 'side') => void) | null>(null)
  const [outfits, setOutfits] = useState<string[]>([])
  const [clips, setClips] = useState<string[]>([])
  const [outfit, setOutfit] = useState<string | null>(null)
  const [clip, setClip] = useState('idle')
  const [info, setInfo] = useState('Загрузка…')

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x3a3d42)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100)
    camera.position.set(0, 1.3, 5.2)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.95, 0)
    controls.enableDamping = true
    const isMarten = src === 'marten' || src === 'marten_v2'
    if (isMarten) {
      camera.position.set(1.7, 0.9, 1.9)
      controls.target.set(0, 0.20, 0)
      cameraView.current = (view) => {
        if (view === 'top') camera.position.set(0, 2.2, 0.001)
        else if (view === 'side') camera.position.set(2, 0.45, 0)
        else camera.position.set(1.7, 0.9, 1.9)
        controls.target.set(0, 0.20, 0)
        controls.update()
      }
    }
    if (src === 'wolf_rig' || src === 'wolf_game') {
      camera.position.set(2.9, 1.5, 3.1)
      controls.target.set(0, 0.45, 0)
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50463c, 1.6))
    const key = new THREE.DirectionalLight(0xfff2e0, 2.2)
    key.position.set(2, 3, 4)
    const rim = new THREE.DirectionalLight(0xb8c8ff, 1.2)
    rim.position.set(-3, 2, -3)
    scene.add(key, rim)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2d31 }))
    scene.add(floor)

    // the marten on her own skeleton, with the same animator as in the game
    let marten: { body: MartenBody | null; pose: string; helper: THREE.SkeletonHelper | null } | null = null
    let wolf: { rig: WolfRig; pose: string; elapsed: number; helper: THREE.SkeletonHelper | null } | null = null
    if (src === 'wolf_game') {
      const preview = { rig: new WolfRig(), pose: 'стоит', elapsed: 0, helper: null as THREE.SkeletonHelper | null }
      wolf = preview
      scene.add(preview.rig.root)
      void preview.rig.ready.then((loaded) => {
        if (disposed) return
        if (!loaded) { setInfo('Не удалось загрузить модель волка'); return }
        let triangles = 0
        let bones = 0
        preview.rig.root.traverse((object) => {
          const mesh = object as THREE.SkinnedMesh
          if (!mesh.isSkinnedMesh) return
          triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3
          bones = Math.max(bones, mesh.skeleton.bones.length)
        })
        setInfo(`Игровые движения. Треугольники — ${triangles}, кости — ${bones}`)
        setClips(WOLF_POSES)
        setClip('стоит')
      })
      api.current = {
        setOutfit: () => {},
        play: (pose) => { preview.pose = pose; preview.elapsed = 0; preview.rig.root.rotation.y = 0 },
      }
      skeletonToggle.current = () => {
        if (preview.helper) { scene.remove(preview.helper); preview.helper = null }
        else { preview.helper = new THREE.SkeletonHelper(preview.rig.root); scene.add(preview.helper) }
      }
    }
    if (isMarten) {
      marten = { body: null, pose: 'стоит', helper: null }
      const m = marten
      loadMarten('/models/marten.glb').then((b) => {
        if (disposed) return
        m.body = b
        scene.add(b.root)
        const g = b.mesh.geometry
        setInfo(`Треугольники — ${Math.round((g.index ? g.index.count : g.attributes.position.count) / 3)}, кости — ${b.bones.length}`)
        setClips(Object.keys(MARTEN_POSES))
        setClip('стоит')
      }).catch(() => { if (!disposed) setInfo('Не удалось загрузить куницу') })
      api.current = {
        setOutfit: () => {},
        play: (c) => {
          m.pose = c
          if (m.body) {
            const a = m.body.animator
            if (c === 'свернуться') a.snap('stand')
            if (c === 'развернуться' || c === 'клубок') a.snap('curl')
          }
        },
      }
      skeletonToggle.current = () => {
        if (!m.body) return
        if (m.helper) {
          scene.remove(m.helper)
          m.helper = null
        } else {
          m.helper = new THREE.SkeletonHelper(m.body.root)
          scene.add(m.helper)
        }
      }
    }
    let mixer: THREE.AnimationMixer | null = null
    const actions: Record<string, THREE.AnimationAction> = {}
    const parts: Record<string, THREE.Object3D> = {}
    let raf = 0
    let disposed = false
    if (!isMarten && src !== 'wolf_game') new GLTFLoader().load(`/models/${src}.glb`, (gltf) => {
      if (disposed) return
      const root = gltf.scene
      if (src === 'wolf_rig') { root.rotation.y = Math.PI / 2; root.updateMatrixWorld(true) }
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          parts[o.name || 'mesh'] = o
          o.frustumCulled = false
        }
      })
      const bb = new THREE.Box3()
      for (const [n, m] of Object.entries(parts)) if (!n.startsWith('outfit_')) bb.expandByObject(m)
      // Humanoids use their gameplay height; other assets are shown about a metre long.
      const size = bb.getSize(new THREE.Vector3())
      const k = src === 'hero_rig' ? 1.82 / size.y : src === 'ubyr_rig' ? 1.95 / size.y : src === 'wolf_rig' ? 0.95 / size.y : 1.2 / Math.max(size.x, size.z)
      root.position.x = -((bb.min.x + bb.max.x) / 2) * k
      root.position.z = -((bb.min.z + bb.max.z) / 2) * k
      root.scale.multiplyScalar(k)
      root.position.y = -bb.min.y * k
      scene.add(root)
      mixer = new THREE.AnimationMixer(root)
      for (const c of gltf.animations) {
        // as in the game: no root motion, the clip plays on the spot
        for (const tr of c.tracks)
          if (/Hips\.position$/.test(tr.name))
            for (let i = 0; i < tr.values.length; i += 3) {
              tr.values[i] = tr.values[0]
              tr.values[i + 2] = tr.values[2]
            }
        actions[c.name] = mixer.clipAction(c)
      }
      const tris = Object.entries(parts).map(([n, m]) => {
        const g = (m as THREE.Mesh).geometry
        return `${n}: ${Math.round((g.index ? g.index.count : g.attributes.position.count) / 3)}`
      })
      setInfo(`Треугольники — ${tris.join(', ')}`)
      api.current = {
        setOutfit: (o) => {
          if (!parts.base_body) return
          for (const [n, m] of Object.entries(parts)) m.visible = n === 'base_head' || (n === 'base_body' ? !o : n === 'outfit_' + o)
        },
        play: (c) => {
          for (const a of Object.values(actions)) a.stop()
          actions[c]?.reset().play()
        },
      }
      const outs = Object.keys(parts).filter((n) => n.startsWith('outfit_')).map((n) => n.slice(7))
      setOutfits(outs)
      setClips(gltf.animations.map((c) => c.name))
      setClip(gltf.animations.some((c) => c.name === 'idle') ? 'idle' : gltf.animations[0]?.name ?? '')
      setOutfit(outs[0] ?? null)
    })
    const clock = new THREE.Clock()
    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, clock.getDelta())
      mixer?.update(dt)
      if (marten?.body) {
        const [pose, speed, turn] = MARTEN_POSES[marten.pose] ?? ['stand', 0, 0]
        const r = marten.body.root
        r.rotation.y += turn * dt
        // walking in place: the camera stays on her
        marten.body.animator.update(dt, { speed, turnRate: turn, pose, look: null, time: clock.elapsedTime, warn: false })
      }
      if (wolf) {
        wolf.elapsed += dt
        let action: Clip | null = null
        let t = 0
        const turn = wolf.pose === 'поворот влево' ? 1.8 : wolf.pose === 'поворот вправо' ? -1.8 : 0
        const speed = wolf.pose === 'шаг' ? 1.5 : wolf.pose === 'галоп' || turn ? 6.5 : 0
        wolf.rig.root.rotation.y += turn * dt
        if (wolf.pose === 'атака') {
          const n = (wolf.elapsed % 2.1) / 1.2
          if (n <= 0.38) { action = WOLF_CLIPS.crouch; t = n / 0.38 }
          else if (n <= 1) { action = WOLF_CLIPS.leap; t = (n - 0.38) / 0.62 }
        } else if (wolf.pose === 'ранение') {
          t = (wolf.elapsed % 1.2) / 0.32
          if (t <= 1) action = WOLF_CLIPS.hurt
        } else if (wolf.pose === 'оглушение') {
          action = WOLF_CLIPS.stagger; t = 1
        } else if (wolf.pose === 'смерть') {
          action = WOLF_CLIPS.death; t = Math.min(wolf.elapsed, 1)
        }
        const fear = wolf.pose === 'испуг' || wolf.pose === 'оглушение' || (wolf.pose === 'ранение' && action === WOLF_CLIPS.hurt) ? 1 : 0
        wolf.rig.update(dt, { speed, clip: action, t, time: clock.elapsedTime, fear })
      }
      controls.update()
      renderer.render(scene, camera)
    }
    loop()
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [src])

  useEffect(() => {
    api.current?.setOutfit(outfit)
  }, [outfit, outfits])
  useEffect(() => {
    api.current?.play(clip)
  }, [clip, clips])
  useEffect(() => {
    if (src === 'marten') setInfo('Загрузка…')
  }, [src])

  const btn = (on: boolean) => `rounded px-3 py-1.5 font-ui text-[15px] transition-colors ${on ? 'bg-amber text-black' : 'bg-white/10 text-bone hover:bg-white/20'}`
  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
      <div className="absolute left-5 top-5 flex max-w-[520px] flex-col gap-3 text-bone">
        <div className="font-display text-[32px] leading-none">Просмотр: {src}</div>
        {(outfits.length > 0 || src === 'hero_rig') && <div className="flex flex-wrap gap-2">
          <button className={btn(outfit === null)} onClick={() => setOutfit(null)}>Рубаха</button>
          {outfits.map((o) => (
            <button key={o} className={btn(outfit === o)} onClick={() => setOutfit(o)}>{o}</button>
          ))}
        </div>}
        <div className="flex flex-wrap gap-2">
          {clips.map((c) => (
            <button key={c} className={btn(clip === c)} onClick={() => setClip(c)}>{c}</button>
          ))}
        </div>
        {(src === 'marten' || src === 'marten_v2' || src === 'wolf_game') && (
          <div>
            <button className={btn(false)} onClick={() => skeletonToggle.current?.()}>скелет</button>
          </div>
        )}
        {(src === 'marten' || src === 'marten_v2') && <div className="flex gap-2">
          <button className={btn(false)} onClick={() => cameraView.current?.('angle')}>¾</button>
          <button className={btn(false)} onClick={() => cameraView.current?.('top')}>сверху</button>
          <button className={btn(false)} onClick={() => cameraView.current?.('side')}>сбоку</button>
        </div>}
        <div className="font-ui text-[13px] text-bone/60">{info}. Мышь — вращать, колесо — приблизить.</div>
      </div>
    </div>
  )
}
