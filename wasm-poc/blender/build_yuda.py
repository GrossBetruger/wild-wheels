"""
Build Master-Yuda (#10), the aviator-shaded biker elder on his chrome V-twin cruiser
motorcycle, as articulated Blender 5.3 PBR glTF (.glb) parts following drawMotorcycle,
drawYuda, and drawYudaJacket in characters/master-yuda/master-yuda.js:
  - wasm-poc/assets/models/yuda_bike.glb       : chrome V-twin cruiser frame, tank, pipes, lamp, mirrors
  - wasm-poc/assets/models/yuda_wheel.glb      : one wheel about its axle (used front & rear)
  - wasm-poc/assets/models/yuda_rider.glb      : Master-Yuda in his studded leather jacket w/ winged back patch
  - wasm-poc/assets/models/yuda_rider_bare.glb : bare-chested Master-Yuda (while boosting / Vulcan!)
  - wasm-poc/assets/models/yuda_jacket.glb     : flying leather biker jacket thrown behind him on boost

Run:
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_yuda.py
"""
import math
import os
import bpy
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


def make_mat(name, hex_color, roughness=0.45, metallic=0.0, emission=0.0, emission_color=None):
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


def add_box(x, y, z, sx, sy, sz, mat, bevel=0.02, rot=(0, 0, 0)):
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


def add_tube(p1, p2, r1, r2, mat, segs=12):
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


