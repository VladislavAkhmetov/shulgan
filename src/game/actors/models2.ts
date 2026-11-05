// Procedural bodies for chapters 2–3 (docs/ASSETS.md §3): the barrow guards, the grave shadows, Хыу инәһе, Shulgen, the
// Albasty, Aisylu, the Shadow of Arslan and the reflections in the black water. They share the humanoid rig and the clips of
// models.ts, so a GLB from the asset pipeline can replace any of them without touching the fighting code.

import * as THREE from 'three'
import { Humanoid, capsule, part, type Clip } from './rig'
import { HERO_CLIPS, MOROK_CLIPS } from './models'
import { glow, ornamentTexture, std } from '../render/materials'

function flashable(rig: { flashMats: THREE.MeshStandardMaterial[] }, color: THREE.ColorRepresentation, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) {
  const m = std(color, rough, extra)
  rig.flashMats.push(m)
  return m
}

/** a cold fresnel shell: bright edges, an almost empty body (spirits, armour of the ancestors, reflections) */
export function fresnelMat(color: THREE.Color, opts: { opacity?: number; depthTest?: boolean; power?: number; base?: number } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opts.opacity ?? 1 }, uTime: { value: 0 }, uPower: { value: opts.power ?? 2.2 }, uBase: { value: opts.base ?? 0.12 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uPower; uniform float uBase; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        float scan = 0.85 + 0.15 * sin(gl_FragCoord.y * 0.7 + uTime * 9.0);
        vec3 c = uColor * (uBase + f * 1.6) * scan;
        gl_FragColor = vec4(c * uOpacity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: opts.depthTest ?? true,
    side: THREE.FrontSide,
  })
}

// ======================================================================= the barrow guards

export interface GuardModel {
  rig: Humanoid
  /** the turquoise shell of the ancestors' armour: shown while it holds */
  shell: THREE.Object3D
  shellMat: THREE.ShaderMaterial
  /** the archer's bow or the guard's shield */
  gear: THREE.Object3D
}

/** a dead warrior of the barrows: rusted scale armour over rags, a pointed helmet, a round shield or a horn bow */
export function createGuard(archer: boolean): GuardModel {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(ref, 0x5a5e5a, 0.7)
  const mail = flashable(ref, 0x3a3631, 0.55, { metalness: 0.5 })
  const dark = flashable(ref, 0x15120f, 1)
  const rig = new Humanoid({ hipH: 0.98, thigh: 0.47, shin: 0.46, torso: 0.64, upperArm: 0.33, foreArm: 0.31, shoulderW: 0.5, hipW: 0.27, limbR: 0.068, headR: 0.125, skin, cloth: mail, dark, stride: 1.7, runSpeed: 4.5, hunch: 0.08 })
  rig.flashMats.push(...ref.flashMats)
  const J = rig.joints
  const rust = std(0x4a2e1c, 0.6, { metalness: 0.6 })
  // a skirt of scales, a pointed helmet with a mail aventail, a tattered cloak
  part(new THREE.CylinderGeometry(0.24, 0.36, 0.5, 10, 2, true).translate(0, -0.25, 0), mail, J.hips, 0, -0.02, 0)
  part(new THREE.ConeGeometry(0.15, 0.32, 8), rust, J.head, 0, 0.3, 0)
  part(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 8, 1, true), mail, J.head, 0, 0.08, 0)
  part(new THREE.SphereGeometry(0.21, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), rust, J.chest, 0, 0.24, 0).scale.set(1.3, 0.5, 1)
  const cloak = part(new THREE.PlaneGeometry(0.55, 0.95, 2, 4).translate(0, -0.47, 0), std(0x221c18, 1, { side: THREE.DoubleSide }), J.chest, 0, 0.32, -0.16)
  rig.addDangle(cloak, { k: 14, c: 2.2, amt: 0.05, grav: 1 })
  // grave eyes: two cold sparks under the helmet
  const eyeMat = glow(0.4, 1.8, 1.7)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(0.4, 1.8, 1.7)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.015, 6, 4), eyeMat, J.head, s * 0.045, 0.12, 0.11)
  let gear: THREE.Object3D
  if (archer) {
    const bow = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.62, 0), new THREE.Vector3(0.1, 0.32, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, -0.32, 0), new THREE.Vector3(0, -0.62, 0)]), 12, 0.018, 5), std(0x2a1a0e, 0.7))
    bow.position.set(0, -0.1, 0.04)
    J.haL.add(bow)
    gear = bow
  } else {
    const shield = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 4, 0, Math.PI * 2, 0, 0.62), std(0x2e2218, 0.85))
    shield.rotation.x = Math.PI / 2
    shield.position.set(0.08, -0.15, 0.1)
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), rust)
    boss.rotation.x = Math.PI / 2
    boss.position.set(0.08, -0.15, 0.22)
    J.elL.add(shield, boss)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.012), rust)
    blade.position.set(0, -0.55, 0.05)
    J.haR.add(blade)
    gear = shield
  }
  // the armour of the ancestors: a turquoise shell over the body (docs/COMPANION.md, «Зов курая»)
  const shellMat = fresnelMat(new THREE.Color(0.2, 1.1, 1.0), { opacity: 0.45, power: 3.2, base: 0.0 })
  const shell = new THREE.Group()
  part(capsule(0.33, 0.9, 10), shellMat, shell, 0, 1.05, 0).castShadow = false
  part(new THREE.SphereGeometry(0.19, 12, 8), shellMat, shell, 0, 1.75, 0).castShadow = false
  rig.body.add(shell)
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !shell.getObjectById(o.id)) o.castShadow = true
  })
  return { rig, shell, shellMat, gear }
}

