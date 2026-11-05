import * as THREE from 'three'
import { capsule, Humanoid, part, Quadruped, type Clip } from './rig'
import { glow, ornamentTexture, std } from '../render/materials'
import { makeFlame, type VFX } from '../render/vfx'
import { WEAPONS } from '../rpg/weapons'

let ornTex: THREE.Texture | null = null
const orn = () => (ornTex ??= ornamentTexture())

function flashable(rig: { flashMats: THREE.MeshStandardMaterial[] }, color: THREE.ColorRepresentation, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) {
  const m = std(color, rough, extra)
  rig.flashMats.push(m)
  return m
}

// ======================================================================= HERO: Aldar the eagle-hunter

/**
 * Aldar's gear, as separate objects on the joints (docs/EQUIPMENT.md, «Таблица точек крепления»): the HeroAnimator moves each
 * onto its Mixamo bone. When the GLBs of docs/ASSETS.md arrive, only the contents of these groups change.
 */
export interface HeroModel {
  rig: Humanoid
  /** eq_ember_vessel: the copper coal vessel on the belt, left front */
  vessel: THREE.Object3D
  /** where the coal glows: the light follows it */
  vesselCore: THREE.Object3D
  /** the tamga slots and the coal: their colour is the heat */
  vesselGlow: THREE.MeshBasicMaterial
  /** eq_bow_yaya in the left hand (stance 2) and on the back (stance 1) */
  bowHand: THREE.Object3D
  bowBack: THREE.Object3D
  /** eq_kalkan on the left forearm (stance 1) and on the back (stance 2) */
  shield: THREE.Object3D
  shieldBack: THREE.Object3D
  /** the boss of the shield: sparks of a parry fly from here */
  shieldBoss: THREE.Object3D
  bladeTip: THREE.Object3D
  /** eq_kylys in the right hand: its wrist angle is turned for thrusts */
  sword: THREE.Object3D
  /** the hilt showing out of the scabbard while the bow is out */
  swordSheathed: THREE.Object3D
  /** eq_quiver: arrow_01..08, visible = arrows in it */
  quiverArrows: THREE.Object3D[]
  /** eq_arrow_hand: on the string while drawing; its head burns once lit at the vessel */
  arrowHand: THREE.Object3D
  arrowFlame: THREE.Object3D
  /** pieces that stay when the body is replaced by a GLB */
  props: THREE.Object3D[]
  handL: THREE.Object3D
}

