/**
 * Melee weapons as physical objects: how far the striking part travels decides both the hit volume
 * and the slash trail (docs/COMBAT.md, «Длина оружия»). Distances are metres from the body axis.
 */
export interface MeleeWeapon {
  id: string
  name: string
  /** body axis → grip with the arm out: one hand reaches further, two hands hold closer to the chest */
  arm: number
  /** grip → tip */
  length: number
  /** the part that cuts or crushes, measured back from the tip: the whole blade, or just an axe/hammer head */
  edge: number
  /** how far past the tip a blow still connects: the body steps into it and animation is not exact */
  slack: number
}

export const WEAPONS = {
  // 60 cm blade + guard (models.ts: L = 0.6, blade starts 7.5 cm below the grip centre)
  kylys: { id: 'kylys', name: 'Кылыс', arm: 0.78, length: 0.68, edge: 0.6, slack: 0.2 },
  // not in the game yet: numbers for when their movesets arrive
  longsword: { id: 'longsword', name: 'Двуручный меч', arm: 0.6, length: 1.25, edge: 1.0, slack: 0.2 },
  axe: { id: 'axe', name: 'Топор', arm: 0.7, length: 0.8, edge: 0.2, slack: 0.15 },
  hammer: { id: 'hammer', name: 'Молот', arm: 0.62, length: 0.95, edge: 0.25, slack: 0.15 },
} satisfies Record<string, MeleeWeapon>

/** where the tip passes; `ext` is the blow's own extension (a thrust reaches past the swing) */
export const tipReach = (w: MeleeWeapon, ext = 0) => w.arm + w.length + ext

/** hit range of a blow (inArc adds the target's radius on top) */
export const hitRange = (w: MeleeWeapon, ext = 0) => tipReach(w, ext) + w.slack

/** the band the slash trail covers: from the base of the striking part to the tip */
export const trailBand = (w: MeleeWeapon, ext = 0) => ({ inner: tipReach(w, ext) - w.edge, outer: tipReach(w, ext) })
