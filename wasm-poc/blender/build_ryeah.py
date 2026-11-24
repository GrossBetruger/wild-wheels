"""Headless Blender 5.3 PBR generator for R-Yeah (#11):
- Bell 206 JetRanger helicopter (cream/royal-navy/gold livery, smoked canopy,
  R-Yeah circular crest on both sides, tubular skids, always-mounted belly Vulcan gimbal)
- Spinning main rotor (navy blades w/ gold tips) & tail rotor
- Spinning 6-barrel rotary M134/M61 Vulcan barrel cluster (muzzle at local (1.3, 4.56, 3.00))
- Heroic hanging lion pilot gripping the left skid (golden fur, cream muzzle, fierce brows,
  expressive smile, black kippah, inner mane collar)
- Sculpted curved flowing mane lock (instanced in 36 layered dynamic rings in Bevy!)

Run: /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_ryeah.py
"""
import math
import os
import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "models")
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


def hanging_pt(x, y, z):
    """hangingLion transform from r-yeah.js, nudged slightly left/down so the lion's
    kippah and head clear the always-mounted Bell 206 Vulcan pod with zero clipping."""
    c, s = math.cos(0.27), math.sin(0.27)
    cp, sp = math.cos(0.18), math.sin(0.18)
    x += 0.85
    y -= 5.15
    xx = x * c - y * s
    yy = x * s + y * c
    gx = 0.05 + xx
    gy = 4.48 + yy * cp - z * sp
    gz = 0.05 + yy * sp + z * cp
    return to_blender(gx, gy, gz)


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print(f"Exported {path} ({os.path.getsize(path) / 1024:.1f} KB)")


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
    mat_red = make_mat("CrestRed", (0.82, 0.04, 0.08), metallic=0.12, roughness=0.30)
    mat_black = make_mat("CrestBlack", (0.04, 0.04, 0.05), metallic=0.15, roughness=0.32)
    mat_white = make_mat("CrestWhite", (0.96, 0.96, 0.96), metallic=0.05, roughness=0.28)
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

    # 9. R-Yeah iconic circular crest on both sides of the aft cabin (red outer ring, white field, black lion/crest center)
    bm_crest_r = bmesh.new()
    bm_crest_w = bmesh.new()
    bm_crest_b = bmesh.new()
    for side in (-1, 1):
        cx = side * 1.24
        add_sphere(bm_crest_r, mini_pt(cx, 2.74, -1.20), 0.04 * s, 0.56 * s, 0.56 * s, segs=16, rings=8)
        add_sphere(bm_crest_w, mini_pt(cx + side * 0.025, 2.74, -1.20), 0.03 * s, 0.43 * s, 0.43 * s, segs=16, rings=8)
        add_sphere(bm_crest_b, mini_pt(cx + side * 0.045, 2.74, -1.20), 0.025 * s, 0.26 * s, 0.26 * s, segs=12, rings=6)
    add_obj("Bell206_CrestRed", bm_crest_r, mat_red)
    add_obj("Bell206_CrestWhite", bm_crest_w, mat_white)
    add_obj("Bell206_CrestBlack", bm_crest_b, mat_black)

    # 10. Glowing tail anti-collision beacon & nose landing lamp
    bm_beacon = bmesh.new()
    add_sphere(bm_beacon, mini_pt(0, 4.38, -6.22), 0.12 * s, 0.12 * s, 0.12 * s, segs=10, rings=6)
    add_obj("Bell206_Beacon", bm_beacon, mat_beacon)

    bm_lamp = bmesh.new()
    add_sphere(bm_lamp, mini_pt(0, 1.65, 2.52), 0.16 * s, 0.14 * s, 0.10 * s, segs=10, rings=6)
    add_obj("Bell206_Lamp", bm_lamp, mat_headlamp)

    export_glb("ryeah_chopper.glb")