export function createHero(vfx: VFX): HeroModel {
  const mats = {
    skin: std(0x8a5e44, 0.7),
    cloth: std(0x1c2a38, 0.88),
    dark: std(0x17110c, 0.9),
  }
  const rig = new Humanoid({
    hipH: 0.95,
    thigh: 0.46,
    shin: 0.45,
    torso: 0.62,
    upperArm: 0.32,
    foreArm: 0.3,
    shoulderW: 0.46,
    hipW: 0.25,
    limbR: 0.066,
    headR: 0.13,
    skin: mats.skin,
    cloth: mats.cloth,
    dark: mats.dark,
    stride: 1.75,
    runSpeed: 5.2,
  })
  rig.flashMats.push(mats.skin, mats.cloth, mats.dark)
  const J = rig.joints
  const ornMat = std(0xffffff, 0.8, { map: orn() })
  const fur = std(0x3a2d22, 1)
  const ochre = std(0x8a3b1e, 0.8)
  const iron = std(0x2b2b30, 0.45, { metalness: 0.7 })

  // kaftan: six hanging flaps with an ornamented hem; legs push them as they stride
  mats.cloth.side = THREE.DoubleSide
  const FL = 6
  for (let i = 0; i < FL; i++) {
    const th = (i / FL) * Math.PI * 2 - Math.PI / FL
    const len = (2 * Math.PI) / FL + 0.12
    const flap = new THREE.Group()
    flap.position.set(0, -0.02, 0)
    J.hips.add(flap)
    part(new THREE.CylinderGeometry(0.21, 0.34, 0.55, 3, 1, true, th, len).translate(0, -0.275, 0), mats.cloth, flap)
    part(new THREE.CylinderGeometry(0.343, 0.35, 0.07, 3, 1, true, th, len).translate(0, -0.52, 0), ornMat, flap)
    const c = Math.cos(th + len / 2)
    const sn = Math.sin(th + len / 2)
    const thigh = sn >= 0 ? J.thL : J.thR
    const side = Math.abs(sn) * 0.6 + 0.4
    rig.addDangle(flap, {
      k: 55,
      c: 7,
      amt: 0.035,
      grav: 0.9,
      limit: 0.9,
      bias: () => {
        const x = thigh.rotation.x
        return [(c > 0 ? Math.min(0, x) : Math.max(0, x)) * Math.abs(c) * 0.75 * side, 0]
      },
    })
  }
  part(new THREE.TorusGeometry(0.19, 0.035, 6, 16), ochre, J.hips, 0, 0.04, 0).rotation.x = Math.PI / 2
  // fur mantle
  const mantle = part(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), fur, J.chest, 0, 0.18, -0.02)
  mantle.scale.set(1.05, 0.55, 0.85)
  // short fur-lined cloak: a chain of three panels, each swinging from the one above
  const cloakMat = std(0x241a14, 0.95, { side: THREE.DoubleSide })
  let anchor: THREE.Object3D = J.chest
  let ay = 0.4
  let az = -0.15
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group()
    seg.position.set(0, ay, az)
    anchor.add(seg)
    const w0 = 0.46 + i * 0.05
    const panel = part(new THREE.PlaneGeometry(w0, 0.2, 2, 1).translate(0, -0.1, 0), cloakMat, seg)
    panel.rotation.x = i === 0 ? 0.35 : 0.05
    if (i === 0) seg.rotation.x = 0.2
    const piv = rig.addDangle(seg, { k: 30 - i * 6, c: 4.5, amt: 0.05 + i * 0.02, grav: 0.85, limit: 1.1 })
    void piv
    anchor = seg
    ay = -0.2
    az = 0
  }
  // hat (bürek): fur band + crown
  part(new THREE.CylinderGeometry(0.145, 0.15, 0.09, 14), fur, J.head, 0, 0.2, 0)
  const crown = part(new THREE.ConeGeometry(0.12, 0.2, 12), ochre, J.head, 0, 0.33, -0.01)
  crown.rotation.x = -0.12
  part(new THREE.CylinderGeometry(0.121, 0.13, 0.04, 12), ornMat, J.head, 0, 0.25, 0)
  // beard
  part(new THREE.SphereGeometry(0.08, 8, 6), std(0x150f0b, 1), J.head, 0, 0.04, 0.08).scale.set(1, 0.9, 0.6)
  // bow (back + hand variants). Built in the hand's local YZ plane: limb along Z, belly toward -Y.
  // eq_bow_yaya: dark horn and birch bark; the string is drawn by code
  const bowMat = std(0x2c1a0e, 0.7)
  const barkMat = std(0xb8955a, 0.8)
  const bowGeo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.2, -0.6),
      new THREE.Vector3(0, 0.08, -0.52),
      new THREE.Vector3(0, -0.04, -0.3),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -0.04, 0.3),
      new THREE.Vector3(0, 0.08, 0.52),
      new THREE.Vector3(0, 0.2, 0.6),
    ]),
    22,
    0.016,
    5,
  )
  const stringGeo = new THREE.CylinderGeometry(0.003, 0.003, 1.2, 3).rotateX(Math.PI / 2).translate(0, 0.2, 0)
  const stringMat = std(0xb8ad90, 0.8)
  const makeBow = () => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(bowGeo, bowMat), new THREE.Mesh(stringGeo, stringMat))
    part(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 6).rotateX(Math.PI / 2), barkMat, g, 0, 0, 0)
    return g
  }
  const bowBack = makeBow()
  bowBack.name = 'eq_bow_yaya_back'
  bowBack.position.set(0.02, 0.08, -0.22)
  bowBack.rotation.set(Math.PI / 2, 0, 0.55)
  J.chest.add(bowBack)
  const bowHand = makeBow()
  bowHand.name = 'eq_bow_yaya'
  bowHand.position.set(0, -0.07, 0)
  bowHand.visible = false
  J.haL.add(bowHand)

  // eq_kalkan: a convex round shield, 55 cm, bull leather over wood, a bronze boss with claw scratches, an iron rim
  const leather = std(0x4a2e1a, 0.85)
  const bronze = std(0x8a6a3a, 0.45, { metalness: 0.7 })
  const makeShield = () => {
    const g = new THREE.Group()
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 6, 0, Math.PI * 2, 0, 0.66), leather)
    dish.position.y = -0.34
    g.add(dish)
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze)
    boss.position.y = 0.105
    g.add(boss)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      part(new THREE.SphereGeometry(0.022, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), bronze, g, Math.cos(a) * 0.17, 0.075, Math.sin(a) * 0.17)
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.272, 0.012, 4, 28), iron)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.0
    g.add(rim)
    // the kuskar (ram's horn) pattern pressed into the leather
    const orn2 = std(0xffffff, 0.9, { map: orn(), transparent: true, opacity: 0.35, depthWrite: false })
    const band = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.25, 24).rotateX(-Math.PI / 2), orn2)
    band.position.y = 0.06
    g.add(band)
    g.traverse((o) => (o.castShadow = true))
    return { g, boss }
  }
  const sh = makeShield()
  const shield = new THREE.Group()
  shield.name = 'eq_kalkan'
  // strapped to the outside of the forearm so the hand stays free: the face looks out to the left
  sh.g.rotation.z = -Math.PI / 2
  shield.add(sh.g)
  shield.position.set(0.09, -0.16, 0.0)
  shield.visible = false
  J.elL.add(shield)
  const shieldBack = new THREE.Group()
  shieldBack.name = 'eq_kalkan_back'
  const sb = makeShield().g
  sb.rotation.x = -Math.PI / 2
  shieldBack.add(sb)
  shieldBack.position.set(0, 0.16, -0.24)
  shieldBack.visible = false
  J.chest.add(shieldBack)

  // short curved kylys: the father's sabre
  const sword = new THREE.Group()
  sword.name = 'eq_kylys'
  const L = WEAPONS.kylys.edge
  const bladeShape = new THREE.Shape()
  const curve = (y: number) => 0.055 * (y / L) ** 2 // the blade sweeps back toward the tip
  bladeShape.moveTo(-0.013, 0)
  for (let i = 1; i <= 8; i++) bladeShape.lineTo(-0.013 + curve((i / 8) * L), -(i / 8) * L) // spine
  bladeShape.lineTo(0.002 + curve(L * 1.05), -L * 1.05) // point
  // the yelman: the last third widens toward the point
  for (let i = 8; i >= 0; i--) bladeShape.lineTo(0.021 - 0.006 * (i / 8) + (i > 5 ? 0.006 * ((i - 5) / 3) : 0) + curve((i / 8) * L), -(i / 8) * L) // edge
  bladeShape.closePath()
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 })
  bladeGeo.translate(0, -0.075, -0.004)
  const steel = std(0x8d959c, 0.36, { metalness: 0.85 })
  const blade = new THREE.Mesh(bladeGeo, steel)
  blade.castShadow = true
  // the flat of the blade faces the sky in horizontal cuts and thrusts, so the top-down camera reads it
  blade.rotation.y = Math.PI / 2
  sword.add(blade)
  const horn = std(0x15100c, 0.6)
  const hilt = (parent: THREE.Object3D) => {
    part(new THREE.BoxGeometry(0.1, 0.018, 0.03), bronze, parent, 0.004, -0.068, 0)
    part(new THREE.CylinderGeometry(0.017, 0.019, 0.13, 6), horn, parent, 0, -0.0, 0)
    part(new THREE.SphereGeometry(0.024, 6, 5), horn, parent, 0.012, 0.075, 0)
  }
  hilt(sword)
  const bladeTip = new THREE.Object3D()
  bladeTip.position.set(0, -0.075 - L, -curve(L))
  sword.add(bladeTip)
  sword.rotation.x = -1.25
  sword.position.y = -0.03
  J.haR.add(sword)
  // the scabbard on the left hip, and the hilt in it while the bow is out
  const scabbard = new THREE.Group()
  scabbard.name = 'eq_kylys_sheath'
  part(new THREE.BoxGeometry(0.05, 0.66, 0.022), std(0x2a1a10, 0.9), scabbard, 0, -0.33, 0)
  part(new THREE.BoxGeometry(0.056, 0.05, 0.028), bronze, scabbard, 0, -0.64, 0)
  const swordSheathed = new THREE.Group()
  hilt(swordSheathed)
  swordSheathed.position.y = 0.07
  swordSheathed.rotation.z = Math.PI
  swordSheathed.visible = false
  scabbard.add(swordSheathed)
  scabbard.position.set(0.2, -0.02, -0.08)
  scabbard.rotation.set(0.5, 0, 0.25)
  J.hips.add(scabbard)

  // eq_quiver at the right hip: hourglass leather with bronze plates and Aisylu's blue tassel; 8 arrow meshes
  const quiver = new THREE.Group()
  quiver.name = 'eq_quiver'
  part(new THREE.CylinderGeometry(0.065, 0.05, 0.22, 8), std(0x3a2414, 0.9), quiver, 0, 0.11, 0)
  part(new THREE.CylinderGeometry(0.05, 0.065, 0.22, 8), std(0x3a2414, 0.9), quiver, 0, -0.11, 0)
  part(new THREE.TorusGeometry(0.052, 0.008, 4, 10), bronze, quiver, 0, 0, 0).rotation.x = Math.PI / 2
  part(new THREE.ConeGeometry(0.025, 0.1, 5), std(0x2c5cb0, 0.8, { emissive: 0x0a1a3a }), quiver, 0.06, -0.05, 0.03).rotation.x = Math.PI
  const shaftMat = std(0x6b5236, 0.8)
  const fletchMat = std(0x8a8070, 0.9)
  const quiverArrows: THREE.Object3D[] = []
  for (let i = 0; i < 8; i++) {
    const a = new THREE.Group()
    a.name = `arrow_0${i + 1}`
    part(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 4), shaftMat, a, 0, 0.1, 0)
    part(new THREE.ConeGeometry(0.016, 0.07, 3), fletchMat, a, 0, 0.21, 0)
    const ang = (i / 8) * Math.PI * 2
    a.position.set(Math.cos(ang) * 0.028, 0.2, Math.sin(ang) * 0.028)
    a.rotation.set(Math.sin(ang) * 0.12, 0, -Math.cos(ang) * 0.12)
    a.visible = false
    quiver.add(a)
    quiverArrows.push(a)
  }
  quiver.position.set(-0.22, -0.02, -0.04)
  quiver.rotation.set(-0.35, 0, -0.3)
  J.hips.add(quiver)

  // eq_arrow_hand: on the string between the fingers of the right hand, only while drawing
  const arrowHand = new THREE.Group()
  arrowHand.name = 'eq_arrow_hand'
  part(new THREE.CylinderGeometry(0.005, 0.005, 0.8, 4).rotateX(Math.PI / 2), shaftMat, arrowHand, 0, 0, 0.35)
  part(new THREE.ConeGeometry(0.014, 0.06, 4).rotateX(Math.PI / 2), iron, arrowHand, 0, 0, 0.77)
  const arrowFlame = makeFlame(0.12)
  arrowFlame.position.set(0, 0.02, 0.79)
  arrowFlame.visible = false
  arrowHand.add(arrowFlame)
  vfx.billboards.add(arrowFlame)
  arrowHand.position.set(0, -0.06, 0.02)
  arrowHand.visible = false
  J.haR.add(arrowHand)

  // eq_ember_vessel «Ут-һауыт»: octagonal hammered copper, a domed lid on a latch, a ring for the belt chain,
  // tamga slots in the walls; the coal on a bed of birch tinder glows through them (docs/ASSETS.md 1.1)
  const vessel = new THREE.Group()
  vessel.name = 'eq_ember_vessel'
  vessel.position.set(0.2, -0.1, 0.12)
  J.hips.add(vessel)
  const copper = std(0x7a4a2a, 0.45, { metalness: 0.85 })
  const patina = std(0x4c5a4a, 0.6, { metalness: 0.5 })
  part(new THREE.CylinderGeometry(0.075, 0.068, 0.11, 8), copper, vessel, 0, -0.13, 0)
  part(new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), copper, vessel, 0, -0.075, 0)
  part(new THREE.CylinderGeometry(0.068, 0.04, 0.03, 8), patina, vessel, 0, -0.2, 0)
  part(new THREE.TorusGeometry(0.022, 0.006, 4, 10), copper, vessel, 0, 0.005, 0)
  for (let i = 0; i < 3; i++) part(new THREE.TorusGeometry(0.009, 0.0025, 3, 6), copper, vessel, 0, 0.03 + i * 0.016, 0).rotation.y = i % 2 ? Math.PI / 2 : 0
  const vesselGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.4, 0.4) })
  // slots: stepped rhombs and bars cut through the copper, glowing with the coal
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(i % 2 ? 0.012 : 0.022, i % 2 ? 0.07 : 0.03), vesselGlow)
    slot.position.set(Math.cos(a) * 0.0725, -0.13 + (i % 2 ? 0 : (i % 4 === 0 ? 0.02 : -0.02)), Math.sin(a) * 0.0725)
    slot.rotation.y = -a + Math.PI / 2
    if (i % 2 === 0) slot.rotation.z = Math.PI / 4
    vessel.add(slot)
  }
  const vesselCore = new THREE.Object3D()
  vesselCore.position.y = -0.13
  vessel.add(vesselCore)
  // it hangs on a short chain from the belt and swings — its light and shadows swing with it
  rig.addDangle(vessel, { k: 26, c: 3, amt: 0.05, grav: 1, limit: 0.8 })

  return {
    rig,
    vessel,
    vesselCore,
    vesselGlow,
    bowHand,
    bowBack,
    shield,
    shieldBack,
    shieldBoss: sh.boss,
    bladeTip,
    sword,
    swordSheathed,
    quiverArrows,
    arrowHand,
    arrowFlame,
    props: [sword, bowBack, bowHand, shield, shieldBack, scabbard, quiver, arrowHand, vessel],
    handL: J.haL,
  }
}

