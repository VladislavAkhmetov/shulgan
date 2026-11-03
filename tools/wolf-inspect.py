"""Inspect the supplied wolf in a separate Blender process; never writes the source FBX."""
import bpy
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1] / 'assets-src' / 'wolf'
WORK = ROOT / 'work'
WORK.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(ROOT / 'source' / 'volk.fbx'))
bpy.context.view_layer.update()
objects = []
for obj in bpy.context.scene.objects:
    item = {'name': obj.name, 'type': obj.type, 'location': list(obj.location),
            'rotation': list(obj.rotation_euler), 'scale': list(obj.scale),
            'dimensions': list(obj.dimensions), 'parent': obj.parent.name if obj.parent else None}
    if obj.type == 'MESH':
        obj.data.calc_loop_triangles()
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        item.update(vertices=len(obj.data.vertices), triangles=len(obj.data.loop_triangles),
                    bounds=[[min(p[i] for p in pts), max(p[i] for p in pts)] for i in range(3)],
                    uv_layers=list(obj.data.uv_layers.keys()),
                    vertex_groups=len(obj.vertex_groups),
                    materials=[m.name if m else None for m in obj.data.materials],
                    modifiers=[{'type':m.type,'name':m.name} for m in obj.modifiers])
    if obj.type == 'ARMATURE':
        item['bones'] = [{'name':b.name,'parent':b.parent.name if b.parent else None,
                          'head':list(b.head_local),'tail':list(b.tail_local)} for b in obj.data.bones]
    objects.append(item)
report = {'blender':bpy.app.version_string, 'objects':objects,
          'actions':[{'name':a.name,'frames':list(a.frame_range)} for a in bpy.data.actions],
          'images':[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file),'path':i.filepath} for i in bpy.data.images],
          'materials':[{'name':m.name,'nodes':[(n.type,n.name) for n in m.node_tree.nodes] if m.node_tree else []} for m in bpy.data.materials]}
(WORK / 'inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
center = (low+high)*0.5
span = max(high-low)
scene = bpy.context.scene
scene.render.engine='BLENDER_WORKBENCH'
scene.render.resolution_x=1100
scene.render.resolution_y=800
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='TEXTURE'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.world = bpy.data.worlds.new('Inspection World')
scene.world.color=(0.045,0.045,0.045)
for name, direction in [('side',(1,0,0)),('front',(0,-1,0)),('three_quarter',(1,-1,0.45))]:
    camera_data=bpy.data.cameras.new('InspectionCamera_'+name)
    camera=bpy.data.objects.new(camera_data.name,camera_data)
    scene.collection.objects.link(camera)
    camera.location=center+Vector(direction).normalized()*span*2
    camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type='ORTHO'
    camera_data.ortho_scale=span*1.2
    camera_data.clip_end=span*20
    scene.camera=camera
    scene.render.filepath=str(WORK / ('inspection_'+name+'.png'))
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'wolf_inspection.blend'))
print(json.dumps(report,ensure_ascii=False))
