import bpy
import json
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/'assets-src'/'wolf'
def status(stage,**extra):
    (ROOT/'work/fbx_status.json').write_text(json.dumps({'stage':stage,**extra},indent=2))

try:
    status('opening')
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'export/volk_rigged.blend'))
    rig=bpy.data.objects['Volk_Rig'];mesh=bpy.data.objects['Volk_Skinned']
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True);mesh.select_set(True);bpy.context.view_layer.objects.active=rig
    rig.animation_data.action=None
    for track in rig.animation_data.nla_tracks:track.mute=False
    status('exporting')
    bpy.ops.export_scene.fbx(filepath=str(ROOT/'export/volk_rigged.fbx'),use_selection=True,
        object_types={'MESH','ARMATURE'},add_leaf_bones=False,bake_anim=True,
        bake_anim_use_all_actions=False,bake_anim_use_nla_strips=True,
        bake_anim_simplify_factor=0,path_mode='COPY',embed_textures=True,
        axis_forward='-Z',axis_up='Y')
    for track in rig.animation_data.nla_tracks:track.mute=True
    action=bpy.data.actions['idle'];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
    target_names={t.name for t in rig.animation_data.nla_tracks}
    for action in list(bpy.data.actions):
        if action.name not in target_names and not action.name.startswith('SOURCE_'):
            action.name='SOURCE_'+action.name
    scene=bpy.context.scene
    scene.frame_set(0);scene.frame_start=0;scene.frame_end=80
    status('saving')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'export/volk_rigged.blend'))
    status('reimporting')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(ROOT/'export/volk_rigged.fbx'))
    report={
        'armatures':[{'name':o.name,'bones':len(o.data.bones)} for o in bpy.context.scene.objects if o.type=='ARMATURE'],
        'actions':[{'name':a.name,'frames':list(a.frame_range)} for a in bpy.data.actions],
        'textures':[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file)} for i in bpy.data.images if i.type=='IMAGE'],
    }
    (ROOT/'work/fbx_roundtrip.json').write_text(json.dumps(report,indent=2))
    assert len(report['actions'])==12,report
    status('complete',actions=len(report['actions']))
except Exception:
    status('error',traceback=traceback.format_exc())
    raise