/** Azamat, eleven: a belted fur coat with an embroidered hem, a fox malakhai, the reed kurai (docs/ASSETS.md, chr_azamat). */
export function createAzamat() {
  const mats = { skin: std(0x8a5e44, 0.7), cloth: std(0x5a3a22, 0.9), dark: std(0x1a120c, 0.9) }
  const rig = new Humanoid({
    hipH: 0.66,
    thigh: 0.32,
    shin: 0.32,
    torso: 0.44,
    upperArm: 0.22,
    foreArm: 0.21,
    shoulderW: 0.32,
    hipW: 0.18,
    limbR: 0.05,
    headR: 0.115,
    skin: mats.skin,
    cloth: mats.cloth,
    dark: mats.dark,
    stride: 1.2,
    runSpeed: 4.2,
  })
  rig.flashMats.push(mats.skin, mats.cloth, mats.dark)
  const J = rig.joints
  const fox = std(0xa0582a, 1)
  part(new THREE.CylinderGeometry(0.16, 0.24, 0.32, 8, 1, true).translate(0, -0.16, 0), mats.cloth, J.hips, 0, 0, 0)
  part(new THREE.CylinderGeometry(0.242, 0.25, 0.05, 8, 1, true).translate(0, -0.3, 0), std(0xffffff, 0.8, { map: orn() }), J.hips, 0, 0, 0)
  part(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), fox, J.head, 0, 0.13, -0.01).scale.set(1, 0.9, 1.05)
  part(new THREE.BoxGeometry(0.06, 0.14, 0.03), fox, J.head, 0.11, 0.06, -0.02)
  part(new THREE.BoxGeometry(0.06, 0.14, 0.03), fox, J.head, -0.11, 0.06, -0.02)
  part(new THREE.BoxGeometry(0.05, 0.06, 0.012), std(0x6a4a2a, 0.8), J.chest, 0, 0.14, 0.12)
  const kurai = part(new THREE.CylinderGeometry(0.009, 0.011, 0.34, 6), std(0xc9b48a, 0.7), J.haR, 0, -0.08, 0.04)
  kurai.rotation.x = 0.5
  rig.root.traverse((o) => (o.castShadow = true))
  return rig
}