def build_main_rotor():
    clear_scene()
    s = 0.6
    mat_hub = make_mat("RotorHub", (0.35, 0.42, 0.48), metallic=0.88, roughness=0.28)
    mat_blade = make_mat("RotorBlade", (0.10, 0.16, 0.28), metallic=0.35, roughness=0.32)
    mat_tip = make_mat("RotorTipGold", (0.95, 0.74, 0.22), metallic=0.65, roughness=0.25)

    bm_hub = bmesh.new()
    add_sphere(bm_hub, Vector((0, 0, 0)), 0.30 * s, 0.16 * s, 0.30 * s, segs=14, rings=8)
    add_box(bm_hub, Vector((0, 0, 0.05 * s)), 0.90 * s, 0.10 * s, 0.24 * s)
    add_obj("MainRotor_Hub", bm_hub, mat_hub)

    bm_blade = bmesh.new()
    bm_tip = bmesh.new()
    for side in (-1, 1):
        add_box(bm_blade, to_blender(side * 2.25 * s, 0.0, 0.0), 4.00 * s, 0.045 * s, 0.32 * s)
        add_box(bm_tip, to_blender(side * 4.48 * s, 0.0, 0.0), 0.52 * s, 0.048 * s, 0.33 * s)
    add_obj("MainRotor_Blades", bm_blade, mat_blade)
    add_obj("MainRotor_Tips", bm_tip, mat_tip)

    export_glb("ryeah_main_rotor.glb")


def build_tail_rotor():
    clear_scene()
    s = 0.6
    mat_hub = make_mat("TailHub", (0.88, 0.68, 0.22), metallic=0.85, roughness=0.25)
    mat_blade = make_mat("TailBlade", (0.95, 0.91, 0.80), metallic=0.15, roughness=0.32)
    mat_tip = make_mat("TailTipRed", (0.85, 0.12, 0.14), metallic=0.2, roughness=0.3)

    bm_hub = bmesh.new()
    add_sphere(bm_hub, Vector((0, 0, 0)), 0.12 * s, 0.14 * s, 0.14 * s, segs=10, rings=6)
    add_obj("TailRotor_Hub", bm_hub, mat_hub)

    bm_b = bmesh.new()
    bm_t = bmesh.new()
    for side in (-1, 1):
        add_box(bm_b, to_blender(0.0, side * 0.48 * s, 0.0), 0.04 * s, 0.78 * s, 0.15 * s)
        add_box(bm_t, to_blender(0.0, side * 0.95 * s, 0.0), 0.045 * s, 0.20 * s, 0.16 * s)
    add_obj("TailRotor_Blades", bm_b, mat_blade)
    add_obj("TailRotor_Tips", bm_t, mat_tip)

    export_glb("ryeah_tail_rotor.glb")


def build_vulcan_barrels():
    """6-barrel rotary cluster pivoted at (0, 0, 0); barrels extend along +Z (Blender -Y) to +1.50."""
    clear_scene()
    mat_steel = make_mat("BarrelSteel", (0.48, 0.54, 0.60), metallic=0.92, roughness=0.24)
    mat_clamp = make_mat("BarrelClamp", (0.22, 0.28, 0.34), metallic=0.88, roughness=0.32)
    mat_bore = make_mat("BarrelBore", (0.04, 0.05, 0.07), metallic=0.5, roughness=0.6)

    bm_steel = bmesh.new()
    bm_bore = bmesh.new()
    for i in range(6):
        a = i * math.tau / 6.0
        bx = math.sin(a) * 0.20
        by = math.cos(a) * 0.20
        add_tube(bm_steel, to_blender(bx, by, 0.0), to_blender(bx, by, 1.50), 0.062, 0.056, segs=8)
        add_sphere(bm_bore, to_blender(bx, by, 1.51), 0.044, 0.044, 0.02, segs=8, rings=4)
    # Central drive shaft
    add_tube(bm_steel, to_blender(0, 0, 0.0), to_blender(0, 0, 1.38), 0.07, 0.06, segs=8)
    add_obj("Vulcan_Barrels", bm_steel, mat_steel)
    add_obj("Vulcan_Bores", bm_bore, mat_bore)

    bm_clamp = bmesh.new()
    for z in (0.30, 0.90, 1.35):
        add_tube(bm_clamp, to_blender(0, 0, z - 0.045), to_blender(0, 0, z + 0.045), 0.28, 0.28, segs=14)
    add_obj("Vulcan_Clamps", bm_clamp, mat_clamp)

    export_glb("ryeah_vulcan_barrels.glb")


