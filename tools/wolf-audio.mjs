// Build the natural wolf voice bank from decoded, mono PCM16 source WAVs.
// node tools/wolf-audio.mjs <source-directory> [--hurt-only]
// Provenance and source ranges: public/audio/wolf/CREDITS.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = process.argv[2]
const hurtOnly = process.argv.includes('--hurt-only')
if (!directory) throw new Error('Usage: node tools/wolf-audio.mjs <source-directory>')
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/audio/wolf')
await mkdir(output, { recursive: true })
const RATE = 24000
function readWav(bytes) {
  let rate, channels, bits, data
  for (let i = 12; i + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', i, i + 4), size = bytes.readUInt32LE(i + 4)
    if (name === 'fmt ') { channels = bytes.readUInt16LE(i + 10); rate = bytes.readUInt32LE(i + 12); bits = bytes.readUInt16LE(i + 22) }
    if (name === 'data') data = bytes.subarray(i + 8, i + 8 + size)
    i += 8 + size + size % 2
  }
  if (rate !== RATE || channels !== 1 || bits !== 16 || !data) throw new Error('Decode sources to mono PCM16 / 24000 Hz first')
  return Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768)
}
function writeWav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2)
  return b
}
const jobs = [
  ['howl-1', 'howl', 13.25, 18.1], ['howl-2', 'howl', 19.9, 24.65],
  ['growl-1', 'growl', 1.5, 3.6], ['growl-2', 'growl', 4.25, 5.55], ['growl-3', 'growl', 6.8, 8.35],
  ['bark-1', 'growl', 12.25, 13.15], ['bark-2', 'growl', 13.4, 14.1], ['bark-3', 'growl', 14.35, 15.15],
  ['hurt-malamute-1', 'malamute', 0, 2.526875],
  ['hurt-malinois-1', 'malinois', 5.94, 6.75], ['hurt-malinois-2', 'malinois', 14.93, 15.73], ['hurt-malinois-3', 'malinois', 20.22, 21.04],
  ['death-rasp-1', 'grunt', 2.0, 3.02], ['death-rasp-2', 'growl', 3.0, 4.1],
]
let total = 0
let count = 0
for (const [name, file, from, to] of jobs) {
  if (hurtOnly && !name.startsWith('hurt-')) continue
  const source = readWav(await readFile(path.resolve(directory, file + '.wav')))
  if (source.length < Math.round(to * RATE)) throw new Error(`${file}: source shorter than ${to}s`)
  const data = source.slice(Math.round(from * RATE), Math.round(to * RATE))
  // Remove rumble and phone hiss gently. No pitch change, distortion, synthetic layers or time stretching.
  let low = 0, top = 0
  const highpass = file === 'malinois' ? 0.026 : 1 - Math.exp(-2 * Math.PI * 65 / RATE)
  const lowpass = file === 'malinois' ? 0.58 : 1 - Math.exp(-2 * Math.PI * 8500 / RATE)
  let peak = 0, energy = 0
  const attack = name.startsWith('howl') ? 0.12 : 0.012
  const release = name.startsWith('death') ? 0.28 : name.startsWith('howl') ? 0.2 : 0.065
  for (let i = 0; i < data.length; i++) {
    low += highpass * (data[i] - low)
    top += lowpass * (data[i] - low - top)
    data[i] = top * Math.min(1, i / (RATE * attack), (data.length - 1 - i) / (RATE * release))
    energy += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]))
  }
  const rms = Math.sqrt(energy / data.length)
  if (rms < 0.001) throw new Error(`${name}: empty selection`)
  const gain = Math.min((name.startsWith('hurt-') ? 0.14 : 0.15) / rms, 0.8 / peak)
  for (let i = 0; i < data.length; i++) data[i] *= gain
  const bytes = writeWav(data)
  await writeFile(path.join(output, name + '.wav'), bytes)
  total += bytes.length
  count++
  console.log(`${name}: ${(data.length / RATE).toFixed(2)} s`)
}
console.log(`Total: ${(total / 1024).toFixed(0)} KiB, ${count} mono recordings`)
