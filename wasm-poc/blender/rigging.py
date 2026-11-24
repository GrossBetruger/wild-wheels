"""
Skeletons, skin weights, poses and animation clips for racers built by script.

A racer's builder creates its pieces, saying which bones carry each (`carry`),
then builds the skeleton (`build_armature`), skins the joined meshes to it
(`skin`), writes its moves as functions of a 0..1 cycle (`author_clips`) and
exports one .glb holding the lot (`export_rig`). Everything a builder passes
in is in the racer's model space: x across, y up, z forward.

Poses are dictionaries of bone -> turn, where a turn is a quaternion about the
bone's hinge relative to its parent, or a tuple (turn, shift) or
(turn, shift, scale) to also move or resize it.
"""
import math
import os
import bpy
from mathutils import Matrix, Quaternion, Vector

# Model space -> Blender space: (x, y, z) -> (x, -z, y). The glTF exporter's
# Y-up conversion brings it back.
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
# The bones that carry what is being built, and their shares of it.
BIND = {}


def RX(angle):
    return Quaternion((1, 0, 0), angle)


def RY(angle):
    return Quaternion((0, 1, 0), angle)


def RZ(angle):
    return Quaternion((0, 0, 1), angle)


def wave(cycle, turns=1, lag=0.0):
    """A sine that completes `turns` whole swings over a clip, so it loops."""
    return math.sin(math.tau * turns * cycle - lag)


def ease(amount):
    """Smooth 0..1, clamped."""
    amount = max(0.0, min(1.0, amount))
    return amount * amount * (3 - 2 * amount)


def carry(**bones):
    """What is built from here on is carried by these bones, in these shares."""
    BIND.clear()
    BIND.update(bones)


def bind(obj):
    """Give a new piece its bones. Builders call this on every mesh they make."""
    vertices = list(range(len(obj.data.vertices)))
    for bone, share in BIND.items():
        obj.vertex_groups.new(name=bone).add(vertices, share, "REPLACE")
    return obj


