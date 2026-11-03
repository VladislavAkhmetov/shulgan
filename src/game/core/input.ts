// Keyboard + mouse state with per-frame edge detection.

export class Input {
  private down = new Set<string>()
  private pressedSet = new Set<string>()
  private releasedSet = new Set<string>()
  mouseX = 0
  mouseY = 0
  wheel = 0
  private el: HTMLElement
  enabled = true
  /** Gamepad sticks (screen space: x right, y up), 0 when idle */
  moveX = 0
  moveY = 0
  aimX = 0
  aimY = 0
  /** true while the last meaningful input came from a gamepad */
  padActive = false
  private padPrev: Record<string, boolean> = {}

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    el.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('wheel', this.onWheel, { passive: true })
    el.addEventListener('contextmenu', this.onContext)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointermove', this.onPointerMove)
    this.el.removeEventListener('wheel', this.onWheel)
    this.el.removeEventListener('contextmenu', this.onContext)
  }

  /** Pressed this frame regardless of `enabled` (menus). */
  rawPressed(code: string) {
    return this.pressedSet.has(code)
  }

  /** Poll the first connected gamepad and map it onto the same virtual codes as keyboard/mouse. */
  pollPad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    let gp: Gamepad | null = null
    for (const p of pads) if (p && p.connected) gp = p
    if (!gp) {
      this.moveX = this.moveY = this.aimX = this.aimY = 0
      return
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82)
    this.moveX = dz(gp.axes[0] ?? 0)
    this.moveY = -dz(gp.axes[1] ?? 0)
    this.aimX = dz(gp.axes[2] ?? 0)
    this.aimY = -dz(gp.axes[3] ?? 0)
    const map: [number, string][] = [
      [0, 'Space'],
      [1, 'KeyQ'],
      [2, 'KeyF'],
      [3, 'KeyE'],
      [4, 'ShiftLeft'],
      [12, 'KeyR'],
      [5, 'KeyT'],
      [6, 'Mouse2'],
      [7, 'Mouse0'],
      [9, 'PadStart'],
      [8, 'PadView'],
      [14, 'KeyZ'],
      [15, 'KeyC'],
      [13, 'PadWeapon'],
      [10, 'KeyV'],
    ]
    let any = Math.hypot(this.moveX, this.moveY) > 0 || Math.hypot(this.aimX, this.aimY) > 0
    for (const [i, code] of map) {
      const b = gp.buttons[i]
      const on = !!b && (b.pressed || b.value > 0.4)
      const was = !!this.padPrev[code]
      if (on && !was) this.press(code)
      if (!on && was) this.release(code)
      this.padPrev[code] = on
      any = any || on
    }
    if (any) this.padActive = true
  }

  isDown(code: string) {
    return this.enabled && this.down.has(code)
  }
  pressed(code: string) {
    return this.enabled && this.pressedSet.has(code)
  }
  released(code: string) {
    return this.releasedSet.has(code)
  }
  endFrame() {
    this.pressedSet.clear()
    this.releasedSet.clear()
    this.wheel = 0
  }
  /** Release everything (used when a menu opens). */
  reset() {
    for (const c of this.down) this.releasedSet.add(c)
    this.down.clear()
  }

  private press(code: string) {
    if (!this.down.has(code)) this.pressedSet.add(code)
    this.down.add(code)
  }
  private release(code: string) {
    if (this.down.has(code)) this.releasedSet.add(code)
    this.down.delete(code)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault()
    if (e.repeat) return
    this.press(e.code)
  }
  private onKeyUp = (e: KeyboardEvent) => this.release(e.code)
  private onBlur = () => this.reset()
  private onPointerDown = (e: PointerEvent) => {
    this.updateMouse(e)
    this.press('Mouse' + e.button)
  }
  private onPointerUp = (e: PointerEvent) => this.release('Mouse' + e.button)
  private onPointerMove = (e: PointerEvent) => {
    this.updateMouse(e)
    this.padActive = false
  }
  private onWheel = (e: WheelEvent) => {
    this.wheel += Math.sign(e.deltaY)
  }
  private onContext = (e: Event) => e.preventDefault()
  private updateMouse(e: PointerEvent) {
    const r = this.el.getBoundingClientRect()
    this.mouseX = e.clientX - r.left
    this.mouseY = e.clientY - r.top
  }
}
