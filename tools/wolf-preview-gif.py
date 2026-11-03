from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]/'assets-src'/'wolf'
frames=[]
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',24)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
for clip,repeat,label in [('walk',2,'ХОДЬБА'),('run',4,'ГАЛОП')]:
    files=sorted((ROOT/'work'/('motion_'+clip)).glob('*.png'))
    cycle=[]
    for file in files:
        im=Image.open(file).convert('RGB').resize((720,480),Image.Resampling.LANCZOS)
        draw=ImageDraw.Draw(im)
        draw.text((26,22),'ВОЛК / '+label,font=font,fill=(239,240,243))
        draw.text((26,55),'Готовый риг · анимации Quaternius CC0',font=small,fill=(190,197,210))
        cycle.append(im)
    frames.extend(cycle*repeat)
frames[0].save(ROOT/'export'/'volk_motion.gif',save_all=True,append_images=frames[1:],duration=42,loop=0,optimize=True)
frames[0].save(ROOT/'export'/'volk_motion.webp',save_all=True,append_images=frames[1:],duration=42,loop=0,quality=80,method=4)
print(ROOT/'export'/'volk_motion.gif')
