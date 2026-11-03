// Process downloaded CC0 voice WAVs into a compact, consistent Ubyr bank.
// node tools/ubyr-audio.mjs <source-directory>
// Sources, download URLs and the soil recording are documented in public/audio/ubyr/CREDITS.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = process.argv[2]
if (!directory) throw new Error('Usage: node tools/ubyr-audio.mjs <source-directory>')
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/audio/ubyr')
await mkdir(output, { recursive: true })
const RATE = 22050

function readWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Expected RIFF/WAV')
  let channels, rate, bits, format, data
  for (let i = 12; i + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', i, i + 4), size = bytes.readUInt32LE(i + 4)
    if (name === 'fmt ') {
      format = bytes.readUInt16LE(i + 8)
      channels = bytes.readUInt16LE(i + 10)
      rate = bytes.readUInt32LE(i + 12)
      bits = bytes.readUInt16LE(i + 22)
    }
    if (name === 'data') data = bytes.subarray(i + 8, i + 8 + size)
    i += 8 + size + size % 2
  }
  if (![1, 65534].includes(format) || ![16, 24].includes(bits) || !data) throw new Error('Expected PCM16/24 WAV')
  const stride = bits / 8
  const mono = new Float32Array(data.length / stride / channels)
  for (let i = 0; i < mono.length; i++) {
    for (let c = 0; c < channels; c++) mono[i] += data.readIntLE((i * channels + c) * stride, stride) / (2 ** (bits - 1)) / channels
  }
  return { samples: mono, rate }
}

function filter(samples, rate, cutoff, highpass = false) {
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / rate)
  let low = 0
  for (let i = 0; i < samples.length; i++) {
    low += alpha * (samples[i] - low)
    samples[i] = highpass ? samples[i] - low : low
  }
}

function at(samples, index) {
  const i = Math.floor(index), f = index - i
  return i >= 0 && i < samples.length - 1 ? samples[i] * (1 - f) + samples[i + 1] * f : 0
}

function writeWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  bytes.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return bytes
}

const jobs = [
  ['groan-1', '2106.wav', 0, 3.2, 0.88],
  ['groan-2', '2106.wav', 5.0, 8.2, 0.88],
  ['groan-3', '2106.wav', 11.0, 14.0, 0.9],
  ['growl-1', 'zombie-1.wav', 0, 2, 0.82],
  ['growl-2', 'zombie-8.wav', 0, 2, 0.86],
  ['growl-3', 'zombie-15.wav', 0, 2, 0.84],
  ['attack-1', 'zombie-3.wav', 0, 2, 0.92],
  ['attack-2', 'zombie-6.wav', 0, 2, 0.9],
  ['attack-3', 'zombie-13.wav', 0, 2, 0.88],
  ['hurt-1', 'zombie-5.wav', 0, 2, 0.96],
  ['hurt-2', 'zombie-11.wav', 0, 2, 0.93],
  ['hurt-3', 'zombie-24.wav', 0, 2, 0.9],
  ['death-1', 'zombie-16.wav', 0, 3, 0.8],
  ['death-2', 'zombie-17.wav', 0, 3, 0.82],
  ['death-3', 'zombie-18.wav', 0, 3, 0.8],
]
let bytes = 0
for (const [name, filename, from, to, speed] of jobs) {
  const { samples, rate } = readWav(await readFile(path.resolve(directory, filename)))
  let input = samples.slice(Math.round(from * rate), Math.round(to * rate))
  filter(input, rate, 65, true)
  filter(input, rate, 6200)
  let first = 0, last = input.length - 1
  while (first < last && Math.abs(input[first]) < 0.008) first++
  while (last > first && Math.abs(input[last]) < 0.008) last--
  input = input.slice(Math.max(0, first - Math.round(rate * 0.015)), Math.min(input.length, last + Math.round(rate * 0.07)))
  const result = new Float32Array(Math.ceil(input.length / rate / speed * RATE))
  const lower = new Float32Array(result.length)
  for (let i = 0; i < result.length; i++) {
    result[i] = at(input, i * rate / RATE * speed)
    lower[i] = at(input, (i / RATE - 0.028) * rate * speed * 0.73)
  }
  filter(lower, RATE, 1100)
  let peak = 0, energy = 0
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.tanh((result[i] + lower[i] * 0.18) * 1.25)
    result[i] *= Math.min(1, i / (RATE * 0.012), (result.length - 1 - i) / (RATE * 0.055))
    peak = Math.max(peak, Math.abs(result[i])); energy += result[i] ** 2
  }
  const rms = Math.sqrt(energy / result.length)
  if (rms < 0.001) throw new Error(`${name}: selection is silent`)
  const gain = Math.min(0.19 / rms, 0.85 / peak)
  for (let i = 0; i < result.length; i++) result[i] *= gain
  const wav = writeWav(result)
  await writeFile(path.join(output, name + '.wav'), wav)
  bytes += wav.length
  console.log(`${name}: ${(result.length / RATE).toFixed(2)} s, ${wav.length} bytes`)
}
console.log(`Voice bank: ${(bytes / 1024).toFixed(0)} KiB, mono PCM16 / ${RATE} Hz`)
