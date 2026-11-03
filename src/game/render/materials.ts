import * as THREE from 'three'

/** Uniforms shared by every patched material (updated once per frame). */
export const globalUniforms = {
  uTime: { value: 0 },
  uPlayerScreen: { value: new THREE.Vector2(-9999, -9999) },
  uPlayerDepth: { value: 0 },
  uFadeRadius: { value: 220 },
  uCamWorld: { value: new THREE.Matrix4() },
}

interface PatchOpts {
  /** sway amplitude per metre of height above windStart */
  wind?: number
  windStart?: number
  /** dither-dissolve when standing between the camera and the hero */
  fade?: boolean
}

/**
 * Injects wind sway and the hero-occlusion dissolve into a built-in material.
 * The dissolve uses the hero's screen position: fragments closer to the camera than the hero
 * and within a screen radius around him are dithered away, so tall spruces never hide the action.
 */
export function patchMaterial<T extends THREE.Material>(mat: T, opts: PatchOpts): T {
  const wind = opts.wind ?? 0
  const windStart = opts.windStart ?? 1.5
  const fade = !!opts.fade
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime
    shader.uniforms.uPlayerScreen = globalUniforms.uPlayerScreen
    shader.uniforms.uPlayerDepth = globalUniforms.uPlayerDepth
    shader.uniforms.uFadeRadius = globalUniforms.uFadeRadius
    shader.uniforms.uCamWorld = globalUniforms.uCamWorld
    if (wind > 0) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            vec4 wpw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              wpw = instanceMatrix * wpw;
            #endif
            wpw = modelMatrix * wpw;
            float hh = max(position.y - ${windStart.toFixed(2)}, 0.0);
            float sw = sin(uTime * 1.1 + wpw.x * 0.35 + wpw.z * 0.27) + 0.45 * sin(uTime * 2.7 + wpw.x * 0.9 + wpw.z * 0.4);
            transformed.x += sw * hh * ${wind.toFixed(4)};
            transformed.z += cos(uTime * 0.93 + wpw.z * 0.31) * hh * ${(wind * 0.7).toFixed(4)};
          }`,
        )
    }
    if (fade) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform vec2 uPlayerScreen; uniform float uPlayerDepth; uniform float uFadeRadius; uniform mat4 uCamWorld;
          float bayer4(vec2 p){
            ivec2 i = ivec2(mod(p, 4.0));
            int idx = i.x + i.y * 4;
            float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
            return m[idx] / 16.0;
          }`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          /* glsl */ `#include <clipping_planes_fragment>
          {
            float rr = length(gl_FragCoord.xy - uPlayerScreen) / uFadeRadius;
            float front = uPlayerDepth - vViewPosition.z;
            if (front > 1.2) {
              // 1) dissolve a window around the hero
              float keep = smoothstep(0.55, 1.0, rr);
              // 2) camera-side cutaway: crowns standing between the camera and the play area are cut
              vec3 wpos = (uCamWorld * vec4(-vViewPosition, 1.0)).xyz;
              // trees right in front of the hero keep their lower body; ones near the camera are cut low,
              // so spruce skirts never become flat black shapes between the camera and the fight
              float h0 = mix(2.4, 0.7, smoothstep(3.0, 9.0, front));
              float cut = smoothstep(h0, h0 + 1.6, wpos.y) * smoothstep(2.0, 5.0, front);
              keep = min(keep, 1.0 - cut);
              if (keep < bayer4(gl_FragCoord.xy) * 0.92 + 0.04) discard;
            }
          }`,
        )
    }
  }
  mat.customProgramCacheKey = () => `fx-${wind}-${windStart}-${fade}`
  return mat
}

/** Cold fresnel rim so characters separate from the darkness (moonlit edge). */
export function rimMaterial<T extends THREE.MeshStandardMaterial>(mat: T, color = new THREE.Color(0.1, 0.13, 0.2)): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: color }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += uRim * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.5);',
      )
  }
  mat.customProgramCacheKey = () => 'rim'
  return mat
}

