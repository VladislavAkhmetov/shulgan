"""Run in connected Blender after `node tools/marten-v2-assets.mjs`.
Creates an isolated, packed review/master file. Existing scenes are preserved.
"""
import bpy
from pathlib import Path
from mathutils import Vector

ROOT = Path('C:/devlad/shulgan')
OUT = ROOT / 'assets-src/marten-v2'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Susar V2 — flexible rig')
bpy.context.window.scene = scene
previous_actions = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/marten_v2_rig.glb'),
                          import_webp_texture=True, disable_bone_shape=True,
                          bone_heuristic='TEMPERANCE')
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
skin = next(o for o in scene.objects if o.type == 'MESH')
for name in ('Susar_V2_Armature', 'Susar_V2_Skin_Master'):
    old = bpy.data.objects.get(name)
    if old is not None and old not in (rig, skin): old.name = 'PreviousReview_' + name
rig.name = 'Susar_V2_Armature'
skin.name = 'Susar_V2_Skin_Master'
rig.show_in_front = True
rig.data.display_type = 'STICK'
actions = {}
for action in set(bpy.data.actions) - previous_actions:
    name = action.name.rsplit('.', 1)[0] if action.name[-3:].isdigit() else action.name
    actions[name] = action
    old = bpy.data.actions.get('Susar_V2_' + name)
    if old is not None and old != action: old.name = 'PreviousReview_' + old.name
    action.name = 'Susar_V2_' + name
    action.use_fake_user = True
for track in rig.animation_data.nla_tracks:
    track.mute = True
for name, prefix in [('Body', ('pelvis', 'spine', 'chest', 'neck', 'head', 'rump')),
                     ('Tail — 16 joints', ('tail',)), ('Paws', ('shoulder', 'elbow', 'wrist', 'paw', 'thigh', 'knee', 'hock'))]:
    collection = rig.data.collections.new(name)
    for bone in rig.data.bones:
        if bone.name.startswith(prefix): collection.assign(bone)
action = actions['sleep_curled']
rig.animation_data.action = action
rig.animation_data.action_slot = action.slots[0]
scene.render.fps = 24
scene.frame_start = 0
scene.frame_end = 96
scene.frame_set(24)

bpy.ops.object.camera_add(location=(-0.8, 0.9, 1.0))
camera = bpy.context.object
camera.name = 'V2_Review_Camera'
camera.rotation_euler = (Vector((-0.02, 0.02, 0.10)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 0.80
scene.camera = camera
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.002))
ground = bpy.context.object
ground.name = 'V2_Studio_Ground'
material = bpy.data.materials.new('V2_Studio_Ground_Material')
material.use_nodes = True
material.diffuse_color = (0.055, 0.066, 0.085, 1)
material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = material.diffuse_color
material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
ground.data.materials.append(material)
for name, position, energy, size, color in [
    ('V2_Key', (-0.8, 0.8, 1.5), 90, 1.4, (1, 0.87, 0.73)),
    ('V2_Fill', (1, -0.5, 1), 50, 1.2, (0.69, 0.80, 1)),
    ('V2_Rim', (0.2, -1.1, 1.0), 100, 1.0, (1, 0.79, 0.58)),
]:
    bpy.ops.object.light_add(type='AREA', location=position)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.size = size
    light.data.color = color
    light.rotation_euler = (Vector((0, 0, 0.1)) - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('V2_Studio_World')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.20, 0.23, 0.30, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = 1000
scene.render.resolution_y = 850
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(OUT / 'susar_v2_curled.png')

readme = bpy.data.texts.new('README — Susar V2')
readme.write('''СУСАР / КУНИЦА — ВАРИАНТ V2

Отдельный риг: 45 костей, включая 16 в хвосте. Новый мех не добавлен.
Основная куница игры; прежний видимый вариант удалён.

В Action Editor выберите Susar_V2_curl_enter (кадры 0–144),
Susar_V2_sleep_curled (0–96) или Susar_V2_curl_exit (0–144).
Остальные Actions — образцы шага, рыси, галопа, поворотов и поз.
Все Actions сохранены с Fake User и в отключённых дорожках NLA.
Ключи запечены из того же решателя, который работает в игре и просмотре.
Кости доступны в Pose Mode; коллекции Body / Tail / Paws.

Просмотр: /#viewer=marten (старый адрес marten_v2 — его псевдоним).
Исходный код: src/game/actors/martenRig.ts.
Пересборка GLB: node tools/marten-v2-assets.mjs.
Пересборка этого файла: tools/marten-v2-blender.py через Blender MCP.
''')
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.shading.type = 'MATERIAL'
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
bpy.ops.file.pack_all()
# Library write recursively includes just this scene, its actions and packed
# dependencies; earlier review iterations and the user's other scenes stay out.
master = OUT / 'susar_v2.blend'
bpy.data.libraries.write(str(master), {scene, readme}, fake_user=True, compress=True)
if globals().get('MARTEN_RENDER_PREVIEW', True):
    bpy.ops.render.render(write_still=True)
result = {'blend': str(master), 'preview': scene.render.filepath,
          'rig': rig.name, 'bones': len(rig.data.bones),
          'actions': {name: action.name for name, action in actions.items()}}
