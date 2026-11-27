"""
Build a weathered, flight-proven, scorched SpaceX Starship (Block 2) + lived-in
Houston the RTPL (#7):
  - houston_ship.glb   : Battle-tested 304L stainless steel with heat-blued & bronze
                         re-entry discoloration, soot streaks around RCS vents & aft skirt,
                         weathered TPS tiles with a few charred/missing ceramic spots,
                         Mechazilla catch pins, aero hinge fairings, nav strobes, and
                         heat-tempered copper/violet Raptor engine bells.
  - houston_pilot.glb  : Lived-in sloth astronaut with dusty scuffed spacesuit, weathered
                         backpack tubing/clasps, scuffed glossy helmet, and expressive face.
  - houston_arm_l.glb  : Left dusty spacesuit arm + 3-clawed glove
  - houston_arm_r.glb  : Right dusty spacesuit arm + 3-clawed glove

    blender --background --python build_houston.py -- wasm-poc/assets
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Euler, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(__file__))
from specialist_rigs import finish_existing

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
# PART 1: FLIGHT-PROVEN, SCORCHED BLOCK 2 SPACEX STARSHIP (houston_ship.glb)
# =============================================================================
def build_ship():
    reset_scene()
    # Real flown 304L stainless steel: slightly brushed/weathered + soot & heat-blued steel!
    m_steel = mat("steel_304l", "#ced8de", roughness=0.22, metallic=0.92)
    m_steel_worn = mat("steel_worn", "#a7b4bd", roughness=0.34, metallic=0.86)
    m_heat_bronze = mat("steel_heat_bronze", "#8f7d6c", roughness=0.36, metallic=0.82)
    m_soot = mat("soot_scorch", "#383d44", roughness=0.78, metallic=0.30)
    m_frost = mat("cryo_frost", "#e6f0f5", roughness=0.52, metallic=0.18)
    m_seam = mat("weld_seam", "#5d6973", roughness=0.45, metallic=0.78)
    m_tile_a = mat("tps_tile_a", "#1b2026", roughness=0.82, metallic=0.08)
    m_tile_b = mat("tps_tile_b", "#262d36", roughness=0.78, metallic=0.08)
    m_tile_missing = mat("tps_missing", "#c9c2b2", roughness=0.88, metallic=0.02)  # Exposed white-tan ceramic blanket!
    m_accent = mat("houston_blue", "#598fa8", roughness=0.38, metallic=0.28)
    m_rim = mat("cockpit_rim", "#435561", roughness=0.42, metallic=0.68)
    m_dark = mat("thrust_bay", "#11161c", roughness=0.80, metallic=0.22)
    m_nozzle = mat("raptor_bell", "#5c5358", roughness=0.30, metallic=0.88)         # Heat-tempered dark bronze/violet bell
    m_manifold = mat("raptor_manifold", "#8c847d", roughness=0.26, metallic=0.92)
    m_glow = mat("raptor_core", "#78eaff", roughness=0.08, emission=4.8, emission_color="#5ee2ff")
    m_xmark = mat("spacex_x", "#1b242e", roughness=0.45, metallic=0.45)
    m_nav_red = mat("nav_port", "#ff3b30", roughness=0.15, emission=3.4, emission_color="#ff3b30")
    m_nav_grn = mat("nav_stbd", "#34e87a", roughness=0.15, emission=3.4, emission_color="#34e87a")

    # Fat-cute chubby cartoon Starship outline (plump wider barrel, shorter rounded dome nose,
    # lower belly skimming the ground while keeping the top cockpit deck at the exact same height!)
    yc = 1.32
    rings = [
        (-2.95, 1.12), (-2.50, 1.18), (-1.95, 1.22), (-1.40, 1.25),
        (-0.85, 1.26), (-0.30, 1.26), (0.25, 1.25),  (0.80, 1.22),
        (1.30, 1.16),  (1.75, 1.06),  (2.15, 0.90),  (2.50, 0.70),
        (2.80, 0.46),  (3.04, 0.22),  (3.18, 0.05),
    ]
    sides = 44
    hull_mesh = bpy.data.meshes.new("StarshipHull")
    hull_obj = bpy.data.objects.new("StarshipHull", hull_mesh)
    bpy.context.collection.objects.link(hull_obj)
    # 0:steel, 1:worn, 2:tile_a, 3:tile_b, 4:dark, 5:frost, 6:bronze_heat, 7:soot, 8:missing_tile
    for m in (m_steel, m_steel_worn, m_tile_a, m_tile_b, m_dark, m_frost, m_heat_bronze, m_soot, m_tile_missing):
        hull_obj.data.materials.append(m)

    bm = bmesh.new()
    ring_verts = []
    for z, r in rings:
        rv = []
        for s in range(sides):
            a = s * 2.0 * math.pi / sides
            # Slightly wider horizontally (1.06x) and cozy vertically (0.94x) for extra fat-cute chubbiness!
            rv.append(bm.verts.new(loc(math.cos(a) * r * 1.06, yc + math.sin(a) * r * 0.94, z)))
        ring_verts.append(rv)

    for ri in range(len(rings) - 1):
        for s in range(sides):
            sn = (s + 1) % sides
            a_mid = (s + 0.5) * 2.0 * math.pi / sides
            f = bm.faces.new([ring_verts[ri][s], ring_verts[ri + 1][s], ring_verts[ri + 1][sn], ring_verts[ri][sn]])
            if math.sin(a_mid) < -0.08:
                # Weathered TPS heat-shield belly with a few chipped/missing white-ceramic backing tiles!
                if (ri == 1 and s in (27, 35)) or (ri == 9 and s == 31) or (ri == 5 and s == 38):
                    f.material_index = 8
                else:
                    f.material_index = 2 if (ri + s) % 2 == 0 else 3
            elif ri == 0:
                # Heavy soot & scorch ring right around the aft engine skirt!
                f.material_index = 7 if s % 3 != 0 else 6
            elif ri == 1 and (s % 5 in (0, 1)):
                # Heat-blued bronze discoloration creeping up from the aft skirt
                f.material_index = 6
            elif ri >= 11:
                # Re-entry plasma scorched & heat-tinted nose cone!
                f.material_index = 6 if (ri + s) % 3 == 0 else (7 if ri == 13 else 1)
            elif ri in (3, 4) and math.sin(a_mid) > 0.35:
                # Cryogenic LOX tank frost band
                f.material_index = 5
            elif (ri * 7 + s * 3) % 11 == 0:
                # Battle-tested oil/soot/scuff panels
                f.material_index = 6 if (ri + s) % 2 == 0 else 1
            else:
                f.material_index = 0 if (ri + s) % 3 != 1 else 1

    # Recessed soot-blackened aft thrust bay
    aft_ring_in = [
        bm.verts.new(loc(math.cos(s * 2.0 * math.pi / sides) * 1.08, yc + math.sin(s * 2.0 * math.pi / sides) * 0.96, -2.95))
        for s in range(sides)
    ]
    aft_ring_deep = [
        bm.verts.new(loc(math.cos(s * 2.0 * math.pi / sides) * 1.04, yc + math.sin(s * 2.0 * math.pi / sides) * 0.92, -2.68))
        for s in range(sides)
    ]
    aft_center = bm.verts.new(loc(0, yc, -2.65))
    nose_center = bm.verts.new(loc(0, yc, 3.22))
    for s in range(sides):
        sn = (s + 1) % sides
        bm.faces.new([ring_verts[0][s], ring_verts[0][sn], aft_ring_in[sn], aft_ring_in[s]]).material_index = 7
        bm.faces.new([aft_ring_in[s], aft_ring_in[sn], aft_ring_deep[sn], aft_ring_deep[s]]).material_index = 4
        bm.faces.new([aft_center, aft_ring_deep[sn], aft_ring_deep[s]]).material_index = 4
        bm.faces.new([nose_center, ring_verts[-1][s], ring_verts[-1][sn]]).material_index = 7

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(hull_mesh)
    bm.free()
    smooth(hull_obj)

    # Darkened heat-affected weld seams along the plump barrel
    for z, r in rings[1:9]:
        t_obj = torus(0, yc, z, r + 0.005, 0.015, m_seam, rot=(math.pi / 2, 0, 0))
        t_obj.scale = (1.06, 0.94, 1.0)

    # Leeward avionics raceway spine + weathered bolts
    box(0, 2.48, -1.68, 0.24, 0.09, 2.15, m_steel_worn, bevel=0.025)
    for rz in (-2.5, -1.95, -1.4, -0.88):
        box(0, 2.53, rz, 0.26, 0.03, 0.06, m_soot, bevel=0.008)

    # Mechazilla catch pins (slightly scorched lifting lugs)
    for side in (-1.0, 1.0):
        cyl(side * 1.32, 1.62, 1.02, 0.075, 0.28, m_manifold, verts=16, rot=(0, math.pi / 2, 0), bevel=0.015)
        sphere(side * 1.46, 1.62, 1.02, 0.085, 0.095, 0.095, m_heat_bronze, segs=14, rings=10)

    # Chunky, cute swept forward & aft Starship flaps with heat-scorched hinge covers, soot & nav strobes
    for side in (-1.0, 1.0):
        fwd = [(side * 1.02, 1.36, 1.55), (side * 2.02, 1.40, 1.02), (side * 1.82, 1.44, 2.05), (side * 0.86, 1.43, 2.42)]
        aft = [(side * 1.10, 1.30, -2.84), (side * 2.68, 1.02, -3.02), (side * 2.50, 1.18, -1.62), (side * 1.18, 1.42, -0.98)]
        add_flap(fwd, 0.13, m_steel_worn, m_tile_a, m_heat_bronze)
        add_flap(aft, 0.15, m_steel_worn, m_tile_a, m_heat_bronze)
        # Scorched aerodynamic hinge covers
        cyl(side * 1.10, 1.40, 1.92, 0.11, 0.88, m_heat_bronze, verts=18, rot=(math.pi / 2 - 0.12, 0, 0), bevel=0.02)
        cyl(side * 1.18, 1.34, -1.90, 0.15, 1.82, m_heat_bronze, verts=20, rot=(math.pi / 2, 0, 0), bevel=0.03)
        # Soot scorch patches near hinge joints
        sphere(side * 1.24, 1.32, -2.58, 0.22, 0.06, 0.42, m_soot, segs=12, rings=8)
        # Port (red) / Starboard (green) navigation strobes
        nav_m = m_nav_red if side < 0 else m_nav_grn
        sphere(side * 2.60, 1.12, -2.32, 0.08, 0.08, 0.12, nav_m, segs=12, rings=8)
        # RCS cold-gas thruster pods with soot smudge behind them
        for rz in (-2.22, 1.78):
            sphere(side * 1.16, 1.54, rz, 0.09, 0.12, 0.18, m_dark, segs=14, rings=10)
            sphere(side * 1.18, 1.53, rz - 0.18, 0.05, 0.11, 0.22, m_soot, segs=10, rings=6)

    # Cockpit collar + SpaceX X deck emblem
    torus(0, 2.45, -0.12, 0.82, 0.095, m_rim)
    cyl(0, 2.40, -0.12, 0.74, 0.12, m_dark, verts=32, bevel=0.02)
    box(0, 2.52, 0.63, 0.88, 0.09, 0.09, m_accent, bevel=0.02)
    box(0, 2.46, 1.28, 0.11, 0.04, 0.78, m_xmark, bevel=0.01, rot=(0.08, 0, 0.54))
    box(0, 2.46, 1.28, 0.11, 0.04, 0.78, m_xmark, bevel=0.01, rot=(0.08, 0, -0.54))

    # 6 Heat-tempered Raptor engine bells with regenerative cooling manifolds
    for ex, ey, er in [
        (0.0, 0.64, 0.28), (-0.55, -0.32, 0.28), (0.55, -0.32, 0.28),
        (0.0, -0.27, 0.16), (-0.23, 0.14, 0.16), (0.23, 0.14, 0.16),
    ]:
        cone(ex, yc + ey, -3.08, er, er * 0.50, 0.56, m_nozzle, verts=28, rot=(-math.pi / 2, 0, 0))
        torus(ex, yc + ey, -2.96, er * 0.76, 0.024, m_manifold, rot=(math.pi / 2, 0, 0))
        torus(ex, yc + ey, -3.20, er * 0.94, 0.022, m_soot, rot=(math.pi / 2, 0, 0))
        sphere(ex, yc + ey, -3.30, er * 0.78, er * 0.78, 0.12, m_glow, segs=16, rings=10)

    export_part("houston_ship.glb", "HoustonShip")


# =============================================================================
# PART 2: LIVED-IN, WEATHERED HOUSTON THE SLOTH ASTRONAUT (houston_pilot.glb)
# =============================================================================
def build_pilot():
    reset_scene()
    m_steel = mat("steel", "#b8c2c8", roughness=0.30, metallic=0.88)
    m_accent = mat("houston_blue", "#578ea8", roughness=0.40, metallic=0.25)
    m_suit = mat("suit_dusty", "#dfd9cc", roughness=0.58, metallic=0.03)         # Lived-in dusty off-white canvas!
    m_dust = mat("suit_scuff", "#b5a692", roughness=0.74, metallic=0.02)         # Mars/lunar dust smudges
    m_pack = mat("backpack", "#9ea9ae", roughness=0.46, metallic=0.42)
    m_strap = mat("strap_dark", "#363c42", roughness=0.72, metallic=0.10)
    m_helmet = mat("helmet_worn", "#ebe8de", roughness=0.24, metallic=0.08)
    m_visor = mat("visor_blue", "#5b9ab8", roughness=0.12, metallic=0.68)
    m_orange = mat("antenna_orange", "#eb9c4c", roughness=0.28, emission=0.9, emission_color="#ffaa52")
    m_led = mat("status_led", "#d7ef8d", roughness=0.15, emission=2.4, emission_color="#d7ef8d")
    m_sloth = mat("sloth_fur", "#9c8266", roughness=0.86)
    m_face = mat("sloth_face", "#e2cfa8", roughness=0.82)
    m_mask = mat("sloth_mask", "#524034", roughness=0.82)
    m_eye = mat("eye_dark", "#241e24", roughness=0.12)
    m_eye_w = mat("eye_glint", "#f8f0e2", roughness=0.10)
    m_cheek = mat("cheek", "#d19b84", roughness=0.75)

    # Dusty spacesuit torso + harness straps + shoulder dust scuffs
    sphere(0, 2.20, 0.0, 0.78, 1.00, 0.72, m_suit, segs=28, rings=18)
    for side in (-1.0, 1.0):
        box(side * 0.42, 2.38, 0.20, 0.14, 0.92, 0.88, m_strap, bevel=0.02)
        sphere(side * 0.62, 2.62, -0.15, 0.22, 0.18, 0.24, m_dust, segs=12, rings=8)
    torus(0, 2.99, 0.02, 0.76, 0.13, m_accent)
    box(0, 2.20, 0.73, 0.68, 0.46, 0.12, m_accent, bevel=0.03)
    box(-0.14, 2.53, 0.77, 0.24, 0.10, 0.04, m_orange, bevel=0.015)
    sphere(0.19, 2.56, 0.80, 0.065, 0.065, 0.035, m_led, segs=12, rings=8)

    # Weathered PLSS life-support backpack + scuffed oxygen tanks + dark hoses/clasps
    box(0, 2.25, -0.82, 1.32, 1.18, 0.50, m_pack, bevel=0.09)
    box(0, 2.25, -1.08, 0.42, 0.72, 0.08, m_strap, bevel=0.02)
    box(0, 1.80, -0.96, 1.18, 0.16, 0.28, m_dust, bevel=0.03)
    for side in (-1.0, 1.0):
        cyl(side * 0.53, 2.42, -1.07, 0.24, 1.05, m_accent, verts=22, bevel=0.05)
        torus(side * 0.53, 2.66, -1.07, 0.245, 0.03, m_strap)
        torus(side * 0.53, 2.18, -1.07, 0.245, 0.03, m_strap)
        sphere(side * 0.53, 2.94, -1.07, 0.24, 0.18, 0.24, m_accent, segs=18, rings=10)
        sphere(side * 0.53, 1.90, -1.07, 0.24, 0.18, 0.24, m_dust, segs=18, rings=10)
        sphere(side * 0.53, 3.12, -1.07, 0.09, 0.09, 0.09, m_steel, segs=12, rings=8)

    torso = set(bpy.context.scene.objects)

    # Slightly weathered helmet + ear pods + scuff band + antenna
    sphere(0, 3.71, 0.03, 1.08, 1.09, 0.99, m_helmet, segs=36, rings=24)
    torus(0, 3.18, 0.03, 0.96, 0.055, m_strap)
    sphere(0, 3.73, 0.60, 0.93, 0.87, 0.57, m_visor, segs=32, rings=20)
    for side in (-1.0, 1.0):
        sphere(side * 1.04, 3.57, 0.16, 0.19, 0.29, 0.26, m_accent, segs=18, rings=12)
        sphere(side * 1.18, 3.57, 0.16, 0.06, 0.14, 0.14, m_strap, segs=12, rings=8)
    cyl(-0.45, 4.81, 0.03, 0.032, 0.44, m_steel, verts=14, bevel=0.01)
    sphere(-0.45, 5.05, 0.03, 0.11, 0.11, 0.11, m_orange, segs=16, rings=10)

    # Sloth face
    sphere(0, 3.68, 0.96, 0.73, 0.72, 0.36, m_sloth, segs=28, rings=18)
    sphere(0, 3.63, 1.15, 0.65, 0.60, 0.20, m_face, segs=26, rings=16)
    for side in (-1.0, 1.0):
        sphere(side * 0.32, 3.77, 1.32, 0.30, 0.20, 0.055, m_mask, segs=18, rings=10)
        box(side * 0.31, 3.82, 1.38, 0.23, 0.048, 0.038, m_eye, bevel=0.012)
        sphere(side * 0.29, 3.88, 1.385, 0.055, 0.035, 0.025, m_eye_w, segs=10, rings=6)
        sphere(side * 0.44, 3.47, 1.31, 0.14, 0.08, 0.028, m_cheek, segs=12, rings=8)
    sphere(0, 3.57, 1.43, 0.15, 0.10, 0.09, m_eye, segs=16, rings=10)
    box(0, 3.35, 1.34, 0.30, 0.042, 0.028, m_mask, bevel=0.01)

    for side in (-1, 1):
        before = set(bpy.context.scene.objects)
        sculpt_arm()
        for obj in set(bpy.context.scene.objects) - before:
            obj['joint'] = ('wrist' if -obj.location.y >= .56 else 'arm') + ('_l' if side < 0 else '_r')
            obj.location += Vector(loc(side * .85, 2.25, .28))
    finish_existing("houston", os.path.join(out_dir, "houston_pilot.glb"), torso=torso)


# =============================================================================
# PART 3: WEATHERED SPACESUIT ARM + 3-CLAWED GLOVE
# =============================================================================
def sculpt_arm():
    m_suit = mat("suit_dusty", "#dfd9cc", roughness=0.58, metallic=0.03)
    m_glove = mat("glove_worn", "#cfc7b4", roughness=0.68)
    m_claw = mat("claw", "#998a70", roughness=0.45)
    m_accent = mat("houston_blue", "#578ea8", roughness=0.40, metallic=0.25)

    sphere(0, 0, 0.32, 0.24, 0.26, 0.44, m_suit, segs=18, rings=12)
    torus(0, 0, 0.56, 0.22, 0.045, m_accent, rot=(math.pi / 2, 0, 0))
    sphere(0, 0, 0.72, 0.29, 0.29, 0.29, m_glove, segs=20, rings=14)
    for claw in (-1, 0, 1):
        sphere(claw * 0.12, -0.08, 0.98, 0.055, 0.08, 0.16, m_claw, segs=12, rings=8)


def build_arm(filename, name):
    reset_scene()
    sculpt_arm()
    export_part(filename, name)


build_ship()
build_pilot()
build_arm("houston_arm_l.glb", "HoustonArmL")
build_arm("houston_arm_r.glb", "HoustonArmR")
