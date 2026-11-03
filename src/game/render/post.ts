import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { GLSL_NOISE } from '../util'

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

/**
 * Render pipeline:
 *  scene -> HDR MSAA target (+depth)
 *  vision pass: reconstructs world position from depth, applies the line-of-sight mask
 *               (visible / remembered / unknown), ground mist and fog
 *  ghost overlay: eagle-revealed enemies drawn as glowing silhouettes on top of the darkness
 *  bloom
 *  final: tone mapping, grading, vignette, grain, damage / low-hp / slow-mo treatment
 */
export class PostFX {
  readonly sceneRT: THREE.WebGLRenderTarget
  readonly rtA: THREE.WebGLRenderTarget
  readonly bloom: UnrealBloomPass
  readonly visionMat: THREE.ShaderMaterial
  readonly finalMat: THREE.ShaderMaterial
  private visionQuad: FullScreenQuad
  private finalQuad: FullScreenQuad
  readonly ghostMat: THREE.MeshBasicMaterial
  bloomOn = true

  constructor(
    private renderer: THREE.WebGLRenderer,
    w: number,
    h: number,
  ) {
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(w, h),
    })
    this.rtA = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType })
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.5, 0.95)

    this.visionMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tVis: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uVisMin: { value: new THREE.Vector2() },
        uVisSize: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uVisionOn: { value: 1 },
        uFogColor: { value: new THREE.Color(0.035, 0.05, 0.085) },
        uMist: { value: 1 },
      },
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tVis;
        uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCamPos;
        uniform vec2 uVisMin; uniform vec2 uVisSize; uniform float uTime; uniform float uVisionOn;
        uniform vec3 uFogColor; uniform float uMist;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          vec3 col = texture2D(tColor, vUv).rgb;
          float d = texture2D(tDepth, vUv).r;
          vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec4 vp = uProjInv * ndc; vp /= vp.w;
          vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
          bool sky = d > 0.99999;

          // Organic, slowly breathing edge for the vision mask.
          vec2 n = vec2(vnoise(wp.xz * 1.1 + uTime * 0.25), vnoise(wp.zx * 1.1 - uTime * 0.21)) - 0.5;
          vec2 vuv = (wp.xz + n * 0.45 - uVisMin) / uVisSize;
          vec2 vs = texture2D(tVis, vuv).rg;
          float vis = smoothstep(0.02, 0.85, vs.r);
          float expl = vs.g;

          // Low ground mist, drifting.
          float mh = exp(-max(wp.y, 0.0) * 1.35);
          float mn = fbm(wp.xz * 0.11 + vec2(uTime * 0.045, uTime * 0.028));
          float mn2 = fbm(wp.xz * 0.35 - vec2(uTime * 0.07, 0.0));
          float mist = mh * smoothstep(0.3, 0.9, mn * 0.75 + mn2 * 0.35) * 0.5 * uMist;
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, uFogColor + col * 0.7, mist * 0.4);
          col += uFogColor * mist * 0.18;

          // Hidden areas: unknown = near black, remembered = cold desaturated ghost of the scene.
          vec3 dark = vec3(0.0025, 0.0035, 0.007);
          vec3 memory = vec3(lum) * vec3(0.45, 0.55, 0.85) * 0.2 + vec3(0.006, 0.009, 0.016);
          vec3 hidden = mix(dark, memory, expl * 0.9);
          float v = mix(1.0, vis, uVisionOn);
          col = mix(hidden, col, v);
          if (sky) col = dark;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })

    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        uExposure: { value: 1.25 },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(w, h) },
        uDamage: { value: 0 },
        uLowHp: { value: 0 },
        uSlowmo: { value: 0 },
        uFade: { value: 0 },
        uWarm: { value: 0 },
      },
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform float uExposure; uniform float uTime; uniform vec2 uRes;
        uniform float uDamage; uniform float uLowHp; uniform float uSlowmo; uniform float uFade; uniform float uWarm;
        varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          vec2 c = vUv - 0.5;
          float ca = 0.0012 + uDamage * 0.006 + uSlowmo * 0.003;
          vec3 col;
          col.r = texture2D(tColor, vUv + c * ca).r;
          col.g = texture2D(tColor, vUv).g;
          col.b = texture2D(tColor, vUv - c * ca).b;
          col *= uExposure;
          col = aces(col);
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          // split-tone: cold shadows, warm highlights
          col += vec3(-0.006, 0.0, 0.016) * (1.0 - l) + vec3(0.02, 0.008, -0.01) * l;
          col = mix(col, col * vec3(1.12, 0.98, 0.85) + vec3(0.02, 0.01, 0.0), uWarm);
          col = mix(col, vec3(l), clamp(uLowHp * 0.55 + uSlowmo * 0.35, 0.0, 1.0));
          float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.15)) * 1.25);
          col *= mix(0.28, 1.0, vig);
          float pulse = uLowHp * (0.5 + 0.5 * sin(uTime * 6.0));
          col = mix(col, vec3(0.28, 0.0, 0.0), clamp(uDamage * 0.9 + pulse * 0.25, 0.0, 1.0) * (1.0 - vig));
          col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
          col += (h(vUv * uRes + fract(uTime * 13.0) * 91.0) - 0.5) * 0.028;
          col *= 1.0 - uFade;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })

    this.visionQuad = new FullScreenQuad(this.visionMat)
    this.finalQuad = new FullScreenQuad(this.finalMat)
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 0.7, 0.25),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
  }

  setSize(w: number, h: number) {
    this.sceneRT.setSize(w, h)
    this.rtA.setSize(w, h)
    this.bloom.setSize(w, h)
    this.finalMat.uniforms.uRes.value.set(w, h)
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, visTex: THREE.Texture, dt: number, ghosts: boolean, overlay?: THREE.Scene) {
    const r = this.renderer
    r.setRenderTarget(this.sceneRT)
    r.clear()
    r.render(scene, camera)

    const vu = this.visionMat.uniforms
    vu.tColor.value = this.sceneRT.texture
    vu.tDepth.value = this.sceneRT.depthTexture
    vu.tVis.value = visTex
    vu.uProjInv.value.copy(camera.projectionMatrixInverse)
    vu.uCamWorld.value.copy(camera.matrixWorld)
    vu.uCamPos.value.copy(camera.position)
    r.setRenderTarget(this.rtA)
    this.visionQuad.render(r)

    if (ghosts) {
      const prevAuto = r.autoClear
      const prevMask = camera.layers.mask
      r.autoClear = false
      camera.layers.set(2)
      scene.overrideMaterial = this.ghostMat
      const sm = r.shadowMap.enabled
      r.shadowMap.enabled = false
      r.render(scene, camera)
      r.shadowMap.enabled = sm
      scene.overrideMaterial = null
      camera.layers.mask = prevMask
      r.autoClear = prevAuto
    }

    // visions (memory echoes) are drawn over the darkness: they are seen with the mind, not the eyes
    if (overlay && overlay.children.some((c) => c.visible)) {
      const prevAuto = r.autoClear
      r.autoClear = false
      const sm = r.shadowMap.enabled
      r.shadowMap.enabled = false
      r.setRenderTarget(this.rtA)
      r.render(overlay, camera)
      r.shadowMap.enabled = sm
      r.autoClear = prevAuto
    }

    if (this.bloomOn) this.bloom.render(r, this.rtA, this.rtA, dt, false)

    this.finalMat.uniforms.tColor.value = this.rtA.texture
    r.setRenderTarget(null)
    this.finalQuad.render(r)
  }

  dispose() {
    this.sceneRT.dispose()
    this.rtA.dispose()
    this.bloom.dispose()
    this.visionMat.dispose()
    this.finalMat.dispose()
  }
}
