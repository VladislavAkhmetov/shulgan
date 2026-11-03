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
    mesh=bpy.data.objects['Volk_Skinned']
    scene.render.engine='CYCLES'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1000;scene.render.resolution_y=700
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.world=bpy.data.worlds.new('Wolf Preview World')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.18,.20,.24,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35
    scene.view_settings.view_transform='AgX'
    # Soft neutral lighting shows the supplied albedo and normal texture.
    def area(name,location,power,size,color):
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
        o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=location
        o.rotation_euler=(Vector((-.05,0,.25))-o.location).to_track_quat('-Z','Y').to_euler()
    area('Key',(-.6,-.9,1.4),110,1.2,(1,.90,.78))
    area('Fill',(-.2,1.1,.9),85,1,(.65,.79,1))
    area('Rim',(.9,.2,1),125,.8,(.67,.82,1))
    camera_data=bpy.data.cameras.new('Wolf_Preview_Camera')
    camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera)
    camera_data.type='ORTHO';camera_data.ortho_scale=1.4
    camera.location=(.15,-2.2,.86)
    aim=Vector((-.01,0,.25));camera.rotation_euler=(aim-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=camera
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002))
    ground=bpy.context.object;ground.name='Preview_Ground'
    mat=bpy.data.materials.new('Preview_Ground');mat.diffuse_color=(.055,.066,.085,1)
    mat.use_nodes=True;bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(.055,.066,.085,1);bsdf.inputs['Roughness'].default_value=.9
    ground.data.materials.append(mat)
    cases=[('idle',0),('walk',6),('walk',18),('run',3),('run',9),('attack',16),('death',25),('eat',30),('jump',15)]
    qa=[]
    for name,frame in cases:
        rig.animation_data.action=bpy.data.actions[name]
        rig.animation_data.action_slot=bpy.data.actions[name].slots[0]
        scene.frame_set(frame);bpy.context.view_layer.update()
        evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        data=evaluated.to_mesh()
        lo=[min(v.co[i] for v in data.vertices) for i in range(3)]
        hi=[max(v.co[i] for v in data.vertices) for i in range(3)]
        qa.append({'clip':name,'frame':frame,'bounds':[lo,hi]})
        evaluated.to_mesh_clear()
        scene.render.filepath=str(WORK/f'preview_{name}_{frame:02}.png')
        (WORK/'qa_status.json').write_text(json.dumps({'stage':'rendering','clip':name,'frame':frame}))
        bpy.ops.render.render(write_still=True)
    (WORK/'pose_qa.json').write_text(json.dumps(qa,indent=2))
    (WORK/'qa_status.json').write_text(json.dumps({'stage':'complete'}))
except Exception:
    (WORK/'qa_status.json').write_text(json.dumps({'stage':'error','traceback':traceback.format_exc()}))
    raise