export const GUARD_CLIPS: Record<string, Clip> = {
  slash: HERO_CLIPS.atk1,
  cleave: HERO_CLIPS.atk3,
  bash: HERO_CLIPS.thrust,
  shoot: HERO_CLIPS.bow,
  hurt: HERO_CLIPS.hurt,
  stagger: MOROK_CLIPS.stagger,
  death: HERO_CLIPS.death,
}

// ======================================================================= the grave shadows (chapter 3)

/** a grave shadow of Shulgan-Tash: a crooked black shape with long arms, smoke coming off it, two frost-white eyes */
export function createShade() {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(ref, 0x0b0c0f, 0.95)
  const rag = flashable(ref, 0x07080a, 1, { side: THREE.DoubleSide })
  const rig = new Humanoid({ hipH: 0.9, thigh: 0.44, shin: 0.44, torso: 0.62, upperArm: 0.46, foreArm: 0.46, shoulderW: 0.42, hipW: 0.22, limbR: 0.05, headR: 0.12, skin, cloth: rag, dark: skin, hunch: 0.45, armHang: 0.2, runSpeed: 6, stride: 2.1 })
  rig.flashMats.push(...ref.flashMats)
  const J = rig.joints
  for (let i = 0; i < 8; i++) {
    const len = 0.4 + Math.random() * 0.4
    const strip = part(new THREE.PlaneGeometry(0.12, len).translate(0, -len / 2, 0), rag, J.chest, (Math.random() - 0.5) * 0.4, 0.1, -0.1 + (Math.random() - 0.5) * 0.2)
    strip.rotation.y = Math.random() * Math.PI
    rig.addDangle(strip, { k: 10, c: 1.5, amt: 0.08, grav: 1 })
  }
  const eyeMat = glow(1.6, 1.9, 2.2)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(1.6, 1.9, 2.2)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.02, 6, 4), eyeMat, J.head, s * 0.045, 0.13, 0.1)
  // long frost-white claws
  for (const h of [J.haL, J.haR]) for (let i = 0; i < 3; i++) part(new THREE.ConeGeometry(0.012, 0.22, 4).rotateX(Math.PI).translate(0, -0.12, 0), std(0xa3c1d1, 0.4), h, (i - 1) * 0.03, -0.06, 0.02)
  rig.springScale = 0.8
  return rig
}