def add_torus(x, y, z, major_r, minor_r, mat, rot=(0, 0, 0), major=32, minor=10, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=major, minor_segments=minor,
        major_radius=major_r, minor_radius=minor_r,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
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
    print(f"[yuda] Exported {path} ({os.path.getsize(path)} bytes)")


# ---------------------------------------------------------------------------
# 1. Chrome V-Twin Cruiser Motorcycle (yuda_bike.glb)
# ---------------------------------------------------------------------------
def build_bike():
    clear_scene()
    m_chrome = make_mat("YudaChrome", "#ccdce2", roughness=0.14, metallic=0.96)
    m_pipe = make_mat("ExhaustPipe", "#788d99", roughness=0.22, metallic=0.90)
    m_heat = make_mat("PipeHeat", "#6e5a4d", roughness=0.32, metallic=0.85)
    m_bore = make_mat("PipeBore", "#111b24", roughness=0.85, metallic=0.2)
    m_engine = make_mat("EngineCast", "#4e5862", roughness=0.52, metallic=0.72)
    m_leather = make_mat("BikerLeather", "#222631", roughness=0.52, metallic=0.06)
    m_paint = make_mat("TankCrimson", "#b8352d", roughness=0.20, metallic=0.42)
    m_gold = make_mat("TankGold", "#f3cb80", roughness=0.24, metallic=0.88)
    m_mirror = make_mat("MirrorGlass", "#8dcad8", roughness=0.05, metallic=0.35)
    m_lamp = make_mat("HeadlampGlow", "#fff2c6", roughness=0.10, emission=3.6, emission_color="#ffe8a8")
    m_tail = make_mat("TaillightGlow", "#ff5240", roughness=0.15, emission=3.2, emission_color="#ff3b28")

    for side in (-1, 1):
        # Rear swingarm, swept chrome front forks, backbone frame
        add_tube((side * 0.44, 0.92, -1.65), (side * 0.48, 1.50, 0.20), 0.095, 0.095, m_chrome)
        add_tube((side * 0.44, 0.92, 1.80), (side * 0.40, 2.16, 1.10), 0.092, 0.092, m_chrome)
        add_tube((side * 0.48, 1.50, 0.20), (side * 0.40, 2.16, 1.10), 0.095, 0.095, m_leather)
        # Exposed finned V-twin cylinder + crankcase
        for i in range(6):
            add_box(side * 0.30, 0.90 + i * 0.12, 0.0, 0.56, 0.045, 0.86, m_chrome, bevel=0.01)
        add_sphere(side * 0.43, 1.16, -0.24, 0.25, 0.30, 0.33, m_engine, segs=14, rings=8)
        # Swept twin chrome megaphone exhaust pipes with heat-tinted collars & dark bores
        add_tube((side * 0.50, 1.12, 0.10), (side * 0.65, 0.66, -1.25), 0.12, 0.14, m_chrome)
        add_tube((side * 0.65, 0.67, -1.22), (side * 0.65, 0.67, -2.32), 0.15, 0.20, m_pipe)
        add_tube((side * 0.65, 0.67, -2.26), (side * 0.65, 0.67, -2.36), 0.20, 0.19, m_heat)
        add_sphere(side * 0.65, 0.67, -2.35, 0.15, 0.15, 0.04, m_bore, segs=12, rings=6)
        # Wide cruiser handlebars, leather grips, mirrors, footpegs
        add_tube((side * 0.15, 2.14, 1.05), (side * 0.86, 2.40, 1.28), 0.072, 0.068, m_chrome)
        add_box(side * 0.92, 2.34, 1.28, 0.38, 0.14, 0.17, m_leather, bevel=0.03)
        add_tube((side * 0.75, 2.40, 1.25), (side * 0.98, 2.90, 1.35), 0.032, 0.032, m_chrome)
        add_sphere(side * 1.02, 2.90, 1.36, 0.20, 0.13, 0.055, m_chrome, segs=14, rings=8)
        add_sphere(side * 1.02, 2.90, 1.42, 0.15, 0.09, 0.02, m_mirror, segs=12, rings=6)
        add_box(side * 0.68, 0.78, -0.32, 0.48, 0.11, 0.34, m_leather, bevel=0.025)

    # Teardrop crimson fuel tank with gold racing stripe + chrome filler cap
    add_sphere(0, 1.75, 0.35, 0.65, 0.43, 0.92, m_paint, segs=24, rings=14)
    add_box(0, 2.14, 0.32, 0.16, 0.04, 1.14, m_gold, bevel=0.012)
    add_sphere(0, 2.18, 0.56, 0.11, 0.05, 0.11, m_chrome, segs=14, rings=6)
    # Low stitched black leather saddle + rear fender
    add_sphere(0, 1.67, -0.69, 0.60, 0.18, 0.66, m_leather, segs=18, rings=10)
    add_sphere(0, 1.65, -1.65, 0.46, 0.17, 0.78, m_paint, segs=18, rings=10)
    # Big chrome round headlamp + glowing warm lens + rear ruby taillight
    add_sphere(0, 1.90, 1.88, 0.34, 0.32, 0.24, m_chrome, segs=18, rings=10)
    add_sphere(0, 1.90, 2.10, 0.26, 0.25, 0.05, m_lamp, segs=16, rings=8)
    add_box(0, 1.57, -2.20, 0.44, 0.14, 0.09, m_tail, bevel=0.025)

    export_glb("yuda_bike.glb")


# ---------------------------------------------------------------------------
# 2. Spinning Motorcycle Wheel (yuda_wheel.glb, centered at axle 0,0,0)
# ---------------------------------------------------------------------------
def build_wheel():
    clear_scene()
    m_tire = make_mat("MotoTire", "#171c24", roughness=0.88, metallic=0.02)
    m_chrome = make_mat("WheelChrome", "#cddce2", roughness=0.14, metallic=0.96)
    m_rotor = make_mat("BrakeRotor", "#34424f", roughness=0.35, metallic=0.85)
    m_gold = make_mat("AxleGold", "#f4c77a", roughness=0.22, metallic=0.90)

    rot_x = (0.0, math.pi / 2, 0.0)
    add_torus(0, 0, 0, 0.68, 0.24, m_tire, rot=rot_x, major=32, minor=12, scale=(1.0, 1.0, 1.45))
    add_torus(0, 0, 0, 0.54, 0.08, m_chrome, rot=rot_x, major=28, minor=8)
    for side in (-1, 1):
        add_sphere(side * 0.35, 0, 0, 0.04, 0.44, 0.44, m_rotor, segs=18, rings=8)
        add_sphere(side * 0.39, 0, 0, 0.055, 0.14, 0.14, m_gold, segs=12, rings=6)
    for i in range(10):
        a = i * math.tau / 10
        add_tube((0, 0, 0), (0, math.cos(a) * 0.54, math.sin(a) * 0.54), 0.024, 0.024, m_chrome, segs=6)

    export_glb("yuda_wheel.glb")


# ---------------------------------------------------------------------------
# 3. Master-Yuda Rider (clothed & bare variants)
# ---------------------------------------------------------------------------
def build_rider(clothed, filename):
    clear_scene()
    m_brown = make_mat("YudaBrown", "#95643f", roughness=0.72)
    m_light = make_mat("YudaLightBrown", "#bc8a59", roughness=0.74)
    m_mouth = make_mat("YudaMouth", "#493428", roughness=0.65)
    m_leather = make_mat("YudaJacket", "#222631", roughness=0.48, metallic=0.08)
    m_boot = make_mat("YudaBoot", "#161d29", roughness=0.58, metallic=0.05)
    m_chrome = make_mat("YudaChrome", "#ccdce2", roughness=0.14, metallic=0.95)
    m_shade = make_mat("AviatorLens", "#0d1622", roughness=0.06, metallic=0.35)
    m_cyan = make_mat("AviatorCyan", "#6af3ed", roughness=0.10, emission=2.6, emission_color="#6af3ed")
    m_hoop = make_mat("EarHoop", "#f2d6a5", roughness=0.20, metallic=0.92)
    m_body = m_leather if clothed else m_brown

    # Torso
    add_sphere(0, 2.32, -0.52, 0.62, 0.70, 0.46, m_body, segs=22, rings=14)
    if not clothed:
        add_sphere(0, 2.08, -0.12, 0.38, 0.32, 0.12, m_light, segs=16, rings=8)

    for side in (-1, 1):
        # Bent biker legs + chunky boots on footpegs
        knee = (side * 0.76, 1.43, 0.05)
        ankle = (side * 0.69, 1.03, -0.28)
        add_tube((side * 0.40, 1.90, -0.55), knee, 0.23, 0.20, m_body)
        add_tube(knee, ankle, 0.20, 0.18, m_body)
        add_sphere(ankle[0], ankle[1] - 0.07, ankle[2] + 0.23, 0.26, 0.20, 0.48, m_boot if clothed else m_brown, segs=14, rings=8)
        # Arms gripping the wide handlebars
        hand = (side * 0.91, 2.38, 1.28)
        add_tube((side * 0.52, 2.65, -0.25), hand, 0.20, 0.17, m_body)
        add_sphere(*hand, 0.22, 0.19, 0.21, m_brown, segs=14, rings=8)
        if clothed:
            # Gleaming chrome jacket lapels + 3 chrome studs per side
            add_box(side * 0.24, 2.68, -0.10, 0.22, 0.42, 0.06, m_chrome, bevel=0.015, rot=(0.15, 0, side * -0.35))
            for i in range(3):
                add_sphere(side * 0.50, 2.73 - i * 0.12, -0.05, 0.042, 0.042, 0.036, m_chrome, segs=8, rings=5)

    # Iconic brown elder head + huge horizontal pointed ears + gold earring + aviator shades
    add_sphere(0, 3.38, -0.32, 0.81, 0.72, 0.68, m_brown, segs=26, rings=16)
    for side in (-1, 1):
        # Expressive long horizontal pointed elder ears
        add_tube((side * 0.62, 3.45, -0.22), (side * 2.08, 3.74, -0.38), 0.30, 0.04, m_brown, segs=10)
        add_tube((side * 0.74, 3.44, -0.12), (side * 1.82, 3.68, -0.30), 0.16, 0.02, m_light, segs=8)
        # Unmistakable chrome-rimmed dark aviator sunglasses with glowing cyan reflection bar!
        add_sphere(side * 0.36, 3.52, 0.29, 0.37, 0.27, 0.10, m_chrome, segs=18, rings=10)
        add_sphere(side * 0.36, 3.52, 0.37, 0.32, 0.22, 0.055, m_shade, segs=16, rings=8)
        add_box(side * 0.35, 3.59, 0.43, 0.26, 0.028, 0.018, m_cyan, bevel=0.005)
        add_tube((side * 0.70, 3.55, 0.31), (side * 0.79, 3.53, -0.30), 0.035, 0.035, m_chrome, segs=8)
        add_tube((side * 0.12, 3.94, -0.02), (side * 0.48, 3.83, 0.08), 0.032, 0.028, m_light, segs=8)

    add_box(0, 3.51, 0.37, 0.20, 0.048, 0.055, m_chrome, bevel=0.01)
    add_sphere(0, 3.27, 0.38, 0.19, 0.16, 0.24, m_light, segs=14, rings=8)
    add_sphere(0, 3.02, 0.19, 0.35, 0.13, 0.23, m_light, segs=14, rings=8)
    add_box(0.08, 3.10, 0.40, 0.30, 0.03, 0.03, m_mouth, bevel=0.008)
    # Gold hoop earring on left ear
    add_torus(-1.06, 3.32, -0.10, 0.11, 0.028, m_hoop, rot=(0, 0, 0), major=18, minor=6)

    # Iconic chrome & glowing cyan winged biker patch on the back of the jacket!
    if clothed:
        for side in (-1, 1):
            for i in range(4):
                add_box(side * (0.14 + i * 0.10), 2.48 + i * 0.05, -0.97, 0.15, 0.065, 0.035, m_chrome, bevel=0.008)
        add_sphere(0, 2.50, -0.98, 0.13, 0.17, 0.03, m_cyan, segs=12, rings=6)

    export_glb(filename)


# ---------------------------------------------------------------------------
# 4. Flying Leather Biker Jacket (yuda_jacket.glb)
# ---------------------------------------------------------------------------
def build_jacket():
    clear_scene()
    m_leather = make_mat("FlyLeather", "#222631", roughness=0.50, metallic=0.08)
    m_chrome = make_mat("FlyChrome", "#ccdce2", roughness=0.14, metallic=0.95)
    m_cyan = make_mat("FlyCyan", "#6af3ed", roughness=0.10, emission=2.4, emission_color="#6af3ed")

    add_box(0, 0.0, -0.20, 1.18, 1.15, 0.18, m_leather, bevel=0.05)
    for side in (-1, 1):
        add_box(side * 0.46, 0.0, 0.14, 0.32, 1.14, 0.32, m_leather, bevel=0.04)
        add_tube((side * 0.55, 0.40, 0.0), (side * 1.15, -0.15, 0.28), 0.22, 0.18, m_leather)
        add_box(side * 0.26, 0.35, 0.32, 0.20, 0.38, 0.05, m_chrome, bevel=0.01)
        for i in range(4):
            add_box(side * (0.14 + i * 0.10), 0.12 + i * 0.05, -0.30, 0.15, 0.065, 0.035, m_chrome, bevel=0.008)
    add_sphere(0, 0.14, -0.31, 0.13, 0.17, 0.03, m_cyan, segs=12, rings=6)

    export_glb("yuda_jacket.glb")


if __name__ == "__main__":
    build_bike()
    build_wheel()
    build_rider(True, "yuda_rider.glb")
    build_rider(False, "yuda_rider_bare.glb")
    build_jacket()
    print("[yuda] ALL DONE!")