def build_lion():
    """Heroic hanging lion pilot in hangingLion pose gripping the Bell 206 left skid."""
    clear_scene()
    # Rich linear-space warm golden-amber lion palette
    mat_gold = make_mat("LionFurGold", (0.76, 0.42, 0.08), metallic=0.02, roughness=0.68)
    mat_cream = make_mat("LionMuzzleCream", (0.94, 0.78, 0.48), metallic=0.02, roughness=0.62)
    mat_mane = make_mat("LionInnerMane", (0.34, 0.12, 0.03), metallic=0.02, roughness=0.72)
    mat_ear = make_mat("LionInnerEar", (0.58, 0.28, 0.12), metallic=0.0, roughness=0.72)
    mat_nose = make_mat("LionNose", (0.09, 0.05, 0.07), metallic=0.06, roughness=0.30)
    mat_eye_w = make_mat("LionEyeWhite", (0.98, 0.96, 0.90), metallic=0.0, roughness=0.20)
    mat_eye_p = make_mat("LionPupil", (0.04, 0.10, 0.08), metallic=0.1, roughness=0.10, coat=0.85)
    mat_mouth = make_mat("LionMouth", (0.32, 0.07, 0.08), metallic=0.0, roughness=0.42)
    mat_kippah = make_mat("LionKippah", (0.03, 0.035, 0.05), metallic=0.04, roughness=0.76)
    mat_kippah_btn = make_mat("LionKippahBtn", (0.14, 0.16, 0.20), metallic=0.20, roughness=0.50)

    bm_gold = bmesh.new()
    bm_cream = bmesh.new()
    bm_mane = bmesh.new()
    bm_ear = bmesh.new()
    bm_nose = bmesh.new()
    bm_ew = bmesh.new()
    bm_ep = bmesh.new()
    bm_mouth = bmesh.new()
    bm_kip = bmesh.new()
    bm_kbtn = bmesh.new()

    # Torso & chest
    add_sphere(bm_gold, hanging_pt(0, 2.58, 0.20), 0.72, 0.84, 0.62, segs=18, rings=10)
    add_sphere(bm_cream, hanging_pt(0, 2.50, 0.62), 0.44, 0.56, 0.24, segs=12, rings=8)

    # Dangling athletic legs & paws
    for side in (-1, 1):
        add_capsule(bm_gold, hanging_pt(side * 0.38, 2.15, 0.18), hanging_pt(side * 0.44, 1.12, 0.34 + side * 0.10), 0.22, segs=10)
        add_sphere(bm_gold, hanging_pt(side * 0.45, 0.96, 0.52 + side * 0.10), 0.30, 0.23, 0.40, segs=12, rings=8)

    # Left arm gripping the Bell 206 left skid firmly at (0.31, 4.77, 0.70)
    left_grip_w = to_blender(0.31, 4.77, 0.70)
    add_capsule(bm_gold, hanging_pt(-0.60, 2.85, 0.30), left_grip_w, 0.21, segs=10)
    add_sphere(bm_gold, left_grip_w, 0.27, 0.25, 0.25, segs=12, rings=8)
    for finger in range(3):
        add_sphere(bm_cream, to_blender(0.31 + (finger - 1) * 0.10, 4.88, 0.77), 0.065, 0.10, 0.09, segs=8, rings=5)

    # Right arm raised heroically / ready to grip
    right_hand = hanging_pt(0.92, 3.35, 0.95)
    add_capsule(bm_gold, hanging_pt(0.60, 2.85, 0.30), right_hand, 0.20, segs=10)
    add_sphere(bm_gold, right_hand, 0.26, 0.25, 0.24, segs=12, rings=8)

    # Sculpted lion tail trailing behind torso with fluffy dark tuft
    tail_pts = [
        hanging_pt(0.0, 2.10, -0.32),
        hanging_pt(-0.18, 1.80, -0.95),
        hanging_pt(-0.30, 1.68, -1.55),
    ]
    add_capsule(bm_gold, tail_pts[0], tail_pts[1], 0.095, segs=8)
    add_capsule(bm_gold, tail_pts[1], tail_pts[2], 0.085, segs=8)
    add_sphere(bm_mane, tail_pts[2] + Vector((0, 0.20, -0.04)), 0.20, 0.22, 0.30, segs=12, rings=8)

    # Head & expressive lion face
    add_sphere(bm_gold, hanging_pt(0, 4.05, 0.65), 0.80, 0.80, 0.68, segs=20, rings=12)
    # Lush inner mane ruff collar snugly framing the face so zero bald spots ever show
    add_sphere(bm_mane, hanging_pt(0, 4.02, 0.34), 1.02, 1.04, 0.72, segs=20, rings=12)

    for side in (-1, 1):
        # Rounded lion ears
        add_sphere(bm_gold, hanging_pt(side * 0.66, 4.74, 0.48), 0.27, 0.28, 0.18, segs=12, rings=8)
        add_sphere(bm_ear, hanging_pt(side * 0.66, 4.74, 0.62), 0.15, 0.16, 0.06, segs=10, rings=6)
        # Bright eyes & pupils
        add_sphere(bm_ew, hanging_pt(side * 0.30, 4.24, 1.22), 0.16, 0.19, 0.07, segs=10, rings=6)
        add_sphere(bm_ep, hanging_pt(side * 0.30, 4.25, 1.28), 0.075, 0.11, 0.04, segs=10, rings=6)
        # Cream muzzle cheeks & whiskers
        add_sphere(bm_cream, hanging_pt(side * 0.24, 3.86, 1.27), 0.29, 0.23, 0.23, segs=12, rings=8)
        # Proud thick lion brows
        add_box(bm_mane, hanging_pt(side * 0.32, 4.48, 1.20), 0.36, 0.075, 0.08)

    # Dark lion nose & proud smile
    add_sphere(bm_nose, hanging_pt(0, 4.02, 1.45), 0.17, 0.12, 0.12, segs=12, rings=8)
    add_sphere(bm_mouth, hanging_pt(0, 3.63, 1.18), 0.30, 0.08, 0.11, segs=12, rings=6)

    # Iconic black kippah on top of R-Yeah's head
    add_sphere(bm_kip, hanging_pt(0, 4.92, 0.58), 0.41, 0.14, 0.35, segs=16, rings=8)
    add_sphere(bm_kbtn, hanging_pt(0, 5.04, 0.58), 0.055, 0.025, 0.055, segs=8, rings=4)

    add_obj("Lion_Gold", bm_gold, mat_gold)
    add_obj("Lion_Cream", bm_cream, mat_cream)
    add_obj("Lion_InnerMane", bm_mane, mat_mane)
    add_obj("Lion_InnerEar", bm_ear, mat_ear)
    add_obj("Lion_Nose", bm_nose, mat_nose)
    add_obj("Lion_EyeWhite", bm_ew, mat_eye_w)
    add_obj("Lion_Pupil", bm_ep, mat_eye_p)
    add_obj("Lion_Mouth", bm_mouth, mat_mouth)
    add_obj("Lion_Kippah", bm_kip, mat_kippah)
    add_obj("Lion_KippahBtn", bm_kbtn, mat_kippah_btn)

    export_glb("ryeah_lion.glb")


