"""Headless Blender 5.3 PBR generator for R-Yeah's Bell 206 JetRanger
(`ryeah_chopper.glb`): cream/livery/navy/gold body, smoked canopy, tubular
skids, the always-mounted belly Vulcan gimbal, and R-Yeah's torch crest on
both sides, taken from the same pixel runs the browser draws
(`characters/r-yeah/r-yeah-logo.js`). The rotors, the Vulcan barrels and the
lion are built by `build_ryeah.py`'s history and `build_ryeah.py`.

Run: /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_ryeah_chopper.py
"""
import json
import math
import os
import re
import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "models")
LOGO = os.path.join(ROOT, "..", "characters", "r-yeah", "r-yeah-logo.js")
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, color, metallic=0.0, roughness=0.45, emission=None, emission_strength=0.0, coat=0.0, alpha=1.0):
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
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    return mat


def add_obj(name, bm, mat, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def to_blender(x, y, z):
    """Convert Bevy/game (X right, Y up, Z forward) to Blender (X right, Y=-Z, Z=Y up)."""
    return Vector((x, -z, y))


def add_sphere(bm, center, rx, ry, rz, segs=16, rings=10, rot=None):
    m = Matrix.Translation(center)
    if rot is not None:
        m = m @ rot.to_4x4()
    m = m @ Matrix.Diagonal((rx, rz, ry, 1.0))  # note Blender Y=-Z, Z=Y
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)


def add_box(bm, center, sx, sy, sz, rot=None):
    m = Matrix.Translation(center)
    if rot is not None:
        m = m @ rot.to_4x4()
    m = m @ Matrix.Diagonal((sx, sz, sy, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def add_tube(bm, p0, p1, r0, r1=None, segs=10):
    if r1 is None:
        r1 = r0
    v0 = Vector(p0)
    v1 = Vector(p1)
    d = v1 - v0
    length = d.length
    if length < 1e-5:
        return
    mid = (v0 + v1) * 0.5
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    m = Matrix.Translation(mid) @ q.to_matrix().to_4x4()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=r0,
        radius2=r1,
        depth=length,
        matrix=m,
    )


def add_capsule(bm, p0, p1, r, segs=10):
    add_tube(bm, p0, p1, r, r, segs=segs)
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=6, radius=r, matrix=Matrix.Translation(p0))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=6, radius=r, matrix=Matrix.Translation(p1))


def mini_pt(x, y, z):
    """miniJetRanger transform from r-yeah.js: (1.3 + x*0.6, 4.5 + y*0.6, -0.4 + z*0.6)."""
    return to_blender(1.3 + x * 0.6, 4.5 + y * 0.6, -0.4 + z * 0.6)


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print(f"Exported {path} ({os.path.getsize(path) / 1024:.1f} KB)")


# The crest's colours in `ryeahLogo` (r-yeah.js), by palette index: name, sRGB, roughness.
CREST = [("CrestRed", "#d00019", 0.32), ("CrestBlack", "#050505", 0.34),
         ("CrestGrey", "#b2b2b2", 0.30), ("CrestWhite", "#ffffff", 0.28)]


def srgb(hex_color):
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)


def logo_runs():
    """[row, left, right, palette index] on a 128 by 128 grid, as the browser has them."""
    source = open(LOGO, encoding="utf-8").read()
    return json.loads(re.search(r"logoRuns\s*=\s*(\[.*\]);", source, re.S).group(1))


def add_crest():
    """One flat square per run, on a plane just outside each side of the aft
    cabin, mirrored so the crest reads the right way round from both sides."""
    runs = logo_runs()
    for index, (name, color, roughness) in enumerate(CREST):
        bm = bmesh.new()
        for side in (-1, 1):
            def point(u, v):
                return bm.verts.new(mini_pt(side * 1.245, 2.74 + (0.5 - v / 128) * 1.35,
                                            -1.2 - side * (u / 128 - 0.5) * 1.35))
            for row, left, right, look in runs:
                if look != index:
                    continue
                corners = [point(left, row), point(right, row), point(right, row + 1), point(left, row + 1)]
                # Face outward, away from the cabin.
                bm.faces.new(corners if side > 0 else corners[::-1])
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for face in bm.faces:
            if face.calc_center_median().x * face.normal.x < 0:
                face.normal_flip()
        add_obj(f"Bell206_{name}", bm, make_mat(name, srgb(color), metallic=0.05, roughness=roughness), smooth=False)


