"""Kara golden-eagle rig. Run through Blender MCP; original FBX is read only.

Canonical Blender coordinates: +Z dorsal/up, -Y forward, +X left wing.
Actions are in place; gameplay owns translation and heading.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path('C:/devlad/shulgan')
OUT = ROOT / 'assets-src/berkut'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'preview').mkdir(exist_ok=True)
FPS = 30

if bpy.data.objects.get('Kara_Berkut_Rig'):
    raise RuntimeError('Build in a fresh Blender file to preserve the existing Kara master and action names.')
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')

scene = bpy.data.scenes.new('Kara — Berkut Animation Studio')
bpy.context.window.scene = scene
bpy.ops.import_scene.fbx(filepath='C:/devlad/amanat/berkut.fbx')
skin = next(o for o in scene.objects if o.type == 'MESH')
skin.name = 'Kara_Berkut_Skin'
bpy.context.view_layer.objects.active = skin
bpy.ops.object.select_all(action='DESELECT')
skin.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
skin.rotation_euler.x = math.pi / 2
skin.scale = (2 / 1.16924697,) * 3
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
for v in skin.data.vertices:
    v.co.y += .45
skin.data.update()
for p in skin.data.polygons:
    p.use_smooth = True

# Retain packed originals in the master; nonmetallic organic surface.
mat = skin.data.materials[0]
mat.name = 'Kara_Original_PBR'
bsdf = mat.node_tree.nodes.get('Principled BSDF')
for link in list(bsdf.inputs['Metallic'].links):
    mat.node_tree.links.remove(link)
bsdf.inputs['Metallic'].default_value = 0
bsdf.inputs['Specular IOR Level'].default_value = .28
for node in mat.node_tree.nodes:
    if node.type == 'NORMAL_MAP':
        node.inputs['Strength'].default_value = .4

arm = bpy.data.armatures.new('Kara_Anatomical_Skeleton')
rig = bpy.data.objects.new('Kara_Berkut_Rig', arm)
scene.collection.objects.link(rig)
rig.show_in_front = True
arm.display_type = 'OCTAHEDRAL'
bpy.context.view_layer.objects.active = rig
skin.select_set(False)
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
defs = {}

def bone(name, head, tail, parent=None, deform=True):
    b = arm.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = arm.edit_bones[parent]
    b.use_deform = deform
    b.align_roll(Vector((0, 0, 1)))
    defs[name] = (Vector(head), Vector(tail), parent)
    return b

bone('root', (0, 0, 0), (0, 0, .12), deform=False)
bone('pelvis', (0, .065, -.025), (0, -.04, -.02), 'root')
bone('spine', (0, -.04, -.02), (0, -.16, -.025), 'pelvis')
bone('chest', (0, -.16, -.025), (0, -.25, -.035), 'spine')
bone('neck', (0, -.25, -.035), (0, -.31, -.065), 'chest')
bone('head', (0, -.31, -.065), (0, -.377, -.115), 'neck')
bone('beak_upper', (0, -.374, -.13), (0, -.385, -.22), 'head')
bone('jaw', (0, -.354, -.158), (0, -.373, -.223), 'head')
bone('tail', (0, .06, .025), (0, .21, .07), 'pelvis')
tail_names = []
for i in range(7):
    angle = (i - 3) * .19
    h = (math.sin(angle) * .048, .16, .063)
    t = (math.sin(angle) * .52, .18 + math.cos(angle) * .25, .12)
    n = f'tail_feather_{i+1:02}'
    bone(n, h, t, 'tail')
    tail_names.append(n)

wing_names = {}
toe_names = {}
for side, sign in [('L', 1), ('R', -1)]:
    def p(x, y, z): return (sign * x, y, z)
    bone('wing_upper.'+side, p(.12,-.225,-.005), p(.38,-.245,.0), 'chest')
    bone('wing_fore.'+side, p(.38,-.245,.0), p(.63,-.265,-.015), 'wing_upper.'+side)
    bone('wing_hand.'+side, p(.63,-.265,-.015), p(.86,-.23,-.033), 'wing_fore.'+side)
    feathers = []
    for i in range(4):
        x = .21 + .09 * i
        n = f'secondary_{i+1:02}.{side}'
        bone(n, p(x,-.22,.0), p(x+.035,.065-.012*i,.018), 'wing_upper.'+side if x < .37 else 'wing_fore.'+side)
        feathers.append(n)
    for i, (tx,ty) in enumerate([(.62,.055),(.74,.025),(.85,-.025),(.945,-.10),(1.0,-.20),(.97,-.30)]):
        hx, hy = .57 + .032*i, -.245 - .004*i
        mid = p(hx+(tx-hx)*.55,hy+(ty-hy)*.55,-.025)
        n = f'primary_{i+1:02}.{side}'
        bone(n,p(hx,hy,-.018),mid,'wing_fore.'+side if i<2 else 'wing_hand.'+side)
        bone(n+'.tip',mid,p(tx,ty,-.035),n)
        feathers.extend([n,n+'.tip'])
    wing_names[side] = feathers
    bone('thigh.'+side,p(.062,-.015,-.10),p(.085,.045,-.14),'pelvis')
    bone('hock.'+side,p(.085,.045,-.14),p(.086,.10,-.173),'thigh.'+side)
    bone('foot.'+side,p(.086,.10,-.173),p(.086,.11,-.208),'hock.'+side)
    toes=[]
    # Three front digits and opposing hallux, each with proximal/distal/claw joints.
    for i, dx in enumerate([-.033,0,.033]):
        base=p(.086+dx*.35,.104,-.19)
        mid=p(.086+dx,.112,-.217)
        tip=p(.086+dx*1.25,.10,-.245)
        end=p(.086+dx*1.25,.073,-.25)
        n=f'toe_{i+2}.{side}'
        bone(n,base,mid,'foot.'+side)
        bone(n+'.distal',mid,tip,n)
        bone(n+'.claw',tip,end,n+'.distal')
        toes.extend([n,n+'.distal',n+'.claw'])
    n='hallux.'+side
    bone(n,p(.075,.097,-.179),p(.052,.075,-.194),'foot.'+side)
    bone(n+'.distal',p(.052,.075,-.194),p(.048,.073,-.22),n)
    bone(n+'.claw',p(.048,.073,-.22),p(.06,.093,-.23),n+'.distal')
    toes.extend([n,n+'.distal',n+'.claw'])
    toe_names[side]=toes
bpy.ops.object.mode_set(mode='OBJECT')

for group, prefixes in [('Body and head',('root','pelvis','spine','chest','neck','head','beak','jaw')),
                        ('Wings FK',('wing_',)),('Flight feathers',('primary','secondary')),
                        ('Tail fan',('tail',)),('Legs and talons',('thigh','hock','foot','toe','hallux'))]:
    col=arm.collections.new(group)
    for b in arm.bones:
        if b.name.startswith(prefixes): col.assign(b)
for b in arm.bones:
    b.color.palette = 'THEME04' if b.name.endswith('.L') else 'THEME03' if b.name.endswith('.R') else 'THEME09'

# Anatomical, normalized weights. No heat weighting across thin overlapping feathers.
groups={b.name:skin.vertex_groups.new(name=b.name) for b in arm.bones if b.use_deform}
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)
def mix(a,b,t):
    out={k:v*(1-t) for k,v in a.items()}
    for k,v in b.items(): out[k]=out.get(k,0)+v*t
    return out
def nearest(point,names,count=2,power=3):
    d=[]
    for n in names:
        h,t,_=defs[n]; seg=t-h
        u=max(0,min(1,(point-h).dot(seg)/seg.length_squared))
        dist=(point-(h+seg*u)).length
        d.append((dist,n))
    d.sort()
    vals={n:1/max(.008,v)**power for v,n in d[:count]}
    su=sum(vals.values())
    return {k:v/su for k,v in vals.items()}
def wing_weights(v,side):
    x=abs(v.x)
    if x<.38: w=mix({'wing_upper.'+side:1},{'wing_fore.'+side:1},smooth(.28,.47,x))
    else: w=mix({'wing_fore.'+side:1},{'wing_hand.'+side:1},smooth(.53,.74,x))
    feather=smooth(-.22,-.06,v.y)*.85
    if x>.77: feather=max(feather,smooth(.77,.94,x)*.95)
    return mix(w,nearest(v,wing_names[side]),feather)

for v in skin.data.vertices:
    p=v.co; x,y,z=p; ax=abs(x); side='L' if x>0 else 'R'
    base=mix({'pelvis':1},{'spine':1},smooth(.07,-.10,y))
    base=mix(base,{'chest':1},smooth(-.10,-.24,y))
    if y<-.245:
        base=mix(base,{'neck':1},smooth(-.245,-.30,y))
        base=mix(base,{'head':1},smooth(-.295,-.335,y))
        if y<-.35 and z<-.15:
            # Upper bill stays rigid with cranium; only the lower mandibular sliver opens.
            base=mix(base,{'beak_upper':1},smooth(-.15,-.19,z))
    # The face projects ventrally in this source pose. Keep the whole skull rigid,
    # rather than slicing the curved bill using a longitudinal neck threshold.
    head=smooth(-.32,-.46,y+z)*(1-smooth(.07,.16,ax))*(1-smooth(-.28,-.18,y))
    base=mix(base,{'head':1},head)
    jaw=smooth(-.218,-.25,z)*smooth(-.375,-.35,y)*(1-smooth(-.327,-.30,y))*(1-smooth(.022,.043,ax))
    base=mix(base,{'jaw':1},jaw)
    tail=smooth(.065,.17,y)*smooth(-.025,.045,z)
    if tail>0:
        tw=mix({'tail':1},nearest(p,tail_names),smooth(.15,.29,y))
        base=mix(base,tw,tail)
    leg=smooth(-.075,-.145,z)*smooth(-.065,.0,y)*(1-smooth(.18,.24,ax))
    if leg>0:
        lw=nearest(p,['thigh.'+side,'hock.'+side,'foot.'+side],2)
        lw=mix(lw,nearest(p,toe_names[side],2),smooth(-.18,-.218,z))
        base=mix(base,lw,leg)
    wing=smooth(.115,.205,ax)
    if wing>0: base=mix(base,wing_weights(p,side),wing)
    vals=sorted(base.items(),key=lambda it:-it[1])[:4]
    total=sum(vv for _,vv in vals)
    for n,w in vals:
        if w>1e-7: groups[n].add([v.index],w/total,'REPLACE')
# Relax weights along actual mesh connectivity; this eliminates narrow spatial
# mask seams without mixing unrelated overlapping feathers through empty space.
import numpy as np
weights=np.zeros((len(skin.data.vertices),len(skin.vertex_groups)),dtype=np.float64)
for v in skin.data.vertices:
    for g in v.groups: weights[v.index,g.group]=g.weight
edges=np.array([tuple(e.vertices) for e in skin.data.edges])
degree=np.bincount(edges.ravel(),minlength=len(weights)).clip(1)
for iteration in range(12):
    sums=np.zeros_like(weights)
    np.add.at(sums,edges[:,0],weights[edges[:,1]])
    np.add.at(sums,edges[:,1],weights[edges[:,0]])
    weights=.5*weights+.5*sums/degree[:,None]
for v,w in zip(skin.data.vertices,weights):
    for g in list(v.groups):skin.vertex_groups[g.group].remove([v.index])
    best=np.argsort(w)[-4:];total=w[best].sum()
    for i in best:
        if w[i]>1e-8:skin.vertex_groups[int(i)].add([v.index],float(w[i]/total),'REPLACE')
skin.parent=rig
mod=skin.modifiers.new('Kara Anatomical Skin','ARMATURE');mod.object=rig
mod.use_deform_preserve_volume=True

for pb in rig.pose.bones:
    pb.rotation_mode='QUATERNION'
rig['species']='Aquila chrysaetos / Golden Eagle'
rig['forward']='-Y in Blender, +Z in glTF after standard export'
rig['rig_notes']='FK flight rig. Independent wing arm/forearm/hand, primary tips, tail fan, 4 articulated digits per foot, fixed upper bill, lower mandible.'
rig['source']='C:/devlad/amanat/berkut.fbx (unchanged)'

def rot(n, xyz):
    # World-rest axes to bone-local axes. Quaternion composition avoids Euler flips.
    basis=arm.bones[n].matrix_local.to_quaternion()
    q=Quaternion()
    for axis,angle in zip(((1,0,0),(0,1,0),(0,0,1)),xyz):
        q=q @ Quaternion(Vector(axis),math.radians(angle))
    rig.pose.bones[n].rotation_quaternion=basis.inverted() @ q @ basis

def reset():
    for pb in rig.pose.bones:
        pb.location=(0,0,0);pb.rotation_quaternion=(1,0,0,0);pb.scale=(1,1,1)

def pose(t,flap=0,fold=0,fan=0,bank=0,attack=0,grip=.3,pitch=0,cry=0):
    reset()
    rot('root',(pitch,bank,0))
    rot('neck',(-34+attack*9,0,math.sin(t*math.tau)*2))
    rot('head',(-29-attack*9,-bank*.55,math.sin(t*math.tau)*3))
    rot('jaw',(cry*14,0,0))
    rot('tail',(4+attack*16,bank*.3,math.sin(t*math.tau)*2))
    for i,n in enumerate(tail_names): rot(n,(0,0,(i-3)*fan*2.1))
    for side,s in [('L',1),('R',-1)]:
        rot('wing_upper.'+side,(0,-s*flap,s*fold*28))
        rot('wing_fore.'+side,(0,-s*(flap*.15+math.sin(t*2*math.pi-0.5)*5*(abs(flap)/35)), -s*fold*66))
        rot('wing_hand.'+side,(flap*.13,-s*math.sin(t*2*math.pi-1)*5*(abs(flap)/35),s*fold*25))
        for i,n in enumerate(wing_names[side]):
            is_tip=n.endswith('.tip')
            spread=(i/len(wing_names[side])-.4)*fan*9
            rot(n,(math.sin(t*math.tau*2-i*.22)*(.9 if is_tip else .35),0,s*spread))
        rot('thigh.'+side,(-10-attack*95,0,s*attack*7))
        rot('hock.'+side,(12+attack*8,0,0))
        rot('foot.'+side,(-8-attack*8,0,0))
        for n in toe_names[side]:
            value=grip*(32 if '.distal' in n else 22 if '.claw' in n else 18)
            rot(n,(value*(-.8 if n.startswith('hallux') else 1),0,0))

actions={}
def action(name,seconds,fn,loop=False,events=None):
    reset(); act=bpy.data.actions.new(name);act.use_fake_user=True
    rig.animation_data_create();rig.animation_data.action=act
    frames=round(seconds*FPS)
    for f in range(frames+1):
        scene.frame_set(f);fn(f/FPS,f/frames)
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion',frame=f,group=pb.name)
            if pb.name=='root':pb.keyframe_insert('location',frame=f,group=pb.name)
    act['loop']=loop;act['duration_seconds']=seconds
    act['events']=json.dumps(events or {},ensure_ascii=False)
    # Dense samples are deliberately linear; easing is authored in the pose functions.
    for slot in act.slots:
        for layer in act.layers:
            for strip in layer.strips:
                for fc in strip.channelbag(slot).fcurves:
                    for kp in fc.keyframe_points:kp.interpolation='LINEAR'
    actions[name]=act
    return act

def flap_pose(t,k,climb=False):
    # 2 Hz power stroke; wrist and feather tips lag behind shoulder.
    f=30*math.cos(t*math.tau*2)+5
    pose(t,flap=f,fold=.10+.10*max(0,f/35),fan=.35,grip=.7,pitch=-9 if climb else -2)
    rig.pose.bones['root'].location.z=.016*math.sin(t*math.tau*2-.5)
action('flight_flap',1,lambda t,k:flap_pose(t,k),True)
action('climb',1,lambda t,k:flap_pose(t,k,True),True)
action('soar',2,lambda t,k:pose(t,flap=7+1.7*math.sin(t*math.pi),fan=.5,grip=.65),True)
action('circle_left',2,lambda t,k:pose(t,flap=8+2*math.sin(t*math.pi),fan=.7,bank=-24,grip=.65),True)
action('circle_right',2,lambda t,k:pose(t,flap=8+2*math.sin(t*math.pi),fan=.7,bank=24,grip=.65),True)
action('dive',.5,lambda t,k:pose(t,flap=6+5*k,fold=.10+.60*smooth(0,.65,k),fan=.15,grip=.7,attack=.1*smooth(.6,1,k)),False,{'next':'talon_strike'})

def strike(t,k):
    extend=smooth(0,.38,k)
    close=smooth(.42,.58,k)
    recover=smooth(.67,1,k)
    pose(t,flap=18+22*math.sin(k*math.pi),fold=.45*(1-extend),fan=.35+.6*extend,
         attack=extend*(1-recover*.8),grip=-.18+1.15*close,pitch=-10*extend,cry=math.sin(k*math.pi)*.35)
action('talon_strike',.6,strike,False,{'contact':.30,'note':'talons first; recover after contact'})
action('pull_up',.8,lambda t,k:pose(t,flap=35*math.cos(t*math.tau*2),fold=.1,fan=.7,attack=(1-k)*.3,grip=.8,pitch=-18*math.sin(k*math.pi)),False)
action('beak_call',1.6,lambda t,k:pose(t,flap=7,fan=.4,grip=.5,cry=math.sin(k*math.pi)**4),False)
action('talon_grip',1.2,lambda t,k:pose(t,flap=9,fan=.7,attack=.9,grip=-.25+1.4*smooth(.15,.8,k)),False)

# Composite demonstration; unlike the production clips, this includes authored pitch.
def demo(t,k):
    if t<2:flap_pose(t,t/2,True)
    elif t<4:pose(t,flap=8,fan=.65,bank=-24*smooth(2,2.5,t),grip=.65)
    elif t<4.5:pose(t,flap=10,fold=.65*smooth(4,4.5,t),fan=.15,grip=.7,pitch=25*smooth(4,4.5,t))
    elif t<5.1:strike(t-4.5,(t-4.5)/.6)
    else:pose(t,flap=32*math.cos((t-5.1)*math.tau*2),fold=.1,fan=.6,grip=.8,pitch=-12)
action('showcase',6.1,demo,False,{'contact':4.8})

scene.render.fps=FPS;scene.frame_start=0;scene.frame_end=183
rig.animation_data.action=actions['showcase']
rig.animation_data.action_slot=actions['showcase'].slots[0]
scene.frame_set(30)
scene.world=bpy.data.worlds.new('Kara_Studio_World');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.035,.055,.085,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
for name,pos,energy,size,color in [('Key',(0,-2,3),320,3,(1,.86,.69)),('Fill',(-2,-1,1),200,3,(.64,.77,1)),('Rim',(1,2,2),400,2,(1,.69,.35))]:
    bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.name='Kara_'+name
    o.data.energy=energy;o.data.size=size;o.data.color=color
    o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.0,-3.3,1.7))
cam=bpy.context.object;cam.name='Kara_Review_Camera';cam.data.type='ORTHO';cam.data.ortho_scale=2.55
cam.rotation_euler=(Vector((0,-.02,-.025))-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=700;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'preview/hero.png')

text=bpy.data.texts.new('README — KARA BERKUT')
text.write('KARA / GOLDEN EAGLE\n\nOriginal FBX remains untouched.\n30 fps, 2 metre wingspan.\nForward -Y, dorsal +Z in Blender.\nFK controls grouped in Bone Collections.\nChoose an Action in the Action Editor.\nLoop clips: flight_flap, climb, soar, circle_left, circle_right.\nOneshots: dive, talon_strike, pull_up, beak_call, talon_grip.\nshowcase: 6.1 s review sequence, contact 4.8 s.\nProduction clips are in place; world motion belongs to the game.\nUpper bill is rigid; lower mandible opens.\nSee assets-src/berkut/RESEARCH.md for references and limitations.\n')
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=2.6
        area.spaces.active.region_3d.view_location=(0,0,0)
        area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
        area.spaces.active.shading.type='MATERIAL'

bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);skin.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'kara_berkut_rig.blend'))
report={'bones':len(arm.bones),'deform_bones':sum(b.use_deform for b in arm.bones),'vertices':len(skin.data.vertices),'triangles':sum(len(p.vertices)-2 for p in skin.data.polygons),'actions':{n:dict(duration=float(a['duration_seconds']),loop=bool(a['loop'])) for n,a in actions.items()},'max_influences':max(len(v.groups) for v in skin.data.vertices),'unweighted':sum(not v.groups for v in skin.data.vertices)}
(OUT/'rig_report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
result=report