export const HERO_CLIPS: Record<string, Clip> = {
  atk1: [
    { t: 0, p: { chest: [0.05, -0.85, 0], spine: [0, -0.3, 0], shR: [-0.9, 0, -1.3], elR: [-0.7, 0, 0], shL: [-0.3, 0, 0.4], elL: [-1, 0, 0], thL: [-0.35, 0, 0], thR: [0.3, 0, 0], knL: [0.35, 0, 0], knR: [0.45, 0, 0] }, b: [-0.06, 0, 0] },
    { t: 0.3, p: { chest: [0.05, -0.95, 0], spine: [0, -0.35, 0], shR: [-1.0, 0.2, -1.45], elR: [-0.8, 0, 0] }, b: [-0.08, 0, 0] },
    { t: 0.5, p: { chest: [0.15, 0.75, 0], spine: [0, 0.3, 0], shR: [-1.5, 0, 0.55], elR: [-0.12, 0, 0], shL: [0.3, 0, 0.3], thL: [-0.5, 0, 0], knL: [0.5, 0, 0] }, b: [-0.1, 0.18, 0.06] },
    { t: 1, p: { chest: [0.1, 0.35, 0], spine: [0, 0.1, 0], shR: [-1.0, 0, 0.15], elR: [-0.45, 0, 0] }, b: [-0.04, 0.05, 0] },
  ],
  atk2: [
    { t: 0, p: { chest: [0.05, 0.85, 0], spine: [0, 0.3, 0], shR: [-1.5, 0, 0.7], elR: [-1.6, 0, 0], shL: [-0.2, 0, 0.3], thR: [-0.4, 0, 0], knR: [0.4, 0, 0] }, b: [-0.06, 0, 0] },
    { t: 0.3, p: { chest: [0.05, 0.95, 0], spine: [0, 0.35, 0], shR: [-1.6, 0, 0.85], elR: [-1.75, 0, 0] } },
    { t: 0.5, p: { chest: [0.15, -0.75, 0], spine: [0, -0.3, 0], shR: [-1.25, 0, -1.25], elR: [-0.1, 0, 0], thR: [-0.55, 0, 0], knR: [0.55, 0, 0] }, b: [-0.1, 0.18, 0.06] },
    { t: 1, p: { chest: [0.1, -0.35, 0], spine: [0, -0.1, 0], shR: [-0.8, 0, -0.6], elR: [-0.45, 0, 0] }, b: [-0.04, 0.05, 0] },
  ],
  atk3: [
    { t: 0, p: { chest: [-0.25, 0, 0], spine: [-0.1, 0, 0], shR: [-2.9, 0, -0.2], elR: [-0.6, 0, 0], shL: [-2.4, 0, 0.3], elL: [-0.8, 0, 0], thL: [-0.4, 0, 0], knL: [0.45, 0, 0], thR: [0.25, 0, 0], knR: [0.2, 0, 0] }, b: [0.04, 0, -0.08] },
    { t: 0.42, p: { chest: [-0.4, 0, 0], spine: [-0.12, 0, 0], shR: [-3.05, 0, -0.15], elR: [-0.7, 0, 0], shL: [-2.6, 0, 0.3] }, b: [0.08, 0, -0.12] },
    { t: 0.56, p: { chest: [0.65, 0, 0], spine: [0.2, 0, 0], shR: [-0.75, 0, 0], elR: [0, 0, 0], shL: [-0.7, 0, 0.2], elL: [-0.2, 0, 0], thL: [-0.75, 0, 0], knL: [0.95, 0, 0], thR: [0.5, 0, 0], knR: [0.65, 0, 0] }, b: [-0.3, 0.22, 0.16] },
    { t: 1, p: { chest: [0.3, 0, 0], spine: [0.1, 0, 0], shR: [-0.65, 0, 0], shL: [-0.4, 0, 0.2] }, b: [-0.12, 0.1, 0.05] },
  ],
  // Укол: the arm pulls back, then the whole body follows the point forward
  thrust: [
    { t: 0, p: { chest: [0.05, 0.55, 0], spine: [0, 0.2, 0], shR: [-0.7, 0, -0.25], elR: [-1.9, 0, 0], shL: [-0.5, 0, 0.5], elL: [-0.9, 0, 0], thR: [-0.25, 0, 0], knR: [0.35, 0, 0], thL: [0.2, 0, 0], knL: [0.3, 0, 0] }, b: [-0.05, -0.08, -0.06] },
    { t: 0.35, p: { chest: [0.05, 0.65, 0], spine: [0, 0.25, 0], shR: [-0.75, 0, -0.3], elR: [-2.05, 0, 0] }, b: [-0.08, -0.1, -0.08] },
    { t: 0.52, p: { chest: [0.3, -0.35, 0], spine: [0.1, -0.15, 0], shR: [-1.6, 0, 0.05], elR: [-0.05, 0, 0], shL: [0.4, 0, 0.6], elL: [-0.4, 0, 0], thL: [-0.85, 0, 0], knL: [0.95, 0, 0], thR: [0.55, 0, 0], knR: [0.3, 0, 0] }, b: [-0.24, 0.12, 0.28] },
    { t: 1, p: { chest: [0.12, -0.1, 0], spine: [0, 0, 0], shR: [-1.0, 0, -0.1], elR: [-0.5, 0, 0], shL: [-0.2, 0, 0.3] }, b: [-0.06, 0.04, 0.06] },
  ],
  // Полумесяц: the arm swings out flat while the body turns a full circle (root spin in Player.syncRig)
  crescent: [
    { t: 0, p: { chest: [0.1, 0.9, 0], spine: [0, 0.35, 0], shR: [-1.45, 0, 0.75], elR: [-1.5, 0, 0], shL: [-0.4, 0, 0.6], thL: [-0.4, 0, 0], knL: [0.55, 0, 0], thR: [-0.3, 0, 0], knR: [0.5, 0, 0] }, b: [-0.14, 0, 0] },
    { t: 0.3, p: { chest: [0.15, 0.2, 0], spine: [0, 0.1, 0], shR: [-1.45, 0, -1.35], elR: [-0.08, 0, 0], shL: [-0.6, 0, 1.2], elL: [-0.2, 0, 0] }, b: [-0.22, 0, 0.04] },
    { t: 0.7, p: { chest: [0.15, -0.2, 0], shR: [-1.45, 0, -1.4], elR: [-0.05, 0, 0], shL: [-0.6, 0, 1.25] }, b: [-0.22, 0, 0.04] },
    { t: 1, p: { chest: [0.08, -0.3, 0], spine: [0, -0.1, 0], shR: [-0.8, 0, -0.6], elR: [-0.4, 0, 0], shL: [-0.2, 0, 0.3] }, b: [-0.05, 0.04, 0] },
  ],
  charge: [
    { t: 0, p: { chest: [-0.2, 0, 0], shR: [-2.6, 0, -0.2], elR: [-0.6, 0, 0], shL: [-2.2, 0, 0.3], elL: [-0.8, 0, 0], thL: [-0.4, 0, 0], knL: [0.5, 0, 0], thR: [0.3, 0, 0], knR: [0.35, 0, 0] }, b: [-0.04, 0, -0.05] },
    { t: 1, p: { chest: [-0.5, 0, 0], spine: [-0.15, 0, 0], shR: [-3.1, 0, -0.1], elR: [-0.8, 0, 0], shL: [-2.8, 0, 0.3], thL: [-0.55, 0, 0], knL: [0.75, 0, 0], thR: [0.4, 0, 0], knR: [0.5, 0, 0] }, b: [-0.1, -0.05, -0.15] },
  ],
  slam: [
    { t: 0, p: { chest: [-0.5, 0, 0], spine: [-0.15, 0, 0], shR: [-3.1, 0, -0.1], elR: [-0.8, 0, 0], shL: [-2.8, 0, 0.3], thL: [-0.55, 0, 0], knL: [0.75, 0, 0], thR: [0.4, 0, 0], knR: [0.5, 0, 0] }, b: [-0.1, -0.05, -0.15] },
    { t: 0.22, p: { chest: [0.8, 0, 0], spine: [0.25, 0, 0], shR: [-0.6, 0, 0], elR: [0, 0, 0], shL: [-0.6, 0, 0.1], elL: [0, 0, 0], thL: [-0.9, 0, 0], knL: [1.1, 0, 0], thR: [0.6, 0, 0], knR: [0.8, 0, 0] }, b: [-0.38, 0.3, 0.22] },
    { t: 0.6, p: { chest: [0.75, 0, 0], shR: [-0.55, 0, 0], shL: [-0.55, 0, 0.1] }, b: [-0.36, 0.3, 0.2] },
    { t: 1, p: { chest: [0.2, 0, 0], shR: [-0.4, 0, 0], shL: [-0.3, 0, 0.1] }, b: [-0.08, 0.1, 0.03] },
  ],
  dodge: [
    { t: 0, p: { chest: [0.75, 0, 0], spine: [0.3, 0, 0], head: [-0.4, 0, 0], shL: [0.9, 0, 0.5], shR: [0.9, 0, -0.5], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], thL: [-1.1, 0, 0], knL: [1.5, 0, 0], thR: [0.35, 0, 0], knR: [1.25, 0, 0] }, b: [-0.38, 0, 0.32] },
    { t: 0.7, p: { chest: [0.7, 0, 0], thL: [-0.9, 0, 0], knL: [1.3, 0, 0], thR: [0.2, 0, 0], knR: [1.0, 0, 0] }, b: [-0.32, 0, 0.28] },
    { t: 1, p: { chest: [0.25, 0, 0], spine: [0.1, 0, 0], head: [0, 0, 0] }, b: [-0.08, 0, 0.08] },
  ],
  hurt: [
    { t: 0, p: { chest: [-0.55, 0.3, 0], head: [-0.45, 0, 0], shL: [-0.6, 0, 0.9], shR: [-0.6, 0, -0.9], elL: [-0.5, 0, 0], elR: [-0.5, 0, 0] }, b: [-0.06, -0.15, -0.15] },
    { t: 1, p: { chest: [0.05, 0, 0], head: [0, 0, 0], shL: [0, 0, 0.12], shR: [0, 0, -0.12] }, b: [0, 0, 0] },
  ],
  drink: [
    { t: 0, p: { shL: [-1.2, 0, 0.3], elL: [-1.5, 0, 0] } },
    { t: 0.25, p: { shL: [-2.3, 0, 0.15], elL: [-2.1, 0, 0], head: [-0.5, 0, 0], chest: [-0.15, 0, 0] } },
    { t: 0.75, p: { shL: [-2.4, 0, 0.15], elL: [-2.15, 0, 0], head: [-0.55, 0, 0], chest: [-0.18, 0, 0] } },
    { t: 1, p: { shL: [-0.4, 0, 0.2], elL: [-0.6, 0, 0], head: [0, 0, 0], chest: [0, 0, 0] } },
  ],
  lasso: [
    { t: 0, p: { shL: [-2.8, 0, 0.6], elL: [-0.8, 0, 0], chest: [-0.1, 0.35, 0] } },
    { t: 0.3, p: { shL: [-3.0, 0, 0.95], elL: [-0.6, 0, 0], chest: [-0.15, 0.45, 0] } },
    { t: 0.45, p: { shL: [-1.55, 0, 0.05], elL: [0, 0, 0], chest: [0.2, -0.3, 0] }, b: [-0.05, 0.1, 0.05] },
    { t: 1, p: { shL: [-1.3, 0, 0.05], elL: [-0.2, 0, 0], chest: [0.1, -0.1, 0] } },
  ],
  pull: [
    { t: 0, p: { shL: [-1.4, 0, 0.1], elL: [-0.2, 0, 0], shR: [-1.2, 0, -0.1], chest: [-0.2, -0.2, 0], thL: [-0.5, 0, 0], knL: [0.5, 0, 0] }, b: [-0.1, -0.1, -0.1] },
    { t: 1, p: { shL: [-0.8, 0, 0.1], elL: [-1.6, 0, 0], shR: [-0.6, 0, -0.1], elR: [-1.4, 0, 0], chest: [-0.35, -0.3, 0] }, b: [-0.12, -0.15, -0.18] },
  ],
  bow: [
    { t: 0, p: { shL: [-1.5, 0, 0.05], elL: [-0.1, 0, 0], shR: [-1.4, 0, 0.35], elR: [-0.9, 0, 0], chest: [0, -0.25, 0], head: [0, 0.2, 0] } },
    { t: 1, p: { shL: [-1.57, 0, 0.0], elL: [0, 0, 0], shR: [-1.45, 0, 0.55], elR: [-2.3, 0, 0], chest: [-0.05, -0.35, 0], head: [0, 0.3, 0] } },
  ],
  eagle: [
    { t: 0, p: { shL: [-1.2, 0, 0.6], elL: [-1.4, 0, 0] } },
    { t: 0.4, p: { shL: [-3.0, 0, 0.35], elL: [-0.2, 0, 0], head: [-0.5, 0, 0], chest: [-0.15, 0, 0] } },
    { t: 1, p: { shL: [-2.6, 0, 0.4], elL: [-0.3, 0, 0], head: [-0.3, 0, 0] } },
  ],
  interact: [
    { t: 0, p: { chest: [0.2, 0, 0] } },
    { t: 0.35, p: { chest: [0.7, 0, 0], shR: [-1.2, 0, -0.1], elR: [-0.3, 0, 0], shL: [-0.8, 0, 0.2], thL: [-1.2, 0, 0], knL: [1.6, 0, 0], thR: [0.2, 0, 0], knR: [1.8, 0, 0] }, b: [-0.42, 0, 0.1] },
    { t: 0.75, p: { chest: [0.7, 0, 0], shR: [-1.3, 0, -0.1], thL: [-1.2, 0, 0], knL: [1.6, 0, 0], thR: [0.2, 0, 0], knR: [1.8, 0, 0] }, b: [-0.42, 0, 0.1] },
    { t: 1, p: { chest: [0.1, 0, 0] }, b: [0, 0, 0] },
  ],
  grabbed: [
    { t: 0, p: { shL: [-1.9, 0, 1.2], shR: [-1.9, 0, -1.2], elL: [-0.8, 0, 0], elR: [-0.8, 0, 0], chest: [-0.35, 0, 0], head: [-0.4, 0, 0], thL: [-0.4, 0, 0], thR: [0.3, 0, 0] }, b: [0.35, 0.1, -0.1] },
    { t: 1, p: { shL: [-2.2, 0, 1.0], shR: [-2.2, 0, -1.0], chest: [-0.45, 0, 0], head: [-0.5, 0, 0], thL: [0.3, 0, 0], thR: [-0.4, 0, 0] }, b: [0.4, 0.1, -0.15] },
  ],
  finisher: [
    { t: 0, p: { chest: [-0.3, 0, 0], shR: [-2.9, 0, -0.2], elR: [-0.7, 0, 0], shL: [-2.7, 0, 0.3], elL: [-0.7, 0, 0] }, b: [0.1, -0.1, -0.1] },
    { t: 0.45, p: { chest: [-0.55, 0, 0], shR: [-3.15, 0, -0.1], shL: [-2.95, 0, 0.3], thL: [-0.6, 0, 0], knL: [0.6, 0, 0] }, b: [0.25, 0.2, -0.18] },
    { t: 0.6, p: { chest: [0.9, 0, 0], spine: [0.3, 0, 0], shR: [-0.5, 0, 0], elR: [0, 0, 0], shL: [-0.5, 0, 0.1], elL: [0, 0, 0], thL: [-1.0, 0, 0], knL: [1.3, 0, 0], thR: [0.6, 0, 0], knR: [1.2, 0, 0] }, b: [-0.45, 0.45, 0.25] },
    { t: 1, p: { chest: [0.3, 0, 0], shR: [-0.5, 0, 0], shL: [-0.3, 0, 0.1] }, b: [-0.1, 0.1, 0.05] },
  ],
  death: [
    { t: 0, p: { chest: [-0.4, 0, 0], head: [-0.4, 0, 0] }, b: [0, -0.1, -0.1] },
    { t: 0.35, p: { chest: [0.5, 0, 0], head: [0.4, 0, 0], shL: [0.1, 0, 0.2], shR: [0.1, 0, -0.2], thL: [-1.4, 0, 0], knL: [2.2, 0, 0], thR: [-1.4, 0, 0], knR: [2.2, 0, 0] }, b: [-0.5, 0, 0.1] },
    { t: 1, p: { chest: [0.2, 0, 0], head: [0.1, 0.6, 0], shL: [-2.4, 0, 0.4], shR: [-2.0, 0, -0.5], thL: [-0.2, 0, 0], knL: [0.4, 0, 0], thR: [0.1, 0, 0], knR: [0.2, 0, 0] }, b: [-0.75, 0.4, 1.45] },
  ],
}

