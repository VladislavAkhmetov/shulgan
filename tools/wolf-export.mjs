import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { copyFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('assets-src/wolf');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read(path.join(root,'export/volk_rigged.glb'));
const summary=(document)=>({
  skins:document.getRoot().listSkins().map(s=>({joints:s.listJoints().length})),
  meshes:document.getRoot().listMeshes().map(m=>({name:m.getName(),triangles:m.listPrimitives().reduce((s,p)=>s+p.getIndices().getCount()/3,0)})),
  animations:document.getRoot().listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,duration:Math.max(...a.listSamplers().map(s=>s.getInput().getMax([])[0]))})),
  textures:document.getRoot().listTextures().map(t=>({name:t.getName(),size:t.getSize(),bytes:t.getImage().length})),
});
const original=summary(doc);
if(original.animations.length!==12) throw new Error(`Expected 12 exported clips, received ${original.animations.length}: ${JSON.stringify(original.animations)}`);
if(original.skins.length!==1)throw new Error('Expected one skeleton');
await MeshoptSimplifier.ready;
await doc.transform(dedup(),prune(),resample(),weld(),
  simplify({simplifier:MeshoptSimplifier,ratio:.24,error:.003}),
  textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:90}));
await io.write(path.join(root,'export/volk_game.glb'),doc);
const verified=await io.read(path.join(root,'export/volk_game.glb'));
let unweighted=0,maxWeightError=0,nonfinite=0;
for(const m of verified.getRoot().listMeshes())for(const p of m.listPrimitives()){
  const w=p.getAttribute('WEIGHTS_0');const a=w.getArray();
  for(let i=0;i<a.length;i+=4){const total=a[i]+a[i+1]+a[i+2]+a[i+3];if(total<.99)unweighted++;maxWeightError=Math.max(maxWeightError,Math.abs(total-1));}
  for(const attr of p.listAttributes())for(const v of attr.getArray())if(!Number.isFinite(v))nonfinite++;
}
const game=summary(verified);
const report={original,game,gameBytes:(await stat(path.join(root,'export/volk_game.glb'))).size,unweighted,maxWeightError,nonfinite};
await writeFile(path.join(root,'work/export_qa.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(unweighted||nonfinite||maxWeightError>.001)throw new Error('Skin validation failed');
const publicModels=path.resolve('public/models');
await mkdir(publicModels,{recursive:true});
await copyFile(path.join(root,'export/volk_game.glb'),path.join(publicModels,'wolf_rig.glb'));
await copyFile(path.join(root,'export/LICENSE-ANIMATIONS.txt'),path.join(publicModels,'wolf-LICENSE.txt'));
