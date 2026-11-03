"""Package only finished deliverables, after export and round-trip checks pass."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]/'assets-src'/'wolf'
EXPORT=ROOT/'export'
read=lambda p:json.loads((ROOT/p).read_text(encoding='utf-8'))
assert read('work/motion_status.json')['stage']=='complete'
assert read('work/fbx_status.json')=={'stage':'complete','actions':12}
gltf=read('work/export_qa.json')
assert len(gltf['game']['animations'])==12 and gltf['unweighted']==0 and gltf['nonfinite']==0
fbx=read('work/fbx_roundtrip.json')
assert len(fbx['actions'])==12 and fbx['armatures'][0]['bones']==48
source=ROOT/'source/volk.fbx'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original=Path('C:/devlad/amanat/volk.fbx')
assert digest(source)==digest(original),'The source must remain byte-identical'
files=['volk_rigged.blend','volk_rigged.fbx','volk_rigged.glb','volk_game.glb',
       'volk_motion.gif','volk_motion.webp','volk_preview.png','README.md','LICENSE-ANIMATIONS.txt']
manifest={
    'bones':48,'deformingBones':46,'animations':gltf['game']['animations'],
    'gameTriangles':gltf['game']['meshes'][0]['triangles'],'gameBytes':gltf['gameBytes'],
    'originalSourceSHA256':digest(original),'originalPreserved':True,
    'validation':{'fbxRoundTripClips':12,'unweightedVertices':0,'nonfiniteValues':0,'maxWeightError':gltf['maxWeightError']},
    'files':{name:{'bytes':(EXPORT/name).stat().st_size,'sha256':digest(EXPORT/name)} for name in files},
}
(EXPORT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
archive=ROOT/'volk_ready.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in files+['manifest.json']:z.write(EXPORT/name,arcname='volk/'+name)
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(files)+1,'verified':True}))