def build_chopper():
    clear_scene()
    s = 0.6

    mat_cream = make_mat("ChopperCream", (0.96, 0.91, 0.78), metallic=0.08, roughness=0.26, coat=0.65)
    mat_livery = make_mat("ChopperLivery", (0.78, 0.12, 0.16), metallic=0.35, roughness=0.24, coat=0.8)
    mat_navy = make_mat("ChopperNavy", (0.11, 0.19, 0.34), metallic=0.30, roughness=0.34, coat=0.45)
    mat_gold = make_mat("ChopperGold", (0.92, 0.70, 0.24), metallic=0.86, roughness=0.22)
    mat_chrome = make_mat("ChopperChrome", (0.78, 0.82, 0.86), metallic=0.92, roughness=0.18)
    mat_glass = make_mat("ChopperGlass", (0.06, 0.13, 0.22), metallic=0.15, roughness=0.08, coat=0.9)
    mat_exhaust = make_mat("ChopperExhaust", (0.28, 0.32, 0.40), metallic=0.88, roughness=0.32)
    mat_gunmetal = make_mat("VulcanGunmetal", (0.18, 0.22, 0.28), metallic=0.84, roughness=0.34)
    mat_brass = make_mat("VulcanBrass", (0.85, 0.68, 0.28), metallic=0.88, roughness=0.26)
    mat_beacon = make_mat("NavBeacon", (1.0, 0.15, 0.1), metallic=0.1, roughness=0.2, emission=(1.0, 0.18, 0.08), emission_strength=4.5)
    mat_headlamp = make_mat("NoseLamp", (0.95, 0.98, 1.0), metallic=0.1, roughness=0.15, emission=(0.95, 0.98, 1.0), emission_strength=5.0)

    # 1. Cream lower fuselage & upper turbine cowling
    bm_cream = bmesh.new()
    # Sleek Bell 206 teardrop lower hull
    add_sphere(bm_cream, mini_pt(0, 1.72, -0.10), 1.44 * s, 0.76 * s, 2.45 * s, segs=22, rings=12)
    # Upper turbine fairing & mast cowling
    add_sphere(bm_cream, mini_pt(0, 3.60, -1.00), 0.92 * s, 0.52 * s, 1.25 * s, segs=18, rings=10)
    # Cockpit windshield mullions (open front cockpit vibe + clean frame)
    for side in (-1, 1):
        add_capsule(bm_cream, mini_pt(side * 1.18, 2.08, 1.42), mini_pt(side * 1.08, 3.62, 0.65), 0.065 * s, segs=8)
        add_capsule(bm_cream, mini_pt(side * 1.08, 3.62, 0.65), mini_pt(side * 0.92, 3.82, -0.95), 0.065 * s, segs=8)
    # Horizontal tail stabilizer with endplates
    add_box(bm_cream, mini_pt(0, 3.05, -5.28), 2.70 * s, 0.10 * s, 0.64 * s)
    for side in (-1, 1):
        add_box(bm_cream, mini_pt(side * 1.36, 3.06, -5.28), 0.08 * s, 0.42 * s, 0.72 * s)
    add_obj("Bell206_Cream", bm_cream, mat_cream)

    # 2. Livery red/crimson nose cone, aft cabin, tapered tail boom & vertical fin
    bm_liv = bmesh.new()
    add_sphere(bm_liv, mini_pt(0, 1.80, 1.72), 1.22 * s, 0.48 * s, 0.92 * s, segs=18, rings=10)
    add_sphere(bm_liv, mini_pt(0, 2.75, -1.25), 1.22 * s, 0.76 * s, 1.12 * s, segs=18, rings=10)
    # Tapered tail boom
    add_tube(bm_liv, mini_pt(0, 2.48, -1.95), mini_pt(0, 3.06, -6.18), 0.44 * s, 0.18 * s, segs=12)
    # Swept Bell 206 vertical tail fin (upper & lower ventral fin)
    add_tube(bm_liv, mini_pt(0, 3.00, -5.85), mini_pt(0, 4.35, -6.22), 0.14 * s, 0.06 * s, segs=8)
    add_box(bm_liv, mini_pt(0, 3.58, -5.95), 0.11 * s, 1.35 * s, 0.85 * s, rot=Matrix.Rotation(math.radians(-18), 3, 'X'))
    add_box(bm_liv, mini_pt(0, 2.68, -6.00), 0.09 * s, 0.58 * s, 0.52 * s, rot=Matrix.Rotation(math.radians(16), 3, 'X'))
    add_obj("Bell206_Livery", bm_liv, mat_livery)

    # 3. Navy skids, instrument console & louvers
    bm_navy = bmesh.new()
    for side in (-1, 1):
        add_capsule(bm_navy, mini_pt(side * 1.65, 0.45, -2.55), mini_pt(side * 1.65, 0.45, 2.55), 0.12 * s, segs=10)
        add_capsule(bm_navy, mini_pt(side * 1.65, 0.45, 2.55), mini_pt(side * 1.65, 0.82, 2.95), 0.115 * s, segs=10)
        for i in range(4):
            add_box(bm_navy, mini_pt(side * 1.19, 2.22 + i * 0.12, -1.10), 0.06 * s, 0.045 * s, 0.68 * s)
    # Forward cockpit instrument glare-shield
    add_box(bm_navy, mini_pt(0, 2.08, 1.38), 1.92 * s, 0.30 * s, 0.34 * s)
    # Vulcan gimbal upper struts & side ammo drum
    for side in (-1, 1):
        add_tube(bm_navy, to_blender(1.3 + side * 0.32, 5.38, 0.85), to_blender(1.3 + side * 0.32, 4.62, 1.15), 0.085, 0.075, segs=8)
    add_box(bm_navy, to_blender(1.82, 4.38, 1.05), 0.40, 0.38, 0.62)
    add_obj("Bell206_Navy", bm_navy, mat_navy)

    # 4. Chrome skid struts & main rotor mast
    bm_chrome = bmesh.new()
    for side in (-1, 1):
        for z in (-1.35, 1.20):
            add_tube(bm_chrome, mini_pt(side * 1.65, 0.50, z), mini_pt(side * 0.88, 1.62, z), 0.095 * s, 0.085 * s, segs=8)
    # Main rotor mast shaft
    add_tube(bm_chrome, mini_pt(0, 3.85, -0.20), mini_pt(0, 6.18, -0.20), 0.12 * s, 0.10 * s, segs=12)
    add_obj("Bell206_Chrome", bm_chrome, mat_chrome)

    # 5. Gold accent beltline stripes & tail gearbox hub
    bm_gold = bmesh.new()
    for side in (-1, 1):
        add_box(bm_gold, mini_pt(side * 1.32, 2.08, -0.32), 0.10 * s, 0.16 * s, 2.85 * s)
        add_box(bm_gold, mini_pt(side * 0.25, 2.84, -3.95), 0.06 * s, 0.08 * s, 3.60 * s)
    add_sphere(bm_gold, mini_pt(0, 3.80, -6.10), 0.17 * s, 0.17 * s, 0.15 * s, segs=10, rings=6)
    add_obj("Bell206_Gold", bm_gold, mat_gold)

    # 6. Smoked glass side windows & windshield visor
    bm_glass = bmesh.new()
    for side in (-1, 1):
        add_box(bm_glass, mini_pt(side * 1.04, 2.72, -1.85), 0.14 * s, 0.48 * s, 0.88 * s)
    add_sphere(bm_glass, mini_pt(0, 2.95, 0.85), 1.08 * s, 0.62 * s, 0.92 * s, segs=16, rings=10)
    add_obj("Bell206_Glass", bm_glass, mat_glass)

    # 7. Heat-blued turbine exhausts
    bm_ex = bmesh.new()
    for side in (-1, 1):
        add_tube(bm_ex, mini_pt(side * 0.34, 3.66, -1.55), mini_pt(side * 0.42, 3.74, -2.22), 0.18 * s, 0.15 * s, segs=10)
    add_obj("Bell206_Exhaust", bm_ex, mat_exhaust)

    # 8. Always-mounted Vulcan gimbal turret housing & brass feed chute (under forward belly)
    bm_gun = bmesh.new()
    add_sphere(bm_gun, to_blender(1.3, 4.65, 1.15), 0.40, 0.30, 0.38, segs=14, rings=8)
    add_box(bm_gun, to_blender(1.3, 4.42, 1.32), 0.62, 0.46, 0.82)
    add_tube(bm_gun, to_blender(1.3, 4.56, 1.45), to_blender(1.3, 4.56, 1.72), 0.30, 0.28, segs=14)
    add_obj("Bell206_VulcanMount", bm_gun, mat_gunmetal)

    bm_brass = bmesh.new()
    add_box(bm_brass, to_blender(1.62, 4.46, 1.15), 0.24, 0.16, 0.32)
    add_obj("Bell206_AmmoChute", bm_brass, mat_brass)

    # 9. R-Yeah's torch crest on both sides of the aft cabin, exactly as the
    # browser draws it: one flat square per run of `logoRuns`.
    add_crest()

    # 10. Glowing tail anti-collision beacon & nose landing lamp
    bm_beacon = bmesh.new()
    add_sphere(bm_beacon, mini_pt(0, 4.38, -6.22), 0.12 * s, 0.12 * s, 0.12 * s, segs=10, rings=6)
    add_obj("Bell206_Beacon", bm_beacon, mat_beacon)

    bm_lamp = bmesh.new()
    add_sphere(bm_lamp, mini_pt(0, 1.65, 2.52), 0.16 * s, 0.14 * s, 0.10 * s, segs=10, rings=6)
    add_obj("Bell206_Lamp", bm_lamp, mat_headlamp)

    export_glb("ryeah_chopper.glb")


if __name__ == "__main__":
    build_chopper()
