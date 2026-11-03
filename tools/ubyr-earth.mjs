// node tools/ubyr-earth.mjs <mono-PCM16-24000-Hz-source.wav>
// CC0 source: SpliceSound, Hand digging dirt, leaves crunch.wav (Freesound 260130).
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.argv[2]) throw new Error('Usage: node tools/ubyr-earth.mjs <source.wav>')
const bytes = await readFile(process.argv[2])
let pcm, rate, channels, bits
for (let i = 12; i + 8 <= bytes.length;) {
  const tag = bytes.toString('ascii', i, i + 4), size = bytes.readUInt32LE(i + 4)
  if (tag === 'fmt ') { channels = bytes.readUInt16LE(i + 10); rate = bytes.readUInt32LE(i + 12); bits = bytes.readUInt16LE(i + 22) }
  if (tag === 'data') pcm = bytes.subarray(i + 8, i + 8 + size)
  i += 8 + size + size % 2
}
if (rate !== 24000 || channels !== 1 || bits !== 16 || !pcm) throw new Error('Expected mono PCM16 / 24000 Hz')
const source = Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768)
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/audio/ubyr')
const DURATION = 1.85
const mixes = [
  [[0, 7.5, 0.6, 0.84], [0.42, 9.0, 0.67, 0.9], [1.0, 0.5, 0.7, 0.82]],
  [[0, 13.0, 0.6, 0.84], [0.42, 0.8, 0.67, 0.9], [1.0, 15.0, 0.7, 0.82]],
]
for (let index = 0; index < mixes.length; index++) {
  const mix = new Float32Array(Math.round(rate * DURATION))
  for (const [at, from, length, speed] of mixes[index]) {
    const clip = source.slice(Math.round(from * rate), Math.round((from + length) * rate))
    const energy = clip.reduce((sum, x) => sum + x * x, 0)
    const gain = 0.18 / Math.max(0.001, Math.sqrt(energy / clip.length))
    const count = Math.ceil(clip.length / speed)
    for (let i = 0; i < count; i++) {
      const sample = i * speed, a = Math.floor(sample), f = sample - a
      const x = ((clip[a] ?? 0) * (1 - f) + (clip[a + 1] ?? 0) * f) * gain
      const dest = Math.round(at * rate) + i
      if (dest >= mix.length) break
      mix[dest] += x * Math.min(1, i / (rate * 0.008), (count - 1 - i) / (rate * 0.07))
    }
  }
  let bass = 0, low = 0, energy = 0, peak = 0
  for (let i = 0; i < mix.length; i++) {
    low += 0.016 * (mix[i] - low) // remove subsonic handling rumble
    const dry = mix[i] - low
    bass += 0.14 * (dry - bass)
    mix[i] = Math.tanh((dry + bass * 0.35) * 2.2) * Math.min(1, i / (rate * 0.012), (mix.length - 1 - i) / (rate * 0.12))
    energy += mix[i] ** 2; peak = Math.max(peak, Math.abs(mix[i]))
  }
  const gain = Math.min(0.21 / Math.sqrt(energy / mix.length), 0.9 / peak)
  const wav = Buffer.alloc(44 + mix.length * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(mix.length * 2, 40)
  for (let i = 0; i < mix.length; i++) wav.writeInt16LE(Math.round(mix[i] * gain * 32767), 44 + i * 2)
  const name = `earth-emerge-${index + 1}.wav`
  await writeFile(path.join(output, name), wav)
  console.log(`${name}: ${DURATION}s, RMS ${(Math.sqrt(energy / mix.length) * gain).toFixed(3)}, peak ${(peak * gain).toFixed(3)}`)
}
