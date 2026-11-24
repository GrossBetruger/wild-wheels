"""
Build a sculpted, smooth-shaded PBR glTF (.glb) model of Tai-Coon
(Tyrolean she-raccoon of Tai Chi & healing in her alpine village pickup truck)
using headless Blender:
    blender --background --python build_taicoon.py -- output.glb
"""
import math
import sys
import bpy
from mathutils import Vector, Euler

# Parse output path after "--"
argv = sys.argv
out_path = argv[argv.index("--") + 1] if "--" in argv else "taicoon.glb"

# Start from a completely clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Coordinate helper: Wild Wheels (x=right, y=up, z=forward) -> Blender (X=x, Y=-z, Z=y)
# Blender's glTF exporter (export_yup=True) converts (X, Y, Z) -> (X, Z, -Y) = (x, y, z)!
def loc(x, y, z):
    return (x, -z, y)


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


MAT_CACHE = {}


def make_mat(name, hex_color, roughness=0.5, metallic=0.0, emission=0.0, emission_color=None):
    if name in MAT_CACHE:
        return MAT_CACHE[name]
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
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
    MAT_CACHE[name] = mat
    return mat


# Rich PBR Material Palette
M_BODY = make_mat("truck_body", "#49a896", roughness=0.22, metallic=0.18)       # Glossy alpine teal lacquer
M_CREAM = make_mat("cream_paint", "#fbf4e3", roughness=0.28, metallic=0.08)     # Glossy vintage cream
M_WOOD = make_mat("wood", "#b57b4a", roughness=0.58)
M_LIGHT_WOOD = make_mat("light_wood", "#d9a870", roughness=0.52)
M_DARK_WOOD = make_mat("dark_wood", "#6e4427", roughness=0.62)
M_TIRE = make_mat("tire_rubber", "#282b33", roughness=0.86)
M_CHROME = make_mat("chrome", "#e6eef0", roughness=0.12, metallic=0.95)
M_GOLD = make_mat("gold", "#f2c95c", roughness=0.24, metallic=0.88)
M_GLASS = make_mat("windshield", "#a8e6ee", roughness=0.08, metallic=0.15)
M_HEADLIGHT = make_mat("headlight", "#fff6c8", roughness=0.15, emission=2.2, emission_color="#fff2b0")
M_TAILLIGHT = make_mat("taillight", "#ff5e52", roughness=0.2, emission=1.8, emission_color="#ff483b")
M_SAGE = make_mat("sage_mat", "#7ec4a8", roughness=0.72)
M_SAGE_LIGHT = make_mat("sage_light", "#dff5eb", roughness=0.75)
M_LAVENDER = make_mat("lavender", "#b694e6", roughness=0.68)
M_HERB = make_mat("herb", "#7cc285", roughness=0.70)
M_LOTUS = make_mat("lotus_pink", "#f7a8c8", roughness=0.42, emission=0.35, emission_color="#ffbfd8")
M_LOTUS_IN = make_mat("lotus_cream", "#fff4d4", roughness=0.4, emission=0.45, emission_color="#ffe8a3")

# Raccoon & Tyrolean Outfit Materials
M_FUR = make_mat("fur_grey", "#a6a29a", roughness=0.80)
M_BELLY = make_mat("fur_cream", "#f8f0df", roughness=0.82)
M_MASK = make_mat("fur_mask", "#3d373a", roughness=0.78)
M_DARK = make_mat("dark_gloss", "#1e1b22", roughness=0.18)
M_EYE_WHITE = make_mat("eye_white", "#ffffff", roughness=0.10)
M_CHEEK = make_mat("cheek_blush", "#f79db3", roughness=0.72)
M_EAR_PINK = make_mat("ear_pink", "#f4b2c2", roughness=0.72)
M_TUNIC = make_mat("tunic_sage", "#4e8a72", roughness=0.68)
M_HAT = make_mat("hat_green", "#3f6e4c", roughness=0.75)
M_RED = make_mat("band_red", "#d94e48", roughness=0.55)
M_FEATHER = make_mat("feather_amber", "#e88b54", roughness=0.62)
M_FEATHER_TIP = make_mat("feather_tip", "#fff6e0", roughness=0.60)
M_BEAD_WOOD = make_mat("bead_wood", "#c98544", roughness=0.38)
M_WHITE = make_mat("petal_white", "#fffdf6", roughness=0.52)


