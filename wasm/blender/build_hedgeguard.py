"""
Build the uplifted PBR Hedgeguard armored heater shield + per-character emblems
for Wild Wheels:
  - hedgeguard_shield.glb         : Double-sided brushed teal-turquoise armored
                                    heater shield with titanium-silver beveled
                                    rim, forged perimeter rivets, glowing cyan
                                    inner energy seam, and recessed emblem field.
  - hedgeguard_emblem_default.glb : Spiky Aegis sunburst (for pickups & non-special racers)
  - hedgeguard_emblem_5.glb       : Tammy the Cricket (reverse-arrows spiral & antennae)
  - hedgeguard_emblem_7.glb       : Houston the RTPL (Starship rocket & gravity ring)
  - hedgeguard_emblem_8.glb       : Avita-Jas (Relativity atom & singularity core)
  - hedgeguard_emblem_9.glb       : Pearococo (Rococo crown & peacock feather eye)
  - hedgeguard_emblem_10.glb      : Master-Yuda (Ring of Fire & winged biker shades)
  - hedgeguard_emblem_11.glb      : R-yeah (authentic torch crest from r-yeah-logo.js)
  - hedgeguard_emblem_12.glb      : Catheterpillar (winged butterfly heart)
  - hedgeguard_emblem_13.glb      : Fourmidable (golden Tax-Audit % seal)
  - hedgeguard_emblem_14.glb      : KnowItOwl (luminous X-ray owl eyes & violet crescent)
  - hedgeguard_emblem_15.glb      : Tai-Coon (3D Tai Chi Yin-Yang medallion)

    /opt/homebrew/bin/blender --background --python wasm/blender/build_hedgeguard.py -- wasm/assets/models
"""
import json
import math
import os
import re
import sys
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(ROOT, "..", "characters", "r-yeah", "r-yeah-logo.js")

argv = sys.argv
OUT_DIR = argv[argv.index("--") + 1] if "--" in argv else os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)

# Front/back Z face of the recessed emblem field on hedgeguard_shield.glb.
EMBLEM_Z = 0.115
EMBLEM_Y = 0.08


def loc(x, y, z):
    """Map Bevy/game coords (x right, y up, z forward) to Blender (x, -z, y)."""
    return (x, -z, y)


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


MATS = {}


