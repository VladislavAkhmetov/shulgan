// node tools/forest-audio.mjs <folder with tree,bush,fire,stream,wind,river.wav> [--river-only]
// Input: mono PCM16 / 24000 Hz. CC0 sources and edits: public/audio/forest/CREDITS.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const input = process.argv[2]
if (!input) throw new Error('Usage: node tools/forest-audio.mjs <source-folder>')
const riverOnly = process.argv.includes('--river-only')
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/audio/forest')
await mkdir(output, { recursive: true })
const rate = 24000

async function read(name) {
  const bytes = await readFile(path.join(input, name + '.wav'))
  let pcm, channels, sampleRate, bits, format
  for (let i = 12; i + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', i, i + 4), size = bytes.readUInt32LE(i + 4)
    if (tag === 'fmt ') {
      format = bytes.readUInt16LE(i + 8); channels = bytes.readUInt16LE(i + 10)
      sampleRate = bytes.readUInt32LE(i + 12); bits = bytes.readUInt16LE(i + 22)
    }
    if (tag === 'data') pcm = bytes.subarray(i + 8, i + 8 + size)
    i += 8 + size + size % 2
  }
  if (format !== 1 || sampleRate !== rate || channels !== 1 || bits !== 16 || !pcm)
    throw new Error(`${name}: expected mono PCM16 / ${rate} Hz`)
  return Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768)
}

// Butterworth filters remove microphone rumble and soften the distant canopy, retaining real transients.
function filter(data, frequency, highpass = false) {
  const w = 2 * Math.PI * frequency / rate, cos = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2
  const a0 = 1 + alpha, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0
  const b0 = (highpass ? 1 + cos : 1 - cos) / 2 / a0
  const b1 = (highpass ? -(1 + cos) : 1 - cos) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < data.length; i++) {
    const x = data[i], y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
    data[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y
  }
}

function wrap(data, seconds) {
  const overlap = Math.round(seconds * rate), count = data.length - overlap
  if (count <= overlap) throw new Error('Loop too short for overlap')
  const loop = data.slice(0, count)
  // Start at the tail, crossfade into the head, then continue through the middle.
  // Both the wrap boundary and the end of the crossfade remain continuous; no fade to silence.
  for (let i = 0; i < overlap; i++) {
    const t = i / (overlap - 1) * Math.PI / 2
    loop[i] = data[count + i] * Math.cos(t) + data[i] * Math.sin(t)
  }
  return loop
}

const sourceNames = riverOnly ? ['river'] : ['tree', 'bush', 'fire', 'stream', 'wind', 'river']
const sources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await read(name)])))
const clips = [
  // file, source, from, to, overlap (zero = one-shot), lowpass, target RMS
  ['wind-loop', 'wind', 15, 42, 2, 1800, 0.13],
  ['fire-loop', 'fire', 3, 20.4, 1.5, 7500, 0.15],
  ['river-loop', 'river', 8, 42, 2, 2800, 0.11],
  ['spring-loop', 'stream', 18, 33, 1.2, 5500, 0.13],
  ['creak-1', 'tree', 0.2, 2.6, 0, 4300, 0.15],
  ['creak-2', 'tree', 2.9, 5.4, 0, 4300, 0.15],
  ['creak-3', 'tree', 6.2, 8.2, 0, 4300, 0.15],
  ['creak-4', 'tree', 8.3, 10.7, 0, 4300, 0.15],
  ['rustle-1', 'bush', 1.0, 3.3, 0, 6500, 0.14],
  ['rustle-2', 'bush', 6.2, 8.0, 0, 6500, 0.14],
  ['rustle-3', 'bush', 12.4, 14.5, 0, 6500, 0.14],
  ['rustle-4', 'bush', 18.1, 20.0, 0, 6500, 0.14],
  ['rustle-5', 'bush', 25.0, 26.9, 0, 6500, 0.14],
]
let total = 0
for (const [name, source, from, to, overlap, cutoff, rms] of clips) {
  if (riverOnly && source !== 'river') continue
  if (sources[source].length < to * rate) throw new Error(`${source}: source shorter than ${to}s`)
  let data = sources[source].slice(Math.round(from * rate), Math.round(to * rate))
  filter(data, source === 'tree' ? 100 : source === 'river' ? 45 : 65, true)
  filter(data, cutoff)
  // The shallow mountain river needs a broad, subdued wash rather than close, bright droplets.
  if (source === 'river') filter(data, cutoff)
  // Tame isolated microphone clicks without flattening the body of the recording.
  const inputRms = Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length)
  const knee = inputRms * 3.5, headroom = inputRms * 2
  for (let i = 0; i < data.length; i++) {
    const x = data[i], a = Math.abs(x)
    if (a > knee) data[i] = Math.sign(x) * (knee + headroom * (1 - Math.exp(-(a - knee) / headroom)))
  }
  if (overlap) data = wrap(data, overlap)
  else for (let i = 0; i < data.length; i++) data[i] *= Math.min(1, i / (rate * 0.035), (data.length - 1 - i) / (rate * 0.15))
  let energy = 0, peak = 0
  for (const x of data) { energy += x * x; peak = Math.max(peak, Math.abs(x)) }
  const gain = Math.min(rms / Math.sqrt(energy / data.length), 0.85 / peak)
  const wav = Buffer.alloc(44 + data.length * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(data.length * 2, 40)
  for (let i = 0; i < data.length; i++) wav.writeInt16LE(Math.round(data[i] * gain * 32767), 44 + i * 2)
  await writeFile(path.join(output, name + '.wav'), wav)
  total += wav.length
  console.log(`${name}: ${(data.length / rate).toFixed(2)}s, RMS ${(Math.sqrt(energy / data.length) * gain).toFixed(3)}, peak ${(peak * gain).toFixed(3)}`)
}
console.log(`Total: ${(total / 1024 / 1024).toFixed(2)} MiB`)
