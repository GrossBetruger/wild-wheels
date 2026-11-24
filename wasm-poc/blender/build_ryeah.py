"""Headless Blender 5.3 PBR generator for R-Yeah (#11):
- Rigid Bell 206 JetRanger helicopter, main rotor, tail rotor, 6-barrel Vulcan cluster
- Skinned hanging lion pilot (`ryeah_lion.glb`) on an 11-bone skeleton (`rigging.py`)
  with 4 animation clips (`hang`, `boost`, `roar`, `fire`) and eyelid blink shape keys!

Run: /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_ryeah.py
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import rigging  # noqa: E402
from rigging import RX, RY, RZ, wave  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, color, metallic=0.0, roughness=0.45, emission=None, emission_strength=0.0, coat=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if coat > 0.0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emission is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def loc(x, y, z):
    """Model space (x across, y up, z forward) -> Blender space (x, -z, y)."""
    return Vector((x, -z, y))


def hanging_model(x, y, z):
    """hangingLion transform in model space (x, y, z), anchored naturally under the
    Bell 206 left skid while keeping the kippah clear of the Vulcan pod."""
    c, s = math.cos(0.27), math.sin(0.27)
    cp, sp = math.cos(0.18), math.sin(0.18)
    x += 0.85
    y -= 5.15
    xx = x * c - y * s
    yy = x * s + y * c
    return (0.22 + xx, 4.64 + yy * cp - z * sp, 0.08 + yy * sp + z * cp)


def hanging_pt(x, y, z):
    return loc(*hanging_model(x, y, z))


def add_sphere(bm, center, rx, ry, rz, segs=16, rings=10):
    m = Matrix.Translation(center) @ Matrix.Diagonal((rx, rz, ry, 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)


def add_box(bm, center, sx, sy, sz):
    m = Matrix.Translation(center) @ Matrix.Diagonal((sx, sz, sy, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def add_tube(bm, p0, p1, r0, r1=None, segs=10):
    if r1 is None:
        r1 = r0
    v0, v1 = Vector(p0), Vector(p1)
    d = v1 - v0
    length = d.length
    if length < 1e-5:
        return
    mid = (v0 + v1) * 0.5
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    m = Matrix.Translation(mid) @ q.to_matrix().to_4x4()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs,
        radius1=r0, radius2=r1, depth=length, matrix=m,
    )


def add_capsule(bm, p0, p1, r, segs=10):
    add_tube(bm, p0, p1, r, r, segs=segs)
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=6, radius=r, matrix=Matrix.Translation(p0))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=6, radius=r, matrix=Matrix.Translation(p1))


def make_piece(name, bm, mat, bucket):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    rigging.bind(obj)
    bucket.append(obj)
    return obj


# --- Skinned Lion Skeleton & Animation Clips ---
HINGE_TORSO = hanging_model(0.0, 2.58, 0.20)
HINGE_HEAD = hanging_model(0.0, 3.65, 0.52)
HINGE_JAW = hanging_model(0.0, 3.72, 1.02)
HINGE_EAR_L = hanging_model(-0.60, 4.68, 0.48)
HINGE_EAR_R = hanging_model(0.60, 4.68, 0.48)
HINGE_ARM_L = hanging_model(-0.58, 2.85, 0.30)
HINGE_ARM_R_UP = hanging_model(0.58, 2.85, 0.30)
HINGE_ARM_R_LO = hanging_model(0.80, 3.10, 0.68)
HINGE_LEG_L = hanging_model(-0.38, 2.15, 0.18)
HINGE_LEG_R = hanging_model(0.38, 2.15, 0.18)
HINGE_TAIL_0 = hanging_model(0.0, 2.10, -0.32)
HINGE_TAIL_1 = hanging_model(-0.18, 1.80, -0.95)


def lion_bones():
    return [
        ("torso", None, HINGE_TORSO),
        ("head", "torso", HINGE_HEAD),
        ("jaw", "head", HINGE_JAW),
        ("ear_l", "head", HINGE_EAR_L),
        ("ear_r", "head", HINGE_EAR_R),
        ("arm_l", "torso", HINGE_ARM_L),
        ("arm_r_upper", "torso", HINGE_ARM_R_UP),
        ("arm_r_lower", "arm_r_upper", HINGE_ARM_R_LO),
        ("leg_l", "torso", HINGE_LEG_L),
        ("leg_r", "torso", HINGE_LEG_R),
        ("tail_base", "torso", HINGE_TAIL_0),
        ("tail_tip", "tail_base", HINGE_TAIL_1),
    ]


def pose_hang(t):
    s = wave(t, 1)
    s2 = wave(t, 2, 0.4)
    return {
        "torso": RZ(s * 0.05) @ RX(s2 * 0.03),
        "head": RY(wave(t, 1, 0.5) * 0.10) @ RX(-0.04 + s2 * 0.04),
        "jaw": RX(0.03 + max(0.0, s) * 0.04),
        "ear_l": RZ(wave(t, 1, 0.7) * 0.10),
        "ear_r": RZ(-wave(t, 1, 0.9) * 0.10),
        "arm_r_upper": RX(-0.10 + s * 0.12) @ RZ(0.08 + s * 0.08),
        "arm_r_lower": RX(-0.18 + wave(t, 1, 0.5) * 0.16),
        "leg_l": RX(-0.12 + wave(t, 1, 0.2) * 0.22),
        "leg_r": RX(-0.12 - wave(t, 1, 0.2) * 0.22),
        "tail_base": RY(wave(t, 1, 0.4) * 0.22) @ RX(-0.10 + s2 * 0.08),
        "tail_tip": RY(wave(t, 1, 1.1) * 0.34),
    }


def pose_boost(t):
    f = wave(t, 2)
    return {
        "torso": RX(0.24 + f * 0.04),
        "head": RX(-0.16 + f * 0.04) @ RY(wave(t, 1) * 0.05),
        "jaw": RX(0.14),
        "ear_l": RX(-0.32) @ RZ(0.18),
        "ear_r": RX(-0.32) @ RZ(-0.18),
        "arm_r_upper": RX(0.45) @ RZ(-0.42),
        "arm_r_lower": RX(0.28),
        "leg_l": RX(0.55 + wave(t, 2, 0.2) * 0.14),
        "leg_r": RX(0.55 - wave(t, 2, 0.2) * 0.14),
        "tail_base": RX(0.42) @ RY(wave(t, 2, 0.3) * 0.18),
        "tail_tip": RX(0.22) @ RY(wave(t, 2, 1.0) * 0.30),
    }


def pose_roar(t):
    w = wave(t, 2)
    cheer = 0.5 + 0.5 * wave(t, 1, -1.2)
    return {
        "torso": RX(-0.10) @ RZ(wave(t, 1) * 0.06),
        "head": RX(-0.24 * cheer - 0.08) @ RY(wave(t, 1) * 0.12),
        "jaw": RX(0.42 * cheer + 0.18),
        "ear_l": RZ(-0.22 * cheer),
        "ear_r": RZ(0.22 * cheer),
        "arm_r_upper": RX(-0.85 - w * 0.22) @ RZ(0.32 + w * 0.14),
        "arm_r_lower": RX(-0.35 + w * 0.25),
        "leg_l": RX(-0.22 + w * 0.18),
        "leg_r": RX(-0.22 - w * 0.18),
        "tail_base": RY(wave(t, 2, 0.3) * 0.28) @ RX(-0.15),
        "tail_tip": RY(wave(t, 2, 1.0) * 0.42),
    }


def pose_fire(t):
    rec = wave(t, 3)
    return {
        "torso": RX(0.06 + rec * 0.025),
        "head": RX(-0.06) @ RY(0.06),
        "jaw": RX(0.20 + abs(rec) * 0.08),
        "ear_l": RX(-0.16),
        "ear_r": RX(-0.16),
        "arm_r_upper": RX(-0.25 + rec * 0.06) @ RZ(0.18),
        "arm_r_lower": RX(-0.32),
        "leg_l": RX(0.18 + rec * 0.06),
        "leg_r": RX(0.18 - rec * 0.06),
        "tail_base": RY(wave(t, 1) * 0.16),
        "tail_tip": RY(wave(t, 1, 0.8) * 0.26),
    }


LION_CLIPS = [
    ("hang", 48, pose_hang),
    ("boost", 30, pose_boost),
    ("roar", 48, pose_roar),
    ("fire", 24, pose_fire),
]


def add_blink_shape_key(lids_obj):
    """Eyelids are built closed over the eyes; rest pose folds them open into the upper brow,
    and the `blink` shape key restores the closed lids!"""
    shut = [v.co.copy() for v in lids_obj.data.vertices]
    brow_z = max(v.co.z for v in lids_obj.data.vertices)
    for v in lids_obj.data.vertices:
        v.co.z = brow_z - (brow_z - v.co.z) * 0.08
        v.co.y += 0.02
    lids_obj.shape_key_add(name="Basis")
    key = lids_obj.shape_key_add(name="blink")
    for idx, co in enumerate(shut):
        key.data[idx].co = co
    key.value = 0.0


def build_lion_rig():
    clear_scene()
    mat_gold = make_mat("LionFurGold", (0.76, 0.42, 0.08), metallic=0.02, roughness=0.68)
    mat_cream = make_mat("LionMuzzleCream", (0.94, 0.78, 0.48), metallic=0.02, roughness=0.62)
    mat_mane = make_mat("LionInnerMane", (0.34, 0.12, 0.03), metallic=0.02, roughness=0.72)
    mat_ear = make_mat("LionInnerEar", (0.58, 0.28, 0.12), metallic=0.0, roughness=0.72)
    mat_nose = make_mat("LionNose", (0.09, 0.05, 0.07), metallic=0.06, roughness=0.30)
    mat_eye_w = make_mat("LionEyeWhite", (0.98, 0.96, 0.90), metallic=0.0, roughness=0.20)
    mat_eye_p = make_mat("LionPupil", (0.04, 0.10, 0.08), metallic=0.1, roughness=0.10, coat=0.85)
    mat_mouth = make_mat("LionMouth", (0.32, 0.07, 0.08), metallic=0.0, roughness=0.42)
    mat_kippah = make_mat("LionKippah", (0.03, 0.035, 0.05), metallic=0.04, roughness=0.76)
    mat_kippah_btn = make_mat("LionKippahBtn", (0.14, 0.16, 0.20), metallic=0.20, roughness=0.50)

    body_parts = []

    # 1. Sculpted athletic torso (broad chest, tapered waist, natural hips)
    rigging.carry(torso=1.0)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 2.74, 0.22), 0.74, 0.64, 0.60, segs=18, rings=10)
    add_sphere(bm, hanging_pt(0, 2.26, 0.16), 0.56, 0.54, 0.50, segs=16, rings=8)
    make_piece("Torso", bm, mat_gold, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 2.64, 0.60), 0.44, 0.52, 0.24, segs=12, rings=8)
    make_piece("Chest", bm, mat_cream, body_parts)

    # 2. Left gripping arm (pulling naturally up onto the Bell 206 left skid)
    rigging.carry(arm_l=1.0)
    left_grip_w = loc(0.31, 4.77, 0.45)
    bm = bmesh.new()
    add_capsule(bm, hanging_pt(-0.58, 2.95, 0.28), left_grip_w, 0.21, segs=10)
    add_sphere(bm, left_grip_w, 0.27, 0.25, 0.25, segs=12, rings=8)
    make_piece("ArmL", bm, mat_gold, body_parts)
    bm = bmesh.new()
    for finger in range(3):
        add_sphere(bm, loc(0.31 + (finger - 1) * 0.10, 4.88, 0.52), 0.065, 0.10, 0.09, segs=8, rings=5)
    make_piece("ArmLFingers", bm, mat_cream, body_parts)

    # 3. Right two-bone articulated arm
    rigging.carry(arm_r_upper=1.0)
    bm = bmesh.new()
    add_capsule(bm, hanging_pt(0.58, 2.95, 0.28), hanging_pt(0.80, 3.16, 0.68), 0.20, segs=10)
    make_piece("ArmRUpper", bm, mat_gold, body_parts)
    rigging.carry(arm_r_upper=0.5, arm_r_lower=0.5)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0.80, 3.16, 0.68), 0.20, 0.20, 0.20, segs=10, rings=6)
    make_piece("ArmRElbow", bm, mat_gold, body_parts)
    rigging.carry(arm_r_lower=1.0)
    bm = bmesh.new()
    add_capsule(bm, hanging_pt(0.80, 3.16, 0.68), hanging_pt(0.96, 3.48, 0.98), 0.19, segs=10)
    add_sphere(bm, hanging_pt(0.96, 3.48, 0.98), 0.26, 0.25, 0.24, segs=12, rings=8)
    make_piece("ArmRLower", bm, mat_gold, body_parts)

    # 4. Naturally bent hanging legs (thigh -> knee -> calf -> paw)
    for side, bone in ((-1, "leg_l"), (1, "leg_r")):
        rigging.carry(**{bone: 1.0})
        hip = hanging_pt(side * 0.36, 2.08, 0.16)
        knee = hanging_pt(side * 0.42, 1.54, 0.42 + side * 0.06)
        ankle = hanging_pt(side * 0.44, 1.04, 0.18 + side * 0.08)
        paw = hanging_pt(side * 0.45, 0.94, 0.40 + side * 0.08)
        bm = bmesh.new()
        add_capsule(bm, hip, knee, 0.22, segs=10)
        add_capsule(bm, knee, ankle, 0.18, segs=10)
        add_sphere(bm, paw, 0.27, 0.21, 0.36, segs=12, rings=8)
        make_piece(f"Leg_{bone}", bm, mat_gold, body_parts)

    # 5. Two-bone tufted lion tail
    t0, t1, t2 = hanging_pt(0.0, 2.10, -0.32), hanging_pt(-0.18, 1.80, -0.95), hanging_pt(-0.30, 1.68, -1.55)
    rigging.carry(tail_base=1.0)
    bm = bmesh.new()
    add_capsule(bm, t0, t1, 0.095, segs=8)
    make_piece("TailBase", bm, mat_gold, body_parts)
    rigging.carry(tail_tip=1.0)
    bm = bmesh.new()
    add_capsule(bm, t1, t2, 0.085, segs=8)
    make_piece("TailTip", bm, mat_gold, body_parts)
    bm = bmesh.new()
    add_sphere(bm, t2 + Vector((0, 0.20, -0.04)), 0.20, 0.22, 0.30, segs=12, rings=8)
    make_piece("TailTuft", bm, mat_mane, body_parts)

    # 6. Head, inner mane collar, face, kippah
    rigging.carry(head=1.0)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.05, 0.65), 0.80, 0.80, 0.68, segs=20, rings=12)
    make_piece("HeadGold", bm, mat_gold, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.02, 0.34), 1.00, 1.02, 0.70, segs=20, rings=12)
    for side in (-1, 1):
        add_box(bm, hanging_pt(side * 0.32, 4.48, 1.20), 0.36, 0.075, 0.08)
    make_piece("HeadMane", bm, mat_mane, body_parts)
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.24, 3.88, 1.27), 0.29, 0.23, 0.23, segs=12, rings=8)
    make_piece("HeadMuzzle", bm, mat_cream, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.02, 1.45), 0.17, 0.12, 0.12, segs=12, rings=8)
    make_piece("HeadNose", bm, mat_nose, body_parts)
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.30, 4.24, 1.22), 0.16, 0.19, 0.07, segs=10, rings=6)
    make_piece("HeadEyeW", bm, mat_eye_w, body_parts)
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.30, 4.25, 1.28), 0.075, 0.11, 0.04, segs=10, rings=6)
    make_piece("HeadPupil", bm, mat_eye_p, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.92, 0.58), 0.41, 0.14, 0.35, segs=16, rings=8)
    make_piece("HeadKippah", bm, mat_kippah, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 5.04, 0.58), 0.055, 0.025, 0.055, segs=8, rings=4)
    make_piece("HeadKippahBtn", bm, mat_kippah_btn, body_parts)

    # 7. Articulated ears (secondary ear flick!)
    for side, bone in ((-1, "ear_l"), (1, "ear_r")):
        rigging.carry(**{bone: 1.0})
        bm = bmesh.new()
        add_sphere(bm, hanging_pt(side * 0.66, 4.74, 0.48), 0.27, 0.28, 0.18, segs=12, rings=8)
        make_piece(f"Ear_{bone}", bm, mat_gold, body_parts)
        bm = bmesh.new()
        add_sphere(bm, hanging_pt(side * 0.66, 4.74, 0.62), 0.15, 0.16, 0.06, segs=10, rings=6)
        make_piece(f"EarIn_{bone}", bm, mat_ear, body_parts)

    # 8. Articulated lower jaw & fangs (opens wide during roar!)
    rigging.carry(jaw=1.0)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 3.60, 1.15), 0.32, 0.14, 0.20, segs=12, rings=6)
    make_piece("JawMouth", bm, mat_mouth, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 3.50, 1.18), 0.28, 0.13, 0.18, segs=10, rings=6)
    for side in (-1, 1):
        add_tube(bm, hanging_pt(side * 0.14, 3.66, 1.24), hanging_pt(side * 0.14, 3.55, 1.26), 0.038, 0.008, segs=6)
    make_piece("JawChinFangs", bm, mat_cream, body_parts)

    # 9. Separate eyelids mesh with `blink` shape key (carried by `head`)
    rigging.carry(head=1.0)
    lids_parts = []
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.30, 4.25, 1.25), 0.175, 0.205, 0.09, segs=12, rings=6)
    lids = make_piece("Lion_Eyelids", bm, mat_gold, lids_parts)
    bpy.context.view_layer.objects.active = lids
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    add_blink_shape_key(lids)

    body = rigging.join(body_parts, "Lion_Body")
    bones = lion_bones()
    rig = rigging.build_armature("LionRig", bones)
    rigging.skin(rig, body, lids)
    rigging.author_clips(rig, bones, LION_CLIPS)
    rigging.export_rig(os.path.join(OUT_DIR, "ryeah_lion.glb"), LION_CLIPS)
    return rig


if __name__ == "__main__":
    build_lion_rig()
