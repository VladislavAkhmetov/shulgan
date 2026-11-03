import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import convert from 'fbx2gltf';

const root = path.resolve('assets-src/wolf');
await convert(path.join(root, 'source/volk.fbx'), path.join(root, 'work/volk_original.glb'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, file] of [['target', 'work/volk_original.glb'], ['donor', 'source/Quaternius_Wolf.glb']]) {
  const doc = await io.read(path.join(root, file));
  const r = doc.getRoot();
  const report = {
    meshes: r.listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({
      vertices:p.getAttribute('POSITION').getCount(), triangles:p.getIndices()?.getCount()/3,
      min:p.getAttribute('POSITION').getMin([]),max:p.getAttribute('POSITION').getMax([]),
      attributes:p.listSemantics(),material:p.getMaterial()?.getName(),
    }))})),
    nodes:r.listNodes().map(n=>({name:n.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale(),children:n.listChildren().map(c=>c.getName()),mesh:n.getMesh()?.getName(),skin:n.getSkin()?.getName()})),
    skins:r.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(j=>j.getName())})),
    animations:r.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,duration:Math.max(...a.listSamplers().map(s=>s.getInput().getMax([])[0]))})),
    textures:r.listTextures().map(t=>({name:t.getName(),size:t.getSize(),bytes:t.getImage()?.length})),
  };
  await writeFile(path.join(root,`work/${name}_data.json`), JSON.stringify(report,null,2));
  console.log(name,JSON.stringify(report));
}
