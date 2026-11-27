"""Render the five exported specialist skeletons side by side through their three clips."""
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

assets = Path(__file__).resolve().parent.parent / 'assets'
output = Path(sys.argv[sys.argv.index('--')+1])
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rigs = []
for col, filename in enumerate(['models/tammy.glb','houston_pilot.glb','models/catheterpillar.glb',
                                'models/fourmidable.glb','taicoon.glb']):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(assets/filename))
    added = set(scene.objects)-before
    rig = next(o for o in added if o.type=='ARMATURE')
    tracks = {t.name:t for t in rig.animation_data.nla_tracks}
    rig.animation_data.action = None
    rigs.append(tracks)
    for obj in added:
        if not obj.parent:
            obj.location.x += (col-2)*4.2

scene.world=bpy.data.worlds.new('Studio')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.20,.26,1)
for energy,rotation in [(3,(.7,.3,-.5)),(2,(.8,-.4,2.7))]:
    bpy.ops.object.light_add(type='SUN',rotation=rotation)
    bpy.context.object.data.energy=energy
bpy.ops.object.camera_add()
camera=bpy.context.object
scene.camera=camera
camera.data.type='ORTHO'
camera.data.ortho_scale=22
scene.frame_start,scene.frame_end=1,90
scene.render.fps=15
def stage(scene,*_):
    mode=('cruise','boost','special')[(scene.frame_current-1)//30]
    for tracks in rigs:
        for name,track in tracks.items():
            track.mute=name!=mode
            for strip in track.strips:
                strip.repeat=12
    # Keep all five silhouettes in frame, including in the chase-camera view.
    offset=math.sin(math.tau*(scene.frame_current-1)/90)
    camera.location=(2.4*offset,16 if mode=="boost" else -16,7.5)
    camera.rotation_euler=(Vector((0,0,2.9))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.stamp_note_text='Tammy / Houston / Catheterpillar / Fourmidable / Tai-Coon    |    '+mode
bpy.app.handlers.frame_change_pre.append(stage)
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x,scene.render.resolution_y=960,340
scene.render.resolution_percentage=100
scene.render.use_stamp=scene.render.use_stamp_note=True
for field in ('date','time','frame','render_time','camera','scene','filename','memory','hostname','lens'):
    setattr(scene.render,'use_stamp_'+field,False)
scene.render.stamp_font_size=16
scene.render.filepath=str(output.resolve())
if output.suffix.lower()=='.png':
    scene.frame_set(87)
    bpy.ops.render.render(write_still=True)
else:
    scene.render.image_settings.media_type='VIDEO'
    scene.render.ffmpeg.format,scene.render.ffmpeg.codec='MPEG4','H264'
    bpy.ops.render.render(animation=True)