def join(objects, name):
    """Merge pieces into one mesh, keeping every piece's bones."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.update()
    return obj


def build_armature(name, bones):
    """A skeleton from [(bone, parent or None, hinge)].

    Bones lie along Blender's +Y with no roll, so every joint's own axes are
    Blender's axes: a turn about a bone's x is a turn about the racer's x. In
    the game a joint is therefore a quarter turn about x from model space;
    parent things to a joint through a socket turned +90 degrees about x.
    """
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone_name, parent, hinge in bones:
        bone = data.edit_bones.new(bone_name)
        bone.head = (TO_BLENDER @ Vector(hinge).to_4d()).to_3d()
        bone.tail = bone.head + Vector((0, 0.3, 0))
        bone.roll = 0.0
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in data.bones:
        assert (bone.matrix_local.to_3x3() - Matrix.Identity(3)).median_scale < 1e-5, bone.name
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
    return rig


def skin(rig, *meshes):
    for mesh in meshes:
        mesh.parent = rig
        mesh.modifiers.new("Armature", "ARMATURE").object = rig


def placements(bones, pose):
    """Where a pose puts every bone, as model-space matrices."""
    moved = {}
    for name, parent, hinge in bones:
        turn, shift, scale = pose.get(name, Quaternion()), (0, 0, 0), 1.0
        if isinstance(turn, tuple):
            turn, shift, scale = (*turn, 1.0)[:3]
        at = Matrix.Translation(hinge)
        about = at @ turn.to_matrix().to_4x4() @ Matrix.Scale(scale, 4) @ at.inverted()
        moved[name] = moved.get(parent, Matrix.Identity(4)) @ Matrix.Translation(shift) @ about
    return moved


def set_pose(rig, bones, pose, keyed=None, frame=None, last=None):
    """Pose the rig; with a frame, key the `keyed` bones there."""
    placed = {name: TO_BLENDER @ matrix @ TO_BLENDER.inverted() for name, matrix in placements(bones, pose).items()}
    for name, parent, _ in bones:
        bone = rig.pose.bones[name]
        rest = rig.data.bones[name].matrix_local
        at_rest, parent_now = rest, Matrix.Identity(4)
        if parent:
            parent_rest = rig.data.bones[parent].matrix_local
            at_rest, parent_now = parent_rest.inverted() @ rest, placed[parent] @ parent_rest
        bone.matrix_basis = at_rest.inverted() @ parent_now.inverted() @ placed[name] @ rest
        if frame is None or name not in keyed:
            continue
        # Keep each key on the same side of the quaternion sphere as the last.
        if name in last and bone.rotation_quaternion.dot(last[name]) < 0:
            bone.rotation_quaternion.negate()
        last[name] = bone.rotation_quaternion.copy()
        for channel in ("rotation_quaternion", "location", "scale"):
            bone.keyframe_insert(channel, frame=frame)


def author_clips(rig, bones, clips):
    """One action per clip, from [(name, frames at 30 a second, pose at each
    point of its 0..1 cycle)], each stashed on its own NLA track for the
    exporter. Looping clips end where they begin; one-shot clips reach their
    last pose at cycle 1."""
    rig.animation_data_create()
    bpy.context.scene.render.fps = 30
    names = [name for name, _, _ in bones]
    for name, frames, pose_at in clips:
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        last = {}
        for frame in range(frames + 1):
            set_pose(rig, bones, pose_at(frame / frames), names, frame, last)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        rig.animation_data.action = None
        set_pose(rig, bones, {})
    bpy.context.scene.frame_end = max(frames for _, frames, _ in clips)


def reach(shoulder, elbow, hand, target, pole, parent=Quaternion(), parent_hinge=(0, 0, 0)):
    """Turns for an upper and a lower limb bone, hinged at `shoulder` and
    `elbow` and ending at `hand`, so the end reaches `target` with the middle
    joint bent toward `pole`. `parent` is the turn of the bone the limb hangs
    from, about `parent_hinge`. All points in model space."""
    shoulder, elbow, hand, target = Vector(shoulder), Vector(elbow), Vector(hand), Vector(target)
    hinge = Vector(parent_hinge)
    root = hinge + parent @ (shoulder - hinge)
    upper, lower = (elbow - shoulder).length, (hand - elbow).length
    span = target - root
    distance = max(abs(upper - lower) + 0.02, min(upper + lower - 0.01, span.length))
    along = span.normalized()
    side = Vector(pole) - along * Vector(pole).dot(along)
    side = side.normalized() if side.length > 1e-5 else along.orthogonal().normalized()
    near = (upper * upper - lower * lower + distance * distance) / (2 * distance)
    bend = root + along * near + side * math.sqrt(max(0.0, upper * upper - near * near))
    upper_turn = (parent @ (elbow - shoulder)).rotation_difference(bend - root) @ parent
    lower_turn = (upper_turn @ (hand - elbow)).rotation_difference(root + along * distance - bend) @ upper_turn
    return parent.inverted() @ upper_turn, upper_turn.inverted() @ lower_turn


def export_rig(path, clips, morph_normals=False):
    """Export everything in the scene as one .glb with skin, shape keys and
    one animation per clip. Shape keys that reshape a surface a long way (a
    simulated mane) need `morph_normals` to stay correctly lit; small ones
    (eyelids) do not, and are smaller without."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_materials="EXPORT",
        export_skins=True,
        export_morph=True,
        export_morph_normal=morph_normals,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=False,
    )
    triangles = sum(len(p.vertices) - 2 for obj in bpy.context.scene.objects if obj.type == "MESH"
                    for p in obj.data.polygons)
    print(f"Exported {os.path.basename(path)}: {triangles} triangles, {len(clips)} clips, "
          f"{os.path.getsize(path) // 1024} KiB")
    return triangles