export const SHADE_CLIPS: Record<string, Clip> = {
  claw: MOROK_CLIPS.claw,
  leap: [
    { t: 0, p: { chest: [0.9, 0, 0], shL: [0.6, 0, 0.5], shR: [0.6, 0, -0.5], thL: [-1.0, 0, 0], knL: [1.7, 0, 0], thR: [-0.9, 0, 0], knR: [1.7, 0, 0] }, b: [-0.5, 0, 0.35] },
    { t: 0.4, p: { chest: [1.0, 0, 0], thL: [-1.1, 0, 0], knL: [1.9, 0, 0], thR: [-1.0, 0, 0], knR: [1.9, 0, 0] }, b: [-0.6, 0, 0.4] },
    { t: 0.55, p: { chest: [0.2, 0, 0], shL: [-2.6, 0, 0.5], shR: [-2.6, 0, -0.5], thL: [-0.4, 0, 0], knL: [0.6, 0, 0], thR: [0.5, 0, 0], knR: [0.4, 0, 0] }, b: [0.1, 0.3, 0.2] },
    { t: 1, p: { chest: [0.6, 0, 0], shL: [-1.2, 0, 0.3], shR: [-1.2, 0, -0.3] }, b: [-0.2, 0.2, 0.2] },
  ],
  hurt: MOROK_CLIPS.hurt,
  stagger: MOROK_CLIPS.stagger,
  death: MOROK_CLIPS.death,
}

// ======================================================================= Хыу инәһе, the mistress of the crossing

export interface SuModel {
  rig: Humanoid
  /** the golden comb in her hand: the only thing about her that does not lie */
  comb: THREE.Mesh
  combMat: THREE.MeshBasicMaterial
  column: THREE.Mesh
  columnMat: THREE.ShaderMaterial
  hair: THREE.Object3D[]
}

