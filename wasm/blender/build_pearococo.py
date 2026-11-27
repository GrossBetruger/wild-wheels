"""Headless Blender 5.3 PBR generator for Pearococo (#9):
- Rigid Rococo royal chariot (`pearococo_chariot.glb`) & gilded wheels (`pearococo_wheel.glb`)
- Skinned royal peacock queen (`pearococo_queen.glb`) on a 10-bone skeleton (`rigging.py`)
  with 3 animation clips (`poise`, `wave`, `boost`) and aristocratic eyelid blink shape keys!

Run: /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_pearococo.py
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


def make_mat(name, color, metallic=0.0, roughness=0.4, coat=0.0, emission=None, emission_strength=0.0):
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


# --- Skinned Queen Skeleton & Animation Clips ---
def queen_bones():
    return [
        ("gown", None, (0.0, 2.04, 0.0)),
        ("torso", "gown", (0.0, 2.48, 0.08)),
        ("neck", "torso", (0.0, 3.12, 0.16)),
        ("head", "neck", (0.0, 3.92, 0.30)),
        ("curl_l", "head", (-0.50, 4.46, 0.24)),
        ("curl_r", "head", (0.50, 4.46, 0.24)),
        ("wing_l", "torso", (-0.64, 2.72, 0.47)),
        ("wing_r_upper", "torso", (0.64, 2.72, 0.47)),
        ("wing_r_fore", "wing_r_upper", (0.92, 2.62, 0.67)),
        ("wing_r_hand", "wing_r_fore", (1.06, 3.28, 0.85)),
    ]


def pose_poise(t):
    s = wave(t, 1)
    s2 = wave(t, 2, 0.4)
    return {
        "gown": RZ(s * 0.025),
        "torso": RX(s2 * 0.025) @ RY(s * 0.04),
        "neck": RX(-0.04 + s2 * 0.035) @ RY(wave(t, 1, 0.4) * 0.07),
        "head": RY(wave(t, 1, 0.7) * 0.10) @ RX(0.03 - s2 * 0.03),
        "curl_l": RZ(wave(t, 2, 0.9) * 0.09) @ RX(wave(t, 2, 0.5) * 0.05),
        "curl_r": RZ(-wave(t, 2, 0.9) * 0.09) @ RX(wave(t, 2, 0.5) * 0.05),
        "wing_l": RZ(s * 0.04),
        # Right wing rests delicately at her side in cruise
        "wing_r_upper": RX(0.75) @ RZ(-0.22 + s * 0.04),
        "wing_r_fore": RX(0.32),
        "wing_r_hand": RZ(s * 0.06),
    }


def pose_wave(t):
    w = wave(t, 2)
    s = wave(t, 1)
    return {
        "gown": RZ(s * 0.03),
        "torso": RX(-0.06) @ RY(0.08 + s * 0.05),
        "neck": RX(-0.08) @ RY(0.06),
        "head": RX(-0.10) @ RY(0.10 + s * 0.08),
        "curl_l": RZ(wave(t, 2, 0.8) * 0.14),
        "curl_r": RZ(-wave(t, 2, 0.8) * 0.14),
        "wing_l": RZ(0.06 + s * 0.04),
        # Signature aristocratic upright royal wrist-swivel wave!
        "wing_r_upper": RX(-0.14) @ RZ(0.10 + s * 0.05),
        "wing_r_fore": RX(-0.08) @ RZ(w * 0.08),
        "wing_r_hand": RZ(w * 0.34) @ RY(w * 0.16),
    }


def pose_boost(t):
    f = wave(t, 2)
    return {
        "gown": RX(0.08),
        "torso": RX(0.16 + f * 0.025),
        "neck": RX(-0.12 + f * 0.03),
        "head": RX(-0.08),
        "curl_l": RX(0.28 + f * 0.08) @ RZ(0.12),
        "curl_r": RX(0.28 + f * 0.08) @ RZ(-0.12),
        "wing_l": RX(0.20) @ RZ(0.12),
        "wing_r_upper": RX(0.85) @ RZ(-0.30),
        "wing_r_fore": RX(0.42),
        "wing_r_hand": RX(0.15),
    }


QUEEN_CLIPS = [
    ("poise", 48, pose_poise),
    ("wave", 48, pose_wave),
    ("boost", 30, pose_boost),
]


def add_blink_shape_key(lids_obj):
    shut = [v.co.copy() for v in lids_obj.data.vertices]
    brow_z = max(v.co.z for v in lids_obj.data.vertices)
    for v in lids_obj.data.vertices:
        v.co.z = brow_z - (brow_z - v.co.z) * 0.06
        v.co.y += 0.02
    lids_obj.shape_key_add(name="Basis")
    key = lids_obj.shape_key_add(name="blink")
    for idx, co in enumerate(shut):
        key.data[idx].co = co
    key.value = 0.0


def build_queen_rig():
    clear_scene()
    mat_pink = make_mat("GownPinkSilk", (0.90, 0.36, 0.60), metallic=0.06, roughness=0.36, coat=0.45)
    mat_blush = make_mat("GownBlushSilk", (0.98, 0.68, 0.80), metallic=0.04, roughness=0.38, coat=0.35)
    mat_lace = make_mat("IvoryLace", (0.98, 0.92, 0.78), metallic=0.02, roughness=0.52)
    mat_teal = make_mat("PeacockTeal", (0.06, 0.38, 0.48), metallic=0.42, roughness=0.22, coat=0.85)
    mat_neck = make_mat("PeacockSapphire", (0.09, 0.50, 0.62), metallic=0.48, roughness=0.18, coat=0.92)
    mat_gold = make_mat("QueenGold24K", (0.94, 0.68, 0.22), metallic=0.94, roughness=0.16, coat=0.4)
    mat_pearl = make_mat("QueenPearl", (1.0, 0.97, 0.92), metallic=0.18, roughness=0.12, coat=1.0)
    mat_eye_w = make_mat("QueenEyeWhite", (0.98, 0.95, 0.88), metallic=0.0, roughness=0.18)
    mat_eye_p = make_mat("QueenPupil", (0.04, 0.07, 0.18), metallic=0.15, roughness=0.08, coat=0.95)
    mat_diamond = make_mat(
        "TiaraDiamond", (0.98, 0.44, 0.72), metallic=0.25, roughness=0.06, coat=1.0,
        emission=(0.55, 0.14, 0.34), emission_strength=0.6,
    )

    body_parts = []

    # 1. Silk pannier gown & scalloped ivory lace
    rigging.carry(gown=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(0, 2.04, 0.0), 1.38, 0.80, 0.88, segs=22, rings=12)
    make_piece("GownMain", bm, mat_pink, body_parts)
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        add_sphere(bm, loc(side * 0.95, 2.10, 0.0), 0.56, 0.62, 0.74, segs=16, rings=10)
    make_piece("GownBustles", bm, mat_blush, body_parts)
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        for i in range(7):
            a = i * math.pi / 6.0
            add_sphere(bm, loc(side * (0.73 + math.sin(a) * 0.63), 1.78 + math.cos(a) * 0.15, 0.56), 0.17, 0.15, 0.14, segs=10, rings=6)
    make_piece("GownLace", bm, mat_lace, body_parts)

    # 2. Peacock bodice & pearl necklace
    rigging.carry(torso=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(0, 2.85, 0.13), 0.56, 0.68, 0.54, segs=18, rings=10)
    make_piece("BodiceTeal", bm, mat_teal, body_parts)
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        for i in range(5):
            add_sphere(bm, loc(side * (0.08 + i * 0.08), 2.96 - i * 0.05, 0.63), 0.08, 0.08, 0.08, segs=8, rings=5)
    make_piece("NecklacePearls", bm, mat_pearl, body_parts)

    # 3. Graceful sapphire swan neck
    rigging.carry(neck=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(0, 3.46, 0.21), 0.30, 0.76, 0.30, segs=16, rings=10)
    make_piece("SwanNeck", bm, mat_neck, body_parts)

    # 4. Head, beak, eyes, bouffant pouf & 8-point gold tiara
    rigging.carry(head=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(0, 4.18, 0.35), 0.54, 0.59, 0.50, segs=20, rings=12)
    make_piece("HeadSapphire", bm, mat_neck, body_parts)
    bm = bmesh.new()
    add_tube(bm, loc(0, 4.06, 0.68), loc(0, 4.01, 1.24), 0.20, 0.03, segs=12)
    for i in range(8):
        a = i * math.tau / 8.0
        add_tube(bm, loc(math.sin(a) * 0.33, 4.76, 0.26 + math.cos(a) * 0.29),
                 loc(math.sin(a) * 0.36, 5.06, 0.26 + math.cos(a) * 0.32), 0.075, 0.02, segs=8)
    make_piece("HeadBeakTiaraGold", bm, mat_gold, body_parts)
    bm = bmesh.new()
    for i in range(8):
        a = i * math.tau / 8.0
        add_sphere(bm, loc(math.sin(a) * 0.36, 5.06, 0.26 + math.cos(a) * 0.32), 0.045, 0.045, 0.045, segs=8, rings=4)
    make_piece("TiaraPearls", bm, mat_pearl, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(0, 5.14, 0.26), 0.13, 0.16, 0.13, segs=12, rings=8)
    make_piece("TiaraDiamond", bm, mat_diamond, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(0, 4.70, 0.26), 0.44, 0.20, 0.40, segs=16, rings=8)
    make_piece("HairPouf", bm, mat_lace, body_parts)
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        add_sphere(bm, loc(side * 0.30, 4.30, 0.73), 0.14, 0.19, 0.08, segs=12, rings=8)
    make_piece("EyeWhite", bm, mat_eye_w, body_parts)
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        add_sphere(bm, loc(side * 0.30, 4.31, 0.79), 0.065, 0.11, 0.035, segs=10, rings=6)
        add_box(bm, loc(side * 0.31, 4.48, 0.74), 0.24, 0.035, 0.045)
    make_piece("EyePupilLashes", bm, mat_eye_p, body_parts)
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        add_sphere(bm, loc(side * 0.39, 4.06, 0.70), 0.13, 0.065, 0.04, segs=10, rings=6)
    make_piece("CheekBlush", bm, mat_pink, body_parts)

    # 5. Secondary-motion powdered Rococo curls & dangling pearl drop earrings!
    for side, bone in ((-1.0, "curl_l"), (1.0, "curl_r")):
        rigging.carry(**{bone: 1.0})
        bm = bmesh.new()
        for i in range(3):
            add_sphere(bm, loc(side * 0.50, 4.46 - i * 0.20, 0.24), 0.20, 0.16, 0.26, segs=12, rings=8)
        make_piece(f"Curls_{bone}", bm, mat_lace, body_parts)
        bm = bmesh.new()
        add_sphere(bm, loc(side * 0.56, 3.90, 0.31), 0.095, 0.115, 0.095, segs=10, rings=6)
        make_piece(f"Earring_{bone}", bm, mat_pearl, body_parts)

    # 6. Delicate left wing resting on the golden rail
    rigging.carry(wing_l=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(-0.64, 2.72, 0.47), 0.28, 0.42, 0.26, segs=12, rings=8)
    make_piece("WingLBlush", bm, mat_blush, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(-0.88, 2.34, 0.70), 0.19, 0.30, 0.20, segs=12, rings=8)
    make_piece("WingLTeal", bm, mat_teal, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(-1.00, 2.17, 0.87), 0.21, 0.13, 0.22, segs=12, rings=8)
    make_piece("WingLGlove", bm, mat_lace, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(-0.96, 2.22, 0.82), 0.17, 0.055, 0.17, segs=10, rings=5)
    make_piece("WingLBracelet", bm, mat_gold, body_parts)

    # 7. Articulated 3-bone right wing & opera-gloved royal hand (built in upright wave pose)
    rigging.carry(wing_r_upper=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(0.64, 2.72, 0.47), 0.30, 0.38, 0.27, segs=12, rings=8)
    make_piece("WingRBlush", bm, mat_blush, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(0.88, 2.62, 0.67), 0.19, 0.29, 0.19, segs=12, rings=8)
    make_piece("WingRTeal", bm, mat_teal, body_parts)

    rigging.carry(wing_r_fore=1.0)
    bm = bmesh.new()
    add_tube(bm, loc(0.96, 2.60, 0.75), loc(1.06, 3.28, 0.85), 0.14, 0.11, segs=10)
    make_piece("WingRForeGlove", bm, mat_lace, body_parts)
    bm = bmesh.new()
    add_sphere(bm, loc(1.01, 3.08, 0.82), 0.16, 0.055, 0.16, segs=12, rings=5)
    make_piece("WingRBracelet", bm, mat_gold, body_parts)

    rigging.carry(wing_r_hand=1.0)
    bm = bmesh.new()
    add_sphere(bm, loc(1.08, 3.38, 0.85), 0.20, 0.22, 0.095, segs=12, rings=8)
    for finger in range(4):
        add_sphere(bm, loc(1.08 + (finger - 1.5) * 0.095, 3.64, 0.85), 0.045, 0.16, 0.06, segs=8, rings=5)
    add_sphere(bm, loc(0.86, 3.36, 0.88), 0.09, 0.11, 0.07, segs=8, rings=5)
    make_piece("WingRHand", bm, mat_lace, body_parts)

    # 8. Eyelids mesh with `blink` shape key (carried by `head`)
    rigging.carry(head=1.0)
    lids_parts = []
    bm = bmesh.new()
    for side in (-1.0, 1.0):
        add_sphere(bm, loc(side * 0.30, 4.31, 0.76), 0.155, 0.205, 0.09, segs=12, rings=6)
    lids = make_piece("Queen_Eyelids", bm, mat_neck, lids_parts)
    bpy.context.view_layer.objects.active = lids
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    add_blink_shape_key(lids)

    body = rigging.join(body_parts, "Queen_Body")
    bones = queen_bones()
    rig = rigging.build_armature("QueenRig", bones)
    rigging.skin(rig, body, lids)
    rigging.author_clips(rig, bones, QUEEN_CLIPS)
    rigging.export_rig(os.path.join(OUT_DIR, "pearococo_queen.glb"), QUEEN_CLIPS)
    return rig


if __name__ == "__main__":
    build_queen_rig()
