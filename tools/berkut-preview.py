"""Fast textured Blender review; no changes to exported animation data."""
import bpy, math, json, time
from pathlib import Path
from mathutils import Vector

OUT=Path('C:/devlad/shulgan/assets-src/berkut/preview')
(OUT/'frames').mkdir(exist_ok=True)
s=bpy.context.scene
r=bpy.data.objects['Kara_Berkut_Rig']
cam=s.camera
cam.location=(1.5,-3.4,1.0)
cam.rotation_euler=(Vector((0,-.03,-.025))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=2.65
s.render.engine='BLENDER_WORKBENCH'
s.display.shading.light='STUDIO'
s.display.shading.studiolight_rotate_z=.3
s.display.shading.color_type='TEXTURE'
s.display.shading.show_shadows=True
s.display.shading.show_cavity=True
s.display.shading.cavity_type='BOTH'
s.display.shading.background_type='WORLD'
s.world.color=(.03,.045,.07)
s.render.resolution_x=840
s.render.resolution_y=560
r.animation_data.action=bpy.data.actions['showcase']
r.animation_data.action_slot=r.animation_data.action.slots[0]
start=time.time()
for i,frame in enumerate(range(0,184,2)):
    t=frame/30
    r.location=(0,0,0)
    r.rotation_euler=(0,0,0)
    if 2<=t<4:
        a=(t-2)*math.pi
        r.rotation_euler.z=-a
        r.location=(.22-.22*math.cos(a),.22*math.sin(a),0)
    elif 4<=t<4.5:
        k=(t-4)/.5
        r.location=(0,-.12*k,-.10*k)
    elif 4.5<=t<5.1:
        r.location=(0,-.12,-.1)
    elif t>=5.1:
        k=min(1,(t-5.1))
        r.location=(0,-.12*(1-k),-.1*(1-k))
    s.frame_set(frame)
    s.render.filepath=str(OUT/f'frames/{i:03}.png')
    bpy.ops.render.render(write_still=True)
r.location=(0,0,0);r.rotation_euler=(0,0,0)
s.frame_set(82)
result={'frames':i+1,'fps':15,'seconds':time.time()-start}
(OUT/'render_report.json').write_text(json.dumps(result),encoding='utf8')
