"""
Build a faithful, smooth-shaded PBR glTF (.glb) model of Houston the RTPL (#7):
her stainless-steel SpaceX Starship (with ceramic heat-shield tiles, exact swept
forward & aft flaps, SpaceX X emblem, and 6 Raptor engine bells) and her adorable
sloth astronaut with dual oxygen tanks, 3-clawed gloves, and antenna helmet.

Faithfully translated from client/characters.js (drawStarship, drawNewDriver case 7,
drawHoustonHelmet) and upgraded with Blender smooth shading & PBR materials:
    blender --background --python build_houston.py -- wasm-poc/assets/houston.glb
"""
import math
import sys
import bpy
import bmesh
from mathutils import Euler, Vector

argv = sys.argv
out_path = argv[argv.index("--") + 1] if "--" in argv else "houston.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)


def loc(x, y, z):
    return (x, -z, y)


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


MATS = {}


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


# Faithful Houston PBR palette
M_STEEL = mat("steel", "#dde6ea", roughness=0.14, metallic=0.94)
M_STEEL_B = mat("steel_panel", "#c3d0d6", roughness=0.18, metallic=0.90)
M_SEAM = mat("steel_seam", "#8395a0", roughness=0.28, metallic=0.84)
M_TILE_A = mat("heat_tile_a", "#262f39", roughness=0.78, metallic=0.08)
M_TILE_B = mat("heat_tile_b", "#313c47", roughness=0.75, metallic=0.08)
M_ACCENT = mat("houston_blue", "#69a9c7", roughness=0.22, metallic=0.30)
M_RIM = mat("cockpit_rim", "#566d7b", roughness=0.32, metallic=0.65)
M_DARK = mat("dark_interior", "#1f2a36", roughness=0.65)
M_NOZZLE = mat("raptor_nozzle", "#6c7e8a", roughness=0.26, metallic=0.88)
M_GLOW = mat("raptor_glow", "#5ce1ff", roughness=0.10, emission=3.5, emission_color="#48d2ff")
M_SUIT = mat("suit_white", "#f2f4ec", roughness=0.34, metallic=0.05)
M_PACK = mat("backpack", "#ced9dc", roughness=0.28, metallic=0.35)
M_HELMET = mat("helmet_shell", "#f5f6ee", roughness=0.14, metallic=0.08)
M_VISOR = mat("visor_blue", "#69a9c7", roughness=0.08, metallic=0.65)
M_ORANGE = mat("antenna_orange", "#eb9c4c", roughness=0.25, emission=0.8, emission_color="#ffaa52")
M_LED = mat("status_led", "#d7ef8d", roughness=0.15, emission=2.2, emission_color="#d7ef8d")
M_SLOTH = mat("sloth_fur", "#a99074", roughness=0.82)
M_FACE = mat("sloth_face", "#e6d4b6", roughness=0.78)
M_MASK = mat("sloth_mask", "#5c493c", roughness=0.78)
M_EYE = mat("eye_dark", "#241e24", roughness=0.12)
M_EYE_W = mat("eye_glint", "#f8f0e2", roughness=0.10)
M_CHEEK = mat("cheek", "#d9a48e", roughness=0.72)
M_GLOVE = mat("glove", "#e7e6d7", roughness=0.52)
M_CLAW = mat("claw", "#a99b82", roughness=0.38)
M_XMARK = mat("spacex_x", "#223242", roughness=0.35, metallic=0.45)


def smooth(obj, bevel=0.0):
    bpy.context.view_layer.objects.active = obj
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
    if obj.type == "MESH":
        obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    return obj


