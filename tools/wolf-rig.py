"""Fit a quadruped rig and retarget the Quaternius CC0 wolf clips.

Run in a separate Blender process. Source files are read-only. All animation
comes from the downloaded clips; the leg solve adapts their paw trajectories
to this mesh's bone lengths.
"""
import bpy
import json
import math
import traceback
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix, Quaternion

ROOT = Path(__file__).resolve().parents[1] / 'assets-src' / 'wolf'
WORK = ROOT / 'work'
EXPORT = ROOT / 'export'
STATUS = WORK / 'rig_status.json'

def status(stage, **values):
    STATUS.write_text(json.dumps({'stage':stage, **values},ensure_ascii=False,indent=2),encoding='utf-8')

def select_only(objects, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=active

def run():
    status('importing')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.name='Volk_Animated'
    scene.render.fps=24
    bpy.ops.import_scene.fbx(filepath=str(ROOT/'source/volk.fbx'))
    mesh=next(o for o in scene.objects if o.type=='MESH')
    mesh.name='Volk_Skinned'
    select_only([mesh],mesh)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    before=set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'source/Quaternius_Wolf.glb'))
    donor_objects=[o for o in scene.objects if o not in before]
    donor=next(o for o in donor_objects if o.type=='ARMATURE')
    donor.name='Source_Quaternius_Rig'
    donor.animation_data_clear()
    donor.data.pose_position='POSE'
    for pb in donor.pose.bones: pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    source_rest={b.name:(donor.matrix_world@b.matrix_local).copy() for b in donor.data.bones}
    source_actions={a.name:a for a in bpy.data.actions if '|' not in a.name}
    donor.animation_data_create()
    for a in bpy.data.actions:a.use_fake_user=True

    heads={
        'Body':(0,0,.09), 'Back':(.12,0,.365), 'Torso':(.015,0,.36),
        'Torso2':(-.11,0,.36),'Torso3':(-.25,0,.385),
        'Neck1':(-.315,0,.40),'Neck2':(-.37,0,.414),
        'Neck3':(-.415,0,.414),'Head':(-.455,0,.394),
    }
    tails={'Body':(0,0,.12),'Head':(-.575,0,.355)}
    next_name={'Back':'Torso','Torso':'Torso2','Torso2':'Torso3','Torso3':'Neck1',
               'Neck1':'Neck2','Neck2':'Neck3','Neck3':'Head'}
    tail_points=[(.16,0,.351),(.215,0,.321),(.27,0,.299),(.325,0,.283),
                 (.38,0,.275),(.435,0,.27),(.49,0,.265),(.545,0,.262),(.583,0,.258)]
    for i in range(8):
        name=f'Tail{i+1}'; heads[name]=tail_points[i];tails[name]=tail_points[i+1]
    for suffix,s,front,back in [('L',-1,(-.29,-.238,-.267,-.297),(.12,.085,.177,.173,.144)),
                              ('R',1,(-.31,-.273,-.306,-.337),(.12,.065,.14,.112,.0754))]:
        sh,el,wr,to=front
        hp,kn,ho,an,bt=back
        coords={
            'FrontShoulder':(-.285,s*.033,.36),'FrontUpperLeg':(sh,s*.063,.335),
            'FrontLowerLeg':(el,s*.061,.215),'IKFrontLeg':(wr,s*.063,.045),
            'FF':(to,s*.065,.021),
            'BackShoulder':(.11,s*.031,.36),'BackLeg':(hp,s*.062,.33),
            'BackUpperLeg':(kn,s*.062,.225),'BackLowerLeg':(ho,s*.061,.12),
            'IKBackLeg':(an,s*.065,.043),'FFB':(bt,s*.068,.021),
        }
        for n,p in coords.items():heads[n+'.'+suffix]=p
        for chain in [['FrontShoulder','FrontUpperLeg','FrontLowerLeg','IKFrontLeg','FF'],
                      ['BackShoulder','BackLeg','BackUpperLeg','BackLowerLeg','IKBackLeg','FFB']]:
            for a,b in zip(chain,chain[1:]):tails[a+'.'+suffix]=heads[b+'.'+suffix]
        tails['FF.'+suffix]=(to-.033,s*.065,.018)
        tails['FFB.'+suffix]=(bt-.032,s*.068,.018)
        for i,(x,z) in enumerate([(-.437,.435),(-.434,.451),(-.43,.467),(-.425,.482)]):
            name=f'Ear{i+1}.{suffix}';heads[name]=(x,s*(.036+i*.004),z)
            tails[name]=(-.422,s*.052,.491) if i==3 else (-.434+i*.004,s*(.04+i*.004),.451+i*.016)
    for a,b in next_name.items():tails[a]=heads[b]

    status('building_skeleton')
    data=bpy.data.armatures.new('Volk_Skeleton')
    rig=bpy.data.objects.new('Volk_Rig',data)
    scene.collection.objects.link(rig)
    rig.show_in_front=True
    data.display_type='OCTAHEDRAL'
    select_only([rig],rig)
    bpy.ops.object.mode_set(mode='EDIT')
    root=data.edit_bones.new('Root');root.head=(0,0,0);root.tail=(0,0,.04);root.use_deform=False
    for src in donor.data.bones:
        n=src.name
        if n not in heads:continue
        b=data.edit_bones.new(n);b.head=heads[n];b.tail=tails[n]
        b.parent=data.edit_bones.get(src.parent.name) if src.parent and src.parent.name in heads else root
        b.use_connect=False
        b.use_deform=n!='Body'
    bpy.ops.object.mode_set(mode='OBJECT')
    rest={b.name:b.matrix_local.copy() for b in data.bones}
    ordered=list(data.bones)
    rig['animation_source']='Quaternius Ultimate Animated Animals / CC0 / https://poly.pizza/m/P1gU3Qkr9r'
    rig['source_model']='User supplied volk.fbx; original preserved'
    rig['retarget']='World rotation offsets; two-bone limb solve; original paw trajectories; ground correction'

    status('skinning')
    # Region masks keep the four legs independent, including near the belly.
    points=np.array([v.co for v in mesh.data.vertices],dtype=np.float64)
    names=[b.name for b in data.bones if b.use_deform]
    count=len(points)
    weights=np.zeros((count,len(names)),dtype=np.float64)
    indices={n:i for i,n in enumerate(names)}
    def distance2(a,b):
        a=np.array(a);d=np.array(b)-a
        t=np.clip(((points-a)*d).sum(axis=1)/(d@d),0,1)
        return ((points-a-t[:,None]*d)**2).sum(axis=1)
    distances=np.column_stack([distance2(heads[n],tails[n]) for n in names])
    x,y,z=points.T
    body=[n for n in names if n in ['Back','Torso','Torso2','Torso3','Neck1','Neck2','Neck3','Head']]
    allowed=np.zeros_like(weights,dtype=bool)
    for n in body:allowed[:,indices[n]]=True
    tail_zone=x>.17
    for n in names:
        if n.startswith('Tail'):allowed[tail_zone,indices[n]]=True
    # Solid head and muzzle; the neck supplies the transition at its base.
    head_zone=x<-.423
    allowed[head_zone,:]=False
    for n in ['Head','Neck3']:allowed[head_zone,indices[n]]=True
    for suffix,s in [('L',-1),('R',1)]:
        for kind in ['Front','Back']:
            if kind=='Front':
                limb=[f'{n}.{suffix}' for n in ['FrontShoulder','FrontUpperLeg','FrontLowerLeg','IKFrontLeg','FF']]
                region=(x<-.195)&(x>-.4)&(y*s>.012)&(z<.365)
                low=region&(z<.235)
            else:
                limb=[f'{n}.{suffix}' for n in ['BackShoulder','BackLeg','BackUpperLeg','BackLowerLeg','IKBackLeg','FFB']]
                region=(x>-.005)&(x<.238)&(y*s>.018)&(z<.365)
                low=region&(z<.235)
            allowed[low,:]=False
            for n in limb:allowed[region,indices[n]]=True
        ear=(x<-.40)&(x>-.47)&(z>.435)&(y*s>.018)
        for i in range(1,5):allowed[ear,indices[f'Ear{i}.{suffix}']]=True
    # The outer tail must not be influenced by a nearby hind leg or the spine.
    allowed[x>.245,:]=False
    for n in names:
        if n.startswith('Tail'):allowed[x>.245,indices[n]]=True
    raw=np.where(allowed,1/np.power(distances+.00013,2.3),0)
    raw/=np.maximum(raw.sum(axis=1,keepdims=True),1e-20)
    edges=np.array([tuple(e.vertices) for e in mesh.data.edges],dtype=np.int32)
    degree=np.bincount(edges.ravel(),minlength=count).astype(float)
    for _ in range(10):
        acc=np.zeros_like(raw)
        np.add.at(acc,edges[:,0],raw[edges[:,1]])
        np.add.at(acc,edges[:,1],raw[edges[:,0]])
        avg=acc/np.maximum(degree[:,None],1)
        raw=(raw*.55+avg*.45)*allowed
        raw/=np.maximum(raw.sum(axis=1,keepdims=True),1e-20)
    # Four influences per vertex keep the runtime and the FBX skin predictable.
    top=np.argpartition(raw,-4,axis=1)[:,-4:]
    weights[np.arange(count)[:,None],top]=raw[np.arange(count)[:,None],top]
    weights/=np.maximum(weights.sum(axis=1,keepdims=True),1e-20)
    for n in names:mesh.vertex_groups.new(name=n)
    for i,row in enumerate(weights):
        for j in np.flatnonzero(row>1e-6):mesh.vertex_groups[names[j]].add([i],float(row[j]),'REPLACE')
    modifier=mesh.modifiers.new('Volk Skin','ARMATURE');modifier.object=rig
    mesh.parent=rig
    mesh['weights']='Anatomical regions; mesh adjacency smoothing; normalized; max 4 influences'

    # Hide donor geometry, retain it in the editable project as provenance/reference.
    source_collection=bpy.data.collections.new('SOURCE_Quaternius_CC0')
    scene.collection.children.link(source_collection)
    for o in donor_objects:
        for c in list(o.users_collection):c.objects.unlink(o)
        source_collection.objects.link(o)
        o.hide_render=True
        o.hide_set(True)
    source_collection.hide_render=True
    # Ensure the base-colour texture is the Workbench/viewport preview texture.
    for material in mesh.data.materials:
        bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        if bsdf.inputs['Base Color'].is_linked:
            material.node_tree.nodes.active=bsdf.inputs['Base Color'].links[0].from_node
    R=Matrix.Rotation(-math.pi/2,4,'Z')
    rq=R.to_quaternion()
    scale=.20
    limbs={}
    for suffix in ['L','R']:
        limbs['Front'+suffix]=[f'{n}.{suffix}' for n in ['FrontUpperLeg','FrontLowerLeg','IKFrontLeg','FF']]
        limbs['Back'+suffix]=[f'{n}.{suffix}' for n in ['BackLeg','BackUpperLeg','BackLowerLeg','IKBackLeg','FFB']]
    leg_names={n for chain in limbs.values() for n in chain}
    target_actions=[]
    source_samples={}
    output_names={'Idle':'idle','Idle_2':'idle_look','Idle_2_HeadLow':'idle_low','Walk':'walk',
                  'Gallop':'run','Gallop_Jump':'run_jump','Jump_ToIdle':'jump',
                  'Attack':'attack','Idle_HitReact_Left':'hit_left','Idle_HitReact_Right':'hit_right',
                  'Death':'death','Eating':'eat'}

    def delta_q(name,sp):
        return rq@sp[name].to_quaternion()@source_rest[name].to_quaternion().inverted()@rq.inverted()
    def matrix_at(q,p):
        m=q.to_matrix().to_4x4();m.translation=p;return m
    def orient(name,head,tail,sp):
        delta=delta_q(name,sp)
        desired=delta@rest[name].to_quaternion()
        desired_y=desired@Vector((0,1,0))
        direction=tail-head
        if direction.length<1e-8:return matrix_at(desired,head)
        swing=desired_y.rotation_difference(direction.normalized())
        return matrix_at(swing@desired,head)
    def solve(a,c,l1,l2,pole):
        d=c-a;length=max(d.length,1e-8);v=d/length
        reach=min(length,(l1+l2)*.997)
        reach=max(reach,abs(l1-l2)+1e-5)
        c=a+v*reach
        h=(l1*l1-l2*l2+reach*reach)/(2*reach)
        height=math.sqrt(max(l1*l1-h*h,0))
        bend=pole-v*pole.dot(v)
        if bend.length<1e-6:bend=Vector((1,0,0))-v*v.x
        return a+v*h+bend.normalized()*height,c,max(0,length-reach)

    # Key the actual retargeted clips; no synthetic walk/run cycles are substituted.
    max_clamp=0
    for source_name,out_name in output_names.items():
        action=source_actions[source_name]
        status('retargeting',clip=out_name)
        donor.animation_data.action=None
        for pb in donor.pose.bones:pb.matrix_basis.identity()
        donor.animation_data.action=action
        donor.animation_data.action_slot=action.slots[0]
        donor.hide_set(False)
        out=bpy.data.actions.new(out_name)
        out.use_fake_user=True
        rig.animation_data_create();rig.animation_data.action=out
        frame_end=int(round(action.frame_range[1]))
        frame_begin=int(round(action.frame_range[0]))
        max_clamp_clip=0
        for frame in range(frame_begin,frame_end+1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            sp={p.name:(donor.matrix_world@p.matrix).copy() for p in donor.pose.bones}
            matrices={'Root':Matrix.Identity(4)}
            for b in ordered:
                n=b.name
                if n=='Root' or n in leg_names:continue
                parent=b.parent.name
                head=(matrices[parent]@rest[parent].inverted()@rest[n]).translation
                if n=='Body':head=Vector(heads[n])+R.to_3x3()@(sp[n].translation-source_rest[n].translation)*scale
                matrices[n]=matrix_at(delta_q(n,sp)@rest[n].to_quaternion(),head)
            for label,chain in limbs.items():
                front=label.startswith('Front')
                upper,lower=chain[:2]
                ankle=chain[2] if front else chain[3]
                toe=chain[3] if front else chain[4]
                parent=data.bones[upper].parent.name
                a=(matrices[parent]@rest[parent].inverted()@rest[upper]).translation
                paw_delta=R.to_3x3()@(sp[ankle].translation-source_rest[ankle].translation)*scale
                # Slightly reduce horizontal stride for this model's shorter limbs.
                if out_name in ['walk','run','run_jump','jump']:
                    paw_delta.x*=.78;paw_delta.y*=.85
                c=Vector(heads[ankle])+paw_delta
                l1=(Vector(tails[upper])-Vector(heads[upper])).length
                l2=(Vector(tails[lower])-Vector(heads[lower])).length
                src_pole=sp[lower].translation-(sp[upper].translation+sp[ankle].translation)*.5
                pole=R.to_3x3()@src_pole
                if front:
                    b,c,error=solve(a,c,l1,l2,pole)
                    matrices[upper]=orient(upper,a,b,sp)
                    matrices[lower]=orient(lower,b,c,sp)
                else:
                    hock=chain[2]
                    metatarsal=delta_q(hock,sp)@(Vector(tails[hock])-Vector(heads[hock]))
                    b,h,error=solve(a,c-metatarsal,l1,l2,pole)
                    c=h+metatarsal
                    matrices[upper]=orient(upper,a,b,sp)
                    matrices[lower]=orient(lower,b,h,sp)
                    matrices[hock]=orient(hock,h,c,sp)
                max_clamp_clip=max(max_clamp_clip,error)
                ankle_q=delta_q(ankle,sp)@rest[ankle].to_quaternion()
                matrices[ankle]=matrix_at(ankle_q,c)
                toe_head=(matrices[ankle]@rest[ankle].inverted()@rest[toe]).translation
                matrices[toe]=matrix_at(delta_q(toe,sp)@rest[toe].to_quaternion(),toe_head)
            for b in ordered:
                n=b.name
                desired=matrices[n]
                basis=rest[n].inverted()@desired if not b.parent else rest[n].inverted()@rest[b.parent.name]@matrices[b.parent.name].inverted()@desired
                loc,rot,scl=basis.decompose()
                pb=rig.pose.bones[n]
                pb.rotation_mode='QUATERNION';pb.location=loc;pb.rotation_quaternion=rot;pb.scale=(1,1,1)
                pb.keyframe_insert('location',frame=frame)
                pb.keyframe_insert('rotation_quaternion',frame=frame)
            bpy.context.view_layer.update()
            # Lift the complete rig only when skinned geometry penetrates the floor.
            deps=bpy.context.evaluated_depsgraph_get()
            evaluated=mesh.evaluated_get(deps)
            surface=evaluated.to_mesh()
            minimum=min(v.co.z for v in surface.vertices)
            evaluated.to_mesh_clear()
            correction=max(0,-minimum)
            if correction:
                root=rig.pose.bones['Root'];root.location.z=correction
                root.keyframe_insert('location',frame=frame)
        max_clamp=max(max_clamp,max_clamp_clip)
        target_actions.append(out)
        source_samples[out_name]={'source':source_name,'frames':[frame_begin,frame_end],
                                  'duration':(frame_end-frame_begin)/24,'max_leg_reach_correction':max_clamp_clip}
        donor.hide_set(True)
    donor.animation_data_clear()
    for pb in donor.pose.bones:pb.matrix_basis.identity()
    donor.data.pose_position='REST'
    rig.animation_data.action=None
    # NLA strips let both exporters write exactly these twelve actions.
    for a in target_actions:
        track=rig.animation_data.nla_tracks.new();track.name=a.name
        strip=track.strips.new(a.name,0,a);strip.action_slot=a.slots[0]
        strip.extrapolation='NOTHING';strip.blend_type='REPLACE'
        track.mute=True
    for pb in rig.pose.bones:pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    select_only([mesh,rig],rig)
    mesh.data.calc_loop_triangles()
    report={'source_fbx':str(ROOT/'source/volk.fbx'),'donor':str(ROOT/'source/Quaternius_Wolf.glb'),
            'license':'Donor animations CC0; supplied mesh ownership unchanged',
            'bones':len(data.bones),'deform_bones':sum(b.use_deform for b in data.bones),
            'vertices':len(mesh.data.vertices),'triangles':len(mesh.data.loop_triangles),
            'max_influences':4,'unweighted_vertices':int(np.sum(weights.sum(axis=1)<.999)),
            'actions':source_samples,'max_leg_reach_correction':max_clamp}
    (WORK/'rig_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    scene.frame_start=0;scene.frame_end=80;scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=str(EXPORT/'volk_rigged.blend'))
    status('exporting_gltf')
    # Muted NLA tracks are intentionally included by the NLA_TRACKS exporter.
    bpy.ops.export_scene.gltf(filepath=str(EXPORT/'volk_rigged.glb'),export_format='GLB',
        use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',
        export_frame_range=False,export_force_sampling=True,export_skins=True,
        export_materials='EXPORT',export_extras=True)
    status('exporting_fbx')
    for track in rig.animation_data.nla_tracks:track.mute=False
    bpy.ops.export_scene.fbx(filepath=str(EXPORT/'volk_rigged.fbx'),use_selection=True,
        object_types={'MESH','ARMATURE'},add_leaf_bones=False,
        bake_anim=True,bake_anim_use_all_actions=False,bake_anim_use_nla_strips=True,
        bake_anim_simplify_factor=0,path_mode='COPY',embed_textures=True,
        axis_forward='-Z',axis_up='Y')
    for track in rig.animation_data.nla_tracks:track.mute=True
    idle=bpy.data.actions['idle'];rig.animation_data.action=idle;rig.animation_data.action_slot=idle.slots[0]
    for action in bpy.data.actions:
        if action not in target_actions:action.name='SOURCE_'+action.name
    scene.frame_set(0)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.shading.type='SOLID'
    bpy.ops.wm.save_as_mainfile(filepath=str(EXPORT/'volk_rigged.blend'))
    status('complete',**report)

try:
    run()
except Exception:
    status('error',traceback=traceback.format_exc())
    raise