/** a tall pale maid of the black lakes, her lower body a churning column of water, wet blue-black hair to the ground */
export function createSuInahi(): SuModel {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(ref, 0xb8c4c8, 0.45)
  const dress = flashable(ref, 0x1a2a32, 0.4, { side: THREE.DoubleSide })
  const dark = flashable(ref, 0x0a1218, 0.5)
  const rig = new Humanoid({ hipH: 1.45, thigh: 0.55, shin: 0.55, torso: 0.78, upperArm: 0.46, foreArm: 0.44, shoulderW: 0.42, hipW: 0.24, limbR: 0.06, headR: 0.15, skin, cloth: dress, dark, armHang: 0.14, runSpeed: 4 })
  rig.flashMats.push(...ref.flashMats)
  const J = rig.joints
  // no legs: the body ends in water
  for (const n of ['thL', 'thR']) J[n].visible = false
  const columnMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec3 p = position; float a = uv.x * 6.2831 + uTime * 3.0 + p.y * 2.5; p.xz *= 1.0 + 0.08 * sin(a * 3.0);
        vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float s = 0.5 + 0.5 * sin(vUv.x * 40.0 + vUv.y * 12.0 - uTime * 6.0);
        vec3 c = vec3(0.02, 0.05, 0.07) + vec3(0.25, 0.55, 0.7) * (f * 0.9 + s * 0.12);
        gl_FragColor = vec4(c, 0.55 + f * 0.4); }`,
    transparent: true,
    depthWrite: false,
  })
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.9, 1.55, 18, 6, true).translate(0, -0.78, 0), columnMat)
  J.hips.add(column)
  part(new THREE.CylinderGeometry(0.2, 0.3, 0.5, 12, 2, true).translate(0, -0.2, 0), dress, J.hips, 0, 0.02, 0)
  // hair to the water: long blue-black wet strands that swing with every lash
  const hairMat = std(0x05080c, 0.35)
  const hair: THREE.Object3D[] = []
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2
    const front = Math.cos(a) > 0.6
    const len = front ? 0.6 : 1.4 + Math.random() * 0.6
    const strand = part(new THREE.CapsuleGeometry(0.025, len, 2, 4).translate(0, -len / 2, 0), hairMat, J.head, Math.sin(a) * 0.12, 0.16, Math.cos(a) * 0.12)
    rig.addDangle(strand, { k: 7 + Math.random() * 4, c: 1.4, amt: 0.07, grav: 1, limit: 1.3 })
    hair.push(strand)
  }
  // the big golden comb glowing in her right hand (docs/ASSETS.md, boss_su_inahi)
  const combMat = glow(2.4, 1.7, 0.5)
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.025), combMat)
  comb.position.set(0, -0.12, 0.06)
  for (let i = 0; i < 7; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.012), combMat)
    tooth.position.set(-0.09 + i * 0.03, -0.08, 0)
    comb.add(tooth)
  }
  J.haR.add(comb)
  const eyeMat = glow(0.6, 1.5, 1.8)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(0.6, 1.5, 1.8)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.018, 6, 4), eyeMat, J.head, s * 0.05, 0.16, 0.13)
  rig.springScale = 0.7
  return { rig, comb, combMat, column, columnMat, hair }
}

export const SU_CLIPS: Record<string, Clip> = {
  whip: [
    { t: 0, p: { shL: [-2.6, 0, 1.0], shR: [-2.6, 0, -1.0], elL: [-0.5, 0, 0], elR: [-0.5, 0, 0], chest: [-0.4, 0, 0], head: [-0.3, 0, 0] }, b: [0.1, -0.1, -0.15] },
    { t: 0.55, p: { shL: [-2.9, 0, 1.2], shR: [-2.9, 0, -1.2], chest: [-0.55, 0, 0], head: [-0.45, 0, 0] }, b: [0.18, -0.15, -0.2] },
    { t: 0.68, p: { shL: [-0.6, 0, -0.6], shR: [-0.6, 0, 0.6], elL: [0, 0, 0], elR: [0, 0, 0], chest: [0.7, 0, 0], head: [0.2, 0, 0] }, b: [-0.1, 0.3, 0.25] },
    { t: 1, p: { shL: [-0.4, 0, 0.3], shR: [-0.4, 0, -0.3], chest: [0.2, 0, 0] } },
  ],
  cast: MOROK_CLIPS.cast,
  slap: MOROK_CLIPS.claw,
  hurt: MOROK_CLIPS.hurt,
  stagger: MOROK_CLIPS.stagger,
  death: MOROK_CLIPS.death,
  frozen: [
    { t: 0, p: { shL: [-1.4, 0, 1.2], shR: [-1.4, 0, -1.2], elL: [-1.2, 0, 0], elR: [-1.2, 0, 0], chest: [-0.3, 0.3, 0], head: [-0.5, 0.3, 0] } },
    { t: 1, p: { shL: [-1.5, 0, 1.25], shR: [-1.45, 0, -1.2], elL: [-1.25, 0, 0], elR: [-1.2, 0, 0], chest: [-0.32, 0.28, 0], head: [-0.55, 0.25, 0] } },
  ],
}

// ======================================================================= Shulgen

export interface ShulgenModel {
  rig: Humanoid
  blade: THREE.Mesh
  bladeMat: THREE.MeshBasicMaterial
  veins: THREE.MeshBasicMaterial
}

/** a stately warrior in rich khan's robes rotted at the hem and a tarnished silver mail; marble-white skin, silver veins */
export function createShulgen(): ShulgenModel {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(ref, 0xd8dade, 0.5)
  const robe = flashable(ref, 0x3a1e2a, 0.85, { side: THREE.DoubleSide })
  const dark = flashable(ref, 0x15121a, 0.9)
  const rig = new Humanoid({ hipH: 1.04, thigh: 0.5, shin: 0.49, torso: 0.7, upperArm: 0.35, foreArm: 0.33, shoulderW: 0.54, hipW: 0.28, limbR: 0.072, headR: 0.13, skin, cloth: robe, dark, stride: 1.9, runSpeed: 5.5 })
  rig.flashMats.push(...ref.flashMats)
  const J = rig.joints
  const silver = std(0x9aa4ac, 0.35, { metalness: 0.85 })
  // the long robe, rotted into tatters at the hem
  const hem = new THREE.CylinderGeometry(0.26, 0.48, 0.75, 14, 3, true).translate(0, -0.37, 0)
  const pos = hem.attributes.position
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.6) pos.setY(i, pos.getY(i) + Math.abs(Math.sin(i * 1.7)) * 0.22)
  hem.computeVertexNormals()
  part(hem, robe, J.hips, 0, 0, 0)
  part(new THREE.CylinderGeometry(0.27, 0.3, 0.06, 14), std(0xffffff, 0.8, { map: ornamentTexture() }), J.hips, 0, 0.02, 0)
  // the silver mail and the pauldrons
  part(new THREE.SphereGeometry(0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), silver, J.chest, 0, 0.26, 0).scale.set(1.25, 0.55, 0.95)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.12, 8, 5), silver, J.chest, s * 0.28, 0.3, 0).scale.set(1, 0.7, 1)
  // a khan's cap with a silver crown band
  part(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 10), std(0x3a1e2a, 0.8), J.head, 0, 0.27, 0)
  part(new THREE.TorusGeometry(0.14, 0.018, 4, 12), silver, J.head, 0, 0.2, 0).rotation.x = Math.PI / 2
  // silver veins of living water glowing under the white skin of the face and the hands
  const veins = glow(0.7, 0.9, 1.2)
  for (let i = 0; i < 6; i++) {
    const v = part(new THREE.BoxGeometry(0.008, 0.08 + Math.random() * 0.06, 0.004), veins, J.head, (Math.random() - 0.5) * 0.16, 0.08 + Math.random() * 0.1, 0.12)
    v.rotation.z = (Math.random() - 0.5) * 1.2
  }
  for (const h of [J.elL, J.elR]) for (let i = 0; i < 3; i++) part(new THREE.BoxGeometry(0.006, 0.18, 0.004), veins, h, (i - 1) * 0.02, -0.18, 0.065)
  const eyeMat = glow(0.8, 0.85, 0.9)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(0.8, 0.85, 0.9)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.014, 6, 4), eyeMat, J.head, s * 0.045, 0.13, 0.11)
  // the ancient silver blade
  const bladeMat = glow(0.55, 0.62, 0.72)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.05, 0.014), bladeMat)
  blade.position.set(0, -0.62, 0.05)
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), silver)
  guard.position.set(0, -0.08, 0.05)
  J.haR.add(blade, guard)
  const cape = part(new THREE.PlaneGeometry(0.6, 1.2, 2, 4).translate(0, -0.6, 0), robe, J.chest, 0, 0.34, -0.17)
  rig.addDangle(cape, { k: 12, c: 2, amt: 0.05, grav: 1 })
  rig.root.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return { rig, blade, bladeMat, veins }
}

export const SHULGEN_CLIPS: Record<string, Clip> = {
  cut1: HERO_CLIPS.atk1,
  cut2: HERO_CLIPS.atk2,
  cut3: HERO_CLIPS.atk3,
  step: HERO_CLIPS.thrust,
  drink: [
    { t: 0, p: { chest: [0.6, 0, 0], thL: [-1.3, 0, 0], knL: [1.7, 0, 0], thR: [0.2, 0, 0], knR: [1.9, 0, 0], shL: [-1.2, 0, 0.2], elL: [-0.6, 0, 0] }, b: [-0.45, 0, 0.1] },
    { t: 0.5, p: { chest: [0.9, 0, 0], head: [0.4, 0, 0], shL: [-1.4, 0, 0.2], elL: [-1.8, 0, 0], thL: [-1.3, 0, 0], knL: [1.7, 0, 0], thR: [0.2, 0, 0], knR: [1.9, 0, 0] }, b: [-0.5, 0.1, 0.2] },
    { t: 1, p: { chest: [0.8, 0, 0], head: [0.3, 0, 0], shL: [-2.2, 0, 0.2], elL: [-2.2, 0, 0], thL: [-1.3, 0, 0], knL: [1.7, 0, 0], thR: [0.2, 0, 0], knR: [1.9, 0, 0] }, b: [-0.5, 0.1, 0.15] },
  ],
  sit: [
    { t: 0, p: { thL: [-1.5, 0, 0.1], knL: [1.5, 0, 0], thR: [-1.5, 0, -0.1], knR: [1.5, 0, 0], chest: [0.15, 0, 0], shR: [-0.6, 0, -0.2], elR: [-0.6, 0, 0] }, b: [-0.5, -0.15, 0] },
    { t: 1, p: { thL: [-1.5, 0, 0.1], knL: [1.5, 0, 0], thR: [-1.5, 0, -0.1], knR: [1.5, 0, 0], chest: [0.2, 0, 0], shR: [-0.6, 0, -0.2], elR: [-0.6, 0, 0] }, b: [-0.5, -0.15, 0] },
  ],
  hurt: HERO_CLIPS.hurt,
  stagger: MOROK_CLIPS.stagger,
  death: HERO_CLIPS.death,
}

// ======================================================================= the Albasty, Aisylu, the Shadow of Arslan

/** a stooped ancient woman, very tall, wrapped to the heels in wet grey hair; long pale arms, bare feet (npc_albasty) */
export function createAlbasty(mat?: THREE.Material) {
  const skin = mat ?? std(0xa8aca8, 0.6)
  const hairMat = mat ?? std(0x8a8c88, 0.75)
  const rig = new Humanoid({ hipH: 1.3, thigh: 0.62, shin: 0.62, torso: 0.82, upperArm: 0.52, foreArm: 0.52, shoulderW: 0.4, hipW: 0.24, limbR: 0.05, headR: 0.14, skin, cloth: hairMat, dark: skin, hunch: 0.35, armHang: 0.08, stride: 2.4, runSpeed: 3 })
  const J = rig.joints
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2
    const len = 1.9 + Math.random() * 0.5
    const strand = part(new THREE.CapsuleGeometry(0.035, len, 2, 4).translate(0, -len / 2, 0), hairMat, J.head, Math.sin(a) * 0.13, 0.18, Math.cos(a) * 0.13)
    strand.rotation.x = Math.cos(a) > 0.5 ? -0.08 : 0.06
    rig.addDangle(strand, { k: 6, c: 1.2, amt: 0.05, grav: 1, limit: 0.9 })
  }
  rig.springScale = 0.6
  return rig
}

/** Aisylu: a young woman with child, in an embroidered dress and a white headscarf (lying by the bowl in chapter 3) */
export function createAisylu(mat?: THREE.Material) {
  const skin = mat ?? std(0x9a6a50, 0.7)
  const dress = mat ?? std(0x6e2a1c, 0.85, { side: THREE.DoubleSide })
  const dark = mat ?? std(0x1a120c, 0.9)
  const rig = new Humanoid({ hipH: 0.9, thigh: 0.43, shin: 0.42, torso: 0.56, upperArm: 0.29, foreArm: 0.27, shoulderW: 0.38, hipW: 0.24, limbR: 0.052, headR: 0.115, skin, cloth: dress, dark, stride: 1.4, runSpeed: 4 })
  const J = rig.joints
  part(new THREE.CylinderGeometry(0.22, 0.42, 0.85, 14, 2, true).translate(0, -0.42, 0), dress, J.hips, 0, 0.02, 0)
  part(new THREE.SphereGeometry(0.17, 12, 8), dress, J.spine, 0, 0.08, 0.1).scale.set(1, 1.05, 0.9)
  part(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), mat ?? std(0xd8d0c0, 0.8), J.head, 0, 0.12, -0.01)
  part(new THREE.PlaneGeometry(0.22, 0.5).translate(0, -0.25, 0), mat ?? std(0xd8d0c0, 0.8, { side: THREE.DoubleSide }), J.head, 0, 0.12, -0.12)
  if (!mat) part(new THREE.CylinderGeometry(0.425, 0.43, 0.06, 14, 1, true).translate(0, -0.82, 0), std(0xffffff, 0.8, { map: ornamentTexture() }), J.hips, 0, 0.02, 0)
  return rig
}

/** a tall man in a fur cap and a long kaftan: Arslan, as a shadow or as a grey-haired reflection */
export function createArslan(mat: THREE.Material) {
  const rig = new Humanoid({ hipH: 0.98, thigh: 0.48, shin: 0.46, torso: 0.64, upperArm: 0.33, foreArm: 0.31, shoulderW: 0.48, hipW: 0.26, limbR: 0.068, headR: 0.13, skin: mat, cloth: mat, dark: mat, stride: 1.75, runSpeed: 5.2 })
  const J = rig.joints
  part(new THREE.CylinderGeometry(0.22, 0.36, 0.62, 12, 1, true).translate(0, -0.31, 0), mat, J.hips, 0, -0.02, 0)
  part(new THREE.CylinderGeometry(0.15, 0.16, 0.1, 12), mat, J.head, 0, 0.2, 0)
  part(new THREE.ConeGeometry(0.13, 0.26, 10), mat, J.head, 0, 0.36, 0)
  // a beard
  part(new THREE.ConeGeometry(0.07, 0.16, 8).rotateX(Math.PI), mat, J.head, 0, 0.0, 0.08)
  return rig
}

/** the mother in her red coral kashmau with silver coins and a long silk lappet: only ever seen in the black water */
export function createMother(mat: THREE.Material, coral: THREE.Material) {
  const rig = createAisylu(mat)
  const J = rig.joints
  part(new THREE.CylinderGeometry(0.15, 0.14, 0.12, 14), coral, J.head, 0, 0.22, 0)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    part(new THREE.SphereGeometry(0.018, 6, 4), coral, J.head, Math.sin(a) * 0.15, 0.15, Math.cos(a) * 0.15)
  }
  const lappet = part(new THREE.PlaneGeometry(0.2, 0.9).translate(0, -0.45, 0), coral, J.head, 0, 0.2, -0.13)
  rig.addDangle(lappet, { k: 9, c: 1.5, amt: 0.06, grav: 1 })
  return rig
}

/** a kneeling / lying / standing pose for NPCs that do not walk */
export const NPC_CLIPS: Record<string, Clip> = {
  kneel: [
    { t: 0, p: { chest: [0.55, 0, 0], head: [0.4, 0, 0], thL: [-1.4, 0, 0], knL: [2.2, 0, 0], thR: [-0.1, 0, 0], knR: [2.3, 0, 0], shL: [-0.4, 0, 0.3], shR: [-0.4, 0, -0.3], elL: [-1.2, 0, 0], elR: [-1.2, 0, 0] }, b: [-0.55, 0, 0.12] },
    { t: 1, p: { chest: [0.6, 0, 0], head: [0.45, 0, 0], thL: [-1.4, 0, 0], knL: [2.2, 0, 0], thR: [-0.1, 0, 0], knR: [2.3, 0, 0], shL: [-0.45, 0, 0.3], shR: [-0.45, 0, -0.3], elL: [-1.25, 0, 0], elR: [-1.25, 0, 0] }, b: [-0.55, 0, 0.12] },
  ],
  sitHug: [
    { t: 0, p: { thL: [-1.6, 0, 0.2], knL: [2.3, 0, 0], thR: [-1.6, 0, -0.2], knR: [2.3, 0, 0], chest: [0.5, 0, 0], head: [0.3, 0, 0], shL: [-1.1, 0, -0.3], shR: [-1.1, 0, 0.3], elL: [-1.4, 0, 0], elR: [-1.4, 0, 0] }, b: [-0.62, -0.1, 0.05] },
    { t: 1, p: { thL: [-1.6, 0, 0.2], knL: [2.3, 0, 0], thR: [-1.6, 0, -0.2], knR: [2.3, 0, 0], chest: [0.55, 0, 0], head: [0.35, 0, 0], shL: [-1.1, 0, -0.3], shR: [-1.1, 0, 0.3], elL: [-1.45, 0, 0], elR: [-1.45, 0, 0] }, b: [-0.62, -0.1, 0.05] },
  ],
  lie: [
    { t: 0, p: { chest: [-0.1, 0, 0], head: [-0.2, 0.5, 0], shL: [-0.3, 0, 0.6], shR: [-0.6, 0, -0.3], elR: [-1.4, 0, 0], thL: [-0.3, 0, 0], knL: [0.6, 0, 0], thR: [-0.1, 0, 0] }, b: [-0.75, 0.3, 1.5] },
    { t: 1, p: { chest: [-0.12, 0, 0], head: [-0.2, 0.5, 0], shL: [-0.3, 0, 0.6], shR: [-0.6, 0, -0.3], elR: [-1.4, 0, 0], thL: [-0.3, 0, 0], knL: [0.6, 0, 0], thR: [-0.1, 0, 0] }, b: [-0.75, 0.3, 1.5] },
  ],
  reach: HERO_CLIPS.interact,
}
