import * as THREE from 'three'

export type Tone = 'neutral' | 'threat' | 'magic' | 'scent'

interface Ind {
  pos: THREE.Vector3
  tone: Tone
  strength: number
  t: number
  life: number
  id: number | string | null
}

const COLORS: Record<Tone, [number, number, number]> = {
  neutral: [168, 188, 220],
  threat: [226, 112, 70],
  magic: [178, 124, 255],
  /** what Susar smells: warm gold */
  scent: [236, 190, 92],
}

/**
 * Hearing made visible: sounds whose source the hero cannot see leave a soft, deliberately
 * imprecise glow in the area they came from (or an arc on the screen edge when off-screen).
 */
export class SoundIndicators {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private list: Ind[] = []
  private w = 1
  private h = 1
  private v = new THREE.Vector3()
  enabled = true

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** distance = metres from the hero; adds positional uncertainty that grows with distance */
  push(src: THREE.Vector3, tone: Tone, strength: number, distance: number, id: number | string | null = null) {
    if (!this.enabled) return
    const fuzz = tone === 'scent' ? 0.3 + distance * 0.04 : 0.6 + distance * 0.12
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * fuzz
    if (id !== null) {
      const ex = this.list.find((i) => i.id === id && i.t < 0.5)
      if (ex) {
        ex.pos.lerp(new THREE.Vector3(src.x + Math.cos(a) * r, 0, src.z + Math.sin(a) * r), 0.35)
        ex.strength = Math.max(ex.strength * 0.8, strength)
        ex.t = Math.min(ex.t, 0.15)
        if (tone === 'threat') ex.tone = tone
        return
      }
    }
    this.list.push({ pos: new THREE.Vector3(src.x + Math.cos(a) * r, 0, src.z + Math.sin(a) * r), tone, strength: Math.min(1, strength), t: 0, life: tone === 'threat' ? 1.4 : 1.1, id })
    if (this.list.length > 40) this.list.shift()
  }

  clear() {
    this.list.length = 0
  }

  /** Thin health/posture bar above an enemy (drawn after draw()). */
  drawBar(x: number, y: number, hp: number, posture: number, broken: boolean) {
    const c = this.ctx
    const w = 54
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = 'rgba(8,6,6,0.65)'
    c.fillRect(x - w / 2 - 1, y - 1, w + 2, 5)
    c.fillStyle = 'rgba(176,52,38,0.95)'
    c.fillRect(x - w / 2, y, w * Math.max(0, hp), 3)
    if (posture > 0.02) {
      c.fillStyle = broken ? 'rgba(255,214,120,1)' : 'rgba(222,168,80,0.85)'
      const pw = w * Math.min(1, posture)
      c.fillRect(x - pw / 2, y + 5, pw, 2)
    }
  }

  draw(camera: THREE.Camera, dt: number) {
    const c = this.ctx
    c.clearRect(0, 0, this.w, this.h)
    if (!this.enabled) return
    c.globalCompositeOperation = 'lighter'
    const m = 34
    for (let i = this.list.length - 1; i >= 0; i--) {
      const ind = this.list[i]
      ind.t += dt / ind.life
      if (ind.t >= 1) {
        this.list.splice(i, 1)
        continue
      }
      this.v.copy(ind.pos).project(camera)
      let x = ((this.v.x + 1) / 2) * this.w
      let y = ((1 - this.v.y) / 2) * this.h
      if (this.v.z > 1) {
        x = this.w - x
        y = this.h - y
      }
      const [r, g, b] = COLORS[ind.tone]
      const fadeIn = Math.min(1, ind.t * 8)
      const life = 1 - ind.t
      const k = ind.strength * fadeIn * life
      const off = x < m || y < m || x > this.w - m || y > this.h - m
      if (!off) {
        const R = 30 + ind.strength * 46
        const grd = c.createRadialGradient(x, y, 0, x, y, R)
        grd.addColorStop(0, `rgba(${r},${g},${b},${0.2 * k})`)
        grd.addColorStop(0.55, `rgba(${r},${g},${b},${0.08 * k})`)
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`)
        c.fillStyle = grd
        c.beginPath()
        c.ellipse(x, y, R, R * 0.6, 0, 0, Math.PI * 2)
        c.fill()
        const rr = R * (0.35 + ind.t * 0.9)
        c.strokeStyle = `rgba(${r},${g},${b},${0.28 * k})`
        c.lineWidth = 1.5
        c.beginPath()
        c.ellipse(x, y, rr, rr * 0.6, 0, 0, Math.PI * 2)
        c.stroke()
        if (ind.tone === 'scent') {
          // a paw print: she smelled it, not heard it
          c.fillStyle = `rgba(${r},${g},${b},${0.75 * k})`
          c.beginPath()
          c.ellipse(x, y + 3, 5, 4, 0, 0, Math.PI * 2)
          c.fill()
          for (const [px, py] of [[-6, -4], [-2, -8], [2, -8], [6, -4]]) {
            c.beginPath()
            c.ellipse(x + px, y + py, 2, 2.4, 0, 0, Math.PI * 2)
            c.fill()
          }
        }
      } else {
        const cx = this.w / 2
        const cy = this.h / 2
        const ang = Math.atan2(y - cy, x - cx)
        const ex = Math.max(m, Math.min(this.w - m, x))
        const ey = Math.max(m, Math.min(this.h - m, y))
        const grd = c.createRadialGradient(ex, ey, 0, ex, ey, 70)
        grd.addColorStop(0, `rgba(${r},${g},${b},${0.22 * k})`)
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`)
        c.fillStyle = grd
        c.fillRect(ex - 70, ey - 70, 140, 140)
        c.strokeStyle = `rgba(${r},${g},${b},${0.45 * k})`
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(ex + Math.cos(ang + 1.9) * 16, ey + Math.sin(ang + 1.9) * 16)
        c.lineTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 6)
        c.lineTo(ex + Math.cos(ang - 1.9) * 16, ey + Math.sin(ang - 1.9) * 16)
        c.stroke()
      }
    }
    c.globalCompositeOperation = 'source-over'
  }
}
