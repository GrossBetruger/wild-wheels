"""
Build the 4 uplifted PBR arena powerup models for Wild Wheels:
  - pickup_missile.glb  : Sidewinder heat-seeker warhead (gunmetal fuselage,
                          crimson/gold hazard bands, ruby optical seeker dome,
                          swept cruciform fins + canards, brass nozzle core).
  - pickup_hedgehog.glb : Expressive spiky battle hedgehog (plump chestnut body,
                          cream snout & belly, glossy eyes + button nose, tiny
                          ears & paws, 32 layered two-tone tapered quills).
  - pickup_boost.glb    : Pressurized Nitrous / Turbo canister (metallic gold
                          cylinder, steel end-caps, brass valve wheel & gauge,
                          glowing plasma sight-glass, 3D lightning bolt badge).
  - pickup_health.glb   : Gleaming emerald-mint med-cross (chamfered satin-white
                          armored frame, luminous emerald core cross, metallic
                          silver bevel trim).

    /opt/homebrew/bin/blender --background --python wasm/blender/build_powerups.py -- wasm/assets/models
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Euler, Vector

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = sys.argv
OUT_DIR = argv[argv.index("--") + 1] if "--" in argv else os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)


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


def box(x, y, z, sx, sy, sz, m, bevel=0.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def sphere(x, y, z, rx, ry, rz, m, segs=20, rings=14, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def cyl(x, y, z, r, depth, m, verts=24, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cone(x, y, z, r1, r2, depth, m, verts=20, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def torus(x, y, z, major_r, minor_r, m, major_segs=24, minor_segs=10, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_r,
        minor_radius=minor_r,
        major_segments=major_segs,
        minor_segments=minor_segs,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj)


def finalize_and_export(parts, filename, root_name, post_rot=(0, 0, 0)):
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
    if any(abs(a) > 1e-6 for a in post_rot):
        merged.rotation_euler = Euler(post_rot, "XYZ")
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


def build_missile():
    """Uplifted Sidewinder heat-seeker missile pickup (angled heroically nose-up)."""
    reset_scene()
    m_body = mat("MissileBody", "#dfe5ec", roughness=0.28, metallic=0.68, coat=0.18)
    m_dark = mat("MissileGunmetal", "#2c3440", roughness=0.34, metallic=0.85)
    m_red = mat("MissileCrimson", "#d9352b", roughness=0.26, metallic=0.35, emission=0.18, emission_color="#ff4838", coat=0.25)
    m_gold = mat("MissileHazard", "#f2bc38", roughness=0.24, metallic=0.82)
    m_seeker = mat("MissileSeeker", "#ff3044", roughness=0.08, metallic=0.4, emission=1.6, emission_color="#ff4252", coat=0.6)
    m_ember = mat("MissileEmber", "#ff7a22", roughness=0.2, metallic=0.1, emission=2.0, emission_color="#ff8a2e")

    parts = []
    # Built along Bevy +Z (Blender -Y), then tilted nose-up by 24 deg at export.
    rx = math.pi / 2
    # Main fuselage cylinder
    parts.append(cyl(0.0, 0.0, 0.0, 0.30, 1.95, m_body, verts=24, rot=(rx, 0, 0)))
    # Crimson warhead band & hazard yellow stripe
    parts.append(cyl(0.0, 0.0, 0.56, 0.312, 0.34, m_red, verts=24, rot=(rx, 0, 0)))
    parts.append(cyl(0.0, 0.0, 0.28, 0.310, 0.14, m_gold, verts=24, rot=(rx, 0, 0)))
    parts.append(cyl(0.0, 0.0, -0.55, 0.308, 0.22, m_dark, verts=24, rot=(rx, 0, 0)))

    # Tapered nosecone + glowing ruby heat-seeker optical dome
    parts.append(cone(0.0, 0.0, 1.18, 0.30, 0.16, 0.44, m_red, verts=24, rot=(-rx, 0, 0)))
    parts.append(sphere(0.0, 0.0, 1.38, 0.165, 0.165, 0.20, m_seeker, segs=18, rings=12))
    parts.append(torus(0.0, 0.0, 1.32, 0.17, 0.022, m_dark, major_segs=20, minor_segs=8, rot=(rx, 0, 0)))

    # Aft rocket nozzle bell + glowing thruster ember core
    parts.append(cone(0.0, 0.0, -1.14, 0.26, 0.18, 0.34, m_dark, verts=20, rot=(-rx, 0, 0)))
    parts.append(sphere(0.0, 0.0, -1.24, 0.15, 0.15, 0.08, m_ember, segs=14, rings=8))

    # 4 swept cruciform tail fins + 4 forward steering canards
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        # Tail fin
        fin = box(ca * 0.46, sa * 0.46, -0.76, 0.46, 0.048, 0.54, m_red, bevel=0.01)
        fin.rotation_euler = Euler((0.0, a, 0.0), "XYZ")
        parts.append(fin)
        # Forward canard
        can = box(ca * 0.38, sa * 0.38, 0.64, 0.24, 0.036, 0.26, m_dark, bevel=0.008)
        can.rotation_euler = Euler((0.0, a, 0.0), "XYZ")
        parts.append(can)

    finalize_and_export(parts, "pickup_missile.glb", "PickupMissile", post_rot=(0.40, 0.0, 0.0))


def build_hedgehog():
    """Uplifted spiky battle hedgehog pickup with layered two-tone quills and expressive face."""
    reset_scene()
    m_fur = mat("HedgeBody", "#734a34", roughness=0.72, metallic=0.0)
    m_snout = mat("HedgeSnout", "#efd3a3", roughness=0.65, metallic=0.0)
    m_quill_dark = mat("HedgeQuillRoot", "#4a2f20", roughness=0.58, metallic=0.05)
    m_quill_tip = mat("HedgeQuillTip", "#e8c482", roughness=0.40, metallic=0.12, emission=0.08, emission_color="#f5d595")
    m_nose = mat("HedgeNose", "#1b2028", roughness=0.14, metallic=0.2, coat=0.5)
    m_eye = mat("HedgeEye", "#12161d", roughness=0.08, metallic=0.15, coat=0.7)
    m_glint = mat("HedgeGlint", "#ffffff", roughness=0.1, emission=1.2, emission_color="#ffffff")
    m_ear_in = mat("HedgeEarPink", "#df9a98", roughness=0.6)

    parts = []
    # Plump rounded hedgehog torso + warm cream belly
    parts.append(sphere(0.0, 0.0, -0.05, 0.88, 0.72, 0.96, m_fur, segs=22, rings=14))
    parts.append(sphere(0.0, -0.26, 0.14, 0.66, 0.44, 0.74, m_snout, segs=18, rings=12))

    # Expressive cream snout + shiny black button nose
    parts.append(sphere(0.0, -0.06, 0.84, 0.46, 0.36, 0.44, m_snout, segs=18, rings=12))
    parts.append(cone(0.0, -0.04, 1.10, 0.28, 0.09, 0.36, m_snout, verts=16, rot=(-math.pi / 2, 0, 0)))
    parts.append(sphere(0.0, 0.0, 1.28, 0.125, 0.11, 0.11, m_nose, segs=14, rings=10))

    # Glossy eyes with white catchlights + cute rounded ears + tucked paws
    for sx in (-1, 1):
        parts.append(sphere(sx * 0.25, 0.14, 0.96, 0.105, 0.115, 0.095, m_eye, segs=12, rings=8))
        parts.append(sphere(sx * 0.28, 0.19, 1.03, 0.032, 0.032, 0.025, m_glint, segs=8, rings=6))
        parts.append(sphere(sx * 0.42, 0.36, 0.54, 0.16, 0.18, 0.08, m_fur, segs=12, rings=8, rot=(0, 0, sx * 0.3)))
        parts.append(sphere(sx * 0.43, 0.35, 0.58, 0.10, 0.12, 0.05, m_ear_in, segs=10, rings=6, rot=(0, 0, sx * 0.3)))
        parts.append(sphere(sx * 0.44, -0.54, 0.48, 0.16, 0.11, 0.22, m_snout, segs=10, rings=8))
        parts.append(sphere(sx * 0.48, -0.54, -0.34, 0.18, 0.12, 0.24, m_snout, segs=10, rings=8))

    # Layered crown of 30 tapered two-tone quills radiating across the back & sides
    quill_rings = [
        (0.60, 0.42, 10, 0.58, 0.20),
        (0.42, 0.10, 12, 0.64, 0.19),
        (0.24, -0.22, 8, 0.56, 0.18),
    ]
    for ring_idx, (elev, z_bias, count, q_len, q_rad) in enumerate(quill_rings):
        for i in range(count):
            # Fan across the back & sides, leaving the front face clear
            ang = -math.pi * 0.78 + (i + 0.5) * (math.pi * 1.56 / count)
            dir_v = Vector((math.sin(ang) * math.cos(elev), math.sin(elev), -math.cos(ang) * math.cos(elev))).normalized()
            base_p = Vector((dir_v.x * 0.64, dir_v.y * 0.54 + 0.08, dir_v.z * 0.72 + z_bias * 0.4))
            mid_p = base_p + dir_v * (q_len * 0.45)
            tip_p = base_p + dir_v * (q_len * 0.92)
            # Align cone +Z (Blender up) along dir_v in Blender coords
            b_dir = Vector(loc(dir_v.x, dir_v.y, dir_v.z)).normalized()
            rot_q = Vector((0, 0, 1)).rotation_difference(b_dir).to_euler()
            parts.append(cone(mid_p.x, mid_p.y, mid_p.z, q_rad, q_rad * 0.45, q_len * 0.55, m_quill_dark, verts=7, rot=rot_q))
            parts.append(cone(tip_p.x, tip_p.y, tip_p.z, q_rad * 0.46, 0.012, q_len * 0.52, m_quill_tip, verts=7, rot=rot_q))

    finalize_and_export(parts, "pickup_hedgehog.glb", "PickupHedgehog")


def build_boost():
    """Uplifted pressurized Nitrous/Turbo canister with glowing plasma sight-glass & 3D lightning bolt."""
    reset_scene()
    m_gold = mat("BoostGold", "#f2b82e", roughness=0.22, metallic=0.88, coat=0.25)
    m_steel = mat("BoostSteel", "#cfd8e3", roughness=0.24, metallic=0.92)
    m_dark = mat("BoostCarbon", "#1c222c", roughness=0.38, metallic=0.55)
    m_plasma = mat("BoostPlasma", "#ffe866", roughness=0.12, metallic=0.1, emission=1.9, emission_color="#ffd842")
    m_cyan = mat("BoostCore", "#56f0ff", roughness=0.14, metallic=0.1, emission=1.5, emission_color="#56f0ff")

    parts = []
    # Main pressurized gold NOS cylinder + domed steel end-caps
    parts.append(cyl(0.0, -0.05, 0.0, 0.46, 1.32, m_gold, verts=28))
    parts.append(sphere(0.0, 0.61, 0.0, 0.46, 0.24, 0.46, m_gold, segs=24, rings=12))
    parts.append(sphere(0.0, -0.71, 0.0, 0.46, 0.18, 0.46, m_steel, segs=24, rings=10))
    # Forged carbon-steel clamping rings
    for y_band in (-0.52, 0.44):
        parts.append(torus(0.0, y_band, 0.0, 0.47, 0.045, m_dark, major_segs=28, minor_segs=10))
    # Glowing cyan plasma sight-glass collar around middle
    parts.append(cyl(0.0, -0.04, 0.0, 0.475, 0.22, m_dark, verts=28))
    parts.append(cyl(0.0, -0.04, 0.0, 0.485, 0.11, m_cyan, verts=28))

    # Top brass valve neck + red/gold handwheel
    parts.append(cyl(0.0, 0.90, 0.0, 0.13, 0.24, m_steel, verts=16))
    parts.append(torus(0.0, 1.05, 0.0, 0.22, 0.038, m_dark, major_segs=20, minor_segs=8))
    for i in range(4):
        a = i * math.pi / 2
        spoke = box(math.cos(a) * 0.11, 1.05, math.sin(a) * 0.11, 0.20, 0.032, 0.032, m_steel, bevel=0.005, rot=(0, 0, a))
        parts.append(spoke)

    # Bold sculpted 3D glowing lightning bolt on front (+Z) and back (-Z)
    for sign in (1.0, -1.0):
        z = sign * 0.50
        parts.append(box(sign * 0.06, 0.26, z, 0.16, 0.44, 0.075, m_plasma, bevel=0.012, rot=(0, -sign * 0.36, 0)))
        parts.append(box(0.0, 0.02, z, 0.34, 0.13, 0.075, m_plasma, bevel=0.012))
        parts.append(box(-sign * 0.06, -0.24, z, 0.15, 0.44, 0.075, m_plasma, bevel=0.012, rot=(0, -sign * 0.36, 0)))

    finalize_and_export(parts, "pickup_boost.glb", "PickupBoost", post_rot=(0.0, 0.0, -0.22))


def build_health():
    """Uplifted gleaming emerald-mint armored Med-Cross pickup."""
    reset_scene()
    m_white = mat("MedWhite", "#eef9f2", roughness=0.22, metallic=0.18, coat=0.35)
    m_emerald = mat("MedEmerald", "#2ce88c", roughness=0.18, metallic=0.25, emission=1.35, emission_color="#38f59a", coat=0.3)
    m_silver = mat("MedSilver", "#c8e6d8", roughness=0.22, metallic=0.88)

    parts = []
    # Sculpted chamfered white armored cross outer body
    parts.append(box(0.0, 0.0, 0.0, 1.66, 0.58, 0.42, m_white, bevel=0.055))
    parts.append(box(0.0, 0.0, 0.0, 0.58, 1.66, 0.42, m_white, bevel=0.055))

    # Brushed silver-mint outer armor collar caps at the 4 cross tips
    for sx in (-1, 1):
        parts.append(box(sx * 0.78, 0.0, 0.0, 0.16, 0.62, 0.46, m_silver, bevel=0.025))
    for sy in (-1, 1):
        parts.append(box(0.0, sy * 0.78, 0.0, 0.62, 0.16, 0.46, m_silver, bevel=0.025))

    # Recessed glowing emerald energy cross inlaid on both front (+Z) and back (-Z)
    for sign in (1.0, -1.0):
        z = sign * 0.21
        parts.append(box(0.0, 0.0, z, 1.24, 0.30, 0.06, m_emerald, bevel=0.018))
        parts.append(box(0.0, 0.0, z, 0.30, 1.24, 0.06, m_emerald, bevel=0.018))

    finalize_and_export(parts, "pickup_health.glb", "PickupHealth")


def build_all():
    build_missile()
    build_hedgehog()
    build_boost()
    build_health()


if __name__ == "__main__":
    build_all()
