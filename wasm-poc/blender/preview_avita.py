"""
Render Avita-Jas's animation clips + offline-simulated woven aviator scarf +
Cessna 172 wing-waggle into one short labelled film. Pass clip names after the
output folder to render only a subset (e.g. `accordion wing_waggle`).

    /opt/homebrew/bin/blender --background --python wasm-poc/blender/preview_avita.py -- "$TMPDIR/avita-preview" && open "$TMPDIR/avita-preview/avita-clips.mp4"
"""
import importlib.util
import math
import os
import sys
import bpy
from mathutils import Euler, Vector

sys.dont_write_bytecode = True
here = os.path.dirname(os.path.abspath(__file__))
assets_dir = os.path.join(here, "..", "assets")

extra = sys.argv[sys.argv.index("--") + 1:]
out_dir, only_clips = extra[0], extra[1:]
os.makedirs(out_dir, exist_ok=True)

spec = importlib.util.spec_from_file_location("build_avita", os.path.join(here, "build_avita.py"))
avita = importlib.util.module_from_spec(spec)
spec.loader.exec_module(avita)

rig = avita.build_worm_rig(os.path.join(out_dir, "avita_worm.glb"))
rig.animation_data.use_nla = False
scarf_keys = bpy.data.objects["Avita_Scarf"].data.shape_keys.key_blocks
clips = {name: (frames, pose_at) for name, frames, pose_at in avita.CLIPS}


def import_part(filename, place=(0, 0, 0)):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(assets_dir, filename))
    added = [obj for obj in set(bpy.data.objects) - before if obj.parent is None]
    for obj in added:
        obj.rotation_mode = "XYZ"
        obj.location = avita.loc(*place)
    return added


# Parent plane, prop, and worm rig under one pivot so wing-waggle rolls everything together
craft = bpy.data.objects.new("AvitaCraft", None)
craft.rotation_mode = "XYZ"
bpy.context.collection.objects.link(craft)

plane = import_part("avita_plane.glb", (0, 0, 0))
prop = import_part("avita_prop.glb", (0, 1.78, 3.16))
for obj in plane + prop + [rig]:
    obj.parent = craft

SHOTS = [
    ("cruise: S-curve ripple + woven scarf breeze", "cruise", 2),
    ("boost: aero tuck + high-speed scarf whip", "boost", 3),
    ("accordion: earthworm scrunch + spring rebound", "accordion", 2),
    ("wing_waggle: Cessna wing-waggle ace salute", "wing_waggle", 2),
]
if only_clips:
    known = {clip for _, clip, _ in SHOTS}
    unknown = [c for c in only_clips if c not in known]
    if unknown:
        raise SystemExit(f"Unknown clip(s): {', '.join(unknown)}. Available: {', '.join(sorted(known))}")
    SHOTS = [shot for shot in SHOTS if shot[1] in only_clips]

timeline = []
for label, clip, plays in SHOTS:
    frames = clips[clip][0]
    timeline += [
        (label, clip, frame / frames, shot_frame)
        for shot_frame, frame in enumerate(list(range(frames)) * plays)
    ]


def apply_scarf_morphs(seconds, stream, turn_throw):
    for kb in scarf_keys:
        kb.value = 0.0
    thrown = min(1.0, abs(turn_throw)) * 0.65
    for (prefix, frames, rate), share in zip(avita.SCARF_PASSES, (1.0 - stream, stream)):
        at = seconds * rate
        first = int(at) % frames
        fade = at - math.floor(at)
        scarf_keys[f"{prefix}{first:02d}"].value += share * (1.0 - thrown) * (1.0 - fade)
        scarf_keys[f"{prefix}{(first + 1) % frames:02d}"].value += share * (1.0 - thrown) * fade
    if thrown > 1e-4:
        scarf_keys["left" if turn_throw > 0 else "right"].value = thrown


def stage(scene, *_):
    label, clip, cycle, shot_frame = timeline[min(scene.frame_current, len(timeline) - 1)]
    seconds = shot_frame / 30.0
    avita.set_pose(rig, clips[clip][1](cycle))

    boosting = clip == "boost"
    # Spin propeller around forward axis (Blender -Y)
    prop_speed = 54.0 if boosting else 22.0
    for obj in prop:
        obj.rotation_euler = Euler((0.0, -seconds * prop_speed, 0.0), "XYZ")

    # Wing-waggle roll + subtle lift on the whole Cessna during celebration
    roll = 0.0
    lift = 0.0
    pitch = 0.06 if boosting else 0.0
    if clip == "wing_waggle":
        env = avita.ease(min(cycle / 0.18, (1.0 - cycle) / 0.22))
        roll = math.sin(cycle * math.tau * 2.0) * 0.44 * env
        lift = 0.38 * env
    # Blender Y is -model Z, so banking roll about model Z is rotation about Blender Y
    craft.location = (0.0, 0.0, lift)
    craft.rotation_euler = Euler((pitch, -roll, 0.0), "XYZ")

    # Offline-simulated scarf playback
    stream = 1.0 if boosting else 0.18
    turn_throw = roll / 0.44 if clip == "wing_waggle" else 0.0
    apply_scarf_morphs(seconds, stream, turn_throw)

    # Rear-quarter chase camera so scarf, worm, and wings are all clearly framed
    camera.location = Vector(avita.loc(-5.8, 5.4, -7.8))
    aim = Vector(avita.loc(-0.2, 3.1, 0.0))
    camera.rotation_euler = (aim - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.stamp_note_text = label


scene = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=80)
ground = bpy.data.materials.new("ground")
ground.use_nodes = True
ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.24, 0.20, 1)
bpy.context.active_object.data.materials.append(ground)
for strength, turn in ((3.2, (0.8, 0.15, 2.6)), (1.6, (0.9, -0.2, -0.6))):
    bpy.ops.object.light_add(type="SUN")
    bpy.context.active_object.data.energy = strength
    bpy.context.active_object.rotation_euler = Euler(turn)
scene.world = bpy.data.worlds.new("sky")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.48, 0.58, 0.74, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.85
camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
camera.data.lens = 40
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
render.filepath = os.path.join(out_dir, "avita-clips.mp4")
scene.frame_start, scene.frame_end = 0, len(timeline) - 1
bpy.app.handlers.frame_change_pre.append(stage)
bpy.ops.render.render(animation=True)
print(f"Avita's clips -> {render.filepath} ({len(timeline) / 30:.1f} seconds)")
