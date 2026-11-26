"""Skinning and named driving clips for the five remaining specialist riders."""
import math
from pathlib import Path
import bpy
from rigging import RX, RY, RZ, wave, build_armature, skin, join, author_clips, export_rig

# In the browser's model coordinates, positive Z points toward the steering wheel.
NECK = {'tammy': (0, 2.85, .12), 'catheterpillar': (0, 2.97, .15),
        'fourmidable': (0, 2.64, -.04), 'houston': (0, 2.99, .03), 'taicoon': (0, 2.65, .1)}
SHOULDER = {'tammy': (.72, 2.58, .2), 'catheterpillar': (.45, 2.76, .2),
            'fourmidable': (.2, 2.6, -.1), 'taicoon': (.54, 2.4, .15), 'houston': (.85, 2.25, .28)}


def bones_for(rider):
    bones = [('seat', None, (0, 0, 0)), ('spine', 'seat', (0, 1.7, 0)), ('head', 'spine', NECK[rider])]
    for side, suffix in [(-1, '_l'), (1, '_r')]:
        def pair(name, parent, hinge):
            x, y, z = hinge
            bones.append((name + suffix, parent, (side*x, y, z)))
        if rider in SHOULDER:
            pair('arm', 'spine', SHOULDER[rider])
        if rider in ('tammy', 'catheterpillar', 'fourmidable'):
            pair('feeler', 'head', (.32, {'tammy':4.1, 'catheterpillar':4.12, 'fourmidable':3.72}[rider], .1))
        if rider == 'houston':
            pair('wrist', 'arm'+suffix, (.85, 2.25, .84))
        if rider == 'tammy':
            pair('thigh', 'spine', (.93, 2.08, -.5))
            pair('shin', 'thigh'+suffix, (1.29, 1.46, -.5))
        if rider == 'catheterpillar':
            pair('wing', 'spine', (.28, 2.9, -.45))
        if rider == 'fourmidable':
            pair('middle', 'spine', (.25, 2.2, -.4))
            pair('leg', 'spine', (.35, 1.9, -.9))
        if rider == 'taicoon':
            pair('ear', 'head', (.59, 3.85, .06))
    if rider == 'taicoon':
        bones.extend([('tail', 'spine', (0,1.65,-.58)), ('tail_mid', 'tail', (.05,2.15,-.94)),
                      ('tail_tip', 'tail_mid', (.09,2.47,-1.27))])
    if rider == 'houston':
        bones.append(('aerial', 'head', (-.45, 4.56, .03)))
    return bones


def pose(rider, mode, cycle):
    special = mode == 'special'
    boost = mode == 'boost'
    # Keep the nurse's body timing independent of her continuous flight stroke.
    body_cycle = cycle
    if rider == 'catheterpillar':
        body_cycle *= {'cruise': 2, 'boost': 3, 'special': 1}[mode]
    beat = wave(body_cycle)
    motion = {'spine': RX((.12 if boost else .028)*beat), 'head': RY((.22 if special else .07)*beat)}
    for side, suffix in [(-1, '_l'), (1, '_r')]:
        sway = wave(body_cycle, lag=side*.4)
        motion['arm'+suffix] = RZ(side*(.12*sway + (.5 if special else .03)))
        motion['feeler'+suffix] = RX(.14*sway - (.3 if boost else 0)) @ RZ(side*.12*sway)
        motion['thigh'+suffix] = RX((.55 if special else .12)*sway)
        motion['shin'+suffix] = RX(-(.8 if special else .17)*sway)
        if rider == 'catheterpillar':
            # rider-parts captures the classic wings with the resting .2 radian yaw baked in.
            motion['wing'+suffix] = RY(side*.95*wave(cycle, turns=4 if boost else 3))
        motion['middle'+suffix] = RX((.55 if special else .13)*sway)
        motion['leg'+suffix] = RZ(side*.1*sway)
        motion['ear'+suffix] = RZ(side*.14*sway)
    if rider == 'taicoon':
        for index, name in enumerate(('tail','tail_mid','tail_tip')):
            motion[name] = RY((.32 if boost or special else .2)*wave(cycle,lag=index*.42)) @ RX(.06*beat)
    if rider == 'houston':
        for side,suffix in [(-1,'_l'),(1,'_r')]:
            motion['arm'+suffix] = RX((-1.15 if special else -.08) + .13*beat) @ RZ(side*.13*beat)
            motion['wrist'+suffix] = RY(side*.18*wave(cycle,lag=.4))
        motion['head'] = RX((.12 if boost else .04)*beat) @ RY((.3 if special else .09)*beat)
        motion['aerial'] = RX((.28 if boost else .09)*wave(cycle, lag=.6))
    return motion


def finish(rider, meshes, path):
    bones = bones_for(rider)
    rig = build_armature(rider.title()+'Rig', bones)
    skin(rig, *meshes)
    periods = (30, 30, 30) if rider == 'catheterpillar' else (48, 24, 36)
    clips = [(mode, frames, lambda t, mode=mode: pose(rider, mode, t))
             for mode, frames in zip(('cruise', 'boost', 'special'), periods)]
    author_clips(rig, bones, clips)
    export_rig(str(Path(path).resolve()), clips)
    return rig


def bind_piece(obj, bone):
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')


def finish_existing(rider, path, chassis=(), torso=()):
    """Choose complete sculpted pieces before the original builder joins its meshes."""
    moving = []
    fixed = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        if obj in chassis:
            fixed.append(obj)
            continue
        x, neg_z, y = obj.location
        suffix = '_r' if x > 0 else '_l'
        bone = 'head'
        if obj in torso:
            bone = 'arm'+suffix if rider == 'taicoon' and abs(x) >= .51 and y < 2.3 else 'spine'
        elif rider == 'houston' and y > 4.7 and x < -.4:
            bone = 'aerial'
        elif rider == 'taicoon' and abs(x) > .6 and 4.0 < y < 4.12:
            bone = 'ear'+suffix
        bind_piece(obj, obj.get('joint', bone))
        moving.append(obj)
    if fixed:
        join(fixed, rider.title()+'Vehicle')
    finish(rider, [join(moving, rider.title()+'Rider')], path)
