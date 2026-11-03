# Ubyr sound bank

All source recordings listed below are released under **CC0 1.0 Universal**.
License: https://creativecommons.org/publicdomain/zero/1.0/
The recordings may be used, edited and redistributed commercially. These credits are retained voluntarily.
Source pages and licenses checked on 2026-11-04.

## Zombie vocalizations

**Zombies Sound Pack — artisticdude**, originally created for Summoning Wars.

- Source: https://opengameart.org/content/zombies-sound-pack
- Original archive: https://opengameart.org/sites/default/files/zombies.zip
- License on source page: CC0.

| Shipped files | Original recordings |
|---|---|
| growl-1.wav, growl-2.wav, growl-3.wav | zombie-1.wav, zombie-8.wav, zombie-15.wav |
| attack-1.wav, attack-2.wav, attack-3.wav | zombie-3.wav, zombie-6.wav, zombie-13.wav |
| hurt-1.wav, hurt-2.wav, hurt-3.wav | zombie-5.wav, zombie-11.wav, zombie-24.wav |
| death-1.wav, death-2.wav, death-3.wav | zombie-16.wav, zombie-17.wav, zombie-18.wav |

## Low groans

**Zombie #1 — Joseph SARDIN / BigSoundBank (LaSonothèque), sound 2106.**

- Source: https://bigsoundbank.com/zombie-1-s2106.html
- Source audio: https://bigsoundbank.com/UPLOAD/mp3/2106.mp3?v=d
- License on source page: CC0, free for commercial use, modification and redistribution.
- Shipped files: groan-1.wav, groan-2.wav, groan-3.wav, edited excerpts of that recording.

## Earth movement

**Hand digging dirt, leaves crunch.wav — SpliceSound**, Freesound 260130.

- Source: https://freesound.org/people/SpliceSound/sounds/260130/
- Source media (HQ MP3): https://cdn.freesound.org/previews/260/260130_1480854-hq.mp3
- License on source page: CC0.
- Recording description: digging through leaves and dense dirt with hands.
- Shipped files: earth-emerge-1.wav, earth-emerge-2.wav, 1.85 seconds each, mono PCM16 / 24000 Hz.
- Each contains three edited pulls of real soil/leaf recordings at 0 / 0.42 / 1.00 seconds, followed by settling debris.
- Variant 1 source ranges: 7.50–8.10, 9.00–9.67, 0.50–1.20 seconds. Playback rates: 0.84 / 0.90 / 0.82.
- Variant 2 source ranges: 13.00–13.60, 0.80–1.47, 15.00–15.70 seconds. Same playback rates.
- Subsonic rumble is removed, a filtered copy supplies body, peaks are softened and levels matched to RMS 0.21.
- The old, quiet Shovel Sound / soil.ogg has been removed.

## Processing

Voices are downmixed to mono, filtered, lowered in pitch, layered subtly with a darker copy,
softly saturated, level-matched and faded at the edges. Output is PCM16 WAV at 22050 Hz.
Runtime playback adds small individual pitch differences, HRTF positioning, forest reverb,
and a low-pass filter for voices below the ground. No remote audio service is used at runtime.

Rebuild voices: extract the original zombie WAVs into a source folder and decode the 2106 MP3 as
`2106.wav` in that folder (for example `ffmpeg -i 2106.mp3 -ac 1 -ar 22050 2106.wav`).
Run `node tools/ubyr-audio.mjs <source-folder>`.

Rebuild earth: decode the SpliceSound recording to mono PCM16 / 24000 Hz (`ffmpeg -i input.mp3 -ac 1 -ar 24000 earth.wav`),
then run `node tools/ubyr-earth.mjs earth.wav`. All audible material in these cues comes from the source recording.
