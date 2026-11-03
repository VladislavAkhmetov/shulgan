# Natural wolf / canine recordings

Source pages and licenses checked on 2026-11-04. The howl is a recording of actual wolves;
close growls, barks, injury whines and breathy grunts are recordings of dogs, used as wolf vocal Foley.
No human imitations, generated voices, distortion layers or drastic pitch shifts are used.

## Howls — U.S. Fish and Wildlife Service, Public Domain

- Source: https://commons.wikimedia.org/wiki/File:Wolf_howls.ogg
- Original media: https://upload.wikimedia.org/wikipedia/commons/8/87/Wolf_howls.ogg
- Attribution/provenance: U.S. Fish and Wildlife Service, originally published at http://www.fws.gov/video/sound.htm.
- Rights: Public Domain / PD-USGov-FWS, as stated on the file description page.
- howl-1.wav: source 13.25–18.10 seconds.
- howl-2.wav: source 19.90–24.65 seconds.

## Growls and barks — klangfabrik, CC0 1.0

- Recording: **dog growls.wav** (a German Shepherd/Alsatian growling, with short barks near the end).
- Source: https://freesound.org/people/klangfabrik/sounds/434049/
- Source media (HQ MP3): https://cdn.freesound.org/previews/434/434049_181941-hq.mp3
- License: https://creativecommons.org/publicdomain/zero/1.0/

| Shipped file | Original range (seconds) |
|---|---|
| growl-1.wav | 1.50–3.60 |
| growl-2.wav | 4.25–5.55 |
| growl-3.wav | 6.80–8.35 |
| bark-1.wav | 12.25–13.15 |
| bark-2.wav | 13.40–14.10 |
| bark-3.wav | 14.35–15.15 |

## Death rasps — FOSSarts and klangfabrik, CC0 1.0

- Recording: **large dog grunt 1** by **FOSSarts**: an unedited recording of a large dog grunting at a stranger, recorded on a Zoom H1 essential.
- Source: https://freesound.org/people/FOSSarts/sounds/740541/
- Source media (HQ MP3): https://cdn.freesound.org/previews/740/740541_14631530-hq.mp3
- License: https://creativecommons.org/publicdomain/zero/1.0/
- Other rasp variants use the klangfabrik German Shepherd recording credited above.
- The previous Breviceps Whining Dog excerpts were rejected and removed from the shipped bank.
- The death cue is a short, fading grunt/rasp, not a recording of an animal dying.

| Shipped file | Source | Original range (seconds) |
|---|---|---|
| death-rasp-1.wav | FOSSarts | 2.00–3.02 |
| death-rasp-2.wav | klangfabrik | 3.00–4.10 |

## Approved injury / fright reactions — be-steele and qubodup

**Malamute Whine 1** by **be-steele** — licensed under **Creative Commons Attribution 4.0 International**.
- Original: https://freesound.org/people/be-steele/sounds/711212/
- License: https://creativecommons.org/licenses/by/4.0/
- HQ preview: https://cdn.freesound.org/previews/711/711212_589889-hq.mp3
- Source: Alaskan Malamute named Mars, short impatient whine; used as wolf injury/fright Foley.
- Changes: downmix/resample to mono 24000 Hz PCM16, gentle filtering, level matching and fades.
- Shipped file: hurt-malamute-1.wav, source 0–2.526875 seconds; original pitch/time retained.

**Whining Dog Training** by **qubodup** — CC0 1.0 Universal.
- Original: https://freesound.org/people/qubodup/sounds/825629/
- License: https://creativecommons.org/publicdomain/zero/1.0/
- HQ preview: https://cdn.freesound.org/previews/825/825629_71257-hq.mp3
- Source: Belgian Malinois whining/yelping during training; used as wolf injury/fright Foley.
- Changes: three excerpts, downmix/resample, gentle filtering, level matching and short fades.

| Shipped file | Original range (seconds) |
|---|---|
| hurt-malinois-1.wav | 5.94–6.75 |
| hurt-malinois-2.wav | 14.93–15.73 |
| hurt-malinois-3.wav | 20.22–21.04 |

These two sources were auditioned and approved by the user on 2026-11-04. They replace all three
hurt-rasp files. The previously rejected TobiasKosmos / aunrea auditions are not shipped.
The four injury clips are selected randomly without immediate repetition.

## Processing / rebuilding

Only mono conversion, gentle high-/low-pass filtering, level matching and short fades are applied.
The original pitch and timing are retained. Runtime individual differences are limited to about ±3%.
Output: mono PCM16 WAV / 24000 Hz, 14 clips, about 1127 KiB total. All playback is local.

Decode the five source recordings into `howl.wav`, `growl.wav`, `grunt.wav`, `malamute.wav`, `malinois.wav` in a source folder:
`ffmpeg -i <input> -ac 1 -ar 24000 <name>.wav`.
Then run `node tools/wolf-audio.mjs <source-folder>`.

To rebuild only the approved injury reactions: `node tools/wolf-audio.mjs <source-folder> --hurt-only`.
