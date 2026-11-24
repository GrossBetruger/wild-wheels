"""
Build BatYouDidn'tKnow (KnowItOwl's hovering Uzi-toting vampire bat companion)
as articulated Blender 5.3 PBR glTF (.glb) parts following drawBat() in
characters/knowitowl/bat-companion.js:
  - wasm-poc/assets/models/bat_body.glb   : plush plum bat body, ears, golden eyes, fangs, crimson scarf, feet
  - wasm-poc/assets/models/bat_wing_l.glb : left scalloped wing membrane + bone fingers about left shoulder
  - wasm-poc/assets/models/bat_wing_r.glb : right scalloped wing membrane + bone fingers about right shoulder
  - wasm-poc/assets/models/bat_uzi.glb    : detailed compact Uzi SMG about its receiver center (for recoil!)

Run:
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_bat.py
"""
import math
import os
import bpy
import bmesh
from mathutils import Euler, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def loc(x, y, z):
    return (x, -z, y)


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


def make_mat(name, hex_color, roughness=0.65, metallic=0.0, emission=0.0, emission_color=None):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*hex_to_linear(hex_color), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0.0:
        ec = hex_to_linear(emission_color or hex_color)
        bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def add_sphere(x, y, z, rx, ry, rz, mat, segs=18, rings=10, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    if rot != (0, 0, 0):
        obj.rotation_euler = Euler(rot, "XYZ")
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def add_cone(x, y, z, r1, r2, depth, mat, verts=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    if rot != (0, 0, 0):
        obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def add_box(x, y, z, sx, sy, sz, mat, bevel=0.015, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    if rot != (0, 0, 0):
        obj.rotation_euler = Euler(rot, "XYZ")
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def add_cyl_between(p1, p2, r1, r2, mat, segs=10):
    v1, v2 = Vector(loc(*p1)), Vector(loc(*p2))
    diff = v2 - v1
    if diff.length < 1e-4:
        return None
    bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r1, radius2=r2, depth=diff.length, location=(v1 + v2) * 0.5)
    obj = bpy.context.active_object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = diff.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_materials="EXPORT",
        export_apply=True,
    )
    print(f"[bat] Exported {path} ({os.path.getsize(path)} bytes)")


def build_bat_body():
    clear_scene()
    m_plum = make_mat("BatPlumFur", "#483351", roughness=0.86)
    m_belly = make_mat("BatPlumBelly", "#61476e", roughness=0.88)
    m_ear_in = make_mat("BatEarPink", "#c68e9e", roughness=0.72)
    m_eye = make_mat("BatGoldEye", "#f7d979", roughness=0.10, emission=0.45, emission_color="#ffe282")
    m_pupil = make_mat("BatPupil", "#1b2736", roughness=0.06)
    m_glint = make_mat("BatGlint", "#ffffff", roughness=0.04, emission=1.5)
    m_nose = make_mat("BatNose", "#c9909f", roughness=0.52)
    m_fang = make_mat("BatFang", "#fff7df", roughness=0.20)
    m_mouth = make_mat("BatMouth", "#e7d8d6", roughness=0.45)
    m_scarf = make_mat("BatScarf", "#a84b68", roughness=0.72)
    m_foot = make_mat("BatFoot", "#d2b57d", roughness=0.52)

    # Plump furry torso + lighter belly + round head
    add_sphere(0, 0.50, 0.0, 0.48, 0.65, 0.35, m_plum, segs=22, rings=12)
    add_sphere(0, 0.48, 0.16, 0.32, 0.44, 0.22, m_belly, segs=16, rings=10)
    add_sphere(0, 1.20, 0.08, 0.55, 0.48, 0.40, m_plum, segs=24, rings=14)

    for side in (-1, 1):
        # Big pointed vampire bat ears + pink inner ear
        add_cone(side * 0.35, 1.78, 0.0, 0.24, 0.02, 0.88, m_plum, verts=12, rot=(0.0, side * -0.18, 0.0))
        add_cone(side * 0.34, 1.72, 0.09, 0.14, 0.015, 0.62, m_ear_in, verts=10, rot=(0.0, side * -0.18, 0.0))
        # Glowing golden eyes + pupils + catchlights
        add_sphere(side * 0.23, 1.25, 0.41, 0.18, 0.20, 0.08, m_eye, segs=16, rings=10)
        add_sphere(side * 0.21, 1.25, 0.47, 0.078, 0.12, 0.035, m_pupil, segs=12, rings=8)
        add_sphere(side * 0.18, 1.32, 0.50, 0.036, 0.042, 0.02, m_glint, segs=8, rings=6)
        # Cute little ivory vampire fangs pointing down
        add_cone(side * 0.12, 0.85, 0.43, 0.06, 0.0, 0.18, m_fang, verts=8, rot=(math.pi, 0, 0))
        # Little legs + tan feet gripping the Uzi
        add_sphere(side * 0.23, -0.10, 0.12, 0.12, 0.35, 0.12, m_plum, segs=12, rings=8)
        add_box(side * 0.23, -0.35, 0.33, 0.20, 0.11, 0.26, m_foot, bevel=0.025)

    # Nose + cheeky grin
    add_sphere(0, 1.08, 0.48, 0.17, 0.095, 0.075, m_nose, segs=14, rings=8)
    add_box(0, 0.90, 0.41, 0.28, 0.038, 0.03, m_mouth, bevel=0.01)

    # Crimson-burgundy bandit neck scarf + fluttering scarf tail
    add_box(0, 0.78, 0.06, 0.82, 0.15, 0.66, m_scarf, bevel=0.045)
    for i in range(4):
        add_sphere(0.45 + i * 0.20, 0.68 - i * 0.09, -0.05 - i * 0.14, 0.15 - i * 0.015, 0.07, 0.14, m_scarf, segs=10, rings=6)

    export_glb("bat_body.glb")


def build_bat_wing(side, filename):
    """Articulated scalloped bat wing authored with its shoulder hinge at (0, 0, 0)."""
    clear_scene()
    m_mem = make_mat("BatMembrane", "#774e79", roughness=0.68)
    m_bone = make_mat("BatWingBone", "#b68aab", roughness=0.45)

    root = (0.0, 0.0, 0.0)
    wrist = (side * 0.92, 0.42, -0.05)
    # Arm bone from shoulder to wrist + attached thumb claw on wrist
    add_cyl_between(root, wrist, 0.045, 0.038, m_bone, segs=10)
    add_cyl_between(wrist, (wrist[0] + side * 0.05, wrist[1] + 0.16, wrist[2] + 0.04), 0.030, 0.008, m_bone, segs=8)

    # 5 anatomical finger tips fanning outward & downward
    tips = []
    for i in range(5):
        tx = side * (1.28 + math.sin(i * 0.55) * 0.56)
        ty = -0.18 - i * 0.30
        tz = -0.08 - i * 0.16
        tips.append((tx, ty, tz))
        add_cyl_between(wrist, (tx, ty, tz), 0.030, 0.014, m_bone, segs=8)

    # Sculpted double-sided scalloped membrane mesh
    bm = bmesh.new()
    v_root = bm.verts.new(loc(*root))
    v_wrist = bm.verts.new(loc(*wrist))
    v_tips = [bm.verts.new(loc(*t)) for t in tips]
    for i in range(5):
        bm.faces.new((v_root, v_wrist, v_tips[i]) if side > 0 else (v_root, v_tips[i], v_wrist))
        if i < 4:
            # Scalloped inward arch between adjacent finger tips
            t0, t1 = tips[i], tips[i + 1]
            sc = (
                (t0[0] + t1[0]) * 0.5 + (root[0] - (t0[0] + t1[0]) * 0.5) * 0.26,
                (t0[1] + t1[1]) * 0.5 + (root[1] - (t0[1] + t1[1]) * 0.5) * 0.26,
                (t0[2] + t1[2]) * 0.5 + (root[2] - (t0[2] + t1[2]) * 0.5) * 0.26,
            )
            v_sc = bm.verts.new(loc(*sc))
            if side > 0:
                bm.faces.new((v_root, v_tips[i], v_sc))
                bm.faces.new((v_root, v_sc, v_tips[i + 1]))
            else:
                bm.faces.new((v_root, v_sc, v_tips[i]))
                bm.faces.new((v_root, v_tips[i + 1], v_sc))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.022)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("BatMembrane")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("BatMembrane", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m_mem)
    smooth(obj)

    export_glb(filename)


