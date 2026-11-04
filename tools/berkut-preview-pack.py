from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT=Path('C:/devlad/shulgan/assets-src/berkut/preview')
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',24)
small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',15)
frames=[]
for i,file in enumerate(sorted((OUT/'frames').glob('*.png'))):
    im=Image.open(file).convert('RGB')
    d=ImageDraw.Draw(im)
    t=i/15
    stage='Набор высоты / силовой взмах' if t<2 else 'Кружение / крен и стабилизация головы' if t<4 else 'Пикирование / подбор крыльев' if t<4.5 else 'Атака / вынос лап и захват' if t<5.1 else 'Выход из атаки / набор высоты'
    d.text((24,18),'ҠАРА · БЕРКУТ',font=font,fill='#e6bc77')
    d.text((24,52),stage,font=small,fill='#d9e0e8')
    d.text((24,im.height-34),'84 кости · Blender MCP · исходная модель и текстуры',font=small,fill='#9daebe')
    d.text((im.width-85,im.height-34),f'{t:.2f} с',font=small,fill='#e6bc77')
    if abs(t-4.8)<.13:
        d.text((24,88),'КОНТАКТ КОГТЕЙ',font=font,fill='#ffc766')
    frames.append(im)
frames[0].save(OUT/'kara_berkut_animation.gif',save_all=True,append_images=frames[1:],duration=[66,67,67]*30+[66,67],loop=0,optimize=True,disposal=2)
frames[0].save(OUT/'kara_berkut_animation.webp',save_all=True,append_images=frames[1:],duration=[66,67,67]*30+[66,67],loop=0,quality=85)
sheet=Image.new('RGB',(1200,800),'#172330')
for j,idx in enumerate([7,40,64,72]):
    tile=frames[idx].resize((600,400),Image.Resampling.LANCZOS)
    sheet.paste(tile,((j%2)*600,(j//2)*400))
sheet.save(OUT/'kara_berkut_contact_sheet.jpg',quality=93)
print({'frames':len(frames),'gif_bytes':(OUT/'kara_berkut_animation.gif').stat().st_size,'webp_bytes':(OUT/'kara_berkut_animation.webp').stat().st_size})