// ======================================================================= UBYR: the hungry dead

export function createUbyr() {
  const rigRef = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(rigRef, 0x3a3f33, 0.75)
  const rags = flashable(rigRef, 0x1c1610, 1)
  const dark = flashable(rigRef, 0x14110e, 1)
  const rig = new Humanoid({
    hipH: 0.9,
    thigh: 0.45,
    shin: 0.44,
    torso: 0.58,
    upperArm: 0.42,
    foreArm: 0.42,
    shoulderW: 0.38,
    hipW: 0.2,
    limbR: 0.048,
    headR: 0.12,
    skin,
    cloth: rags,
    dark,
    hunch: 0.6,
    armHang: 0.22,
    stride: 1.25,
    runSpeed: 3.2,
  })
  rig.flashMats.push(...rigRef.flashMats)
  const J = rig.joints
  // rags hanging from the hips
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const len = 0.35 + Math.random() * 0.35
    const strip = part(new THREE.PlaneGeometry(0.12, len).translate(0, -len / 2, 0), rags, J.hips, Math.sin(a) * 0.17, -0.02, Math.cos(a) * 0.13)
    strip.rotation.set(0.15 * Math.cos(a), a, 0.15 * Math.sin(a))
    ;(strip.material as THREE.Material).side = THREE.DoubleSide
    rig.addDangle(strip, { k: 26, c: 3, amt: 0.05, grav: 0.9 })
  }
  // stringy hair
  for (let i = 0; i < 8; i++) {
    const h = part(new THREE.CylinderGeometry(0.008, 0.004, 0.38, 3).translate(0, -0.19, 0), std(0x0d0c0b, 1), J.head, (Math.random() - 0.5) * 0.18, 0.24, -0.04 - Math.random() * 0.06)
    h.rotation.x = 0.2 + Math.random() * 0.4
    rig.addDangle(h, { k: 20, c: 2.5, amt: 0.04, grav: 0.8 })
  }
  rig.springScale = 0.85
  // claws
  for (const hand of [J.haL, J.haR]) {
    for (let i = 0; i < 3; i++) {
      const c = part(new THREE.ConeGeometry(0.012, 0.12, 4), std(0x1a1712, 0.6), hand, (i - 1) * 0.025, -0.12, 0.02)
      c.rotation.x = Math.PI + 0.3
    }
  }
  // jaw + eyes
  part(new THREE.BoxGeometry(0.1, 0.03, 0.03), std(0x050404, 1), J.head, 0, 0.06, 0.11)
  const eyeMat = glow(0.7, 1.7, 0.9)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(0.7, 1.7, 0.9)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.018, 6, 4), eyeMat, J.head, s * 0.045, 0.13, 0.105)
  return rig
}

export const UBYR_CLIPS: Record<string, Clip> = {
  swipe: [
    { t: 0, p: { chest: [0.25, -0.7, 0], shR: [-2.4, 0, -0.8], elR: [-0.6, 0, 0], shL: [-1.0, 0, 0.5], head: [-0.3, 0, 0] }, b: [0, 0, -0.08] },
    { t: 0.42, p: { chest: [0.1, -0.95, 0], shR: [-2.75, 0, -0.95], elR: [-0.7, 0, 0], head: [-0.4, 0, 0] }, b: [0.03, 0, -0.12] },
    { t: 0.52, p: { chest: [0.85, 0.6, 0], shR: [-0.6, 0, 0.6], elR: [-0.1, 0, 0], shL: [-0.3, 0, 0.3], head: [0.1, 0, 0] }, b: [-0.12, 0.28, 0.22] },
    { t: 1, p: { chest: [0.6, 0.1, 0], shR: [-0.3, 0, -0.2], elR: [-0.3, 0, 0] }, b: [-0.04, 0.05, 0.05] },
  ],
  lunge: [
    { t: 0, p: { chest: [0.8, 0, 0], shL: [0.8, 0, 0.5], shR: [0.8, 0, -0.5], thL: [-0.9, 0, 0], knL: [1.3, 0, 0], thR: [-0.6, 0, 0], knR: [1.2, 0, 0], head: [-0.6, 0, 0] }, b: [-0.32, 0, 0.3] },
    { t: 0.45, p: { chest: [0.9, 0, 0], shL: [0.9, 0, 0.55], shR: [0.9, 0, -0.55], thL: [-1.0, 0, 0], knL: [1.45, 0, 0], thR: [-0.7, 0, 0], knR: [1.35, 0, 0] }, b: [-0.38, 0, 0.32] },
    { t: 0.58, p: { chest: [0.4, 0, 0], shL: [-1.9, 0, 0.25], shR: [-1.9, 0, -0.25], elL: [-0.1, 0, 0], elR: [-0.1, 0, 0], thL: [-0.8, 0, 0], knL: [0.3, 0, 0], thR: [0.6, 0, 0], knR: [0.6, 0, 0], head: [-0.2, 0, 0] }, b: [0.2, 0.3, 0.55] },
    { t: 0.75, p: { chest: [0.9, 0, 0], shL: [-1.2, 0, 0.3], shR: [-1.2, 0, -0.3], thL: [-0.8, 0, 0], knL: [1.2, 0, 0] }, b: [-0.25, 0.2, 0.35] },
    { t: 1, p: { chest: [0.6, 0, 0] }, b: [0, 0, 0] },
  ],
  hurt: [
    { t: 0, p: { chest: [-0.4, 0.3, 0], head: [-0.6, 0, 0], shL: [-0.5, 0, 0.8], shR: [-0.5, 0, -0.8] }, b: [-0.05, -0.2, -0.2] },
    { t: 1, p: { chest: [0.5, 0, 0], head: [0, 0, 0] } },
  ],
  stagger: [
    { t: 0, p: { chest: [-0.5, 0, 0], head: [-0.6, 0, 0] }, b: [0, -0.2, -0.2] },
    { t: 0.2, p: { chest: [0.9, 0, 0], head: [0.7, 0, 0], shL: [0.3, 0, 0.2], shR: [0.3, 0, -0.2], thL: [-1.3, 0, 0], knL: [2.0, 0, 0], thR: [-0.3, 0, 0], knR: [1.6, 0, 0] }, b: [-0.45, 0, 0.3] },
    { t: 1, p: { chest: [1.0, 0, 0], head: [0.8, 0, 0], shL: [0.35, 0, 0.2], shR: [0.35, 0, -0.2], thL: [-1.3, 0, 0], knL: [2.0, 0, 0], thR: [-0.3, 0, 0], knR: [1.6, 0, 0] }, b: [-0.47, 0, 0.32] },
  ],
  death: [
    { t: 0, p: { chest: [-0.6, 0, 0], head: [-0.6, 0, 0] }, b: [0, -0.2, -0.3] },
    { t: 0.4, p: { chest: [0.3, 0, 0], thL: [-1.3, 0, 0], knL: [2.0, 0, 0], thR: [-1.3, 0, 0], knR: [2.0, 0, 0] }, b: [-0.45, 0, 0.1] },
    { t: 1, p: { chest: [0.2, 0, 0], shL: [-2.6, 0, 0.6], shR: [-2.4, 0, -0.6], thL: [0, 0, 0], knL: [0.2, 0, 0], thR: [0, 0, 0], knR: [0.2, 0, 0] }, b: [-0.75, 0.4, 1.5] },
  ],
}