def build_bat_uzi():
    """Detailed compact Uzi SMG centered at (0, -0.52, 0.42) so recoil slides along local -Z."""
    clear_scene()
    m_rec = make_mat("UziReceiver", "#2e3843", roughness=0.38, metallic=0.82)
    m_mag = make_mat("UziMag", "#1e2832", roughness=0.46, metallic=0.75)
    m_grip = make_mat("UziGrip", "#47515a", roughness=0.72, metallic=0.15)
    m_steel = make_mat("UziSteel", "#87949d", roughness=0.24, metallic=0.92)
    m_bore = make_mat("UziBore", "#0e151c", roughness=0.85, metallic=0.2)

    # Box receiver, vertical magazine, pistol grip, trigger guard, folded wire stock, barrel & sights
    add_box(0, 0.0, 0.0, 0.56, 0.34, 1.05, m_rec, bevel=0.028)
    add_box(0, -0.50, -0.07, 0.23, 0.55, 0.31, m_mag, bevel=0.018)
    add_box(0, -0.14, -0.37, 0.20, 0.36, 0.23, m_grip, bevel=0.018)
    add_box(0, -0.20, -0.07, 0.40, 0.07, 0.40, m_steel, bevel=0.012)
    for side in (-1, 1):
        add_box(side * 0.21, 0.07, -0.90, 0.055, 0.055, 0.80, m_steel, bevel=0.01)
    add_box(0, -0.11, -1.27, 0.50, 0.24, 0.07, m_grip, bevel=0.018)
    add_cyl_between((0, 0.22, 0.52), (0, 0.22, 0.96), 0.105, 0.095, m_steel, segs=14)
    add_cyl_between((0, 0.22, 0.95), (0, 0.22, 1.00), 0.072, 0.072, m_bore, segs=12)
    # Top receiver cooling slots + front/rear iron sights
    for z in (-0.24, -0.08, 0.08, 0.24):
        add_box(0, 0.18, z, 0.28, 0.025, 0.055, m_bore, bevel=0.004)
    for z in (-0.44, 0.64):
        add_box(0, 0.34, z, 0.07, 0.18, 0.07, m_steel, bevel=0.01)

    export_glb("bat_uzi.glb")


if __name__ == "__main__":
    build_bat_body()
    build_bat_wing(-1, "bat_wing_l.glb")
    build_bat_wing(1, "bat_wing_r.glb")
    build_bat_uzi()
    print("[bat] ALL DONE!")
