"""
Render Master-Yuda's animation clips into one short labelled film, so the
moves can be judged without playing a match. Seen from behind, as in a race.

    blender --background --python wasm-poc/blender/preview_yuda.py -- "$TMPDIR/yuda-preview" && open "$TMPDIR/yuda-preview/yuda-clips.mp4"

Frame numbers after the folder render those frames of the film as stills instead.
"""
import importlib.util
import math
import os
import sys
import bpy
from mathutils import Euler, Vector

# Importing the builder must not leave a bytecode folder in the repository.
sys.dont_write_bytecode = True
here = os.path.dirname(os.path.abspath(__file__))
models = os.path.join(here, "..", "assets", "models")
arguments = sys.argv[sys.argv.index("--") + 1:]
out_dir, stills = arguments[0], [int(frame) for frame in arguments[1:]]
os.makedirs(out_dir, exist_ok=True)
spec = importlib.util.spec_from_file_location("build_yuda", os.path.join(here, "build_yuda.py"))
yuda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(yuda)
rigging = yuda.rigging
# Build into the preview's folder, leaving the game's models alone.
yuda.OUT_DIR = out_dir

rig = yuda.build_rider()
rig.animation_data.use_nla = False
bones = yuda.rider_bones()
clips = {name: (frames, pose_at) for name, frames, pose_at in yuda.RIDER_CLIPS}
for name, place in (("bike", (0, 0, 0)), ("wheel", (0, 0.92, -1.65)), ("wheel", (0, 0.92, 1.8))):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(models, f"yuda_{name}.glb"))
    for obj in set(bpy.data.objects) - before:
        if obj.parent is None:
            obj.location = yuda.loc(*place)

# (label, clip, times it plays, frames to hold its last pose)
SHOTS = [
    ("ride: cruising in the jacket", "ride", 1, 0),
    ("strip: the jacket comes off (thrown from frame %d)" % yuda.RELEASE_FRAME, "strip", 1, 6),
    ("bare: boosting", "bare", 1, 0),
    ("dress: the jacket goes back on", "dress", 1, 10),
    ("strip, slowed four times", "strip", 4, 0),
    ("dress, slowed four times", "dress", 4, 0),
]
timeline = []
for label, clip, stretch, hold in SHOTS:
    frames = clips[clip][0]
    slow = label.endswith("times")
    steps = frames * stretch if slow else frames
    looping = clip in ("ride", "bare")
    timeline += [(label, clip, step / steps) for step in range(steps if looping else steps + 1)]
    timeline += [(label, clip, 1.0)] * hold


def stage(scene, *_):
    label, clip, cycle = timeline[min(scene.frame_current, len(timeline) - 1)]
    rigging.set_pose(rig, bones, clips[clip][1](cycle))
    scene.render.stamp_note_text = label


scene = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=80)
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.26, 0.22, 1)
bpy.context.active_object.data.materials.append(ground)
for strength, turn in ((3.2, (0.8, 0.15, 0.5)), (1.8, (0.9, -0.2, -2.6))):
    bpy.ops.object.light_add(type="SUN")
    bpy.context.active_object.data.energy = strength
    bpy.context.active_object.rotation_euler = Euler(turn)
scene.world = bpy.data.worlds.new("sky")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.58, 0.72, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
camera.data.lens = 42
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = Vector(yuda.loc(-4.5, 5.6, -8.5))
aim = Vector(yuda.loc(0, 2.5, 0))
camera.rotation_euler = (aim - camera.location).to_track_quat("-Z", "Y").to_euler()

render = scene.render
render.engine = "BLENDER_EEVEE"
render.resolution_x, render.resolution_y, render.fps = 720, 720, 30
render.use_stamp = render.use_stamp_note = True
for stamp in ("date", "time", "render_time", "frame", "scene", "camera", "filename", "memory", "hostname", "lens"):
    setattr(render, "use_stamp_" + stamp, False)
render.stamp_font_size = 22
scene.frame_start, scene.frame_end = 0, len(timeline) - 1
bpy.app.handlers.frame_change_pre.append(stage)
if stills:
    for frame in stills:
        scene.frame_set(frame)
        render.filepath = os.path.join(out_dir, f"frame{frame:03d}.png")
        bpy.ops.render.render(write_still=True)
else:
    render.image_settings.media_type = "VIDEO"
    render.ffmpeg.format, render.ffmpeg.codec = "MPEG4", "H264"
    render.filepath = os.path.join(out_dir, "yuda-clips.mp4")
    bpy.ops.render.render(animation=True)
    print(f"Master-Yuda's clips -> {render.filepath} ({len(timeline) / 30:.0f} seconds)")
