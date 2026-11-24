"""
Build sculpted, smooth-shaded PBR glTF (.glb) models for 5 more Wild Wheels characters
using headless Blender:
    blender --background --python build_characters.py -- wasm-poc/assets

Exports:
  - pip.glb      (#0  Pip the Panda — purple racing kart + adorable panda)
  - tammy.glb    (#5  Tammy the Cricket — emerald cricket + lime/gold turbo kart)
  - houston.glb  (#7  Houston the RTPL — sloth astronaut in stainless-steel Starship)
  - yuda.glb     (#10 Master-Yuda — cool shades sage on sleek copper/chrome motorcycle)
  - owl.glb      (#14 KnowItOwl — snowy professor owl with gold spectacles + pearl/indigo kart)
"""
import math
import os
import sys
import bpy
from mathutils import Euler

argv = sys.argv
out_dir = argv[argv.index("--") + 1] if "--" in argv else "assets"
os.makedirs(out_dir, exist_ok=True)


def loc(x, y, z):
    return (x, -z, y)


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


MATS = {}


def reset_scene():
    global MATS
    MATS = {}
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, hex_color, roughness=0.5, metallic=0.0, emission=0.0, emission_color=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name=name)
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    rgb = hex_to_linear(hex_color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0.0:
        ec = hex_to_linear(emission_color or hex_color)
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    MATS[name] = m
    return m


def smooth(obj, bevel=0.0):
    bpy.context.view_layer.objects.active = obj
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def sphere(x, y, z, rx, ry, rz, m, segs=22, rings=14, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def box(x, y, z, sx, sy, sz, m, bevel=0.04, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cyl(x, y, z, r, depth, m, verts=22, rot=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cone(x, y, z, r1, r2, depth, m, verts=22, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def torus(x, y, z, major_r, minor_r, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=26, minor_segments=12,
        major_radius=major_r, minor_radius=minor_r,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def export_glb(filename, name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    # Ensure silky-smooth interpolated normals after joining in Blender 5.x
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.update()
    path = os.path.join(out_dir, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
    )
    print(f"Exported {name} -> {path} ({os.path.getsize(path) // 1024} KiB)")


def add_racing_kart(body_hex, accent_hex, stripe_hex="#ffffff"):
    m_body = mat("kart_body", body_hex, roughness=0.20, metallic=0.22)
    m_acc = mat("kart_accent", accent_hex, roughness=0.26, metallic=0.35)
    m_stripe = mat("kart_stripe", stripe_hex, roughness=0.24, metallic=0.10)
    m_tire = mat("tire", "#252830", roughness=0.86)
    m_chrome = mat("chrome", "#e8eff2", roughness=0.10, metallic=0.96)
    m_seat = mat("seat", "#2d303b", roughness=0.72)
    m_head = mat("headlight", "#fff6c6", roughness=0.14, emission=2.2, emission_color="#fff0a8")
    m_tail = mat("taillight", "#ff5247", roughness=0.18, emission=2.0, emission_color="#ff3b30")

    # Four sculpted racing slick wheels with chrome rims
    for wx in (-1.52, 1.52):
        for wz in (-1.35, 1.38):
            s = 1.0 if wx > 0 else -1.0
            r = 0.58 if wz < 0 else 0.52
            w = 0.62 if wz < 0 else 0.50
            cyl(wx, r, wz, r, w, m_tire, verts=26, rot=(0, math.pi / 2, 0), bevel=0.07)
            torus(wx + s * (w * 0.32), r, wz, r * 0.72, 0.14, m_tire, rot=(0, math.pi / 2, 0))
            cyl(wx + s * (w * 0.45), r, wz, r * 0.56, 0.08, m_chrome, verts=20, rot=(0, math.pi / 2, 0), bevel=0.02)
            sphere(wx + s * (w * 0.52), r, wz, 0.08, 0.15, 0.15, m_acc, segs=14, rings=8)

    # Chassis, sculpted nose cone, side pods, racing stripe
    box(0, 0.48, 0.0, 2.55, 0.36, 4.15, m_seat, bevel=0.06)
    box(0, 0.84, 0.10, 2.65, 0.62, 3.60, m_body, bevel=0.14)
    sphere(0, 0.90, 1.85, 1.18, 0.44, 0.92, m_body, segs=26, rings=14)
    box(0, 1.16, 1.10, 0.44, 0.06, 2.25, m_stripe, bevel=0.02)
    for side in (-1.0, 1.0):
        box(side * 1.32, 0.74, 0.0, 0.44, 0.44, 2.05, m_acc, bevel=0.10)
        # Dual chrome exhausts + glowing taillights
        cyl(side * 0.62, 0.78, -2.05, 0.18, 0.68, m_chrome, verts=18, rot=(math.pi / 2 - 0.18, 0, 0), bevel=0.02)
        sphere(side * 0.96, 1.06, -1.86, 0.18, 0.14, 0.08, m_tail, segs=14, rings=8)
        # Headlights
        cyl(side * 0.86, 0.98, 2.28, 0.24, 0.12, m_chrome, verts=18, rot=(math.pi / 2, 0, 0), bevel=0.02)
        sphere(side * 0.86, 0.98, 2.34, 0.19, 0.19, 0.08, m_head, segs=14, rings=8)

    # Sporty rear spoiler
    for side in (-1.0, 1.0):
        box(side * 0.95, 1.48, -1.68, 0.12, 0.74, 0.24, m_chrome, bevel=0.02, rot=(-0.22, 0, 0))
    box(0, 1.88, -1.82, 2.55, 0.12, 0.58, m_acc, bevel=0.04, rot=(0.14, 0, 0))

    # Bucket seat + steering wheel
    box(0, 1.48, -0.68, 1.55, 1.05, 0.26, m_seat, bevel=0.08)
    cyl(0, 1.35, 0.88, 0.06, 0.54, m_chrome, verts=12, rot=(0.45, 0, 0), bevel=0.01)
    torus(0, 1.62, 0.72, 0.34, 0.055, m_seat, rot=(math.pi / 2 - 0.45, 0, 0))


# =============================================================================
# 1. PIP THE PANDA (#0)
# =============================================================================
def build_pip():
    reset_scene()
    add_racing_kart("#8456cf", "#62c47e", "#f7f3ff")
    m_white = mat("panda_white", "#faf8f4", roughness=0.80)
    m_black = mat("panda_black", "#232229", roughness=0.76)
    m_gloss = mat("eye_gloss", "#14141a", roughness=0.10)
    m_eye_w = mat("eye_w", "#ffffff", roughness=0.10)
    m_cheek = mat("cheek", "#f7a2b5", roughness=0.70)
    m_bamboo = mat("bamboo", "#5eb868", roughness=0.45)

    # Plump panda torso + black shoulder band
    sphere(0, 1.88, -0.05, 0.82, 0.88, 0.72, m_white, segs=26, rings=16)
    torus(0, 2.28, -0.02, 0.56, 0.22, m_black)
    # Paws on steering wheel
    for side in (-1.0, 1.0):
        sphere(side * 0.68, 2.02, 0.28, 0.24, 0.28, 0.26, m_black, segs=16, rings=10)
        sphere(side * 0.48, 1.80, 0.68, 0.22, 0.20, 0.22, m_black, segs=16, rings=10)
    # Big adorable round panda head
    hy = 3.12
    sphere(0, hy, 0.06, 1.06, 0.96, 0.94, m_white, segs=32, rings=22)
    for side in (-1.0, 1.0):
        # Round black panda ears
        sphere(side * 0.74, hy + 0.76, 0.02, 0.34, 0.34, 0.24, m_black, segs=20, rings=14)
        # Signature tilted panda eye patches + sparkling eyes
        sphere(side * 0.38, hy + 0.08, 0.86, 0.34, 0.27, 0.16, m_black, segs=20, rings=14, rot=(0, 0, side * 0.25))
        sphere(side * 0.35, hy + 0.10, 0.98, 0.16, 0.19, 0.07, m_eye_w, segs=18, rings=12)
        sphere(side * 0.34, hy + 0.10, 1.03, 0.10, 0.13, 0.05, m_gloss, segs=16, rings=10)
        sphere(side * 0.30, hy + 0.16, 1.065, 0.045, 0.05, 0.02, m_eye_w, segs=10, rings=6)
        sphere(side * 0.62, hy - 0.18, 0.88, 0.18, 0.10, 0.06, m_cheek, segs=12, rings=8)
    # Glossy button nose & happy bamboo sprig
    sphere(0, hy - 0.12, 1.02, 0.18, 0.13, 0.12, m_gloss, segs=16, rings=10)
    cyl(0.42, hy - 0.28, 1.05, 0.045, 0.65, m_bamboo, verts=12, rot=(0.2, 0.9, 0.3), bevel=0.01)
    sphere(0.72, hy - 0.36, 1.15, 0.14, 0.06, 0.22, m_bamboo, segs=12, rings=8)
    export_glb("pip.glb", "PipThePanda")


# =============================================================================
# 2. TAMMY THE CRICKET (#5)
# =============================================================================
def build_tammy():
    reset_scene()
    add_racing_kart("#7eb844", "#f5ce54", "#efffd1")
    m_green = mat("cricket_green", "#63b33d", roughness=0.35, metallic=0.08)
    m_lime = mat("cricket_lime", "#9fe063", roughness=0.40)
    m_wing = mat("cricket_wing", "#d8f7b2", roughness=0.22, metallic=0.15)
    m_dark = mat("cricket_dark", "#1f2b1c", roughness=0.14)
    m_eye_w = mat("eye_w", "#ffffff", roughness=0.10)
    m_gold = mat("gold", "#f5cf58", roughness=0.22, metallic=0.88)

    # Sleek emerald cricket thorax + folded iridescent wings
    sphere(0, 1.88, -0.02, 0.64, 0.84, 0.60, m_green, segs=24, rings=16)
    sphere(0, 1.86, 0.32, 0.44, 0.62, 0.32, m_lime, segs=20, rings=12)
    for side in (-1.0, 1.0):
        # Folded translucent wings behind shoulders
        sphere(side * 0.52, 2.08, -0.58, 0.24, 0.68, 0.82, m_wing, segs=18, rings=12, rot=(0.45, side * 0.25, side * 0.15))
        # Springy cricket arms + knees
        sphere(side * 0.56, 2.00, 0.28, 0.18, 0.26, 0.22, m_green, segs=14, rings=10)
        sphere(side * 0.44, 1.78, 0.68, 0.17, 0.17, 0.18, m_lime, segs=14, rings=10)
    # Big expressive cartoon cricket head
    hy = 3.08
    sphere(0, hy, 0.10, 0.88, 0.92, 0.84, m_green, segs=30, rings=20)
    for side in (-1.0, 1.0):
        # Huge adorable bright cartoon eyes
        sphere(side * 0.44, hy + 0.16, 0.72, 0.32, 0.36, 0.24, m_eye_w, segs=20, rings=14)
        sphere(side * 0.42, hy + 0.16, 0.90, 0.18, 0.22, 0.10, m_dark, segs=18, rings=12)
        sphere(side * 0.36, hy + 0.24, 0.96, 0.065, 0.075, 0.03, m_eye_w, segs=10, rings=6)
        # Long graceful curved antennae with golden tips!
        for i in range(6):
            t = i / 5.0
            ax = side * (0.28 + t * 0.48)
            ay = hy + 0.82 + t * 0.88 - t * t * 0.25
            az = 0.24 + t * 0.52
            sphere(ax, ay, az, 0.055, 0.055, 0.055, m_gold if i == 5 else m_dark, segs=10, rings=6)
    # Cheerful little smile
    for i in range(7):
        sx = (i - 3) * 0.07
        sphere(sx, hy - 0.28 + sx * sx * 1.4, 0.88, 0.04, 0.03, 0.03, m_dark, segs=8, rings=6)
    export_glb("tammy.glb", "TammyTheCricket")


# =============================================================================
# 3. HOUSTON THE RTPL (#7 — Sloth Astronaut in Stainless-Steel Starship!)
# =============================================================================
def build_houston():
    reset_scene()
    m_steel = mat("steel", "#d4dde2", roughness=0.16, metallic=0.92)
    m_steel2 = mat("steel_dark", "#9fb0ba", roughness=0.22, metallic=0.88)
    m_tiles = mat("heat_tiles", "#242c36", roughness=0.78, metallic=0.10)
    m_accent = mat("houston_blue", "#5ca8cc", roughness=0.24, metallic=0.35)
    m_glow = mat("raptor_glow", "#5cd4ff", roughness=0.15, emission=3.0, emission_color="#48c4ff")
    m_suit = mat("suit_white", "#f2f6fa", roughness=0.34, metallic=0.06)
    m_visor = mat("visor_gold", "#f5be4f", roughness=0.08, metallic=0.94)
    m_sloth = mat("sloth_fur", "#9c856b", roughness=0.82)
    m_face = mat("sloth_face", "#ede1cc", roughness=0.80)
    m_mask = mat("sloth_mask", "#524135", roughness=0.78)
    m_dark = mat("dark", "#1c1c22", roughness=0.15)
    m_eye_w = mat("eye_w", "#ffffff", roughness=0.10)

    # Polished stainless-steel SpaceX Starship fuselage + conical nose
    cyl(0, 1.38, -0.45, 1.02, 4.4, m_steel, verts=32, rot=(math.pi / 2, 0, 0), bevel=0.05)
    cone(0, 1.38, 2.55, 1.02, 0.06, 1.75, m_steel, verts=32, rot=(-math.pi / 2, 0, 0))
    # Black ceramic heat-shield belly strip
    box(0, 0.62, -0.25, 1.48, 0.42, 4.4, m_tiles, bevel=0.12)
    # Four Starship aero flaps (forward + aft)
    for side in (-1.0, 1.0):
        box(side * 1.48, 1.38, 1.75, 1.15, 0.14, 0.95, m_steel2, bevel=0.04, rot=(0, 0, side * 0.22))
        box(side * 1.72, 1.24, -2.05, 1.65, 0.16, 1.55, m_steel2, bevel=0.04, rot=(0, 0, -side * 0.15))
        box(side * 1.05, 1.38, 1.75, 0.16, 0.20, 0.98, m_accent, bevel=0.03)
    # 6 Raptor engine bells with glowing cyan-blue plasma cores
    for ex, ey, er in [(0, 0.56, 0.26), (-0.50, -0.28, 0.26), (0.50, -0.28, 0.26), (0, -0.22, 0.16), (-0.24, 0.16, 0.16), (0.24, 0.16, 0.16)]:
        cone(ex, 1.38 + ey, -2.92, er, er * 0.58, 0.54, m_steel2, verts=16, rot=(math.pi / 2, 0, 0))
        sphere(ex, 1.38 + ey, -3.14, er * 0.65, er * 0.65, 0.14, m_glow, segs=12, rings=8)

    # Open cockpit ring + cute astronaut Sloth (Houston!)
    torus(0, 2.38, -0.10, 0.80, 0.12, m_accent)
    sphere(0, 2.48, -0.10, 0.68, 0.56, 0.62, m_suit, segs=22, rings=14)
    # Sloth head + adorable dark eye patches + space helmet rim
    hy = 3.32
    sphere(0, hy, -0.05, 0.78, 0.72, 0.72, m_sloth, segs=26, rings=18)
    sphere(0, hy - 0.04, 0.28, 0.64, 0.54, 0.48, m_face, segs=22, rings=14)
    for side in (-1.0, 1.0):
        sphere(side * 0.30, hy + 0.04, 0.66, 0.24, 0.18, 0.12, m_mask, segs=16, rings=10, rot=(0, 0, -side * 0.3))
        sphere(side * 0.28, hy + 0.05, 0.75, 0.11, 0.12, 0.06, m_dark, segs=14, rings=10)
        sphere(side * 0.25, hy + 0.09, 0.79, 0.035, 0.04, 0.02, m_eye_w, segs=8, rings=6)
    sphere(0, hy - 0.12, 0.78, 0.11, 0.08, 0.07, m_dark, segs=12, rings=8)
    # Raised golden astronaut visor dome & helmet collar
    torus(0, hy - 0.62, -0.04, 0.66, 0.12, m_accent)
    sphere(0, hy + 0.34, -0.18, 0.90, 0.66, 0.88, m_suit, segs=26, rings=16)
    sphere(0, hy + 0.44, 0.28, 0.74, 0.36, 0.62, m_visor, segs=22, rings=14)
    export_glb("houston.glb", "HoustonTheRTPL")


# =============================================================================
# 4. MASTER-YUDA (#10 — Cool Biker on Sleek Copper & Chrome Motorcycle)
# =============================================================================
def build_yuda():
    reset_scene()
    m_copper = mat("yuda_copper", "#b86b35", roughness=0.18, metallic=0.58)
    m_chrome = mat("chrome", "#eaf1f5", roughness=0.08, metallic=0.98)
    m_tire = mat("tire", "#22242b", roughness=0.86)
    m_leather = mat("leather", "#2c2429", roughness=0.52)
    m_skin = mat("skin", "#e8be9c", roughness=0.65)
    m_hair = mat("hair", "#2b221e", roughness=0.72)
    m_shades = mat("shades", "#111622", roughness=0.06, metallic=0.85)
    m_head = mat("headlight", "#fff7d4", roughness=0.12, emission=2.6, emission_color="#fff0a8")
    m_tail = mat("taillight", "#ff4a3d", roughness=0.16, emission=2.2, emission_color="#ff3828")

    # Front & rear chunky sport-motorcycle wheels
    for wz, r in [(-1.72, 0.74), (1.78, 0.70)]:
        torus(0, r, wz, r - 0.18, 0.22, m_tire, rot=(0, math.pi / 2, 0))
        cyl(0, r, wz, r - 0.24, 0.22, m_chrome, verts=24, rot=(0, math.pi / 2, 0), bevel=0.02)
        sphere(0, r, wz, 0.24, 0.18, 0.18, m_copper, segs=14, rings=8)

    # Sculpted motorcycle frame, teardrop copper fuel tank, twin chrome pipes, fork & handlebars
    box(0, 0.88, 0.0, 0.72, 0.76, 2.35, m_chrome, bevel=0.10)
    sphere(0, 1.54, 0.56, 0.58, 0.44, 0.92, m_copper, segs=26, rings=16)
    box(0, 1.32, -0.68, 0.64, 0.28, 1.25, m_leather, bevel=0.10)
    sphere(0, 1.50, -1.58, 0.42, 0.26, 0.65, m_copper, segs=20, rings=12)
    sphere(0, 1.48, -2.18, 0.18, 0.14, 0.10, m_tail, segs=12, rings=8)
    for side in (-1.0, 1.0):
        # Twin chrome front forks
        cyl(side * 0.24, 1.48, 1.48, 0.075, 1.75, m_chrome, verts=16, rot=(-0.38, 0, 0), bevel=0.01)
        # Swept chrome exhaust pipes
        cyl(side * 0.48, 0.68, -1.05, 0.12, 2.05, m_chrome, verts=18, rot=(math.pi / 2 - 0.10, 0, 0), bevel=0.02)
    # Handlebars + gleaming chrome headlight
    cyl(0, 2.18, 1.12, 0.06, 1.78, m_chrome, verts=14, rot=(0, math.pi / 2, 0), bevel=0.01)
    cyl(0, 1.88, 1.66, 0.28, 0.34, m_chrome, verts=20, rot=(math.pi / 2, 0, 0), bevel=0.04)
    sphere(0, 1.88, 1.82, 0.24, 0.24, 0.08, m_head, segs=16, rings=10)

    # Master-Yuda in leather biker jacket + iconic cool shades!
    sphere(0, 2.18, -0.22, 0.64, 0.78, 0.54, m_leather, segs=24, rings=16, rot=(0.25, 0, 0))
    for side in (-1.0, 1.0):
        cyl(side * 0.64, 2.24, 0.46, 0.17, 1.28, m_leather, verts=16, rot=(1.35, 0, -side * 0.20), bevel=0.04)
        sphere(side * 0.78, 2.18, 1.12, 0.18, 0.17, 0.18, m_leather, segs=14, rings=10)
    hy = 3.24
    sphere(0, hy, 0.08, 0.72, 0.76, 0.70, m_skin, segs=28, rings=18)
    # Swept dark hair + goatee beard
    sphere(0, hy + 0.34, -0.08, 0.74, 0.54, 0.74, m_hair, segs=24, rings=14)
    sphere(0, hy - 0.48, 0.48, 0.36, 0.24, 0.30, m_hair, segs=16, rings=10)
    # Iconic glossy black aviator sunglasses
    for side in (-1.0, 1.0):
        box(side * 0.30, hy + 0.08, 0.72, 0.44, 0.26, 0.12, m_shades, bevel=0.05)
    box(0, hy + 0.12, 0.74, 0.22, 0.06, 0.08, m_chrome, bevel=0.01)
    export_glb("yuda.glb", "MasterYuda")


# =============================================================================
# 5. KNOWITOWL (#14 — Ultra-Smooth Sculpted Snowy Professor Owl)
# =============================================================================
def build_owl():
    reset_scene()
    add_racing_kart("#e6eef5", "#27355c", "#f5cd58")
    m_snow = mat("owl_snow", "#f8fbff", roughness=0.68)
    m_wing = mat("owl_wing", "#d4deea", roughness=0.64)
    m_wing_tip = mat("owl_wing_tip", "#a8b8cc", roughness=0.62)
    m_belly = mat("owl_belly", "#ffffff", roughness=0.72)
    m_gold = mat("gold", "#f7ce56", roughness=0.14, metallic=0.95)
    m_lens = mat("lens", "#c8eeff", roughness=0.05, metallic=0.20)
    m_beak = mat("beak", "#eb9e34", roughness=0.30)
    m_indigo = mat("indigo", "#1f2a4a", roughness=0.48)
    m_dark = mat("dark", "#10141c", roughness=0.08)
    m_amber = mat("owl_eye", "#ffb82e", roughness=0.10, emission=0.85, emission_color="#ffaa1a")
    m_eye_w = mat("eye_w", "#ffffff", roughness=0.08)

    # Silky high-res plump snowy owl body + layered sculpted feathers
    sphere(0, 1.98, -0.02, 0.86, 0.98, 0.76, m_snow, segs=40, rings=26)
    sphere(0, 1.92, 0.36, 0.62, 0.74, 0.42, m_belly, segs=32, rings=20)
    # Soft scalloped chest feathers
    for row in range(3):
        for col in range(-1, 2):
            sphere(col * 0.24, 1.62 + row * 0.24, 0.70 - row * 0.03, 0.14, 0.10, 0.06, m_wing, segs=16, rings=10)
    # Layered sculpted folded wings (3 feather tiers per side)
    for side in (-1.0, 1.0):
        sphere(side * 0.78, 2.08, -0.04, 0.36, 0.78, 0.64, m_wing, segs=32, rings=20, rot=(0.14, 0, side * 0.16))
        sphere(side * 0.86, 1.78, -0.22, 0.28, 0.56, 0.56, m_wing_tip, segs=24, rings=16, rot=(0.24, 0, side * 0.22))
        sphere(side * 0.76, 1.48, -0.44, 0.22, 0.38, 0.46, m_snow, segs=22, rings=14, rot=(0.35, 0, side * 0.15))

    # Ultra-smooth high-res owl head + plush facial heart-disc + curved ear tufts
    hy = 3.24
    sphere(0, hy, 0.08, 0.98, 0.90, 0.90, m_snow, segs=44, rings=28)
    for side in (-1.0, 1.0):
        # Plush curved feather ear tufts (2 layered plumes)
        sphere(side * 0.62, hy + 0.76, 0.04, 0.24, 0.46, 0.18, m_wing, segs=24, rings=16, rot=(0, 0, -side * 0.42))
        sphere(side * 0.72, hy + 0.94, 0.00, 0.15, 0.30, 0.13, m_wing_tip, segs=20, rings=12, rot=(0, 0, -side * 0.55))
        # Facial disc + glowing golden owl eyes + glossy gold spectacles with lens tint
        sphere(side * 0.38, hy + 0.06, 0.78, 0.38, 0.38, 0.15, m_belly, segs=28, rings=18)
        sphere(side * 0.38, hy + 0.06, 0.88, 0.25, 0.25, 0.10, m_amber, segs=26, rings=16)
        sphere(side * 0.38, hy + 0.06, 0.955, 0.13, 0.14, 0.05, m_dark, segs=22, rings=14)
        sphere(side * 0.33, hy + 0.13, 0.995, 0.05, 0.05, 0.02, m_eye_w, segs=14, rings=10)
        torus(side * 0.38, hy + 0.06, 0.98, 0.30, 0.036, m_gold, rot=(math.pi / 2, 0, 0))
        cyl(side * 0.38, hy + 0.06, 0.975, 0.27, 0.012, m_lens, verts=28, rot=(math.pi / 2, 0, 0), bevel=0.0)
    box(0, hy + 0.08, 0.98, 0.22, 0.045, 0.045, m_gold, bevel=0.01)
    # Smooth curved sculpted beak
    sphere(0, hy - 0.14, 0.94, 0.17, 0.16, 0.22, m_beak, segs=24, rings=16)
    cone(0, hy - 0.22, 1.06, 0.13, 0.025, 0.26, m_beak, verts=24, rot=(math.pi / 2 + 0.48, 0, 0))
    # Scholar's mortarboard graduation cap + smooth hanging golden tassel
    cyl(0, hy + 0.86, 0.04, 0.56, 0.28, m_indigo, verts=32, bevel=0.03)
    box(0, hy + 1.04, 0.04, 1.50, 0.09, 1.50, m_indigo, bevel=0.025, rot=(0.06, 0.78, 0))
    sphere(0, hy + 1.11, 0.04, 0.10, 0.06, 0.10, m_gold, segs=18, rings=12)
    cyl(0.68, hy + 0.78, 0.04, 0.035, 0.56, m_gold, verts=16, rot=(0, 0, 0.22), bevel=0.01)
    cone(0.75, hy + 0.46, 0.04, 0.12, 0.04, 0.22, m_gold, verts=20)
    export_glb("owl.glb", "KnowItOwl")


build_pip()
build_tammy()
build_houston()
build_yuda()
build_owl()