// ======================================================================= SHADOW WOLF

export function createWolf() {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const fur = flashable(ref, 0x07080b, 1)
  const dark = flashable(ref, 0x030304, 0.9)
  const rig = new Quadruped({ bodyLen: 0.95, height: 0.7, legR: 0.034, fur, dark, runSpeed: 7 })
  rig.flashMats.push(...ref.flashMats)
  const eyeMat = glow(2.4, 0.35, 0.15)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(2.4, 0.35, 0.15)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.022, 6, 4), eyeMat, rig.joints.head, s * 0.07, 0.05, 0.13)
  // ragged mane on the shoulders and a bristling crest down the spine
  for (let i = 0; i < 16; i++) {
    const c = part(new THREE.ConeGeometry(0.05, 0.26, 4), fur, rig.joints.chest, (Math.random() - 0.5) * 0.3, 0.26 + Math.random() * 0.1, (Math.random() - 0.5) * 0.35)
    c.rotation.set(-0.7 + Math.random() * 0.3, 0, (Math.random() - 0.5) * 0.7)
  }
  for (let i = 0; i < 12; i++) {
    const z = 0.05 + (i / 12) * 0.85
    const c = part(new THREE.ConeGeometry(0.035, 0.18 - i * 0.006, 4), fur, rig.joints.pelvis, (Math.random() - 0.5) * 0.06, 0.2 + Math.sin((i / 12) * Math.PI) * 0.03, z)
    c.rotation.set(-1.0 + Math.random() * 0.3, 0, (Math.random() - 0.5) * 0.4)
  }
  // cheek ruff and a bushy tail
  for (const s of [-1, 1]) {
    const c = part(new THREE.ConeGeometry(0.05, 0.16, 4), fur, rig.joints.head, s * 0.12, -0.05, -0.04)
    c.rotation.set(0, 0, s * 1.9)
  }
  for (let i = 0; i < 6; i++) {
    const c = part(new THREE.ConeGeometry(0.06 - i * 0.006, 0.22, 5), fur, rig.joints.tail, (Math.random() - 0.5) * 0.04, -0.12 - i * 0.04, -0.15 - i * 0.07)
    c.rotation.set(-2.1 + Math.random() * 0.3, 0, 0)
  }
  return rig
}

export const WOLF_CLIPS: Record<string, Clip> = {
  crouch: [
    { t: 0, p: { chest: [0.25, 0, 0], neck: [0.4, 0, 0], head: [0.05, 0, 0], jaw: [0.55, 0, 0], uFL: [-0.6, 0, 0], lFL: [0.4, 0, 0], uFR: [-0.6, 0, 0], lFR: [0.4, 0, 0], uBL: [-0.5, 0, 0], lBL: [0.9, 0, 0], uBR: [-0.5, 0, 0], lBR: [0.9, 0, 0], tail: [0.2, 0, 0] }, b: [-0.16, -0.05, 0.06] },
    { t: 1, p: { chest: [0.3, 0, 0], neck: [0.45, 0, 0], jaw: [0.65, 0, 0], uBL: [-0.6, 0, 0], lBL: [1.1, 0, 0], uBR: [-0.6, 0, 0], lBR: [1.1, 0, 0] }, b: [-0.2, -0.08, 0.08] },
  ],
  leap: [
    { t: 0, p: { chest: [-0.2, 0, 0], neck: [-0.1, 0, 0], head: [0.3, 0, 0], jaw: [0.85, 0, 0], uFL: [-1.3, 0, 0], lFL: [-0.2, 0, 0], uFR: [-1.2, 0, 0], lFR: [-0.3, 0, 0], uBL: [1.1, 0, 0], lBL: [0.2, 0, 0], uBR: [1.0, 0, 0], lBR: [0.3, 0, 0], tail: [-0.8, 0, 0] }, b: [0.3, 0, -0.25] },
    { t: 0.6, p: { jaw: [0.05, 0, 0], head: [0.5, 0, 0] }, b: [0.15, 0, 0.05] },
    { t: 1, p: { jaw: [0.15, 0, 0], uFL: [-0.3, 0, 0], uBL: [0.3, 0, 0] }, b: [0, 0, 0] },
  ],
  hurt: [
    { t: 0, p: { chest: [-0.4, 0, 0], head: [-0.4, 0, 0], jaw: [0.6, 0, 0] }, b: [0.05, -0.15, -0.15] },
    { t: 1, p: { chest: [0, 0, 0], head: [0.3, 0, 0], jaw: [0.1, 0, 0] } },
  ],
  stagger: [
    { t: 0, p: { chest: [0.3, 0, 0], head: [0.6, 0, 0], uFL: [-0.9, 0, 0], lFL: [1.2, 0, 0], uFR: [-0.9, 0, 0], lFR: [1.2, 0, 0] }, b: [-0.3, 0, 0.12] },
    { t: 1, p: { chest: [0.35, 0, 0], head: [0.7, 0, 0], uFL: [-0.95, 0, 0], lFL: [1.3, 0, 0], uFR: [-0.95, 0, 0], lFR: [1.3, 0, 0] }, b: [-0.32, 0, 0.14] },
  ],
  death: [
    { t: 0, p: { head: [-0.6, 0, 0], jaw: [0.8, 0, 0] }, b: [0.1, -0.2, -0.3] },
    { t: 1, p: { head: [0.9, 0, 0], jaw: [0.3, 0, 0], uFL: [-1.3, 0, 0], lFL: [1.5, 0, 0], uFR: [-1.2, 0, 0], lFR: [1.5, 0, 0], uBL: [-1.0, 0, 0], lBL: [1.8, 0, 0], uBR: [-1.0, 0, 0], lBR: [1.8, 0, 0] }, b: [-0.42, 0, 0.05] },
  ],
}

// ======================================================================= ALBASTY

export interface MorokModel {
  rig: Humanoid
  handGlow: THREE.MeshBasicMaterial
}

export function createMorok(): MorokModel {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(ref, 0x9a9a92, 0.6)
  const dress = flashable(ref, 0x5d5b55, 0.95, { side: THREE.DoubleSide })
  const dark = flashable(ref, 0x0a0909, 1)
  const rig = new Humanoid({
    hipH: 0.95,
    thigh: 0.46,
    shin: 0.45,
    torso: 0.6,
    upperArm: 0.4,
    foreArm: 0.4,
    shoulderW: 0.34,
    hipW: 0.2,
    limbR: 0.042,
    headR: 0.115,
    skin,
    cloth: dress,
    dark,
    hunch: 0.2,
    armHang: 0.1,
    runSpeed: 3,
  })
  rig.flashMats.push(...ref.flashMats)
  const J = rig.joints
  part(new THREE.CylinderGeometry(0.18, 0.55, 1.15, 16, 3, true), dress, J.spine, 0, -0.5, 0)
  const hair = std(0x050505, 0.8)
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2
    const front = Math.cos(a) > 0.5
    const len = front ? 0.55 : 0.95 + Math.random() * 0.3
    const strand = part(new THREE.CapsuleGeometry(0.02, len, 2, 4).translate(0, -len / 2, 0), hair, J.head, Math.sin(a) * 0.1, 0.14, Math.cos(a) * 0.1)
    strand.rotation.x = front ? -0.05 : 0.08
    rig.addDangle(strand, { k: 9 + Math.random() * 4, c: 1.6, amt: 0.06, grav: 1, limit: 1.2 })
  }
  rig.springScale = 0.7
  const eyeMat = glow(1.2, 0.5, 2.2)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(1.2, 0.5, 2.2)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.016, 6, 4), eyeMat, J.head, s * 0.04, 0.12, 0.105)
  const handGlow = glow(0, 0, 0, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  for (const h of [J.haL, J.haR]) part(new THREE.SphereGeometry(0.09, 10, 8), handGlow, h, 0, -0.06, 0).castShadow = false
  return { rig, handGlow }
}

