"""Headless Blender 5.3 PBR generator for Pearococo (#9):
- Opulent Rococo royal chariot (porcelain cream, rose velvet seat, 24K gold scrollwork,
  strings of nacreous pearls, 9-fluted scallop-shell prow w/ amethyst cabochon)
- Spinning gilded carriage wheel (pearl rim, 10 tapered gold spokes, rose-gold hub)
- Her Majesty Pearococo (silk pink pannier gown w/ ivory lace, teal peacock neck/head,
  gold beak, powdered Rococo curls, pearl earrings & necklace, 8-point gold tiara)
- Articulated royal right wing/hand pivoted at shoulder for her regal celebration wave!

Run: /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_pearococo.py
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


def make_mat(name, color, metallic=0.0, roughness=0.4, coat=0.0, emission=None, emission_strength=0.0):
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
    return mat


def to_blender(x, y, z):
    """Game/Bevy (X right, Y up, Z forward) -> Blender (X right, Y=-Z, Z=Y up)."""
    return Vector((x, -z, y))


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


def add_sphere(bm, center, rx, ry, rz, segs=16, rings=10, rot=None):
    m = Matrix.Translation(center)
    if rot is not None:
        m = m @ rot.to_4x4()
    m = m @ Matrix.Diagonal((rx, rz, ry, 1.0))
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
    v0, v1 = Vector(p0), Vector(p1)
    d = v1 - v0
    length = d.length
    if length < 1e-5:
        return
    mid = (v0 + v1) * 0.5
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    m = Matrix.Translation(mid) @ q.to_matrix().to_4x4()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs,
        radius1=r0, radius2=r1, depth=length, matrix=m,
    )


def add_scroll(bm, x, y, z, side=1.0):
    """Elegant Baroque spiral filigree scroll built from smooth connected tubes."""
    pts = []
    for i in range(14):
        a = i * 0.38
        r = 0.48 * (1.0 - i / 18.0)
        pts.append(to_blender(x + side * math.cos(a) * r, y + math.sin(a) * r, z))
    for i in range(len(pts) - 1):
        r = 0.075 * (1.0 - i / 22.0)
        add_tube(bm, pts[i], pts[i + 1], r, r * 0.96, segs=7)
    add_sphere(bm, pts[-1], 0.065, 0.065, 0.065, segs=8, rings=5)


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print(f"Exported {path} ({os.path.getsize(path) / 1024:.1f} KB)")


def build_chariot():
    clear_scene()
    # Linear-space opulent Rococo palace materials
    mat_porcelain = make_mat("RococoPorcelain", (0.98, 0.90, 0.72), metallic=0.05, roughness=0.18, coat=0.95)
    mat_gold = make_mat("RococoGold24K", (0.92, 0.66, 0.20), metallic=0.94, roughness=0.16, coat=0.4)
    mat_velvet = make_mat("RococoVelvet", (0.58, 0.12, 0.34), metallic=0.04, roughness=0.76)
    mat_rose = make_mat("RococoRoseSilk", (0.90, 0.38, 0.62), metallic=0.12, roughness=0.28, coat=0.6)
    mat_pearl = make_mat("RococoPearl", (1.0, 0.97, 0.92), metallic=0.18, roughness=0.12, coat=1.0)
    mat_amethyst = make_mat(
        "RococoAmethyst", (0.68, 0.22, 0.72), metallic=0.22, roughness=0.08, coat=1.0,
        emission=(0.35, 0.08, 0.42), emission_strength=0.45,
    )

    bm_porc = bmesh.new()
    bm_gold = bmesh.new()
    bm_velv = bmesh.new()
    bm_rose = bmesh.new()
    bm_pearl = bmesh.new()
    bm_gem = bmesh.new()

    # Main porcelain hull (shifted +0.13 in Y matching renderer.js mesh.at(0, .13, 0))
    yo = 0.13
    add_sphere(bm_porc, to_blender(0, 0.96 + yo, 0.0), 1.62, 0.52, 2.48, segs=24, rings=12)
    # Velvet royal seat cushion & backrest
    add_sphere(bm_velv, to_blender(0, 1.32 + yo, -0.60), 1.14, 0.46, 1.18, segs=18, rings=10)
    add_sphere(bm_velv, to_blender(0, 1.72 + yo, -1.35), 1.05, 0.55, 0.34, segs=16, rings=8)

    for side in (-1.0, 1.0):
        # Gilded side rails & lower chassis trim
        add_box(bm_gold, to_blender(side * 1.42, 1.16 + yo, 0.0), 0.20, 0.23, 3.48)
        add_tube(bm_gold, to_blender(side * 1.56, 1.78 + yo, -1.85), to_blender(side * 1.56, 1.78 + yo, 1.45), 0.06, 0.06, segs=8)
        # Rose silk side panel insert
        add_sphere(bm_rose, to_blender(side * 1.50, 1.13 + yo, 0.15), 0.13, 0.34, 1.28, segs=14, rings=8)
        # Baroque gold filigree scrolls along sides & front
        for z in (-1.80, -0.45, 1.00):
            add_scroll(bm_gold, side * 1.58, 1.48 + yo, z, side)
        add_scroll(bm_gold, side * 0.80, 1.48 + yo, 2.35, side)
        # Strings of luminous nacreous pearls crowning both rails
        for i in range(9):
            add_sphere(bm_pearl, to_blender(side * 1.58, 1.85 + yo, -1.80 + i * 0.40), 0.095, 0.095, 0.095, segs=10, rings=6)
        # Front rose cheek bolster
        add_sphere(bm_rose, to_blender(side * 1.30, 1.46 + yo, 2.05), 0.32, 0.38, 0.20, segs=12, rings=8)
        # Axle housings connecting chassis to wheels
        for z in (-1.55, 1.45):
            add_tube(bm_gold, to_blender(side * 1.15, 0.84 + yo, z), to_blender(side * 1.78, 0.84 + yo, z), 0.085, 0.085, segs=8)

    # Iconic 9-fluted Rococo scallop-shell prow alternating 24K gold & porcelain!
    for i in range(9):
        a = (i - 4) * 0.19
        target = bm_gold if i % 2 == 1 else bm_porc
        add_sphere(target, to_blender(math.sin(a) * 0.78, 1.55 + yo + math.cos(a) * 0.34, 2.40), 0.12, 0.50, 0.13, segs=12, rings=7)
    # Glowing faceted amethyst cabochon centerpiece in golden bezel
    add_sphere(bm_gold, to_blender(0, 1.42 + yo, 2.48), 0.24, 0.25, 0.10, segs=14, rings=8)
    add_sphere(bm_gem, to_blender(0, 1.42 + yo, 2.54), 0.19, 0.20, 0.11, segs=14, rings=8)

    add_obj("Chariot_Porcelain", bm_porc, mat_porcelain)
    add_obj("Chariot_Gold", bm_gold, mat_gold)
    add_obj("Chariot_Velvet", bm_velv, mat_velvet)
    add_obj("Chariot_Rose", bm_rose, mat_rose)
    add_obj("Chariot_Pearls", bm_pearl, mat_pearl)
    add_obj("Chariot_Amethyst", bm_gem, mat_amethyst)

    export_glb("pearococo_chariot.glb")


def build_wheel():
    """Spinning gilded Rococo carriage wheel centered at axle (0, 0, 0)."""
    clear_scene()
    mat_rim = make_mat("WheelPorcelain", (0.98, 0.92, 0.78), metallic=0.08, roughness=0.22, coat=0.85)
    mat_gold = make_mat("WheelGold", (0.92, 0.66, 0.20), metallic=0.94, roughness=0.16, coat=0.4)
    mat_rose = make_mat("WheelHubRose", (0.92, 0.36, 0.60), metallic=0.25, roughness=0.20, coat=0.9)

    bm_rim = bmesh.new()
    bm_gold = bmesh.new()
    bm_rose = bmesh.new()

    # Smooth circular pearl-ivory wheel rim (24-segment torus built from connected tubes)
    segs = 24
    r_wheel = 0.76
    for i in range(segs):
        a0 = i * math.tau / segs
        a1 = (i + 1) * math.tau / segs
        p0 = to_blender(0.0, math.sin(a0) * r_wheel, math.cos(a0) * r_wheel)
        p1 = to_blender(0.0, math.sin(a1) * r_wheel, math.cos(a1) * r_wheel)
        add_tube(bm_rim, p0, p1, 0.125, 0.125, segs=8)
        # Inner gold trim ring
        g0 = to_blender(0.0, math.sin(a0) * (r_wheel - 0.11), math.cos(a0) * (r_wheel - 0.11))
        g1 = to_blender(0.0, math.sin(a1) * (r_wheel - 0.11), math.cos(a1) * (r_wheel - 0.11))
        add_tube(bm_gold, g0, g1, 0.045, 0.045, segs=6)

    # 10 delicate tapered gold spokes
    for i in range(10):
        a = i * math.tau / 10.0
        p_out = to_blender(0.0, math.sin(a) * (r_wheel - 0.08), math.cos(a) * (r_wheel - 0.08))
        add_tube(bm_gold, Vector((0, 0, 0)), p_out, 0.055, 0.038, segs=7)

    # Ornate gold hub & rose-jewel cap
    add_sphere(bm_gold, Vector((0, 0, 0)), 0.19, 0.23, 0.23, segs=14, rings=8)
    add_sphere(bm_rose, to_blender(0.14, 0.0, 0.0), 0.08, 0.12, 0.12, segs=12, rings=6)
    add_sphere(bm_rose, to_blender(-0.14, 0.0, 0.0), 0.08, 0.12, 0.12, segs=12, rings=6)

    add_obj("Wheel_Rim", bm_rim, mat_rim)
    add_obj("Wheel_Gold", bm_gold, mat_gold)
    add_obj("Wheel_Cap", bm_rose, mat_rose)

    export_glb("pearococo_wheel.glb")


def build_queen():
    """Her Majesty Pearococo in her silk pannier gown, powdered curls, pearls, and tiara."""
    clear_scene()
    mat_pink = make_mat("GownPinkSilk", (0.90, 0.36, 0.60), metallic=0.06, roughness=0.36, coat=0.45)
    mat_blush = make_mat("GownBlushSilk", (0.98, 0.68, 0.80), metallic=0.04, roughness=0.38, coat=0.35)
    mat_lace = make_mat("IvoryLace", (0.98, 0.92, 0.78), metallic=0.02, roughness=0.52)
    mat_teal = make_mat("PeacockTeal", (0.06, 0.38, 0.48), metallic=0.42, roughness=0.22, coat=0.85)
    mat_neck = make_mat("PeacockSapphire", (0.09, 0.50, 0.62), metallic=0.48, roughness=0.18, coat=0.92)
    mat_gold = make_mat("QueenGold24K", (0.94, 0.68, 0.22), metallic=0.94, roughness=0.16, coat=0.4)
    mat_pearl = make_mat("QueenPearl", (1.0, 0.97, 0.92), metallic=0.18, roughness=0.12, coat=1.0)
    mat_eye_w = make_mat("QueenEyeWhite", (0.98, 0.95, 0.88), metallic=0.0, roughness=0.18)
    mat_eye_p = make_mat("QueenPupil", (0.04, 0.07, 0.18), metallic=0.15, roughness=0.08, coat=0.95)
    mat_diamond = make_mat(
        "TiaraDiamond", (0.98, 0.44, 0.72), metallic=0.25, roughness=0.06, coat=1.0,
        emission=(0.55, 0.14, 0.34), emission_strength=0.6,
    )

    bm_pink = bmesh.new()
    bm_blush = bmesh.new()
    bm_lace = bmesh.new()
    bm_teal = bmesh.new()
    bm_neck = bmesh.new()
    bm_gold = bmesh.new()
    bm_pearl = bmesh.new()
    bm_ew = bmesh.new()
    bm_ep = bmesh.new()
    bm_dia = bmesh.new()

    # Wide Rococo silk pannier skirt + blush side bustles + scalloped ivory lace
    add_sphere(bm_pink, to_blender(0, 2.04, 0.0), 1.38, 0.80, 0.88, segs=22, rings=12)
    for side in (-1.0, 1.0):
        add_sphere(bm_blush, to_blender(side * 0.95, 2.10, 0.0), 0.56, 0.62, 0.74, segs=16, rings=10)
        for i in range(7):
            a = i * math.pi / 6.0
            add_sphere(bm_lace, to_blender(side * (0.73 + math.sin(a) * 0.63), 1.78 + math.cos(a) * 0.15, 0.56), 0.17, 0.15, 0.14, segs=10, rings=6)

    # Iridescent sapphire-teal peacock torso, graceful swan neck & regal head
    add_sphere(bm_teal, to_blender(0, 2.85, 0.13), 0.56, 0.68, 0.54, segs=18, rings=10)
    add_sphere(bm_neck, to_blender(0, 3.46, 0.21), 0.30, 0.76, 0.30, segs=16, rings=10)
    add_sphere(bm_neck, to_blender(0, 4.18, 0.35), 0.54, 0.59, 0.50, segs=20, rings=12)

    # Sculpted golden peacock beak
    add_tube(bm_gold, to_blender(0, 4.06, 0.68), to_blender(0, 4.01, 1.24), 0.20, 0.03, segs=12)

    for side in (-1.0, 1.0):
        # Expressive eyes, aristocratic lashes & rosy blush
        add_sphere(bm_ew, to_blender(side * 0.30, 4.30, 0.73), 0.14, 0.19, 0.08, segs=12, rings=8)
        add_sphere(bm_ep, to_blender(side * 0.30, 4.31, 0.79), 0.065, 0.11, 0.035, segs=10, rings=6)
        add_box(bm_ep, to_blender(side * 0.31, 4.48, 0.74), 0.24, 0.035, 0.045)
        add_sphere(bm_pink, to_blender(side * 0.39, 4.06, 0.70), 0.13, 0.065, 0.04, segs=10, rings=6)
        # Powdered Rococo sausage curls framing the face
        for i in range(3):
            add_sphere(bm_lace, to_blender(side * 0.50, 4.46 - i * 0.20, 0.24), 0.20, 0.16, 0.26, segs=12, rings=8)
        # Dangling pearl drop earrings & pearl necklace
        add_sphere(bm_pearl, to_blender(side * 0.56, 3.90, 0.31), 0.095, 0.115, 0.095, segs=10, rings=6)
        for i in range(5):
            add_sphere(bm_pearl, to_blender(side * (0.08 + i * 0.08), 2.96 - i * 0.05, 0.63), 0.08, 0.08, 0.08, segs=8, rings=5)

    # Powdered Rococo bouffant pouf, 8-point 24K gold tiara & pink diamond finial!
    add_sphere(bm_lace, to_blender(0, 4.70, 0.26), 0.44, 0.20, 0.40, segs=16, rings=8)
    for i in range(8):
        a = i * math.tau / 8.0
        p0 = to_blender(math.sin(a) * 0.33, 4.76, 0.26 + math.cos(a) * 0.29)
        p1 = to_blender(math.sin(a) * 0.36, 5.06, 0.26 + math.cos(a) * 0.32)
        add_tube(bm_gold, p0, p1, 0.075, 0.02, segs=8)
        add_sphere(bm_pearl, p1, 0.045, 0.045, 0.045, segs=8, rings=4)
    add_sphere(bm_dia, to_blender(0, 5.14, 0.26), 0.13, 0.16, 0.13, segs=12, rings=8)

    # Delicate left wing resting on the golden chariot rail
    add_sphere(bm_blush, to_blender(-0.64, 2.72, 0.47), 0.28, 0.42, 0.26, segs=12, rings=8)
    add_sphere(bm_teal, to_blender(-0.88, 2.34, 0.70), 0.19, 0.30, 0.20, segs=12, rings=8)
    add_sphere(bm_lace, to_blender(-1.00, 2.17, 0.87), 0.21, 0.13, 0.22, segs=12, rings=8)
    add_sphere(bm_gold, to_blender(-0.96, 2.22, 0.82), 0.17, 0.055, 0.17, segs=10, rings=5)

    add_obj("Queen_Pink", bm_pink, mat_pink)
    add_obj("Queen_Blush", bm_blush, mat_blush)
    add_obj("Queen_Lace", bm_lace, mat_lace)
    add_obj("Queen_Teal", bm_teal, mat_teal)
    add_obj("Queen_Neck", bm_neck, mat_neck)
    add_obj("Queen_Gold", bm_gold, mat_gold)
    add_obj("Queen_Pearls", bm_pearl, mat_pearl)
    add_obj("Queen_EyeWhite", bm_ew, mat_eye_w)
    add_obj("Queen_Pupil", bm_ep, mat_eye_p)
    add_obj("Queen_Diamond", bm_dia, mat_diamond)

    export_glb("pearococo_queen.glb")


def build_wing():
    """Articulated royal right wing/gloved hand pivoted at shoulder (0, 0, 0)."""
    clear_scene()
    mat_blush = make_mat("WingBlush", (0.98, 0.68, 0.80), metallic=0.04, roughness=0.38, coat=0.35)
    mat_teal = make_mat("WingTeal", (0.06, 0.38, 0.48), metallic=0.42, roughness=0.22, coat=0.85)
    mat_glove = make_mat("WingOperaGlove", (0.98, 0.93, 0.84), metallic=0.04, roughness=0.36, coat=0.4)
    mat_gold = make_mat("WingBraceletGold", (0.94, 0.68, 0.22), metallic=0.94, roughness=0.16)

    bm_blush = bmesh.new()
    bm_teal = bmesh.new()
    bm_glove = bmesh.new()
    bm_gold = bmesh.new()

    # Relative to shoulder socket (0.64, 2.72, 0.47)
    add_sphere(bm_blush, to_blender(0.0, 0.0, 0.0), 0.30, 0.38, 0.27, segs=12, rings=8)
    add_sphere(bm_teal, to_blender(0.24, -0.10, 0.20), 0.19, 0.29, 0.19, segs=12, rings=8)
    add_tube(bm_glove, to_blender(0.32, -0.12, 0.28), to_blender(0.42, 0.56, 0.38), 0.14, 0.11, segs=10)
    add_sphere(bm_gold, to_blender(0.37, 0.36, 0.35), 0.16, 0.055, 0.16, segs=12, rings=5)
    # Upright gloved royal hand
    add_sphere(bm_glove, to_blender(0.44, 0.66, 0.38), 0.20, 0.22, 0.095, segs=12, rings=8)
    for finger in range(4):
        add_sphere(bm_glove, to_blender(0.44 + (finger - 1.5) * 0.095, 0.92, 0.38), 0.045, 0.16, 0.06, segs=8, rings=5)
    add_sphere(bm_glove, to_blender(0.22, 0.64, 0.41), 0.09, 0.11, 0.07, segs=8, rings=5)

    add_obj("Wing_Blush", bm_blush, mat_blush)
    add_obj("Wing_Teal", bm_teal, mat_teal)
    add_obj("Wing_Glove", bm_glove, mat_glove)
    add_obj("Wing_Gold", bm_gold, mat_gold)

    export_glb("pearococo_wing.glb")


def render_preview():
    clear_scene()
    for name, offset in [
        ("pearococo_chariot.glb", (0, 0, 0)),
        ("pearococo_queen.glb", (0, 0, 0)),
        ("pearococo_wing.glb", (0.64, 2.72, 0.47)),
        ("pearococo_wheel.glb", (-1.82, 0.97, -1.55)),
        ("pearococo_wheel.glb", (1.82, 0.97, -1.55)),
        ("pearococo_wheel.glb", (-1.82, 0.97, 1.45)),
        ("pearococo_wheel.glb", (1.82, 0.97, 1.45)),
    ]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT_DIR, name))
        added = [o for o in bpy.data.objects if o not in before and o.parent is None]
        bx, by, bz = to_blender(*offset)
        for o in added:
            o.location = (bx, by, bz)

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = to_blender(6.2, 4.8, 6.4)
    direction = to_blender(0.0, 2.5, 0.2) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam

    sun_data = bpy.data.lights.new("Sun", type='SUN')
    sun_data.energy = 3.6
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), math.radians(-22), math.radians(36))

    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.14, 0.12, 0.24, 1.0)
    bg.inputs[1].default_value = 0.85

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    out_img = "/Users/orenkoriat/.gemini/antigravity-cli/brain/7e29a728-e29b-408d-ad2f-f93959640962/scratch/pearococo_preview.png"
    scene.render.filepath = out_img
    bpy.ops.render.render(write_still=True)
    print(f"Rendered preview to {out_img}")


if __name__ == "__main__":
    build_chariot()
    build_wheel()
    build_queen()
    build_wing()
    render_preview()