def sphere(x, y, z, rx, ry, rz, m, segs=28, rings=18, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def box(x, y, z, sx, sy, sz, m, bevel=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cyl(x, y, z, r, depth, m, verts=28, rot=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cone(x, y, z, r1, r2, depth, m, verts=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def torus(x, y, z, major_r, minor_r, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=32, minor_segments=14,
        major_radius=major_r, minor_radius=minor_r,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def add_flap(top_pts, thickness, m_top, m_bot, m_edge):
    """Build an exact extruded 4-corner Starship aero flap from Wild Wheels coordinates."""
    mesh = bpy.data.meshes.new("Flap")
    obj = bpy.data.objects.new("Flap", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m_top)   # 0
    obj.data.materials.append(m_bot)   # 1
    obj.data.materials.append(m_edge)  # 2

    bm = bmesh.new()
    top = [bm.verts.new(loc(x, y, z)) for (x, y, z) in top_pts]
    bot = [bm.verts.new(loc(x, y - thickness, z)) for (x, y, z) in top_pts]
    f_top = bm.faces.new(top)
    f_top.material_index = 0
    f_bot = bm.faces.new(list(reversed(bot)))
    f_bot.material_index = 1
    for i in range(4):
        j = (i + 1) % 4
        f = bm.faces.new([top[i], top[j], bot[j], bot[i]])
        f.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return smooth(obj, bevel=0.025)


# =============================================================================
# 1. EXACT SPACEX STARSHIP HULL (from drawStarship in client/characters.js)
# =============================================================================
RINGS = [
    (-3.05, 1.02), (-2.50, 1.02), (-1.90, 1.02), (-1.30, 1.02),
    (-0.70, 1.02), (-0.10, 1.02), (0.50, 1.02),  (1.10, 1.02),
    (1.60, 0.98),  (2.10, 0.85),  (2.60, 0.66),  (3.10, 0.40),
    (3.60, 0.04),
]
SIDES = 36

hull_mesh = bpy.data.meshes.new("StarshipHull")
hull_obj = bpy.data.objects.new("StarshipHull", hull_mesh)
bpy.context.collection.objects.link(hull_obj)
for m in (M_STEEL, M_STEEL_B, M_TILE_A, M_TILE_B, M_DARK):
    hull_obj.data.materials.append(m)

bm = bmesh.new()
ring_verts = []
for z, r in RINGS:
    rv = []
    for s in range(SIDES):
        a = s * 2.0 * math.pi / SIDES
        rv.append(bm.verts.new(loc(math.cos(a) * r, 1.45 + math.sin(a) * r, z)))
    ring_verts.append(rv)

for ri in range(len(RINGS) - 1):
    for s in range(SIDES):
        sn = (s + 1) % SIDES
        a_mid = (s + 0.5) * 2.0 * math.pi / SIDES
        f = bm.faces.new([ring_verts[ri][s], ring_verts[ri + 1][s], ring_verts[ri + 1][sn], ring_verts[ri][sn]])
        if math.sin(a_mid) < -0.15:
            f.material_index = 2 if (ri + s) % 2 == 0 else 3
        else:
            f.material_index = 0 if s % 3 != 1 else 1

# Aft bulkhead cap & nose tip cap
aft_center = bm.verts.new(loc(0, 1.45, -3.06))
nose_center = bm.verts.new(loc(0, 1.45, 3.62))
for s in range(SIDES):
    sn = (s + 1) % SIDES
    fa = bm.faces.new([aft_center, ring_verts[0][sn], ring_verts[0][s]])
    fa.material_index = 4
    fn = bm.faces.new([nose_center, ring_verts[-1][s], ring_verts[-1][sn]])
    fn.material_index = 0

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(hull_mesh)
bm.free()
smooth(hull_obj)

# Subtle stainless-steel weld ring seams along the barrel
for z, r in RINGS[1:8]:
    torus(0, 1.45, z, r + 0.006, 0.015, M_SEAM, rot=(math.pi / 2, 0, 0))

# Exact swept forward & aft Starship flaps (matching drawStarship coordinates)
for side in (-1.0, 1.0):
    fwd = [
        (side * 0.89, 1.42, 1.80),
        (side * 1.85, 1.47, 1.15),
        (side * 1.65, 1.52, 2.30),
        (side * 0.77, 1.52, 2.65),
    ]
    aft = [
        (side * 0.91, 1.42, -2.90),
        (side * 2.50, 1.14, -3.15),
        (side * 2.35, 1.28, -1.72),
        (side * 0.98, 1.52, -1.05),
    ]
    add_flap(fwd, 0.12, M_STEEL_B, M_TILE_A, M_ACCENT)
    add_flap(aft, 0.13, M_STEEL_B, M_TILE_A, M_ACCENT)
    # RCS maneuvering pods
    for rz in (-2.35, 2.05):
        sphere(side * 0.96, 1.62, rz, 0.09, 0.12, 0.16, M_DARK, segs=14, rings=10)

# Open cartoon cockpit collar + forward X emblem
torus(0, 2.40, -0.12, 0.80, 0.09, M_RIM)
cyl(0, 2.36, -0.12, 0.72, 0.12, M_DARK, verts=28, bevel=0.02)
box(0, 2.49, 0.63, 0.86, 0.09, 0.09, M_ACCENT, bevel=0.02)
# Crisp SpaceX X on the forward deck
box(0, 2.47, 1.35, 0.11, 0.04, 0.78, M_XMARK, bevel=0.01, rot=(0.06, 0, 0.54))
box(0, 2.47, 1.35, 0.11, 0.04, 0.78, M_XMARK, bevel=0.01, rot=(0.06, 0, -0.54))

# 6 Exact Raptor engine bells flaring BACKWARD (-Z -> rot=-pi/2) with glowing plasma cores
RAPTOR_ENGINES = [
    (0.0, 0.64, 0.28), (-0.55, -0.32, 0.28), (0.55, -0.32, 0.28),
    (0.0, -0.27, 0.16), (-0.23, 0.14, 0.16), (0.23, 0.14, 0.16),
]
for ex, ey, er in RAPTOR_ENGINES:
    cone(ex, 1.45 + ey, -3.30, er, er * 0.56, 0.48, M_NOZZLE, verts=24, rot=(-math.pi / 2, 0, 0))
    sphere(ex, 1.45 + ey, -3.50, er * 0.76, er * 0.76, 0.12, M_GLOW, segs=16, rings=10)

# =============================================================================
# 2. EXACT HOUSTON THE SLOTH ASTRONAUT (from drawNewDriver case 7 & drawHoustonHelmet)
# =============================================================================

# Off-white spacesuit torso + sky-blue collar ring + chest panel with mission patch & LED
sphere(0, 2.20, 0.0, 0.78, 1.00, 0.72, M_SUIT, segs=28, rings=18)
torus(0, 2.99, 0.02, 0.76, 0.13, M_ACCENT)
box(0, 2.20, 0.73, 0.68, 0.46, 0.12, M_ACCENT, bevel=0.03)
box(-0.14, 2.53, 0.77, 0.24, 0.10, 0.04, M_ORANGE, bevel=0.015)
sphere(0.19, 2.56, 0.80, 0.065, 0.065, 0.035, M_LED, segs=12, rings=8)

# Life-support backpack + twin sky-blue oxygen tanks (signature rear silhouette!)
box(0, 2.25, -0.82, 1.32, 1.18, 0.50, M_PACK, bevel=0.09)
for side in (-1.0, 1.0):
    cyl(side * 0.53, 2.42, -1.07, 0.24, 1.05, M_ACCENT, verts=22, bevel=0.05)
    sphere(side * 0.53, 2.94, -1.07, 0.24, 0.18, 0.24, M_ACCENT, segs=18, rings=10)
    sphere(side * 0.53, 1.90, -1.07, 0.24, 0.18, 0.24, M_ACCENT, segs=18, rings=10)
    sphere(side * 0.53, 3.12, -1.07, 0.09, 0.09, 0.09, M_STEEL, segs=12, rings=8)

# Spacesuit arms reaching forward + gloved paws with 3 adorable sloth claws each
for side in (-1.0, 1.0):
    sphere(side * 0.85, 2.16, 0.62, 0.24, 0.30, 0.38, M_SUIT, segs=18, rings=12)
    sphere(side * 0.83, 2.12, 1.00, 0.29, 0.29, 0.29, M_GLOVE, segs=20, rings=14)
    for claw in (-1, 0, 1):
        sphere(side * 0.83 + claw * 0.12, 2.03, 1.25, 0.055, 0.08, 0.15, M_CLAW, segs=12, rings=8)

# Exact Houston Helmet (drawHoustonHelmet): pearl-white shell, sky-blue visor, ear pods & orange-tip antenna
sphere(0, 3.71, 0.03, 1.08, 1.09, 0.99, M_HELMET, segs=36, rings=24)
sphere(0, 3.73, 0.60, 0.93, 0.87, 0.57, M_VISOR, segs=32, rings=20)
for side in (-1.0, 1.0):
    sphere(side * 1.04, 3.57, 0.16, 0.19, 0.29, 0.26, M_ACCENT, segs=18, rings=12)
cyl(-0.45, 4.81, 0.03, 0.032, 0.44, M_ACCENT, verts=14, bevel=0.01)
sphere(-0.45, 5.05, 0.03, 0.11, 0.11, 0.11, M_ORANGE, segs=16, rings=10)

# Exact Sloth face (peeking cleanly in front of the visor, matching drawNewDriver case 7)
sphere(0, 3.68, 0.96, 0.73, 0.72, 0.36, M_SLOTH, segs=28, rings=18)
sphere(0, 3.63, 1.15, 0.65, 0.60, 0.20, M_FACE, segs=26, rings=16)
for side in (-1.0, 1.0):
    sphere(side * 0.32, 3.77, 1.32, 0.30, 0.20, 0.055, M_MASK, segs=18, rings=10)
    box(side * 0.31, 3.82, 1.38, 0.23, 0.048, 0.038, M_EYE, bevel=0.012)
    sphere(side * 0.29, 3.88, 1.385, 0.055, 0.035, 0.025, M_EYE_W, segs=10, rings=6)
    sphere(side * 0.44, 3.47, 1.31, 0.14, 0.08, 0.028, M_CHEEK, segs=12, rings=8)
sphere(0, 3.57, 1.43, 0.15, 0.10, 0.09, M_EYE, segs=16, rings=10)
box(0, 3.35, 1.34, 0.30, 0.042, 0.028, M_MASK, bevel=0.01)

# Join all meshes into one clean multi-material mesh with smooth interpolated normals
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.join()
obj = bpy.context.active_object
obj.name = "HoustonTheRTPL"
obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
obj.data.update()

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_normals=True,
    export_materials="EXPORT",
)
print(f"Exported faithful Blender PBR Houston to {out_path}")
