# Аманат — ночной лес, огонь и вода

Исходные записи опубликованы авторами на Freesound и BigSoundBank под **CC0 1.0 Universal**:
https://creativecommons.org/publicdomain/zero/1.0/
Разрешены использование в игре, изменение и распространение, в том числе коммерческое.
Авторы и первоисточники сохранены ниже. Проверено 4 ноября 2026 года.

| Запись | Автор и страница | Использование |
|---|---|---|
| tree_creak_04.wav | [Department64](https://freesound.org/people/Department64/sounds/95262/) | Четыре скрипа настоящего дерева: ветви на ветру |
| Bushes Rustling.WAV | [G.Lamont](https://freesound.org/people/G.Lamont/sounds/117884/) | Пять разных фрагментов шелеста лесного куста |
| Fire Crackle and Flames 002 | [TheWoodlandNomad](https://freesound.org/people/TheWoodlandNomad/sounds/363092/) | Непрерывный треск поленьев и шум пламени костров/жаровен |
| Water, small stream | [peridactyloptrix](https://freesound.org/people/peridactyloptrix/sounds/197705/) | Петля родника |
| Mountain stream #1 | [Pierre SIBANARCO / BigSoundBank](https://bigsoundbank.com/mountain-stream-1-s2754.html) | Приглушённый ровный шум мелкой горной речки |
| Wind in Trees | [bone666138](https://freesound.org/people/bone666138/sounds/520183/) | Тихий ветер в кронах, естественные порывы |

Использованы авторские HQ MP3 previews Freesound и MP3 из библиотеки BigSoundBank:

- tree: https://cdn.freesound.org/previews/95/95262_861714-hq.mp3
- bush: https://cdn.freesound.org/previews/117/117884_2110106-hq.mp3
- fire: https://cdn.freesound.org/previews/363/363092_6612464-hq.mp3
- stream: https://cdn.freesound.org/previews/197/197705_2737063-hq.mp3
- wind: https://cdn.freesound.org/previews/520/520183_285997-hq.mp3 (достаточно первых 60 секунд)
- river: https://bigsoundbank.com/UPLOAD/mp3/2754.mp3 (для игрового монтажа достаточно первых 60 секунд)

## Подготовка

Исходные MP3 декодированы в mono PCM16 / 24000 Гц. Из этой папки исходников
`node tools/forest-audio.mjs <folder>` воспроизводимо собирает игровые WAV.
Моно позволяет HRTF-панораме задавать направление каждого источника на карте.
Убраны инфранизкий гул микрофона и резкие одиночные пики мягким ограничением;
выравнена громкость, у коротких фрагментов плавные начало/конец.
Петли сшиты перекрёстным переходом без провала в тишину.
Ветер приглушён low-pass 1800 Гц, чтобы остаться дальним фоном под звуками существ.
Речка v1.10: прежний близкий мелкий Water, small stream заменён записью горного потока в Пиренеях
(Mountain stream #1, высота записи 1053 м; по описанию автора без птиц и дорожного шума).
Звуковой образ в игре — мелкая речка шириной 2–3 м. Два прохода low-pass 2800 Гц приглушают
верхние частоты, high-pass 45 Гц сохраняет тело течения без инфранизкого гула; RMS — 0.11.
Понижения высоты, синтетических тонов и подмешанных голосов в этих файлах нет.

| Файл | Исходник, секунды | Длительность в игре | Перекрытие петли |
|---|---|---|---|
| wind-loop.wav | wind 15–42 | 25.0 с | 2.0 с |
| fire-loop.wav | fire 3–20.4 | 15.9 с | 1.5 с |
| river-loop.wav | river 8–42 | 32.0 с | 2.0 с |
| spring-loop.wav | stream 18–33 | 13.8 с | 1.2 с |
| creak-1.wav | tree 0.2–2.6 | 2.4 с | — |
| creak-2.wav | tree 2.9–5.4 | 2.5 с | — |
| creak-3.wav | tree 6.2–8.2 | 2.0 с | — |
| creak-4.wav | tree 8.3–10.7 | 2.4 с | — |
| rustle-1.wav | bush 1.0–3.3 | 2.3 с | — |
| rustle-2.wav | bush 6.2–8.0 | 1.8 с | — |
| rustle-3.wav | bush 12.4–14.5 | 2.1 с | — |
| rustle-4.wav | bush 18.1–20.0 | 1.9 с | — |
| rustle-5.wav | bush 25.0–26.9 | 1.9 с | — |

13 файлов, около 4.85 МиБ. Это полевые записи природных материалов;
жуткую атмосферу создают паузы, расположение источников во тьме и редкие неожиданные движения ветвей.