def smooth(obj, subsurf=0, bevel=0.0):
    bpy.context.view_layer.objects.active = obj
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
    if subsurf > 0:
        mod = obj.modifiers.new("Subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def add_sphere(x, y, z, rx, ry, rz, mat, segs=24, rings=16, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat)
    return smooth(obj)


def add_box(x, y, z, sx, sy, sz, mat, bevel=0.04, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat)
    return smooth(obj, bevel=bevel)


def add_cyl(x, y, z, r, depth, mat, verts=24, rot=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat)
    return smooth(obj, bevel=bevel)


def add_cone(x, y, z, r1, r2, depth, mat, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat)
    return smooth(obj)


def add_torus(x, y, z, major_r, minor_r, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=28, minor_segments=14,
        major_radius=major_r, minor_radius=minor_r,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat)
    return smooth(obj)


def add_flower(x, y, z, r, petal_mat, center_mat=M_GOLD, normal_z=1.0):
    for i in range(6):
        a = i * math.pi / 3.0
        add_sphere(
            x + math.cos(a) * r, y + math.sin(a) * r, z,
            r * 0.62, r * 0.50, r * 0.24, petal_mat, segs=12, rings=8,
        )
    add_sphere(x, y, z + normal_z * r * 0.14, r * 0.46, r * 0.46, r * 0.26, center_mat, segs=12, rings=8)


def add_lotus(x, y, z, s, outer_mat=M_LOTUS, inner_mat=M_LOTUS_IN):
    for i in range(8):
        a = i * math.pi / 4.0
        add_sphere(
            x + math.sin(a) * s * 0.72, y + s * 0.16, z + math.cos(a) * s * 0.72,
            s * 0.36, s * 0.18, s * 0.50, outer_mat, segs=12, rings=8,
        )
    for i in range(5):
        a = i * math.pi * 2.0 / 5.0 + 0.3
        add_sphere(
            x + math.sin(a) * s * 0.34, y + s * 0.36, z + math.cos(a) * s * 0.34,
            s * 0.24, s * 0.28, s * 0.24, inner_mat, segs=12, rings=8,
        )
    add_sphere(x, y + s * 0.42, z, s * 0.22, s * 0.22, s * 0.22, M_GOLD, segs=12, rings=8)


# =============================================================================
# 1. COZY ALPINE VILLAGE PICKUP TRUCK (Sculpted PBR)
# =============================================================================

# Four chunky vintage wheels with rubber torus tires, cream hubcaps & golden hubs
for wx in (-1.58, 1.58):
    for wz in (-1.52, 1.48):
        sign = 1.0 if wx > 0 else -1.0
        # Tire cylinder + rounded sidewall torus
        add_cyl(wx, 0.62, wz, 0.60, 0.58, M_TIRE, verts=28, rot=(0, math.pi / 2, 0), bevel=0.06)
        add_torus(wx + sign * 0.18, 0.62, wz, 0.44, 0.18, M_TIRE, rot=(0, math.pi / 2, 0))
        add_torus(wx - sign * 0.18, 0.62, wz, 0.44, 0.18, M_TIRE, rot=(0, math.pi / 2, 0))
        # Cream hubcap + metallic gold center cap
        add_cyl(wx + sign * 0.29, 0.62, wz, 0.36, 0.10, M_CREAM, verts=24, rot=(0, math.pi / 2, 0), bevel=0.02)
        add_sphere(wx + sign * 0.35, 0.62, wz, 0.08, 0.16, 0.16, M_GOLD, segs=16, rings=10)

# Chassis & glossy alpine teal body
add_box(0, 0.56, 0.0, 2.72, 0.42, 4.72, M_TIRE, bevel=0.06)
add_box(0, 0.94, 0.44, 2.94, 0.74, 2.62, M_BODY, bevel=0.10)
# Sculpted rounded vintage hood
add_sphere(0, 1.24, 1.62, 1.38, 0.48, 0.88, M_BODY, segs=28, rings=16)
# Glossy cream wheel arches & running boards
for side in (-1.0, 1.0):
    add_sphere(side * 1.42, 1.04, 1.48, 0.36, 0.36, 0.86, M_CREAM, segs=20, rings=12)
    add_sphere(side * 1.42, 1.04, -1.52, 0.36, 0.36, 0.86, M_CREAM, segs=20, rings=12)
    add_box(side * 1.50, 0.72, 0.02, 0.26, 0.13, 1.78, M_CREAM, bevel=0.03)

# Open-air cozy cab windshield & polished chrome mirrors
add_box(0, 1.58, 0.88, 2.36, 0.60, 0.09, M_GLASS, bevel=0.02)
add_box(0, 1.92, 0.88, 2.56, 0.12, 0.16, M_CREAM, bevel=0.04)
for side in (-1.0, 1.0):
    add_box(side * 1.22, 1.56, 0.88, 0.12, 0.68, 0.15, M_CREAM, bevel=0.03)
    add_cyl(side * 1.44, 1.60, 0.84, 0.035, 0.34, M_CHROME, verts=12, rot=(0, math.pi / 2, 0), bevel=0.0)
    add_sphere(side * 1.64, 1.60, 0.84, 0.15, 0.15, 0.07, M_CREAM, segs=16, rings=10)

# Cozy wooden bench seat & sculpted steering wheel
add_box(0, 1.38, -0.46, 2.04, 0.88, 0.28, M_DARK_WOOD, bevel=0.07)
add_box(0, 1.14, 0.02, 1.94, 0.26, 0.96, M_DARK_WOOD, bevel=0.06)
add_cyl(0, 1.50, 0.66, 0.06, 0.48, M_DARK_WOOD, verts=14, rot=(0.35, 0, 0), bevel=0.01)
add_torus(0, 1.74, 0.54, 0.34, 0.055, M_LIGHT_WOOD, rot=(math.pi / 2 - 0.35, 0, 0))
add_sphere(0, 1.74, 0.54, 0.10, 0.10, 0.08, M_GOLD, segs=14, rings=10)

# Rear alpine wooden pickup bed & slatted rails
add_box(0, 0.92, -1.56, 2.86, 0.64, 2.02, M_BODY, bevel=0.08)
add_box(0, 1.26, -1.56, 2.62, 0.10, 1.88, M_LIGHT_WOOD, bevel=0.02)
for side in (-1.0, 1.0):
    add_box(side * 1.38, 1.52, -1.56, 0.12, 0.46, 1.98, M_WOOD, bevel=0.025)
    add_box(side * 1.38, 1.86, -1.56, 0.11, 0.16, 1.96, M_LIGHT_WOOD, bevel=0.025)
    for pz in (-2.42, -1.56, -0.72):
        add_box(side * 1.38, 1.60, pz, 0.14, 0.68, 0.14, M_DARK_WOOD, bevel=0.025)

# Tailgate with alpine flowers & glowing lotus emblem
add_box(0, 1.46, -2.52, 2.82, 0.56, 0.14, M_WOOD, bevel=0.03)
add_box(0, 1.84, -2.52, 2.74, 0.14, 0.12, M_LIGHT_WOOD, bevel=0.025)
add_flower(-0.84, 1.48, -2.61, 0.16, M_WHITE, M_GOLD, normal_z=-1.0)
add_flower(0.84, 1.48, -2.61, 0.16, M_WHITE, M_GOLD, normal_z=-1.0)
add_lotus(0, 1.36, -2.60, 0.24)

# Cargo in the pickup bed:
# 1. Rolled sage meditation mat with gold strap
add_cyl(-0.78, 1.54, -1.52, 0.23, 1.42, M_SAGE, verts=20, rot=(math.pi / 2, 0, 0), bevel=0.02)
add_cyl(-0.78, 1.54, -1.52, 0.25, 0.14, M_GOLD, verts=20, rot=(math.pi / 2, 0, 0), bevel=0.01)
# 2. Wooden alpine herb crate with lavender & mint sprigs
add_box(0.74, 1.52, -1.55, 0.82, 0.48, 0.92, M_LIGHT_WOOD, bevel=0.03)
add_box(0.74, 1.52, -1.55, 0.86, 0.10, 0.96, M_DARK_WOOD, bevel=0.02)
for i in range(4):
    ox = 0.50 + (i % 2) * 0.46
    oz = -1.78 + (i // 2) * 0.44
    add_sphere(ox, 1.86, oz, 0.17, 0.24, 0.17, M_LAVENDER if i % 2 else M_HERB, segs=12, rings=8)
    add_sphere(ox, 2.04, oz, 0.10, 0.14, 0.10, M_LOTUS_IN if i % 2 else M_WHITE, segs=10, rings=8)
# 3. Hammered-gold Tibetan singing bowl & glowing lotus blossom
add_sphere(0, 1.50, -1.52, 0.40, 0.24, 0.40, M_GOLD, segs=24, rings=14)
add_torus(0, 1.66, -1.52, 0.34, 0.045, M_GOLD)
add_lotus(0, 1.68, -1.52, 0.30)

# Chrome bumper, friendly smiling grille, glowing round headlights & rosy cheeks
add_box(0, 0.54, 2.48, 2.86, 0.22, 0.24, M_CHROME, bevel=0.05)
add_box(0, 0.92, 2.42, 1.48, 0.44, 0.12, M_CREAM, bevel=0.04)
for i in range(5):
    add_box(-0.54 + i * 0.27, 0.92, 2.48, 0.07, 0.34, 0.06, M_CHROME, bevel=0.015)
for side in (-1.0, 1.0):
    add_cyl(side * 1.02, 1.18, 2.34, 0.35, 0.14, M_CHROME, verts=22, rot=(math.pi / 2, 0, 0), bevel=0.02)
    add_sphere(side * 1.02, 1.18, 2.38, 0.29, 0.28, 0.11, M_HEADLIGHT, segs=18, rings=12)
    add_sphere(side * 1.26, 0.94, 2.39, 0.15, 0.08, 0.05, M_CHEEK, segs=12, rings=8)
    # Glowing tail lights
    add_cyl(side * 1.14, 1.16, -2.56, 0.20, 0.08, M_CHROME, verts=18, rot=(math.pi / 2, 0, 0), bevel=0.015)
    add_sphere(side * 1.14, 1.16, -2.59, 0.16, 0.16, 0.06, M_TAILLIGHT, segs=14, rings=10)

# =============================================================================
# 2. TAI-COON — SUPER CUTE SCULPTED TYROLEAN SHE-RACCOON
# =============================================================================

# Cozy alpine sage tunic torso + soft cream belly
add_sphere(0, 2.16, 0.02, 0.74, 0.84, 0.64, M_TUNIC, segs=26, rings=18)
add_sphere(0, 2.12, 0.34, 0.48, 0.62, 0.34, M_BELLY, segs=22, rings=14)

# Glossy wooden & gold mala prayer beads + tiny collar lotus
for i in range(11):
    t = (i / 10.0 - 0.5) * math.pi * 1.06
    add_sphere(
        math.sin(t) * 0.52, 2.66 - math.cos(t) * 0.22, 0.16 + math.cos(t) * 0.42,
        0.09, 0.09, 0.09, M_BEAD_WOOD if i % 2 else M_GOLD, segs=12, rings=8,
    )
add_lotus(0, 2.48, 0.58, 0.18)

# Fluffy ringed raccoon tail curling cheerfully behind the seat
for i in range(8):
    t = i / 7.0
    tx = math.sin(t * 1.6) * 0.22
    ty = 1.65 + t * 0.88 + math.sin(t * math.pi) * 0.24
    tz = -0.60 - t * 0.82
    r = 0.25 + math.sin(t * math.pi) * 0.18
    mat = M_MASK if i % 2 else (M_BELLY if i == 7 else M_FUR)
    add_sphere(tx, ty, tz, r, r * 0.96, r, mat, segs=18, rings=12)

# Serene arms & paws holding the steering wheel
for side in (-1.0, 1.0):
    add_sphere(side * 0.64, 2.22, 0.28, 0.22, 0.28, 0.24, M_FUR, segs=16, rings=12)
    add_sphere(side * 0.52, 2.08, 0.56, 0.20, 0.19, 0.20, M_MASK, segs=16, rings=12)

# Super cute smooth-sculpted round raccoon head
hy = 3.34
add_sphere(0, hy, 0.14, 0.98, 0.90, 0.86, M_FUR, segs=32, rings=22)

for side in (-1.0, 1.0):
    # Fluffy cream cheek tufts
    add_sphere(side * 0.78, hy - 0.16, 0.26, 0.36, 0.28, 0.28, M_BELLY, segs=18, rings=12)
    # Fluffy layered raccoon ears
    add_sphere(side * 0.66, hy + 0.74, 0.06, 0.33, 0.40, 0.22, M_FUR, segs=20, rings=14)
    add_sphere(side * 0.66, hy + 0.72, 0.16, 0.21, 0.25, 0.12, M_BELLY, segs=16, rings=10)
    add_sphere(side * 0.66, hy + 0.70, 0.22, 0.12, 0.15, 0.06, M_EAR_PINK, segs=14, rings=10)
    # Soft cocoa-charcoal bandit mask
    add_sphere(side * 0.36, hy + 0.04, 0.82, 0.36, 0.29, 0.15, M_MASK, segs=22, rings=14)
    # Sparkling cartoon eyes with glossy sclera, dark iris, dual catchlights & delicate lashes
    add_sphere(side * 0.34, hy + 0.06, 0.93, 0.22, 0.25, 0.08, M_EYE_WHITE, segs=20, rings=14)
    add_sphere(side * 0.33, hy + 0.06, 0.98, 0.15, 0.18, 0.055, M_DARK, segs=18, rings=12)
    add_sphere(side * 0.28, hy + 0.13, 1.025, 0.065, 0.075, 0.025, M_EYE_WHITE, segs=12, rings=8)
    add_sphere(side * 0.38, hy + 0.00, 1.015, 0.035, 0.035, 0.02, M_EYE_WHITE, segs=10, rings=8)
    add_sphere(side * 0.55, hy + 0.21, 0.94, 0.10, 0.03, 0.03, M_DARK, segs=10, rings=6)
    add_sphere(side * 0.59, hy + 0.15, 0.93, 0.08, 0.028, 0.03, M_DARK, segs=10, rings=6)
    # Rosy cheeks
    add_sphere(side * 0.58, hy - 0.20, 0.85, 0.19, 0.11, 0.06, M_CHEEK, segs=14, rings=10)

# Pink alpine lotus tucked sweetly beside her left ear
add_flower(-0.64, hy + 0.52, 0.34, 0.15, M_LOTUS, M_LOTUS_IN)

# Soft cream forehead stripe, sculpted muzzle, glossy button nose & serene smile
add_sphere(0, hy + 0.18, 0.89, 0.15, 0.32, 0.10, M_BELLY, segs=16, rings=10)
add_sphere(0, hy - 0.20, 0.90, 0.42, 0.28, 0.28, M_BELLY, segs=22, rings=14)
add_sphere(0, hy - 0.10, 1.15, 0.14, 0.10, 0.09, M_DARK, segs=18, rings=12)
add_sphere(-0.03, hy - 0.06, 1.21, 0.04, 0.03, 0.02, M_EYE_WHITE, segs=10, rings=6)
for i in range(7):
    sx = (i - 3) * 0.06
    add_sphere(sx, hy - 0.31 + sx * sx * 1.4, 1.11, 0.04, 0.026, 0.026, M_DARK, segs=10, rings=6)

# Adorable sculpted Tyrolean alpine hat (Seppelhut) with braided gold/red band, edelweiss & feather
hat_y = hy + 0.84
add_sphere(0.04, hat_y, 0.06, 0.95, 0.14, 0.90, M_HAT, segs=28, rings=14)
add_cone(0.05, hat_y + 0.44, 0.05, 0.66, 0.22, 0.82, M_HAT, verts=28)
add_sphere(0.05, hat_y + 0.84, 0.05, 0.23, 0.12, 0.23, M_HAT, segs=18, rings=10)
# Braided red-and-gold Tyrolean cord band
for i in range(18):
    a = i * math.pi / 9.0
    add_sphere(
        0.05 + math.cos(a) * 0.60, hat_y + 0.14, 0.05 + math.sin(a) * 0.60,
        0.08, 0.08, 0.08, M_GOLD if i % 2 else M_RED, segs=10, rings=8,
    )
# White edelweiss flower on front-left of hatband
add_flower(-0.38, hat_y + 0.25, 0.48, 0.13, M_WHITE, M_GOLD)
# Jaunty curved alpine feather on right side of hatband
for i in range(7):
    f = i / 6.0
    add_sphere(
        0.52 + f * 0.38, hat_y + 0.24 + f * 0.68, 0.10 - f * 0.16,
        0.095 - f * 0.03, 0.14, 0.05, M_FEATHER_TIP if f > 0.55 else M_FEATHER, segs=12, rings=8,
    )

# Apply all modifiers and join into one clean multi-material mesh (1 entity in Bevy!)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.join()
bpy.context.active_object.name = "TaiCoon"

# Export single clean binary glTF 2.0 (.glb) with Y-up and PBR materials
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_materials="EXPORT",
)
print(f"Exported Blender PBR Tai-Coon to {out_path}")