// ---------- Procedural textures ----------

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  draw(ctx, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Forest floor detail: needles, twigs, mottling. Multiplied with vertex colours. */
export function groundTexture() {
  return canvasTex(512, (ctx, s) => {
    const img = ctx.createImageData(s, s)
    for (let i = 0; i < s * s; i++) {
      const v = 200 + Math.random() * 55
      img.data[i * 4] = v
      img.data[i * 4 + 1] = v
      img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    // mottled patches
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * s
      const y = Math.random() * s
      const r = 6 + Math.random() * 30
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const dark = Math.random() < 0.6
      g.addColorStop(0, dark ? 'rgba(60,55,45,0.35)' : 'rgba(255,250,235,0.18)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // needles and twigs
    ctx.lineCap = 'round'
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * s
      const y = Math.random() * s
      const a = Math.random() * Math.PI * 2
      const l = 3 + Math.random() * 9
      const shade = Math.random() < 0.5 ? 'rgba(70,58,40,0.55)' : 'rgba(235,220,190,0.35)'
      ctx.strokeStyle = shade
      ctx.lineWidth = Math.random() < 0.95 ? 1 : 2.2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
  })
}

/** Conifer needles: fine directional strokes that break up flat facets. */
export function needleTexture() {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#c8c8c8'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 2200; i++) {
      const x = Math.random() * s
      const y = Math.random() * s
      const l = 4 + Math.random() * 10
      const a = Math.PI / 2 + (Math.random() - 0.5) * 0.9
      const v = Math.random()
      ctx.strokeStyle = v < 0.5 ? `rgba(40,40,40,${0.25 + Math.random() * 0.4})` : `rgba(255,255,255,${0.2 + Math.random() * 0.35})`
      ctx.lineWidth = 1 + Math.random()
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
  })
}

/** Birch bark: white with black lenticels. */
export function birchTexture() {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#e8e4da'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * s
      const x = Math.random() * s
      const w = 6 + Math.random() * 40
      const h = 1 + Math.random() * 4
      ctx.fillStyle = `rgba(20,18,16,${0.5 + Math.random() * 0.5})`
      ctx.fillRect(x, y, w, h)
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(120,110,95,${Math.random() * 0.25})`
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 1)
    }
  })
}

/** Rough bark / generic detail used on wood, stone and cloth. */
export function barkTexture() {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#bdb6aa'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * s
      ctx.strokeStyle = `rgba(30,25,20,${0.2 + Math.random() * 0.5})`
      ctx.lineWidth = 1 + Math.random() * 3
      ctx.beginPath()
      ctx.moveTo(x, 0)
      let cx = x
      for (let y = 0; y <= s; y += 16) {
        cx += (Math.random() - 0.5) * 6
        ctx.lineTo(cx, y)
      }
      ctx.stroke()
    }
  })
}

/** Bashkir-inspired ornament strip (kuskar / ram-horn motif) used on trim and UI-like props. */
export function ornamentTexture() {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#6e2a1c'
    ctx.fillRect(0, 0, s, s)
    ctx.strokeStyle = '#d9a441'
    ctx.lineWidth = 6
    const step = s / 4
    for (let i = 0; i < 4; i++) {
      const cx = i * step + step / 2
      const cy = s / 2
      ctx.beginPath()
      ctx.moveTo(cx, cy + step * 0.45)
      ctx.lineTo(cx, cy - step * 0.1)
      ctx.arc(cx - step * 0.18, cy - step * 0.1, step * 0.18, 0, Math.PI, true)
      ctx.moveTo(cx, cy - step * 0.1)
      ctx.arc(cx + step * 0.18, cy - step * 0.1, step * 0.18, Math.PI, 0, false)
      ctx.stroke()
    }
    ctx.fillStyle = '#d9a441'
    ctx.fillRect(0, 6, s, 6)
    ctx.fillRect(0, s - 12, s, 6)
  })
}

export function std(color: THREE.ColorRepresentation, rough = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra })
}

/** Unlit HDR colour – values above 1 bloom. */
export function glow(r: number, g: number, b: number, extra: THREE.MeshBasicMaterialParameters = {}) {
  const m = new THREE.MeshBasicMaterial({ ...extra })
  m.color.setRGB(r, g, b)
  return m
}
