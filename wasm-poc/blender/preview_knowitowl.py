"""
Render every KnowItOwl animation clip into one short film, each labelled, so
the moves can be judged without playing a match.

    blender --background --python wasm-poc/blender/preview_knowitowl.py -- "$TMPDIR/knowitowl-preview" && open "$TMPDIR/knowitowl-preview/knowitowl-clips.mp4"
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
# The builder exports wherever the argument after "--" says: the preview's own
# folder, so the game's model is left alone.
out_dir = sys.argv[sys.argv.index("--") + 1]
spec = importlib.util.spec_from_file_location("build_knowitowl", os.path.join(here, "build_knowitowl.py"))
owl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owl)

rig = owl.build_owl()
rig.animation_data.use_nla = False
lids = bpy.data.objects["KnowItOwlLids"].data.shape_keys.key_blocks
clips = {name: (frames, pose_at) for name, frames, _, pose_at in owl.CLIPS}


def part(name, place):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(models, f"knowitowl_{name}.glb"))
    added = [obj for obj in set(bpy.data.objects) - before if obj.parent is None]
    for obj in added:
        obj.rotation_mode = "XYZ"
        obj.location = owl.loc(*place)
    return added


bicycle = part("bike", (0, 0, 0)) + part("wheel", (0, 1.1, -1.9)) + part("wheel", (0, 1.1, 1.9))
crank = part("crank", (0, 0.95, 0))
wheels = bicycle[-2:]

# (label, clip for the upper body, how many times it plays, in flight?)
SHOTS = [
    ("perch + pedal: riding, wings ruffling, blinking", "perch", 1, False),
    ("fly + trail: boosting", "fly", 3, True),
    ("wave", "wave", 3, False),
    ("cheer", "cheer", 3, False),
    ("wink: left eyelid shape key", "wink", 3, False),
    ("flourish", "flourish", 2, False),
    ("monocle: Dark Humor", "monocle", 3, False),
]
timeline = []
for label, clip, plays, flying in SHOTS:
    frames = clips[clip][0]
    timeline += [(label, clip, frame / frames, flying, shot_frame, frames * plays)
                 for shot_frame, frame in enumerate(list(range(frames)) * plays)]


def stage(scene, *_):
    label, clip, cycle, flying, shot_frame, shot_frames = timeline[min(scene.frame_current, len(timeline) - 1)]
    seconds = shot_frame / 30
    pose = dict(clips[clip][1](cycle))
    if flying:
        pose.update(clips["trail"][1]((seconds / 1.4) % 1))
    else:
        turn = (seconds * 0.9) % 1
        pose.update(clips["pedal"][1](turn))
        for obj in crank:
            obj.rotation_euler = Euler((math.tau * turn, 0, 0))
        for obj in wheels:
            obj.rotation_euler = Euler((math.tau * turn / 0.42, 0, 0))
    owl.set_pose(rig, pose)
    rig.location = (0, 0, 2.4 if flying else 0)
    for obj in bicycle + crank:
        obj.hide_render = flying
    # A blink every second and a half; the wink holds the left eye shut.
    since = (seconds % 1.5) - 1.2
    blink = max(0.0, 1 - abs(since / 0.08 - 1)) if since > 0 else 0.0
    lids["lid_l"].value = 1.0 if clip == "wink" and 0.25 < shot_frame / shot_frames else blink
    lids["lid_r"].value = blink
    camera.location = Vector(owl.loc(-6.5, 5.2 + (1.6 if flying else 0), 8.5))
    aim = Vector(owl.loc(0, 3.0 + (2.2 if flying else 0), 0))
    camera.rotation_euler = (aim - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.stamp_note_text = label


scene = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=80)
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.26, 0.22, 1)
bpy.context.active_object.data.materials.append(ground)
for strength, turn in ((3.2, (0.8, 0.15, 2.6)), (1.6, (0.9, -0.2, -0.6))):
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

render = scene.render
render.engine = "BLENDER_EEVEE"
render.resolution_x, render.resolution_y, render.fps = 720, 720, 30
render.use_stamp = render.use_stamp_note = True
for stamp in ("date", "time", "render_time", "frame", "scene", "camera", "filename", "memory", "hostname", "lens"):
    setattr(render, "use_stamp_" + stamp, False)
render.stamp_font_size = 22
render.image_settings.media_type = "VIDEO"
render.ffmpeg.format, render.ffmpeg.codec = "MPEG4", "H264"
render.filepath = os.path.join(out_dir, "knowitowl-clips.mp4")
scene.frame_start, scene.frame_end = 0, len(timeline) - 1
bpy.app.handlers.frame_change_pre.append(stage)
bpy.ops.render.render(animation=True)
print(f"KnowItOwl's clips -> {render.filepath} ({len(timeline) / 30:.0f} seconds)")