export const MOROK_CLIPS: Record<string, Clip> = {
  cast: [
    { t: 0, p: { shL: [-1.2, 0, 0.6], shR: [-1.2, 0, -0.6], elL: [-1.0, 0, 0], elR: [-1.0, 0, 0] } },
    { t: 0.2, p: { shL: [-2.3, 0, 0.7], shR: [-2.3, 0, -0.7], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], chest: [-0.35, 0, 0], head: [-0.4, 0, 0] }, b: [0.1, 0, -0.05] },
    { t: 0.55, p: { shL: [-2.5, 0, 0.8], shR: [-2.5, 0, -0.8], chest: [-0.45, 0, 0], head: [-0.5, 0, 0] }, b: [0.15, 0, -0.08] },
    { t: 0.65, p: { shL: [-1.6, 0, 0.15], shR: [-1.6, 0, -0.15], elL: [0, 0, 0], elR: [0, 0, 0], chest: [0.35, 0, 0], head: [0.1, 0, 0] }, b: [0, 0.15, 0.08] },
    { t: 1, p: { shL: [-0.4, 0, 0.2], shR: [-0.4, 0, -0.2], chest: [0.1, 0, 0] } },
  ],
  claw: [
    { t: 0, p: { shR: [-2.5, 0, -0.6], elR: [-0.5, 0, 0], chest: [0, -0.6, 0] } },
    { t: 0.4, p: { shR: [-2.8, 0, -0.7], chest: [-0.1, -0.8, 0] } },
    { t: 0.52, p: { shR: [-0.7, 0, 0.5], elR: [0, 0, 0], chest: [0.5, 0.6, 0] }, b: [0, 0.2, 0.1] },
    { t: 1, p: { shR: [-0.3, 0, -0.1], chest: [0.1, 0, 0] } },
  ],
  hurt: [
    { t: 0, p: { chest: [-0.5, 0.4, 0], head: [-0.6, 0, 0], shL: [-0.4, 0, 1.0], shR: [-0.4, 0, -1.0] }, b: [0, -0.2, -0.15] },
    { t: 1, p: { chest: [0, 0, 0], head: [0, 0, 0] } },
  ],
  stagger: [
    { t: 0, p: { chest: [0.9, 0, 0], head: [0.8, 0, 0], shL: [0.2, 0, 0.3], shR: [0.2, 0, -0.3] }, b: [-0.35, 0, 0.2] },
    { t: 1, p: { chest: [1.0, 0, 0], head: [0.85, 0, 0], shL: [0.25, 0, 0.3], shR: [0.25, 0, -0.3] }, b: [-0.38, 0, 0.22] },
  ],
  death: [
    { t: 0, p: { chest: [-0.7, 0, 0], head: [-0.8, 0, 0], shL: [-2.0, 0, 1.2], shR: [-2.0, 0, -1.2] }, b: [0.2, 0, -0.2] },
    { t: 1, p: { chest: [1.2, 0, 0], head: [0.6, 0, 0], shL: [0.3, 0, 0.3], shR: [0.3, 0, -0.3] }, b: [-0.9, 0, 0.4] },
  ],
}

// ======================================================================= SHURALE: master of the urman

export interface ShuraleModel {
  rig: Humanoid
  fingers: THREE.Object3D[]
}

export function createShurale(): ShuraleModel {
  const ref = { flashMats: [] as THREE.MeshStandardMaterial[] }
  const skin = flashable(ref, 0x2a2016, 0.9)
  const furM = flashable(ref, 0x1a1d12, 1)
  const dark = flashable(ref, 0x100c08, 1)
  const rig = new Humanoid({
    hipH: 1.55,
    thigh: 0.8,
    shin: 0.78,
    torso: 1.0,
    upperArm: 0.85,
    foreArm: 0.85,
    shoulderW: 0.66,
    hipW: 0.32,
    limbR: 0.075,
    headR: 0.2,
    skin,
    cloth: furM,
    dark,
    hunch: 0.38,
    armHang: 0.16,
    stride: 2.7,
    runSpeed: 6.5,
  })
  rig.flashMats.push(...ref.flashMats)
  const J = rig.joints
  const bone = std(0xc9bda4, 0.6)
  // horn
  const horn = part(new THREE.ConeGeometry(0.06, 0.55, 7), bone, J.head, 0, 0.4, 0.12)
  horn.rotation.x = 0.45
  // grin + teeth
  part(new THREE.TorusGeometry(0.11, 0.02, 4, 12, Math.PI), std(0x050303, 1), J.head, 0, 0.14, 0.17).rotation.set(0, 0, Math.PI)
  for (let i = 0; i < 6; i++) part(new THREE.ConeGeometry(0.01, 0.04, 3), bone, J.head, -0.08 + i * 0.032, 0.1, 0.18).rotation.x = Math.PI
  // fur tufts on shoulders and back
  for (let i = 0; i < 28; i++) {
    const c = part(new THREE.ConeGeometry(0.06, 0.32, 4), furM, J.chest, (Math.random() - 0.5) * 0.7, 0.2 + Math.random() * 0.35, -0.05 - Math.random() * 0.2)
    c.rotation.set(-0.9 + Math.random() * 0.6, 0, (Math.random() - 0.5) * 1.2)
  }
  for (let i = 0; i < 12; i++) {
    const c = part(new THREE.ConeGeometry(0.05, 0.28, 4), furM, J.hips, (Math.random() - 0.5) * 0.5, -0.1, (Math.random() - 0.5) * 0.4)
    c.rotation.set(Math.PI + (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)
  }
  // moss and hair hanging from forearms and jaw, swinging with every lunge
  const moss = std(0x1f2414, 1, { side: THREE.DoubleSide })
  for (const [jn, n] of [
    ['elL', 4],
    ['elR', 4],
    ['head', 5],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const len = 0.25 + Math.random() * 0.35
      const strip = part(new THREE.PlaneGeometry(0.06, len).translate(0, -len / 2, 0), moss, J[jn], (Math.random() - 0.5) * 0.12, jn === 'head' ? 0.08 : -0.2 - Math.random() * 0.5, jn === 'head' ? 0.12 : 0.06)
      strip.rotation.y = Math.random() * Math.PI
      rig.addDangle(strip, { k: 14, c: 2, amt: 0.05, grav: 1 })
    }
  }
  rig.springScale = 0.75
  // eyes
  const eyeMat = glow(2.4, 1.3, 0.25)
  rig.eyeMats.push(eyeMat)
  rig.baseEye.setRGB(2.4, 1.3, 0.25)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.03, 8, 6), eyeMat, J.head, s * 0.075, 0.26, 0.165)
  // very long fingers
  const fingers: THREE.Object3D[] = []
  for (const hand of [J.haL, J.haR]) {
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group()
      f.position.set((i - 1.5) * 0.035, -0.08, 0.02)
      f.rotation.set(0.15 + i * 0.05, 0, (i - 1.5) * 0.12)
      part(new THREE.CylinderGeometry(0.012, 0.02, 0.26, 4).translate(0, -0.13, 0), dark, f)
      const f2 = new THREE.Group()
      f2.position.y = -0.26
      f2.rotation.x = 0.35
      part(new THREE.CylinderGeometry(0.004, 0.012, 0.24, 4).translate(0, -0.12, 0), dark, f2)
      f.add(f2)
      hand.add(f)
      fingers.push(f)
    }
  }
  return { rig, fingers }
}