def reset_scene():
    global MATS
    MATS = {}
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, hex_color, roughness=0.45, metallic=0.0, emission=0.0, emission_color=None, coat=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name=name)
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    rgb = hex_to_linear(hex_color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if coat > 0.0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emission > 0.0:
        ec = hex_to_linear(emission_color or hex_color)
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    MATS[name] = m
    return m


def smooth(obj, bevel=0.0, bevel_segs=1):
    bpy.context.view_layer.objects.active = obj
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = bevel_segs
        mod.limit_method = "ANGLE"
    if obj.type == "MESH":
        obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    return obj


def box(x, y, z, sx, sy, sz, m, bevel=0.01, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def sphere(x, y, z, rx, ry, rz, m, segs=18, rings=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def cyl(x, y, z, r, depth, m, verts=20, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cone(x, y, z, r1, r2, depth, m, verts=18, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def torus_ring(x, y, z, major_r, minor_r, m, major_segs=28, minor_segs=10, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_r,
        minor_radius=minor_r,
        major_segments=major_segs,
        minor_segments=minor_segs,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    # Default torus lies in Blender XY (Bevy XZ); rotate X by pi/2 to face Bevy +Z.
    obj.rotation_euler = Euler((math.pi / 2 + rot[0], rot[1], rot[2]), "XYZ")
    obj.scale = (scale[0], scale[2], scale[1])
    obj.data.materials.append(m)
    return smooth(obj)


def extruded_poly(points_xy, z_center, depth, m, name="Poly", bevel=0.012):
    """Build an extruded 2D polygon in Bevy XY plane centered at z_center."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    hz = depth * 0.5
    front = [bm.verts.new(loc(px, py, z_center + hz)) for px, py in points_xy]
    back = [bm.verts.new(loc(px, py, z_center - hz)) for px, py in points_xy]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(points_xy)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def extruded_ring_band(outer_xy, inner_xy, z_center, depth, m, name="Band"):
    """Extrude a hollow frame between outer_xy and inner_xy loops (same length)."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    hz = depth * 0.5
    n = len(outer_xy)
    of = [bm.verts.new(loc(px, py, z_center + hz)) for px, py in outer_xy]
    ob = [bm.verts.new(loc(px, py, z_center - hz)) for px, py in outer_xy]
    inf = [bm.verts.new(loc(px, py, z_center + hz)) for px, py in inner_xy]
    inb = [bm.verts.new(loc(px, py, z_center - hz)) for px, py in inner_xy]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((of[i], of[j], inf[j], inf[i]))
        bm.faces.new((ob[j], ob[i], inb[i], inb[j]))
        bm.faces.new((of[i], ob[i], ob[j], of[j]))
        bm.faces.new((inf[j], inb[j], inb[i], inf[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m)
    return smooth(obj)


def shield_outline(scale=1.0):
    """Classic heraldic heater shield outline (CCW in Bevy XY)."""
    pts = [
        (0.0, 0.94),
        (-0.42, 0.90),
        (-0.76, 0.80),
        (-0.78, 0.36),
        (-0.72, -0.08),
        (-0.56, -0.46),
        (-0.30, -0.76),
        (0.0, -0.98),
        (0.30, -0.76),
        (0.56, -0.46),
        (0.72, -0.08),
        (0.78, 0.36),
        (0.76, 0.80),
        (0.42, 0.90),
    ]
    return [(x * scale, y * scale) for x, y in pts]


def finalize_and_export(parts, filename, root_name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = root_name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    tris = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    out_path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print(f"Exported {out_path} ({tris} tris, {os.path.getsize(out_path) / 1024:.1f} KB)")


def build_base_shield():
    reset_scene()
    m_teal = mat("ShieldTeal", "#1d9c92", roughness=0.34, metallic=0.55, coat=0.22)
    m_field = mat("ShieldField", "#105c5c", roughness=0.42, metallic=0.45, coat=0.18)
    m_rim = mat("ShieldTitanium", "#cde9ec", roughness=0.24, metallic=0.88, coat=0.15)
    m_rivet = mat("ShieldRivet", "#e8f8fa", roughness=0.20, metallic=0.94)
    m_glow = mat("ShieldEnergy", "#5ff7ea", roughness=0.2, metallic=0.2, emission=1.1, emission_color="#5ff7ea")

    parts = []
    # Main armored core plate
    parts.append(extruded_poly(shield_outline(0.96), 0.0, 0.21, m_teal, "ShieldCore", bevel=0.016))
    # Forged titanium-silver outer rim frame
    parts.append(extruded_ring_band(shield_outline(1.02), shield_outline(0.88), 0.0, 0.27, m_rim, "ShieldRim"))
    # Glowing cyan-teal energy trim seam just inside the rim
    parts.append(extruded_ring_band(shield_outline(0.88), shield_outline(0.83), 0.0, 0.245, m_glow, "ShieldEnergyTrim"))
    # Recessed dark-teal emblem field on both faces so gold/colored emblems pop
    parts.append(extruded_poly(shield_outline(0.82), 0.0, 0.225, m_field, "ShieldField", bevel=0.008))

    # Forged perimeter rivets on both faces
    rim_pts = shield_outline(0.945)
    for i in (0, 2, 3, 5, 7, 9, 11, 12):
        rx, ry = rim_pts[i]
        for sz in (-1, 1):
            parts.append(sphere(rx, ry, sz * 0.145, 0.036, 0.036, 0.022, m_rivet, segs=10, rings=6))

    finalize_and_export(parts, "hedgeguard_shield.glb", "HedgeguardShield")


def mirror_emblem(builder_fn, filename, root_name):
    """Build a 3D emblem on BOTH front (+Z) and back (-Z) faces of the shield."""
    reset_scene()
    parts = []
    for sign in (1.0, -1.0):
        parts.extend(builder_fn(sign))
    finalize_and_export(parts, filename, root_name)


def emblem_default(sign):
    """Spiky Hedgeguard Aegis sunburst crest (replaces generic cross)."""
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.28, emission_color="#f7d678")
    m_cyan = mat("CyanGem", "#6cfcf0", roughness=0.16, metallic=0.35, emission=0.95, emission_color="#6cfcf0")
    z = sign * EMBLEM_Z
    parts = []
    # 7 radiating protective spines around the top/sides
    for i in range(7):
        ang = -math.pi * 0.72 + i * (math.pi * 1.44 / 6.0)
        r_mid = 0.34
        px = math.sin(ang) * r_mid
        py = EMBLEM_Y + math.cos(ang) * r_mid
        parts.append(cone(px, py, z + sign * 0.02, 0.075, 0.008, 0.28, m_gold, verts=8, rot=(0, -ang, 0)))
    # Beveled inner shield diamond + glowing cyan core gem
    parts.append(box(0.0, EMBLEM_Y - 0.04, z + sign * 0.02, 0.32, 0.32, 0.05, m_gold, bevel=0.012, rot=(0, math.pi / 4, 0)))
    parts.append(sphere(0.0, EMBLEM_Y - 0.04, z + sign * 0.045, 0.12, 0.14, 0.045, m_cyan, segs=14, rings=10))
    return parts


def emblem_tammy(sign):
    """Driver 5 (Tammy the Cricket): Emerald Reverse-Psychology twin arrows & cricket antennae."""
    m_lime = mat("TammyLime", "#7ce846", roughness=0.22, metallic=0.45, emission=0.65, emission_color="#8aff52")
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.25, emission_color="#f7d678")
    z = sign * EMBLEM_Z
    parts = []
    # Reverse-psychology twin curved arcs (two opposing C-arcs + arrowheads)
    for half in (0, 1):
        base_a = half * math.pi + 0.25
        for k in range(7):
            a = base_a + k * (math.pi * 0.65 / 6.0)
            px = math.cos(a) * 0.36
            py = EMBLEM_Y + math.sin(a) * 0.36
            parts.append(sphere(px, py, z + sign * 0.025, 0.048, 0.048, 0.032, m_lime, segs=10, rings=8))
        # Arrowhead at end of arc
        a_tip = base_a + math.pi * 0.72
        tx = math.cos(a_tip) * 0.36
        ty = EMBLEM_Y + math.sin(a_tip) * 0.36
        tang = a_tip + math.pi / 2
        parts.append(cone(tx, ty, z + sign * 0.025, 0.095, 0.01, 0.18, m_gold, verts=6, rot=(0, math.pi / 2 - tang, 0)))
    # Center stylized cricket head + twin antennae
    parts.append(sphere(0.0, EMBLEM_Y - 0.02, z + sign * 0.035, 0.15, 0.17, 0.055, m_gold, segs=14, rings=10))
    for sx in (-1, 1):
        parts.append(box(sx * 0.11, EMBLEM_Y + 0.20, z + sign * 0.025, 0.032, 0.26, 0.028, m_gold, bevel=0.004, rot=(0, -sx * 0.42, 0)))
        parts.append(sphere(sx * 0.17, EMBLEM_Y + 0.32, z + sign * 0.03, 0.036, 0.036, 0.03, m_lime, segs=8, rings=6))
    return parts


def emblem_houston(sign):
    """Driver 7 (Houston): Starship rocket silhouette + tilted gravity ring + UV flame."""
    m_steel = mat("StarshipSteel", "#e2edf5", roughness=0.18, metallic=0.94, coat=0.2)
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.25, emission_color="#f7d678")
    m_uv = mat("NightmareUV", "#a95eff", roughness=0.18, metallic=0.2, emission=1.4, emission_color="#b86bff")
    z = sign * EMBLEM_Z
    parts = []
    # Tilted orbital gravity-well ring
    parts.append(torus_ring(0.0, EMBLEM_Y - 0.02, z + sign * 0.02, 0.42, 0.032, m_gold, rot=(0.45, 0.38, 0.0), scale=(1.0, 0.55, 0.5)))
    # Starship fuselage + nosecone + 4 aero flaps
    parts.append(cyl(0.0, EMBLEM_Y + 0.04, z + sign * 0.04, 0.11, 0.48, m_steel, verts=16))
    parts.append(cone(0.0, EMBLEM_Y + 0.40, z + sign * 0.04, 0.11, 0.01, 0.26, m_steel, verts=16))
    for sx in (-1, 1):
        parts.append(box(sx * 0.15, EMBLEM_Y - 0.12, z + sign * 0.035, 0.12, 0.18, 0.03, m_steel, bevel=0.005, rot=(0, sx * 0.28, 0)))
        parts.append(box(sx * 0.12, EMBLEM_Y + 0.25, z + sign * 0.035, 0.08, 0.10, 0.025, m_steel, bevel=0.004, rot=(0, sx * 0.35, 0)))
    # Ultraviolet Nightmare Fuel exhaust diamond
    parts.append(cone(0.0, EMBLEM_Y - 0.34, z + sign * 0.035, 0.10, 0.01, 0.28, m_uv, verts=10, rot=(0, math.pi, 0)))
    return parts


def emblem_avita(sign):
    """Driver 8 (Avita-Jas): Relativity 3-orbit electron atom + singularity core."""
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.28, emission_color="#f7d678")
    m_cyan = mat("RelativityCyan", "#4deeff", roughness=0.16, metallic=0.3, emission=1.25, emission_color="#4deeff")
    m_void = mat("Singularity", "#120624", roughness=0.1, metallic=0.8)
    z = sign * EMBLEM_Z
    parts = []
    for i in range(3):
        ang = i * math.pi / 3.0
        parts.append(torus_ring(0.0, EMBLEM_Y, z + sign * 0.025, 0.42, 0.026, m_gold, rot=(0.0, ang, 0.0), scale=(1.0, 0.44, 0.4)))
        # Glowing electron pearl on each orbital
        ex = math.cos(ang + 0.6) * 0.38
        ey = EMBLEM_Y + math.sin(ang + 0.6) * 0.30
        parts.append(sphere(ex, ey, z + sign * 0.04, 0.055, 0.055, 0.04, m_cyan, segs=10, rings=8))
    # Wormhole singularity core + bright cyan halo ring
    parts.append(torus_ring(0.0, EMBLEM_Y, z + sign * 0.035, 0.145, 0.024, m_cyan, major_segs=20, minor_segs=8))
    parts.append(sphere(0.0, EMBLEM_Y, z + sign * 0.04, 0.12, 0.12, 0.05, m_void, segs=14, rings=10))
    return parts


def emblem_pearococo(sign):
    """Driver 9 (Pearococo): Rococo royal crown + iridescent peacock feather eye."""
    m_gold = mat("GoldCrest", "#f5ce68", roughness=0.18, metallic=0.94, emission=0.25, emission_color="#ffd875")
    m_rose = mat("RoseGold", "#f296c2", roughness=0.22, metallic=0.75, emission=0.35, emission_color="#ff9ece")
    m_sapphire = mat("PeacockBlue", "#1c5ef2", roughness=0.16, metallic=0.5, emission=0.85, emission_color="#2a74ff")
    m_emerald = mat("PeacockGreen", "#1de0a0", roughness=0.2, metallic=0.55, emission=0.55, emission_color="#1de0a0")
    z = sign * EMBLEM_Z
    parts = []
    # Crown base band
    parts.append(box(0.0, EMBLEM_Y - 0.24, z + sign * 0.03, 0.64, 0.12, 0.055, m_gold, bevel=0.012))
    # 3 regal crown spires + pearl tips
    for sx, h, tilt in ((-0.26, 0.34, 0.26), (0.0, 0.46, 0.0), (0.26, 0.34, -0.26)):
        parts.append(cone(sx, EMBLEM_Y - 0.18 + h * 0.5, z + sign * 0.03, 0.11, 0.025, h, m_gold, verts=8, rot=(0, tilt, 0)))
        parts.append(sphere(sx - math.sin(tilt) * h * 0.45, EMBLEM_Y - 0.16 + h, z + sign * 0.038, 0.058, 0.058, 0.045, m_rose, segs=10, rings=8))
    # Peacock feather eye medallion nested at crown center
    parts.append(sphere(0.0, EMBLEM_Y + 0.02, z + sign * 0.042, 0.14, 0.18, 0.04, m_emerald, segs=14, rings=10))
    parts.append(sphere(0.0, EMBLEM_Y + 0.02, z + sign * 0.058, 0.08, 0.11, 0.032, m_sapphire, segs=12, rings=8))
    return parts


def emblem_yuda(sign):
    """Driver 10 (Master-Yuda): Blazing Ring of Fire + winged biker shades."""
    m_fire = mat("RingFire", "#ff7426", roughness=0.2, metallic=0.3, emission=1.35, emission_color="#ff8a38")
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.25, emission_color="#f7d678")
    m_lens = mat("ShadesDark", "#101822", roughness=0.08, metallic=0.92, coat=0.4)
    z = sign * EMBLEM_Z
    parts = []
    # Blazing Ring of Fire halo + flame licks
    parts.append(torus_ring(0.0, EMBLEM_Y, z + sign * 0.02, 0.41, 0.048, m_fire, major_segs=28, minor_segs=10))
    for i in range(8):
        ang = i * math.pi / 4.0
        parts.append(cone(math.sin(ang) * 0.47, EMBLEM_Y + math.cos(ang) * 0.47, z + sign * 0.02, 0.065, 0.008, 0.14, m_fire, verts=6, rot=(0, -ang, 0)))
    # Iconic biker shades (dark mirror lenses + gold bridge + swept frames)
    for sx in (-1, 1):
        parts.append(box(sx * 0.19, EMBLEM_Y + 0.01, z + sign * 0.045, 0.25, 0.16, 0.045, m_lens, bevel=0.018))
        parts.append(box(sx * 0.19, EMBLEM_Y + 0.095, z + sign * 0.052, 0.28, 0.032, 0.04, m_gold, bevel=0.006))
        # Swept silver-gold biker wing tips
        parts.append(box(sx * 0.36, EMBLEM_Y + 0.06, z + sign * 0.035, 0.16, 0.045, 0.03, m_gold, bevel=0.005, rot=(0, -sx * 0.32, 0)))
    parts.append(box(0.0, EMBLEM_Y + 0.075, z + sign * 0.052, 0.14, 0.035, 0.04, m_gold, bevel=0.005))
    return parts


def emblem_ryeah(sign):
    """Driver 11 (R-yeah): Authentic torch crest from characters/r-yeah/r-yeah-logo.js in gold frame."""
    source = open(LOGO_PATH, encoding="utf-8").read()
    runs = json.loads(re.search(r"logoRuns\s*=\s*(\[.*\]);", source, re.S).group(1))
    crest_mats = [
        mat("RyeahRed", "#d61224", roughness=0.30, metallic=0.1, emission=0.25, emission_color="#e82436"),
        mat("RyeahBlack", "#0d0d10", roughness=0.35, metallic=0.2),
        mat("RyeahGrey", "#c2c7cc", roughness=0.28, metallic=0.45),
        mat("RyeahWhite", "#ffffff", roughness=0.24, metallic=0.1, emission=0.18, emission_color="#ffffff"),
    ]
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.28, emission_color="#f7d678")
    z = sign * EMBLEM_Z
    parts = []
    # Circular gold heraldic bezel around the authentic torch crest
    parts.append(torus_ring(0.0, EMBLEM_Y, z + sign * 0.025, 0.45, 0.042, m_gold, major_segs=32, minor_segs=10))
    span = 0.74
    z_face = z + sign * 0.035
    for idx, m_c in enumerate(crest_mats):
        bm = bmesh.new()
        for row, left, right, look in runs:
            if look != idx:
                continue
            u0 = (left / 128.0 - 0.5) * span * sign
            u1 = (right / 128.0 - 0.5) * span * sign
            v0 = EMBLEM_Y + (0.5 - row / 128.0) * span
            v1 = EMBLEM_Y + (0.5 - (row + 1) / 128.0) * span
            verts = [
                bm.verts.new(loc(u0, v0, z_face)),
                bm.verts.new(loc(u1, v0, z_face)),
                bm.verts.new(loc(u1, v1, z_face)),
                bm.verts.new(loc(u0, v1, z_face)),
            ]
            bm.faces.new(verts if sign > 0 else list(reversed(verts)))
        if len(bm.faces) > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            mesh = bpy.data.meshes.new(f"RyeahCrest_{idx}_{int(sign)}")
            bm.to_mesh(mesh)
            bm.free()
            obj = bpy.data.objects.new(mesh.name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(m_c)
            parts.append(obj)
        else:
            bm.free()
    return parts


def emblem_catheterpillar(sign):
    """Driver 12 (Catheterpillar): Winged butterfly heart (Six-Heart Recovery)."""
    m_heart = mat("NurseHeart", "#ef3666", roughness=0.22, metallic=0.2, emission=0.65, emission_color="#ff4a7a")
    m_wing = mat("ButterflyPink", "#f7a8d4", roughness=0.28, metallic=0.35, emission=0.32, emission_color="#ffb8e0")
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.25, emission_color="#f7d678")
    z = sign * EMBLEM_Z
    parts = []
    # Graceful left & right butterfly wings
    for sx in (-1, 1):
        parts.append(sphere(sx * 0.30, EMBLEM_Y + 0.14, z + sign * 0.02, 0.22, 0.18, 0.03, m_wing, segs=14, rings=10, rot=(0, -sx * 0.35, 0)))
        parts.append(sphere(sx * 0.24, EMBLEM_Y - 0.12, z + sign * 0.018, 0.15, 0.14, 0.028, m_wing, segs=12, rings=8, rot=(0, sx * 0.25, 0)))
    # Sculpted plump heart at center
    for sx in (-1, 1):
        parts.append(sphere(sx * 0.11, EMBLEM_Y + 0.09, z + sign * 0.045, 0.14, 0.14, 0.065, m_heart, segs=14, rings=10))
    parts.append(cone(0.0, EMBLEM_Y - 0.10, z + sign * 0.045, 0.21, 0.01, 0.30, m_heart, verts=14, rot=(0, math.pi, 0)))
    # Subtle golden halo above the heart
    parts.append(torus_ring(0.0, EMBLEM_Y + 0.34, z + sign * 0.035, 0.16, 0.024, m_gold, rot=(1.1, 0.0, 0.0)))
    return parts


def emblem_fourmidable(sign):
    """Driver 13 (Fourmidable): Golden Tax-Audit '%' seal & balance beam."""
    m_gold = mat("GoldCrest", "#f5ce68", roughness=0.18, metallic=0.94, emission=0.30, emission_color="#ffd875")
    m_copper = mat("AuditCopper", "#d97a5e", roughness=0.28, metallic=0.82, emission=0.18, emission_color="#e88a6e")
    z = sign * EMBLEM_Z
    parts = []
    # Precision copper-gold audit ring
    parts.append(torus_ring(0.0, EMBLEM_Y, z + sign * 0.02, 0.44, 0.036, m_copper, major_segs=32, minor_segs=10))
    # Crisp 3D '%' symbol (diagonal '/' slash + two embossed rings on opposite sides)
    parts.append(box(0.0, EMBLEM_Y, z + sign * 0.042, 0.075, 0.62, 0.05, m_gold, bevel=0.01, rot=(0, sign * 0.56, 0)))
    parts.append(torus_ring(-sign * 0.19, EMBLEM_Y + 0.17, z + sign * 0.042, 0.105, 0.036, m_gold, major_segs=20, minor_segs=8))
    parts.append(torus_ring(sign * 0.19, EMBLEM_Y - 0.17, z + sign * 0.042, 0.105, 0.036, m_gold, major_segs=20, minor_segs=8))
    return parts


def emblem_knowitowl(sign):
    """Driver 14 (KnowItOwl): Luminous X-ray owl eyes & dark-humor violet crescent."""
    m_violet = mat("DarkHumorViolet", "#9852ff", roughness=0.2, metallic=0.4, emission=1.1, emission_color="#a864ff")
    m_eye = mat("XrayEye", "#fff39c", roughness=0.12, metallic=0.2, emission=1.55, emission_color="#fff08a")
    m_silver = mat("OwlSilver", "#e4ecf5", roughness=0.26, metallic=0.82)
    m_pupil = mat("OwlPupil", "#140826", roughness=0.1, metallic=0.6)
    z = sign * EMBLEM_Z
    parts = []
    # Violet crescent moon arc crowning the eyes
    for i in range(9):
        a = -math.pi * 0.52 + i * (math.pi * 1.04 / 8.0)
        taper = 1.0 - abs(i - 4) / 5.0
        parts.append(sphere(math.sin(a) * 0.36, EMBLEM_Y + 0.14 + math.cos(a) * 0.24, z + sign * 0.025, 0.055 * taper + 0.02, 0.055 * taper + 0.02, 0.035, m_violet, segs=10, rings=8))
    # Twin glowing X-ray owl eyes + brow tufts
    for sx in (-1, 1):
        parts.append(torus_ring(sx * 0.19, EMBLEM_Y - 0.04, z + sign * 0.032, 0.145, 0.028, m_silver, major_segs=20, minor_segs=8))
        parts.append(sphere(sx * 0.19, EMBLEM_Y - 0.04, z + sign * 0.036, 0.125, 0.125, 0.04, m_eye, segs=14, rings=10))
        parts.append(sphere(sx * 0.19, EMBLEM_Y - 0.04, z + sign * 0.056, 0.048, 0.075, 0.025, m_pupil, segs=10, rings=8))
        parts.append(box(sx * 0.24, EMBLEM_Y + 0.12, z + sign * 0.04, 0.22, 0.042, 0.035, m_silver, bevel=0.006, rot=(0, -sx * 0.32, 0)))
    # Sharp golden-silver owl beak below eyes
    parts.append(cone(0.0, EMBLEM_Y - 0.24, z + sign * 0.045, 0.08, 0.01, 0.18, m_silver, verts=6, rot=(0, math.pi, 0)))
    return parts


def emblem_tycoon(sign):
    """Driver 15 (Tai-Coon): Sculpted 3D Tai Chi Yin-Yang karmic medallion."""
    m_gold = mat("GoldCrest", "#f2cb63", roughness=0.20, metallic=0.92, emission=0.28, emission_color="#f7d678")
    m_jade = mat("KarmicJade", "#e6fff4", roughness=0.20, metallic=0.25, emission=0.55, emission_color="#b8ffe2")
    m_obsidian = mat("KarmicObsidian", "#152126", roughness=0.16, metallic=0.72, coat=0.3)
    z = sign * EMBLEM_Z
    parts = []
    R = 0.40
    # Outer gold karmic bezel
    parts.append(torus_ring(0.0, EMBLEM_Y, z + sign * 0.025, R + 0.03, 0.042, m_gold, major_segs=32, minor_segs=10))
    # Base obsidian disc + right-side jade half-disc + S-curve lobes + dots
    parts.append(cyl(0.0, EMBLEM_Y, z + sign * 0.022, R, 0.045, m_obsidian, verts=28, rot=(math.pi / 2, 0, 0)))
    # Jade semicircle (positive X half)
    semi = []
    segs = 18
    for i in range(segs + 1):
        a = -math.pi / 2 + i * math.pi / segs
        semi.append((math.cos(a) * R, EMBLEM_Y + math.sin(a) * R))
    parts.append(extruded_poly(semi, z + sign * 0.030, 0.038, m_jade, f"YangHalf_{int(sign)}", bevel=0.004))
    # Upper jade lobe + lower obsidian lobe forming the S-curve
    parts.append(cyl(0.0, EMBLEM_Y + R * 0.5, z + sign * 0.034, R * 0.5, 0.042, m_jade, verts=20, rot=(math.pi / 2, 0, 0)))
    parts.append(cyl(0.0, EMBLEM_Y - R * 0.5, z + sign * 0.036, R * 0.5, 0.046, m_obsidian, verts=20, rot=(math.pi / 2, 0, 0)))
    # Opposing dots
    parts.append(sphere(0.0, EMBLEM_Y + R * 0.5, z + sign * 0.056, 0.068, 0.068, 0.025, m_obsidian, segs=12, rings=8))
    parts.append(sphere(0.0, EMBLEM_Y - R * 0.5, z + sign * 0.058, 0.068, 0.068, 0.025, m_jade, segs=12, rings=8))
    return parts


EMBLEMS = [
    ("default", emblem_default, "EmblemDefault"),
    ("5", emblem_tammy, "EmblemTammy"),
    ("7", emblem_houston, "EmblemHouston"),
    ("8", emblem_avita, "EmblemAvita"),
    ("9", emblem_pearococo, "EmblemPearococo"),
    ("10", emblem_yuda, "EmblemYuda"),
    ("11", emblem_ryeah, "EmblemRyeah"),
    ("12", emblem_catheterpillar, "EmblemCatheterpillar"),
    ("13", emblem_fourmidable, "EmblemFourmidable"),
    ("14", emblem_knowitowl, "EmblemKnowItOwl"),
    ("15", emblem_tycoon, "EmblemTaiCoon"),
]


def build_all():
    build_base_shield()
    for key, fn, root_name in EMBLEMS:
        mirror_emblem(fn, f"hedgeguard_emblem_{key}.glb", root_name)


if __name__ == "__main__":
    build_all()