def build_mane_lock():
    """Single sculpted, long silky S-curved mane lock rooted at (0, 0, 0),
    extending backward along -Z (Blender +Y) with flowing wave taper.
    Bevy instances 44 of these in 4 concentric rings around R-Yeah's head with
    live multi-frequency wind/downwash/boost animation and 4 rich golden-russet PBR shades!"""
    clear_scene()
    mat_lock = make_mat("ManeLock", (0.52, 0.20, 0.04), metallic=0.05, roughness=0.52, coat=0.30)

    bm = bmesh.new()
    # 7 cross-section rings for a silky, flowing S-wave lock (1.65 units long)
    steps = [
        # (z_game, y_curve, rx, ry)
        (0.00,   0.00, 0.22, 0.20),
        (-0.26,  0.07, 0.25, 0.22),
        (-0.56,  0.04, 0.22, 0.19),
        (-0.88, -0.05, 0.17, 0.14),
        (-1.18, -0.08, 0.11, 0.09),
        (-1.44, -0.02, 0.055, 0.045),
        (-1.62,  0.02, 0.018, 0.016),
    ]
    segs = 8
    rings = []
    for gz, gy, rx, ry in steps:
        ring = []
        for k in range(segs):
            a = k * math.tau / segs
            pinch = 1.07 if k % 2 == 0 else 0.93
            vx = math.cos(a) * rx * pinch
            vy = gy + math.sin(a) * ry * pinch
            ring.append(bm.verts.new(to_blender(vx, vy, gz)))
        rings.append(ring)

    bm.faces.new(list(reversed(rings[0])))
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for k in range(segs):
            kn = (k + 1) % segs
            bm.faces.new((r0[k], r0[kn], r1[kn], r1[k]))
    tip = bm.verts.new(to_blender(0.0, 0.03, -1.70))
    for k in range(segs):
        kn = (k + 1) % segs
        bm.faces.new((rings[-1][k], rings[-1][kn], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    add_obj("ManeLock", bm, mat_lock)
    export_glb("ryeah_mane_lock.glb")


def render_preview():
    clear_scene()
    for name, offset in [
        ("ryeah_chopper.glb", (0, 0, 0)),
        ("ryeah_main_rotor.glb", (1.3, 4.5 + 6.15 * 0.6, -0.4 - 0.2 * 0.6)),
        ("ryeah_tail_rotor.glb", (1.3 + 0.26 * 0.6, 4.5 + 3.8 * 0.6, -0.4 - 6.1 * 0.6)),
        ("ryeah_vulcan_barrels.glb", (1.3, 4.56, 1.50)),
        ("ryeah_lion.glb", (0, 0, 0)),
    ]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT_DIR, name))
        added = [o for o in bpy.data.objects if o not in before and o.parent is None]
        bx, by, bz = to_blender(*offset)
        for o in added:
            o.location = (bx, by, bz)

    # Add a ring of mane locks to preview the lush mane silhouette
    mane_center = hanging_pt(0, 4.02, 0.30)
    for row in range(3):
        count = 10 + row * 4
        rad = 0.45 + row * 0.26
        for i in range(count):
            a = i * math.tau / count + row * 0.35
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.join(OUT_DIR, "ryeah_mane_lock.glb"))
            added = [o for o in bpy.data.objects if o not in before and o.parent is None]
            for o in added:
                o.location = mane_center + Vector((math.sin(a) * rad, 0.25 + row * 0.12, math.cos(a) * rad))
                o.rotation_euler = (math.radians(-10 + row * 6), 0.0, math.radians(-math.sin(a) * 18))

    # Camera & lighting (wider 3/4 hero shot showing full Bell 206 + Vulcan + hanging lion + mane)
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = to_blender(8.5, 7.6, 8.8)
    direction = to_blender(0.6, 4.4, -0.5) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam

    sun_data = bpy.data.lights.new("Sun", type='SUN')
    sun_data.energy = 3.5
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), math.radians(-20), math.radians(32))

    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.12, 0.16, 0.26, 1.0)
    bg.inputs[1].default_value = 0.8

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    out_img = "/Users/orenkoriat/.gemini/antigravity-cli/brain/7e29a728-e29b-408d-ad2f-f93959640962/scratch/ryeah_preview.png"
    scene.render.filepath = out_img
    bpy.ops.render.render(write_still=True)
    print(f"Rendered preview to {out_img}")


if __name__ == "__main__":
    build_chopper()
    build_main_rotor()
    build_tail_rotor()
    build_vulcan_barrels()
    build_lion()
    build_mane_lock()
    render_preview()
