import bpy
import json
import traceback
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]/'assets-src'/'wolf'
WORK=ROOT/'work'
try:
    scene=bpy.context.scene
    rig=bpy.data.objects['Volk_Rig']
    # Keep the master easy to open even when GPU memory is occupied.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.shading.type='SOLID'
                area.spaces.active.shading.color_type='MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'export/volk_rigged.blend'))
    scene.render.engine='BLENDER_WORKBENCH'
    scene.render.resolution_x=720;scene.render.resolution_y=480
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.display.shading.light='STUDIO'
    scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=True
    scene.display.shading.show_cavity=True
    scene.display.shading.background_type='WORLD'
    for material in bpy.data.objects['Volk_Skinned'].data.materials:
        material.diffuse_color=(.48,.46,.43,1)
    scene.world=bpy.data.worlds.new('Motion Preview World');scene.world.color=(.075,.085,.105)
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.18,.20,.24,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35
    scene.view_settings.view_transform='AgX'
    for name,location,power,size,color in [
        ('Key',(-.6,-.9,1.4),110,1.2,(1,.90,.78)),
        ('Fill',(-.2,1.1,.9),85,1,(.65,.79,1)),
        ('Rim',(.9,.2,1),125,.8,(.67,.82,1))]:
        light_data=bpy.data.lights.new(name,'AREA');light_data.energy=power;light_data.size=size;light_data.color=color
        light=bpy.data.objects.new(name,light_data);scene.collection.objects.link(light);light.location=location
        light.rotation_euler=(Vector((-.05,0,.25))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002))
    ground=bpy.context.object;ground.name='Preview_Ground'
    mat=bpy.data.materials.new('Preview_Ground');mat.use_nodes=True;mat.diffuse_color=(.075,.085,.105,1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.055,.066,.085,1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9
    ground.data.materials.append(mat)
    camera_data=bpy.data.cameras.new('MotionCamera')
    camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera)
    camera_data.type='ORTHO';camera_data.ortho_scale=1.4
    camera.location=(.1,-2.2,.85)
    camera.rotation_euler=(Vector((-.01,0,.25))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=camera
    for name,end in [('walk',25),('run',13)]:
        folder=WORK/('motion_'+name);folder.mkdir(exist_ok=True)
        a=bpy.data.actions[name];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0]
        for frame in range(end):
            (WORK/'motion_status.json').write_text(json.dumps({'stage':'rendering','clip':name,'frame':frame}))
            scene.frame_set(frame)
            scene.render.filepath=str(folder/f'{frame:03}.png')
            bpy.ops.render.render(write_still=True)
    # Check the actual optimized GLB in Blender as well as the editable master.
    bpy.data.objects['Volk_Skinned'].hide_render=True
    prior_objects=set(scene.objects);prior_actions=set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'export/volk_game.glb'))
    game_rig=next(o for o in scene.objects if o not in prior_objects and o.type=='ARMATURE')
    game_actions={a.name.split('.')[0]:a for a in bpy.data.actions if a not in prior_actions}
    for clip,frame in [('idle',0),('run',3)]:
        action=game_actions[clip];game_rig.animation_data_create();game_rig.animation_data.action=action
        game_rig.animation_data.action_slot=action.slots[0]
        scene.frame_set(frame)
        scene.render.filepath=str(WORK/f'game_{clip}.png')
        bpy.ops.render.render(write_still=True)
    (WORK/'motion_status.json').write_text(json.dumps({'stage':'complete'}))
except Exception:
    (WORK/'motion_status.json').write_text(json.dumps({'stage':'error','traceback':traceback.format_exc()}))
    raise