export const SHURALE_CLIPS: Record<string, Clip> = {
  swipeR: [
    { t: 0, p: { chest: [0.2, -0.8, 0], shR: [-1.3, 0, -1.6], elR: [-0.4, 0, 0], shL: [-0.6, 0, 0.6], head: [-0.2, 0, 0] } },
    { t: 0.45, p: { chest: [0.15, -1.0, 0], shR: [-1.4, 0.2, -1.75], elR: [-0.5, 0, 0] }, b: [-0.05, -0.05, 0] },
    { t: 0.56, p: { chest: [0.5, 0.8, 0], shR: [-1.4, 0, 0.9], elR: [-0.05, 0, 0], shL: [-0.2, 0, 0.3] }, b: [-0.12, 0.45, 0.2] },
    { t: 1, p: { chest: [0.4, 0.3, 0], shR: [-0.6, 0, 0.1], elR: [-0.3, 0, 0] } },
  ],
  swipeL: [
    { t: 0, p: { chest: [0.2, 0.8, 0], shL: [-1.3, 0, 1.6], elL: [-0.4, 0, 0], shR: [-0.6, 0, -0.6] } },
    { t: 0.4, p: { chest: [0.15, 1.0, 0], shL: [-1.4, -0.2, 1.75], elL: [-0.5, 0, 0] } },
    { t: 0.52, p: { chest: [0.5, -0.8, 0], shL: [-1.4, 0, -0.9], elL: [-0.05, 0, 0], shR: [-0.2, 0, -0.3] }, b: [-0.12, 0.45, 0.2] },
    { t: 1, p: { chest: [0.4, -0.3, 0], shL: [-0.6, 0, -0.1], elL: [-0.3, 0, 0] } },
  ],
  grab: [
    { t: 0, p: { shL: [-1.4, 0, 1.4], shR: [-1.4, 0, -1.4], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0], chest: [0.1, 0, 0], head: [-0.3, 0.3, 0.3] }, b: [-0.1, 0, 0] },
    { t: 0.5, p: { shL: [-1.5, 0, 1.6], shR: [-1.5, 0, -1.6], head: [-0.35, -0.3, -0.3], chest: [0.15, 0, 0] }, b: [-0.25, -0.1, 0.1] },
    { t: 0.62, p: { shL: [-1.6, 0, 0.25], shR: [-1.6, 0, -0.25], elL: [-0.2, 0, 0], elR: [-0.2, 0, 0], chest: [0.55, 0, 0], head: [0, 0, 0] }, b: [-0.25, 0.6, 0.35] },
    { t: 1, p: { shL: [-1.2, 0, 0.3], shR: [-1.2, 0, -0.3], chest: [0.5, 0, 0] }, b: [-0.1, 0.2, 0.2] },
  ],
  hold: [
    { t: 0, p: { shL: [-1.3, 0, 0.15], shR: [-1.3, 0, -0.15], elL: [-1.1, 0, 0], elR: [-1.1, 0, 0], chest: [0.2, 0, 0], head: [-0.4, 0, 0] } },
    { t: 0.5, p: { shL: [-1.4, 0, 0.1], shR: [-1.4, 0, -0.1], elL: [-1.2, 0, 0], elR: [-1.2, 0, 0], chest: [0.1, 0.15, 0], head: [-0.6, 0.2, 0.2] } },
    { t: 1, p: { shL: [-1.3, 0, 0.15], shR: [-1.3, 0, -0.15], elL: [-1.1, 0, 0], elR: [-1.1, 0, 0], chest: [0.2, -0.15, 0], head: [-0.4, -0.2, -0.2] } },
  ],
  leap: [
    { t: 0, p: { chest: [0.9, 0, 0], shL: [0.7, 0, 0.5], shR: [0.7, 0, -0.5], thL: [-1.1, 0, 0], knL: [1.8, 0, 0], thR: [-1.0, 0, 0], knR: [1.8, 0, 0] }, b: [-0.7, 0, 0.4] },
    { t: 0.3, p: { chest: [0.95, 0, 0], thL: [-1.2, 0, 0], knL: [2.0, 0, 0], thR: [-1.1, 0, 0], knR: [2.0, 0, 0] }, b: [-0.8, 0, 0.45] },
    { t: 0.45, p: { chest: [-0.3, 0, 0], shL: [-2.9, 0, 0.4], shR: [-2.9, 0, -0.4], thL: [-1.4, 0, 0], knL: [2.0, 0, 0], thR: [-1.2, 0, 0], knR: [1.9, 0, 0] }, b: [0, 0, -0.2] },
    { t: 1, p: { chest: [-0.2, 0, 0], shL: [-2.7, 0, 0.5], shR: [-2.7, 0, -0.5], thL: [-1.3, 0, 0], knL: [1.9, 0, 0], thR: [-1.1, 0, 0], knR: [1.8, 0, 0] } },
  ],
  land: [
    { t: 0, p: { chest: [0.8, 0, 0], shL: [-0.8, 0, 0.3], shR: [-0.8, 0, -0.3], elL: [0, 0, 0], elR: [0, 0, 0], thL: [-1.1, 0, 0], knL: [1.8, 0, 0], thR: [-0.9, 0, 0], knR: [1.7, 0, 0] }, b: [-0.75, 0.2, 0.45] },
    { t: 0.6, p: { chest: [0.7, 0, 0], shL: [-0.7, 0, 0.3], shR: [-0.7, 0, -0.3] }, b: [-0.6, 0.2, 0.4] },
    { t: 1, p: { chest: [0.4, 0, 0] }, b: [0, 0, 0] },
  ],
  roar: [
    { t: 0, p: { chest: [0.4, 0, 0], head: [0.3, 0, 0] }, b: [-0.1, 0, 0.1] },
    { t: 0.25, p: { chest: [-0.6, 0, 0], head: [-0.8, 0, 0], shL: [-0.7, 0, 1.4], shR: [-0.7, 0, -1.4], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0] }, b: [0.08, 0, -0.22] },
    { t: 0.85, p: { chest: [-0.65, 0, 0], head: [-0.85, 0, 0], shL: [-0.8, 0, 1.5], shR: [-0.8, 0, -1.5] }, b: [0.08, 0, -0.24] },
    { t: 1, p: { chest: [0.3, 0, 0], head: [0, 0, 0] } },
  ],
  hurt: [
    { t: 0, p: { chest: [-0.35, 0.2, 0], head: [-0.5, 0, 0] }, b: [0, -0.15, -0.12] },
    { t: 1, p: { chest: [0.3, 0, 0], head: [0, 0, 0] } },
  ],
  stagger: [
    { t: 0, p: { chest: [-0.5, 0, 0], head: [-0.6, 0, 0] }, b: [0, -0.3, -0.2] },
    { t: 0.2, p: { chest: [1.0, 0, 0], head: [0.5, 0, 0], shL: [0.4, 0, 0.3], shR: [0.4, 0, -0.3], thL: [-1.4, 0, 0], knL: [2.2, 0, 0], thR: [-0.4, 0, 0], knR: [1.8, 0, 0] }, b: [-0.85, 0, 0.35] },
    { t: 1, p: { chest: [1.1, 0, 0], head: [0.6, 0, 0], shL: [0.45, 0, 0.3], shR: [0.45, 0, -0.3], thL: [-1.4, 0, 0], knL: [2.2, 0, 0], thR: [-0.4, 0, 0], knR: [1.8, 0, 0] }, b: [-0.88, 0, 0.37] },
  ],
  death: [
    { t: 0, p: { chest: [-0.7, 0, 0], head: [-0.9, 0, 0], shL: [-0.9, 0, 1.4], shR: [-0.9, 0, -1.4] }, b: [0, -0.2, -0.25] },
    { t: 0.4, p: { chest: [0.6, 0, 0], thL: [-1.4, 0, 0], knL: [2.2, 0, 0], thR: [-1.4, 0, 0], knR: [2.2, 0, 0] }, b: [-0.9, 0, 0.2] },
    { t: 1, p: { chest: [0.3, 0, 0], shL: [-2.6, 0, 0.6], shR: [-2.4, 0, -0.6], thL: [0, 0, 0], knL: [0.2, 0, 0], thR: [0, 0, 0], knR: [0.2, 0, 0] }, b: [-1.4, 0.6, 1.5] },
  ],
}

// ======================================================================= ECHO: memory ghost

/** A translucent, cold silhouette of someone who died here (same build as the hero). */
export function createGhost() {
  // cold fresnel glow: edges bright, body almost empty, a faint scanline shimmer
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.3, 0.55, 1.0) }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 0.9 + uTime * 14.0);
        vec3 c = uColor * (0.12 + f * 1.7) * scan;
        gl_FragColor = vec4(c * uOpacity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
  const rig = new Humanoid({
    hipH: 0.95,
    thigh: 0.46,
    shin: 0.45,
    torso: 0.62,
    upperArm: 0.32,
    foreArm: 0.3,
    shoulderW: 0.46,
    hipW: 0.25,
    limbR: 0.066,
    headR: 0.13,
    skin: mat,
    cloth: mat,
    dark: mat,
    stride: 1.75,
    runSpeed: 5.2,
  })
  const J = rig.joints
  part(new THREE.CylinderGeometry(0.21, 0.34, 0.55, 12, 1, true).translate(0, -0.275, 0), mat, J.hips, 0, -0.02, 0)
  part(new THREE.CylinderGeometry(0.145, 0.15, 0.09, 12), mat, J.head, 0, 0.2, 0)
  part(new THREE.ConeGeometry(0.12, 0.2, 10), mat, J.head, 0, 0.33, 0)
  part(new THREE.IcosahedronGeometry(0.08, 0), mat, J.haR, 0, -0.12, 0)
  rig.root.traverse((o) => (o.castShadow = false))
  return { rig, mat }
}
