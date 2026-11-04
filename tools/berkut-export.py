"""Export the current Kara rig: full FBX plus web GLB (20k triangles, 2k maps)."""
import bpy
import json
from pathlib import Path

ROOT=Path('C:/devlad/shulgan')
OUT=ROOT/'assets-src/berkut'
scene=bpy.context.scene
if bpy.context.object and bpy.context.object.mode!='OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
rig=next(o for o in scene.objects if o.type=='ARMATURE')
skin=next(o for o in scene.objects if o.type=='MESH')
actions={n:bpy.data.actions[n] for n in ['flight_flap','climb','soar','circle_left','circle_right','dive','talon_strike','pull_up','beak_call','talon_grip','showcase']}

checks={}
for name,act in actions.items():
    rig.animation_data.action=act;rig.animation_data.action_slot=act.slots[0]
    start,end=map(int,act.frame_range)
    scene.frame_set(start)
    initial=[p.rotation_quaternion.copy() for p in rig.pose.bones]
    scene.frame_set(end)
    if act['loop']:
        err=max(min((a-b.rotation_quaternion).magnitude,(a+b.rotation_quaternion).magnitude) for a,b in zip(initial,rig.pose.bones))
        checks[name]={'quaternion_seam_error':err,'passed':err<1e-5}
        assert err<1e-5,(name,err)

# Assess deformed edge stretching over wing extrema and attack contact.
rest=[v.co.copy() for v in skin.data.vertices]
edge_lengths=[(rest[e.vertices[0]]-rest[e.vertices[1]]).length for e in skin.data.edges]
samples=[]
for name,frame in [('flight_flap',0),('flight_flap',7),('flight_flap',15),('dive',15),('talon_strike',9),('talon_grip',24)]:
    act=actions[name];rig.animation_data.action=act;rig.animation_data.action_slot=act.slots[0];scene.frame_set(frame)
    bpy.context.view_layer.update()
    evaluated=skin.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
    ratios=[]
    for e,l in zip(skin.data.edges,edge_lengths):
        if l>.001:
            ratios.append((mesh.vertices[e.vertices[0]].co-mesh.vertices[e.vertices[1]].co).length/l)
    ratios.sort()
    samples.append({'action':name,'frame':frame,'edge_stretch_p99':ratios[int(len(ratios)*.99)],'edge_stretch_max':max(ratios)})
    evaluated.to_mesh_clear()

rig.animation_data.action=actions['showcase'];rig.animation_data.action_slot=actions['showcase'].slots[0]
scene.frame_set(82)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);skin.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.fbx(filepath=str(OUT/'kara_berkut_rig.fbx'),use_selection=True,object_types={'ARMATURE','MESH'},
                        add_leaf_bones=False,bake_anim=True,bake_anim_use_all_actions=True,
                        bake_anim_use_nla_strips=False,bake_anim_simplify_factor=0.0,path_mode='COPY',embed_textures=True)

# A mesh copy preserves the full-resolution master and its existing weights.
export_skin=skin.copy();export_skin.data=skin.data.copy();export_skin.name='Kara_Berkut_GameSkin'
scene.collection.objects.link(export_skin)
skin.select_set(False);rig.select_set(False);export_skin.select_set(True)
bpy.context.view_layer.objects.active=export_skin
dec=export_skin.modifiers.new('Game mesh 20k','DECIMATE');dec.ratio=.40
# Apply before pose deformation. Armature stays live.
bpy.ops.object.modifier_move_up(modifier=dec.name)
bpy.ops.object.modifier_apply(modifier=dec.name)
for v in export_skin.data.vertices:
    weights=sorted([(g.group,g.weight) for g in v.groups],key=lambda g:-g[1])[:4]
    for g in list(v.groups): export_skin.vertex_groups[g.group].remove([v.index])
    total=sum(w for _,w in weights)
    for index,w in weights: export_skin.vertex_groups[index].add([v.index],w/total,'REPLACE')
material=skin.data.materials[0].copy();material.name='Kara_Game_PBR_2K'
export_skin.data.materials.clear();export_skin.data.materials.append(material)
for node in material.node_tree.nodes:
    if node.type=='TEX_IMAGE' and node.image:
        image=node.image.copy();image.name='Kara_2K_'+node.image.name
        image.scale(2048,2048);image.pack();node.image=image
rig.select_set(True)
glb=ROOT/'public/models/berkut_rig.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,
                          export_animations=True,export_animation_mode='ACTIONS',export_nla_strips=False,
                          export_force_sampling=True,export_anim_slide_to_zero=True,
                          export_skins=True,export_all_influences=False,export_image_format='AUTO')
tris=sum(len(p.vertices)-2 for p in export_skin.data.polygons)
# Export copy is a task-created temporary object, not part of the master.
bpy.data.objects.remove(export_skin,do_unlink=True)
skin.hide_set(False);rig.select_set(True);skin.select_set(True);bpy.context.view_layer.objects.active=rig
rig.animation_data.action=actions['showcase'];rig.animation_data.action_slot=actions['showcase'].slots[0]
scene.frame_set(82)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'kara_berkut_rig.blend'))
report={'loop_checks':checks,'deformation_samples':samples,'game_triangles':tris,'glb_bytes':glb.stat().st_size,
        'weight_sums_max_error':max(abs(sum(g.weight for g in v.groups)-1) for v in skin.data.vertices),
        'weighted_jaw_vertices':sum(any(g.group==skin.vertex_groups['jaw'].index and g.weight>.01 for g in v.groups) for v in skin.data.vertices)}
(OUT/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
result=report
