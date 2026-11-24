"""
Build a realistic, smooth-shaded PBR SpaceX Starship (Block 2) + Houston the RTPL (#7):
  - houston_ship.glb   : Mirror-polished 304L stainless-steel Starship hull, welded ring seams,
                         leeward avionics raceway, Mechazilla catch pins, TPS heat-shield belly,
                         swept forward & aft flaps with aero hinge fairings, port/starboard nav
                         beacons, recessed aft thrust bay, and 3 RVac + 3 SL Raptor engine bells
                         with regenerative cooling manifolds.
  - houston_pilot.glb  : Houston the Sloth Astronaut (torso, twin O2 tanks, glossy helmet, face)
  - houston_arm_l.glb  : Left spacesuit arm + 3-clawed glove (origin at shoulder)
  - houston_arm_r.glb  : Right spacesuit arm + 3-clawed glove (origin at shoulder)

    blender --background --python build_houston.py -- wasm-poc/assets
"""
import math
import os
import sys
import bpy
import bmesh
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
        major_segments=36, minor_segments=14,
        major_radius=major_r, minor_radius=minor_r,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def export_part(filename, name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
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


def add_flap(top_pts, thickness, m_top, m_bot, m_edge):
    mesh = bpy.data.meshes.new("Flap")
    obj = bpy.data.objects.new("Flap", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m_top)
    obj.data.materials.append(m_bot)
    obj.data.materials.append(m_edge)
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
# PART 1: REALISTIC BLOCK 2 SPACEX STARSHIP (houston_ship.glb)
# =============================================================================
def build_ship():
    reset_scene()
    m_steel = mat("steel_304l", "#e4edf2", roughness=0.09, metallic=0.97)
    m_steel_b = mat("steel_panel", "#c8d5dc", roughness=0.14, metallic=0.94)
    m_frost = mat("cryo_frost", "#eef7fc", roughness=0.38, metallic=0.25)
    m_seam = mat("weld_seam", "#7d909c", roughness=0.26, metallic=0.88)
    m_tile_a = mat("tps_tile_a", "#1e242c", roughness=0.76, metallic=0.10)
    m_tile_b = mat("tps_tile_b", "#29323d", roughness=0.72, metallic=0.10)
    m_accent = mat("houston_blue", "#69a9c7", roughness=0.20, metallic=0.35)
    m_rim = mat("cockpit_rim", "#526978", roughness=0.28, metallic=0.72)
    m_dark = mat("thrust_bay", "#151c24", roughness=0.68, metallic=0.25)
    m_nozzle = mat("raptor_bell", "#5e707d", roughness=0.22, metallic=0.92)
    m_manifold = mat("raptor_manifold", "#9aaab5", roughness=0.18, metallic=0.95)
    m_glow = mat("raptor_core", "#70e8ff", roughness=0.08, emission=4.5, emission_color="#5ce0ff")
    m_xmark = mat("spacex_x", "#1d2a38", roughness=0.30, metallic=0.55)
    m_nav_red = mat("nav_port", "#ff3b30", roughness=0.15, emission=3.2, emission_color="#ff3b30")
    m_nav_grn = mat("nav_stbd", "#34e87a", roughness=0.15, emission=3.2, emission_color="#34e87a")

    # Authentic tangent-ogive SpaceX Starship silhouette
    rings = [
        (-3.15, 1.03), (-2.65, 1.03), (-2.10, 1.03), (-1.55, 1.03),
        (-1.00, 1.03), (-0.45, 1.03), (0.10, 1.03),  (0.65, 1.03),
        (1.18, 1.02),  (1.65, 0.97),  (2.12, 0.86),  (2.58, 0.69),
        (3.02, 0.47),  (3.42, 0.23),  (3.72, 0.05),
    ]
    sides = 44
    hull_mesh = bpy.data.meshes.new("StarshipHull")
    hull_obj = bpy.data.objects.new("StarshipHull", hull_mesh)
    bpy.context.collection.objects.link(hull_obj)
    for m in (m_steel, m_steel_b, m_tile_a, m_tile_b, m_dark, m_frost):
        hull_obj.data.materials.append(m)

    bm = bmesh.new()
    ring_verts = []
    for z, r in rings:
        rv = []
        for s in range(sides):
            a = s * 2.0 * math.pi / sides
            rv.append(bm.verts.new(loc(math.cos(a) * r, 1.45 + math.sin(a) * r, z)))
        ring_verts.append(rv)

    for ri in range(len(rings) - 1):
        for s in range(sides):
            sn = (s + 1) % sides
            a_mid = (s + 0.5) * 2.0 * math.pi / sides
            f = bm.faces.new([ring_verts[ri][s], ring_verts[ri + 1][s], ring_verts[ri + 1][sn], ring_verts[ri][sn]])
            if math.sin(a_mid) < -0.10:
                # Hex-checker TPS ceramic heat-shield belly
                f.material_index = 2 if (ri + s) % 2 == 0 else 3
            elif ri in (2, 3) and math.sin(a_mid) > 0.25:
                # Subtle cryogenic LOX tank frost band on the leeward barrel
                f.material_index = 5
            else:
                f.material_index = 0 if (ri + s) % 4 != 1 else 1

    # Recessed dark aft thrust dome (realistic hollow Starship skirt!)
    aft_ring_in = [
        bm.verts.new(loc(math.cos(s * 2.0 * math.pi / sides) * 0.94, 1.45 + math.sin(s * 2.0 * math.pi / sides) * 0.94, -3.15))
        for s in range(sides)
    ]
    aft_ring_deep = [
        bm.verts.new(loc(math.cos(s * 2.0 * math.pi / sides) * 0.92, 1.45 + math.sin(s * 2.0 * math.pi / sides) * 0.92, -2.85))
        for s in range(sides)
    ]
    aft_center = bm.verts.new(loc(0, 1.45, -2.82))
    nose_center = bm.verts.new(loc(0, 1.45, 3.76))
    for s in range(sides):
        sn = (s + 1) % sides
        f_lip = bm.faces.new([ring_verts[0][s], ring_verts[0][sn], aft_ring_in[sn], aft_ring_in[s]])
        f_lip.material_index = 1
        f_wall = bm.faces.new([aft_ring_in[s], aft_ring_in[sn], aft_ring_deep[sn], aft_ring_deep[s]])
        f_wall.material_index = 4
        f_cap = bm.faces.new([aft_center, aft_ring_deep[sn], aft_ring_deep[s]])
        f_cap.material_index = 4
        f_nose = bm.faces.new([nose_center, ring_verts[-1][s], ring_verts[-1][sn]])
        f_nose.material_index = 0

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(hull_mesh)
    bm.free()
    smooth(hull_obj)

    # Crisp welded stainless-steel ring seams along the barrel
    for z, r in rings[1:9]:
        torus(0, 1.45, z, r + 0.005, 0.013, m_seam, rot=(math.pi / 2, 0, 0))

    # Leeward avionics/propellant raceway spine running along the upper hull
    box(0, 2.46, -1.78, 0.22, 0.09, 2.45, m_steel_b, bevel=0.025)
    # Mechazilla catch pins (forward lifting lugs on both sides of the Starship!)
    for side in (-1.0, 1.0):
        cyl(side * 1.12, 1.72, 1.08, 0.075, 0.28, m_manifold, verts=16, rot=(0, math.pi / 2, 0), bevel=0.015)
        sphere(side * 1.26, 1.72, 1.08, 0.085, 0.095, 0.095, m_steel, segs=14, rings=10)

    # Sleek Block 2 forward & aft Starship flaps with aero hinge fairings + nav strobes!
    for side in (-1.0, 1.0):
        fwd = [(side * 0.87, 1.46, 1.82), (side * 1.78, 1.52, 1.24), (side * 1.58, 1.56, 2.34), (side * 0.72, 1.55, 2.74)]
        aft = [(side * 0.92, 1.42, -3.02), (side * 2.58, 1.12, -3.22), (side * 2.38, 1.28, -1.74), (side * 0.99, 1.54, -1.04)]
        add_flap(fwd, 0.11, m_steel_b, m_tile_a, m_accent)
        add_flap(aft, 0.13, m_steel_b, m_tile_a, m_accent)
        # Cylindrical aerodynamic hinge covers along flap roots
        cyl(side * 0.94, 1.50, 2.20, 0.10, 0.96, m_steel, verts=18, rot=(math.pi / 2 - 0.12, 0, 0), bevel=0.02)
        cyl(side * 1.01, 1.46, -2.02, 0.14, 1.98, m_steel, verts=20, rot=(math.pi / 2, 0, 0), bevel=0.03)
        # Port (red) / Starboard (green) navigation strobes on aft flap tips!
        nav_m = m_nav_red if side < 0 else m_nav_grn
        sphere(side * 2.48, 1.22, -2.48, 0.075, 0.075, 0.12, nav_m, segs=12, rings=8)
        # RCS cold-gas thruster pods
        for rz in (-2.35, 2.05):
            sphere(side * 0.98, 1.64, rz, 0.09, 0.12, 0.18, m_dark, segs=14, rings=10)

    # Open cockpit collar + SpaceX X deck emblem
    torus(0, 2.42, -0.12, 0.80, 0.09, m_rim)
    cyl(0, 2.37, -0.12, 0.72, 0.12, m_dark, verts=32, bevel=0.02)
    box(0, 2.50, 0.63, 0.86, 0.09, 0.09, m_accent, bevel=0.02)
    box(0, 2.48, 1.38, 0.11, 0.04, 0.82, m_xmark, bevel=0.01, rot=(0.06, 0, 0.54))
    box(0, 2.48, 1.38, 0.11, 0.04, 0.82, m_xmark, bevel=0.01, rot=(0.06, 0, -0.54))

    # 3 RVac (outer large) + 3 Sea-Level Raptor 3 (inner) engine bells with cooling manifolds!
    for ex, ey, er in [
        (0.0, 0.64, 0.28), (-0.55, -0.32, 0.28), (0.55, -0.32, 0.28),
        (0.0, -0.27, 0.16), (-0.23, 0.14, 0.16), (0.23, 0.14, 0.16),
    ]:
        # Regenerative-cooled nozzle bell flaring backward (-Z -> rot=-pi/2)
        cone(ex, 1.45 + ey, -3.26, er, er * 0.50, 0.58, m_nozzle, verts=28, rot=(-math.pi / 2, 0, 0))
        # Metallic manifold stiffening bands around each Raptor bell
        torus(ex, 1.45 + ey, -3.14, er * 0.76, 0.024, m_manifold, rot=(math.pi / 2, 0, 0))
        torus(ex, 1.45 + ey, -3.38, er * 0.94, 0.022, m_manifold, rot=(math.pi / 2, 0, 0))
        # Glowing cyan-white combustion throat inside each bell
        sphere(ex, 1.45 + ey, -3.48, er * 0.78, er * 0.78, 0.12, m_glow, segs=16, rings=10)

    export_part("houston_ship.glb", "HoustonShip")


# =============================================================================
# PART 2: HOUSTON THE SLOTH ASTRONAUT (houston_pilot.glb)
# =============================================================================
def build_pilot():
    reset_scene()
    m_steel = mat("steel", "#dde6ea", roughness=0.14, metallic=0.94)
    m_accent = mat("houston_blue", "#69a9c7", roughness=0.22, metallic=0.30)
    m_suit = mat("suit_white", "#f2f4ec", roughness=0.34, metallic=0.05)
    m_pack = mat("backpack", "#ced9dc", roughness=0.28, metallic=0.35)
    m_helmet = mat("helmet_shell", "#f5f6ee", roughness=0.14, metallic=0.08)
    m_visor = mat("visor_blue", "#69a9c7", roughness=0.08, metallic=0.65)
    m_orange = mat("antenna_orange", "#eb9c4c", roughness=0.25, emission=0.9, emission_color="#ffaa52")
    m_led = mat("status_led", "#d7ef8d", roughness=0.15, emission=2.4, emission_color="#d7ef8d")
    m_sloth = mat("sloth_fur", "#a99074", roughness=0.82)
    m_face = mat("sloth_face", "#e6d4b6", roughness=0.78)
    m_mask = mat("sloth_mask", "#5c493c", roughness=0.78)
    m_eye = mat("eye_dark", "#241e24", roughness=0.12)
    m_eye_w = mat("eye_glint", "#f8f0e2", roughness=0.10)
    m_cheek = mat("cheek", "#d9a48e", roughness=0.72)

    sphere(0, 2.20, 0.0, 0.78, 1.00, 0.72, m_suit, segs=28, rings=18)
    torus(0, 2.99, 0.02, 0.76, 0.13, m_accent)
    box(0, 2.20, 0.73, 0.68, 0.46, 0.12, m_accent, bevel=0.03)
    box(-0.14, 2.53, 0.77, 0.24, 0.10, 0.04, m_orange, bevel=0.015)
    sphere(0.19, 2.56, 0.80, 0.065, 0.065, 0.035, m_led, segs=12, rings=8)

    box(0, 2.25, -0.82, 1.32, 1.18, 0.50, m_pack, bevel=0.09)
    for side in (-1.0, 1.0):
        cyl(side * 0.53, 2.42, -1.07, 0.24, 1.05, m_accent, verts=22, bevel=0.05)
        sphere(side * 0.53, 2.94, -1.07, 0.24, 0.18, 0.24, m_accent, segs=18, rings=10)
        sphere(side * 0.53, 1.90, -1.07, 0.24, 0.18, 0.24, m_accent, segs=18, rings=10)
        sphere(side * 0.53, 3.12, -1.07, 0.09, 0.09, 0.09, m_steel, segs=12, rings=8)

    sphere(0, 3.71, 0.03, 1.08, 1.09, 0.99, m_helmet, segs=36, rings=24)
    sphere(0, 3.73, 0.60, 0.93, 0.87, 0.57, m_visor, segs=32, rings=20)
    for side in (-1.0, 1.0):
        sphere(side * 1.04, 3.57, 0.16, 0.19, 0.29, 0.26, m_accent, segs=18, rings=12)
    cyl(-0.45, 4.81, 0.03, 0.032, 0.44, m_accent, verts=14, bevel=0.01)
    sphere(-0.45, 5.05, 0.03, 0.11, 0.11, 0.11, m_orange, segs=16, rings=10)

    sphere(0, 3.68, 0.96, 0.73, 0.72, 0.36, m_sloth, segs=28, rings=18)
    sphere(0, 3.63, 1.15, 0.65, 0.60, 0.20, m_face, segs=26, rings=16)
    for side in (-1.0, 1.0):
        sphere(side * 0.32, 3.77, 1.32, 0.30, 0.20, 0.055, m_mask, segs=18, rings=10)
        box(side * 0.31, 3.82, 1.38, 0.23, 0.048, 0.038, m_eye, bevel=0.012)
        sphere(side * 0.29, 3.88, 1.385, 0.055, 0.035, 0.025, m_eye_w, segs=10, rings=6)
        sphere(side * 0.44, 3.47, 1.31, 0.14, 0.08, 0.028, m_cheek, segs=12, rings=8)
    sphere(0, 3.57, 1.43, 0.15, 0.10, 0.09, m_eye, segs=16, rings=10)
    box(0, 3.35, 1.34, 0.30, 0.042, 0.028, m_mask, bevel=0.01)

    export_part("houston_pilot.glb", "HoustonPilot")


# =============================================================================
# PART 3: SPACESUIT ARM + 3-CLAWED GLOVE
# =============================================================================
def build_arm(side, filename, name):
    reset_scene()
    m_suit = mat("suit_white", "#f2f4ec", roughness=0.34, metallic=0.05)
    m_glove = mat("glove", "#e7e6d7", roughness=0.52)
    m_claw = mat("claw", "#a99b82", roughness=0.38)
    m_accent = mat("houston_blue", "#69a9c7", roughness=0.22, metallic=0.30)

    sphere(0, 0, 0.32, 0.24, 0.26, 0.44, m_suit, segs=18, rings=12)
    torus(0, 0, 0.56, 0.22, 0.045, m_accent, rot=(math.pi / 2, 0, 0))
    sphere(0, 0, 0.72, 0.29, 0.29, 0.29, m_glove, segs=20, rings=14)
    for claw in (-1, 0, 1):
        sphere(claw * 0.12, -0.08, 0.98, 0.055, 0.08, 0.16, m_claw, segs=12, rings=8)
    export_part(filename, name)


build_ship()
build_pilot()
build_arm(-1.0, "houston_arm_l.glb", "HoustonArmL")
build_arm(1.0, "houston_arm_r.glb", "HoustonArmR")
