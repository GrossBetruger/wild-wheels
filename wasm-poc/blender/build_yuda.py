"""
Build Master-Yuda (#10), the aviator-shaded biker elder on his chrome V-twin cruiser
motorcycle, as Blender 5.3 PBR glTF (.glb) following drawMotorcycle, drawYuda, and
drawYudaJacket in characters/master-yuda/master-yuda.js:
  - wasm-poc/assets/models/yuda_bike.glb   : chrome V-twin cruiser frame, tank, pipes, lamp, mirrors
  - wasm-poc/assets/models/yuda_wheel.glb  : one wheel about its axle (used front & rear)
  - wasm-poc/assets/models/yuda_rider.glb  : Master-Yuda and his studded leather jacket, skinned
                                             to one skeleton, with the clips ride, strip, bare, dress
  - wasm-poc/assets/models/yuda_jacket.glb : the jacket alone on its own bones, tumbling through
                                             the air after he throws it

Run:
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_yuda.py
"""
import math
import os
import sys
import bmesh
import bpy
from mathutils import Euler, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rigging
from rigging import RX, RY, RZ, ease, wave

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# Subtracted from every point built, to author a part about its own hinge.
ORIGIN = [0.0, 0.0, 0.0]


def loc(x, y, z):
    return (x - ORIGIN[0], -(z - ORIGIN[2]), y - ORIGIN[1])


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


def make_mat(name, hex_color, roughness=0.45, metallic=0.0, emission=0.0, emission_color=None):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*hex_to_linear(hex_color), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0.0:
        ec = hex_to_linear(emission_color or hex_color)
        bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def add_sphere(x, y, z, rx, ry, rz, mat, segs=18, rings=10, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    if rot != (0, 0, 0):
        obj.rotation_euler = Euler(rot, "XYZ")
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    return rigging.bind(obj)


def add_box(x, y, z, sx, sy, sz, mat, bevel=0.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    if rot != (0, 0, 0):
        obj.rotation_euler = Euler(rot, "XYZ")
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    smooth(obj)
    return rigging.bind(obj)


def add_tube(p1, p2, r1, r2, mat, segs=12):
    v1, v2 = Vector(loc(*p1)), Vector(loc(*p2))
    diff = v2 - v1
    if diff.length < 1e-4:
        return None
    bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r1, radius2=r2, depth=diff.length, location=(v1 + v2) * 0.5)
    obj = bpy.context.active_object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = diff.to_track_quat("Z", "Y")
    obj.data.materials.append(mat)
    smooth(obj)
    return rigging.bind(obj)


def add_torus(x, y, z, major_r, minor_r, mat, rot=(0, 0, 0), major=32, minor=10, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=major, minor_segments=minor,
        major_radius=major_r, minor_radius=minor_r,
        location=loc(x, y, z),
    )
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    return rigging.bind(obj)


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_materials="EXPORT",
        export_apply=True,
    )
    print(f"[yuda] Exported {path} ({os.path.getsize(path)} bytes)")


# ---------------------------------------------------------------------------
# 1. Chrome V-Twin Cruiser Motorcycle (yuda_bike.glb)
# ---------------------------------------------------------------------------
def build_bike():
    clear_scene()
    m_chrome = make_mat("YudaChrome", "#ccdce2", roughness=0.14, metallic=0.96)
    m_pipe = make_mat("ExhaustPipe", "#788d99", roughness=0.22, metallic=0.90)
    m_heat = make_mat("PipeHeat", "#6e5a4d", roughness=0.32, metallic=0.85)
    m_bore = make_mat("PipeBore", "#111b24", roughness=0.85, metallic=0.2)
    m_engine = make_mat("EngineCast", "#4e5862", roughness=0.52, metallic=0.72)
    m_leather = make_mat("BikerLeather", "#222631", roughness=0.52, metallic=0.06)
    m_paint = make_mat("TankCrimson", "#b8352d", roughness=0.20, metallic=0.42)
    m_gold = make_mat("TankGold", "#f3cb80", roughness=0.24, metallic=0.88)
    m_mirror = make_mat("MirrorGlass", "#8dcad8", roughness=0.05, metallic=0.35)
    m_lamp = make_mat("HeadlampGlow", "#fff2c6", roughness=0.10, emission=3.6, emission_color="#ffe8a8")
    m_tail = make_mat("TaillightGlow", "#ff5240", roughness=0.15, emission=3.2, emission_color="#ff3b28")

    for side in (-1, 1):
        # Rear swingarm, swept chrome front forks, backbone frame
        add_tube((side * 0.44, 0.92, -1.65), (side * 0.48, 1.50, 0.20), 0.095, 0.095, m_chrome)
        add_tube((side * 0.44, 0.92, 1.80), (side * 0.40, 2.16, 1.10), 0.092, 0.092, m_chrome)
        add_tube((side * 0.48, 1.50, 0.20), (side * 0.40, 2.16, 1.10), 0.095, 0.095, m_leather)
        # Exposed finned V-twin cylinder + crankcase
        for i in range(6):
            add_box(side * 0.30, 0.90 + i * 0.12, 0.0, 0.56, 0.045, 0.86, m_chrome, bevel=0.01)
        add_sphere(side * 0.43, 1.16, -0.24, 0.25, 0.30, 0.33, m_engine, segs=14, rings=8)
        # Swept twin chrome megaphone exhaust pipes with heat-tinted collars & dark bores
        add_tube((side * 0.50, 1.12, 0.10), (side * 0.65, 0.66, -1.25), 0.12, 0.14, m_chrome)
        add_tube((side * 0.65, 0.67, -1.22), (side * 0.65, 0.67, -2.32), 0.15, 0.20, m_pipe)
        add_tube((side * 0.65, 0.67, -2.26), (side * 0.65, 0.67, -2.36), 0.20, 0.19, m_heat)
        add_sphere(side * 0.65, 0.67, -2.35, 0.15, 0.15, 0.04, m_bore, segs=12, rings=6)
        # Wide cruiser handlebars, leather grips, mirrors, footpegs
        add_tube((side * 0.15, 2.14, 1.05), (side * 0.86, 2.40, 1.28), 0.072, 0.068, m_chrome)
        add_box(side * 0.92, 2.34, 1.28, 0.38, 0.14, 0.17, m_leather, bevel=0.03)
        add_tube((side * 0.75, 2.40, 1.25), (side * 0.98, 2.90, 1.35), 0.032, 0.032, m_chrome)
        add_sphere(side * 1.02, 2.90, 1.36, 0.20, 0.13, 0.055, m_chrome, segs=14, rings=8)
        add_sphere(side * 1.02, 2.90, 1.42, 0.15, 0.09, 0.02, m_mirror, segs=12, rings=6)
        add_box(side * 0.68, 0.78, -0.32, 0.48, 0.11, 0.34, m_leather, bevel=0.025)

    # Teardrop crimson fuel tank with gold racing stripe + chrome filler cap
    add_sphere(0, 1.75, 0.35, 0.65, 0.43, 0.92, m_paint, segs=24, rings=14)
    add_box(0, 2.14, 0.32, 0.16, 0.04, 1.14, m_gold, bevel=0.012)
    add_sphere(0, 2.18, 0.56, 0.11, 0.05, 0.11, m_chrome, segs=14, rings=6)
    # Low stitched black leather saddle + rear fender
    add_sphere(0, 1.67, -0.69, 0.60, 0.18, 0.66, m_leather, segs=18, rings=10)
    add_sphere(0, 1.65, -1.65, 0.46, 0.17, 0.78, m_paint, segs=18, rings=10)
    # Big chrome round headlamp + glowing warm lens + rear ruby taillight
    add_sphere(0, 1.90, 1.88, 0.34, 0.32, 0.24, m_chrome, segs=18, rings=10)
    add_sphere(0, 1.90, 2.10, 0.26, 0.25, 0.05, m_lamp, segs=16, rings=8)
    add_box(0, 1.57, -2.20, 0.44, 0.14, 0.09, m_tail, bevel=0.025)

    export_glb("yuda_bike.glb")


# ---------------------------------------------------------------------------
# 2. Spinning Motorcycle Wheel (yuda_wheel.glb, centered at axle 0,0,0)
# ---------------------------------------------------------------------------
def build_wheel():
    clear_scene()
    m_tire = make_mat("MotoTire", "#171c24", roughness=0.88, metallic=0.02)
    m_chrome = make_mat("WheelChrome", "#cddce2", roughness=0.14, metallic=0.96)
    m_rotor = make_mat("BrakeRotor", "#34424f", roughness=0.35, metallic=0.85)
    m_gold = make_mat("AxleGold", "#f4c77a", roughness=0.22, metallic=0.90)

    rot_x = (0.0, math.pi / 2, 0.0)
    add_torus(0, 0, 0, 0.68, 0.24, m_tire, rot=rot_x, major=32, minor=12, scale=(1.0, 1.0, 1.45))
    add_torus(0, 0, 0, 0.54, 0.08, m_chrome, rot=rot_x, major=28, minor=8)
    for side in (-1, 1):
        add_sphere(side * 0.35, 0, 0, 0.04, 0.44, 0.44, m_rotor, segs=18, rings=8)
        add_sphere(side * 0.39, 0, 0, 0.055, 0.14, 0.14, m_gold, segs=12, rings=6)
    for i in range(10):
        a = i * math.tau / 10
        add_tube((0, 0, 0), (0, math.cos(a) * 0.54, math.sin(a) * 0.54), 0.024, 0.024, m_chrome, segs=6)

    export_glb("yuda_wheel.glb")


# ---------------------------------------------------------------------------
# 3. Master-Yuda Rider (clothed & bare variants)
# ---------------------------------------------------------------------------
# 3. Master-Yuda and his jacket on one skeleton (yuda_rider.glb)
# ---------------------------------------------------------------------------
SIDES = {-1: "_l", 1: "_r"}
HIPS, CHEST, NECK, JACKET = (0, 1.9, -0.55), (0, 2.0, -0.5), (0, 2.95, -0.38), (0, 2.3, -0.52)


def shoulder(side):
    return (side * 0.52, 2.65, -0.25)


def elbow(side):
    return (side * 0.835, 2.4, 0.5)


def grip(side):
    return (side * 0.91, 2.38, 1.28)


def rider_bones():
    bones = [("hips", None, HIPS), ("chest", "hips", CHEST), ("head", "chest", NECK), ("jacket", "chest", JACKET)]
    for side, tag in SIDES.items():
        bones += [
            ("ear" + tag, "head", (side * 0.62, 3.45, -0.22)),
            ("arm_upper" + tag, "chest", shoulder(side)),
            ("arm_fore" + tag, "arm_upper" + tag, elbow(side)),
            ("sleeve_upper" + tag, "jacket", shoulder(side)),
            ("sleeve_fore" + tag, "sleeve_upper" + tag, elbow(side)),
        ]
    return bones


def jacket_bones():
    """The thrown jacket's own skeleton, about the jacket's hinge."""
    def about(point):
        return tuple(p - j for p, j in zip(point, JACKET))
    bones = [("jacket", None, (0, 0, 0))]
    for side, tag in SIDES.items():
        bones += [("sleeve_upper" + tag, "jacket", about(shoulder(side))),
                  ("sleeve_fore" + tag, "sleeve_upper" + tag, about(elbow(side)))]
    return bones


def limb(side, upper, fore, wide, narrow, mat, cuff=0.0):
    """An arm or a sleeve from shoulder to grip: two tapered tubes on their own
    bones and a ball that both share, so the elbow bends without a gap."""
    stop = Vector(grip(side)) + (Vector(elbow(side)) - Vector(grip(side))).normalized() * cuff
    middle = (wide + narrow) / 2
    rigging.carry(**{upper: 1.0})
    add_tube(shoulder(side), elbow(side), wide, middle, mat)
    add_sphere(*shoulder(side), wide, wide, wide, mat, segs=12, rings=8)
    rigging.carry(**{upper: 0.5, fore: 0.5})
    add_sphere(*elbow(side), middle, middle, middle, mat, segs=12, rings=8)
    rigging.carry(**{fore: 1.0})
    add_tube(elbow(side), tuple(stop), middle, narrow, mat)


def add_jacket():
    """The studded leather jacket: an open-bottomed shell, two sleeves that
    bend at the elbow, chrome lapels and the winged patch on the back."""
    m_leather = make_mat("YudaJacket", "#222631", roughness=0.48, metallic=0.08)
    m_lining = make_mat("YudaJacketLining", "#3a2f33", roughness=0.7)
    m_chrome = make_mat("YudaChrome", "#ccdce2", roughness=0.14, metallic=0.95)
    m_cyan = make_mat("AviatorCyan", "#6af3ed", roughness=0.10, emission=2.6, emission_color="#6af3ed")
    rigging.carry(jacket=1.0)
    for radius, mat in ((1.0, m_leather), (0.985, m_lining)):
        shell = add_sphere(0, 2.32, -0.52, 0.67 * radius, 0.74 * radius, 0.51 * radius, mat, segs=22, rings=14)
        # Open at the waist, so that thrown it reads as a jacket and not a ball.
        cut = bmesh.new()
        cut.from_mesh(shell.data)
        waist = 1.84 - ORIGIN[1] - shell.location.z
        bmesh.ops.delete(cut, geom=[f for f in cut.faces if f.calc_center_median().z < waist], context="FACES")
        cut.to_mesh(shell.data)
        cut.free()
    for side, tag in SIDES.items():
        limb(side, "sleeve_upper" + tag, "sleeve_fore" + tag, 0.225, 0.19, m_leather, cuff=0.24)
        rigging.carry(jacket=1.0)
        # Gleaming chrome jacket lapels + 3 chrome studs per side
        add_box(side * 0.24, 2.68, -0.07, 0.22, 0.42, 0.06, m_chrome, bevel=0.015, rot=(0.15, 0, side * -0.35))
        for i in range(3):
            add_sphere(side * 0.50, 2.73 - i * 0.12, -0.02, 0.042, 0.042, 0.036, m_chrome, segs=8, rings=5)
        # Iconic chrome & glowing cyan winged biker patch on the back of the jacket!
        for i in range(4):
            add_box(side * (0.14 + i * 0.10), 2.48 + i * 0.05, -1.01, 0.15, 0.065, 0.035, m_chrome, bevel=0.008)
    add_sphere(0, 2.50, -1.02, 0.13, 0.17, 0.03, m_cyan, segs=12, rings=6)


def add_rider():
    m_brown = make_mat("YudaBrown", "#95643f", roughness=0.72)
    m_light = make_mat("YudaLightBrown", "#bc8a59", roughness=0.74)
    m_mouth = make_mat("YudaMouth", "#493428", roughness=0.65)
    m_leather = make_mat("YudaJacket", "#222631", roughness=0.48, metallic=0.08)
    m_boot = make_mat("YudaBoot", "#161d29", roughness=0.58, metallic=0.05)
    m_chrome = make_mat("YudaChrome", "#ccdce2", roughness=0.14, metallic=0.95)
    m_shade = make_mat("AviatorLens", "#0d1622", roughness=0.06, metallic=0.35)
    m_cyan = make_mat("AviatorCyan", "#6af3ed", roughness=0.10, emission=2.6, emission_color="#6af3ed")
    m_hoop = make_mat("EarHoop", "#f2d6a5", roughness=0.20, metallic=0.92)

    # Bare torso; the jacket goes over it.
    rigging.carry(chest=1.0)
    add_sphere(0, 2.32, -0.52, 0.62, 0.70, 0.46, m_brown, segs=22, rings=14)
    add_sphere(0, 2.08, -0.12, 0.38, 0.32, 0.12, m_light, segs=16, rings=8)

    for side, tag in SIDES.items():
        # Bent biker legs in leather trousers + chunky boots on footpegs
        rigging.carry(hips=1.0)
        knee = (side * 0.76, 1.43, 0.05)
        ankle = (side * 0.69, 1.03, -0.28)
        add_tube((side * 0.40, 1.90, -0.55), knee, 0.23, 0.20, m_leather)
        add_tube(knee, ankle, 0.20, 0.18, m_leather)
        add_sphere(*knee, 0.2, 0.2, 0.2, m_leather, segs=12, rings=8)
        add_sphere(ankle[0], ankle[1] - 0.07, ankle[2] + 0.23, 0.26, 0.20, 0.48, m_boot, segs=14, rings=8)
        # Bare arms gripping the wide handlebars
        limb(side, "arm_upper" + tag, "arm_fore" + tag, 0.185, 0.15, m_brown)
        add_sphere(*grip(side), 0.22, 0.19, 0.21, m_brown, segs=14, rings=8)

    # Iconic brown elder head + huge horizontal pointed ears + gold earring + aviator shades
    rigging.carry(head=1.0)
    add_sphere(0, 3.38, -0.32, 0.81, 0.72, 0.68, m_brown, segs=26, rings=16)
    for side, tag in SIDES.items():
        # Expressive long horizontal pointed elder ears, each on its own bone
        rigging.carry(**{"ear" + tag: 1.0})
        add_tube((side * 0.62, 3.45, -0.22), (side * 2.08, 3.74, -0.38), 0.30, 0.04, m_brown, segs=10)
        add_tube((side * 0.74, 3.44, -0.12), (side * 1.82, 3.68, -0.30), 0.16, 0.02, m_light, segs=8)
        if side < 0:
            # Gold hoop earring on left ear
            add_torus(-1.06, 3.32, -0.10, 0.11, 0.028, m_hoop, rot=(0, 0, 0), major=18, minor=6)
        rigging.carry(head=1.0)
        # Unmistakable chrome-rimmed dark aviator sunglasses with glowing cyan reflection bar!
        add_sphere(side * 0.36, 3.52, 0.29, 0.37, 0.27, 0.10, m_chrome, segs=18, rings=10)
        add_sphere(side * 0.36, 3.52, 0.37, 0.32, 0.22, 0.055, m_shade, segs=16, rings=8)
        add_box(side * 0.35, 3.59, 0.43, 0.26, 0.028, 0.018, m_cyan, bevel=0.005)
        add_tube((side * 0.70, 3.55, 0.31), (side * 0.79, 3.53, -0.30), 0.035, 0.035, m_chrome, segs=8)
        add_tube((side * 0.12, 3.94, -0.02), (side * 0.48, 3.83, 0.08), 0.032, 0.028, m_light, segs=8)

    add_box(0, 3.51, 0.37, 0.20, 0.048, 0.055, m_chrome, bevel=0.01)
    add_sphere(0, 3.27, 0.38, 0.19, 0.16, 0.24, m_light, segs=14, rings=8)
    add_sphere(0, 3.02, 0.19, 0.35, 0.13, 0.23, m_light, segs=14, rings=8)
    add_box(0.08, 3.10, 0.40, 0.30, 0.03, 0.03, m_mouth, bevel=0.008)


# How far along the strip the jacket leaves him, and where it is then: the
# game throws the loose jacket (yuda_jacket.glb) from there.
STRIP_FRAMES, RELEASE_FRAME, DRESS_FRAMES = 12, 8, 26
RELEASE_TURN, RELEASE_SHIFT = RX(-0.6), (0, 0.2, -0.9)
GONE = 0.001


def mix(a, b, amount):
    return tuple(p + (q - p) * amount for p, q in zip(a, b))


def arms(pose, chest, hands, worn=True):
    """Put each hand where `hands` says, elbows out and down; worn sleeves follow."""
    for side, tag in SIDES.items():
        upper, fore = rigging.reach(shoulder(side), elbow(side), grip(side), hands(side),
                                    (side * 0.6, -0.8, -0.1), chest, CHEST)
        pose["arm_upper" + tag], pose["arm_fore" + tag] = upper, fore
        if worn:
            pose["sleeve_upper" + tag], pose["sleeve_fore" + tag] = upper, fore


def ears(pose, cycle, swept):
    """Ears bob at a cruise and stream back, fluttering, at full throttle."""
    for side, tag in SIDES.items():
        calm = RZ(side * 0.05 * wave(cycle, 2, side)) @ RY(side * 0.06 * wave(cycle, 4))
        back = RY(side * (0.42 + 0.1 * wave(cycle, 6, side))) @ RZ(side * 0.06 * wave(cycle, 8))
        pose["ear" + tag] = calm.slerp(back, swept)


def clip_ride(cycle):
    """Cruising in the jacket: hands on the bars, the engine thrumming through him."""
    chest = RX(0.02 * wave(cycle, 2))
    pose = {"chest": (chest, (0, 0.006 * wave(cycle, 12), 0)),
            "head": RY(0.05 * wave(cycle)) @ RX(-0.02 * wave(cycle, 2))}
    arms(pose, chest, grip)
    ears(pose, cycle, 0.0)
    return pose


def clip_bare(cycle):
    """Bare-chested at full throttle: tucked forward, ears streaming."""
    chest = RX(0.14 + 0.02 * wave(cycle, 4))
    pose = {"chest": (chest, (0, 0.01 * wave(cycle, 12), 0)), "head": RX(-0.12) @ RY(0.03 * wave(cycle, 2)),
            "jacket": (Quaternion(), (0, 0, 0), GONE)}
    arms(pose, chest, grip)
    ears(pose, cycle, 1.0)
    return pose


def clip_strip(cycle):
    """Once through: hands leave the bars, the arms sweep back and the jacket
    slides off them; from RELEASE_FRAME he is bare and reaching for the bars."""
    release = RELEASE_FRAME / STRIP_FRAMES
    tuck, back, home = ease(cycle / 0.3), ease((cycle - 0.3) / (release - 0.3)), ease((cycle - release) / (1 - release))
    chest = RX(-0.14 * back * (1 - home) + 0.14 * home)

    def hands(side):
        swept = mix(mix(grip(side), (side * 0.8, 2.75, 0.2), tuck), (side * 0.95, 2.25, -1.2), back)
        return mix(swept, grip(side), home)

    pose = {"chest": chest, "head": RX(0.1 * back * (1 - home) - 0.12 * home)}
    arms(pose, chest, hands)
    ears(pose, cycle, home)
    shift = tuple(s * back for s in RELEASE_SHIFT)
    pose["jacket"] = (Quaternion().slerp(RELEASE_TURN, back), shift, 1.0 if cycle < release else GONE)
    return pose


def clip_dress(cycle):
    """Once through: he reaches up and back, swings the jacket over his
    shoulders from behind the saddle, and his arms drop into the sleeves."""
    lift, settle, into = math.sin(math.pi * cycle), ease(cycle / 0.75), ease((cycle - 0.45) / 0.4)
    chest = RX(0.14 * (1 - ease(cycle / 0.6)) - 0.08 * lift)

    def hands(side):
        return mix(grip(side), (side * 1.1, 3.6, -0.25), lift)

    pose = {"chest": chest, "head": RX(-0.12 * (1 - settle) + 0.08 * lift)}
    arms(pose, chest, hands, worn=False)
    ears(pose, cycle, 1 - settle)
    rise = (0, -0.55 * (1 - settle) + 0.35 * math.sin(math.pi * settle), -0.9 * (1 - settle))
    pose["jacket"] = (RX(0.9 * (1 - settle)), rise, max(GONE, ease(cycle / 0.12)))
    for side, tag in SIDES.items():
        # The sleeves hang open and wide until the arms come down into them.
        pose["sleeve_upper" + tag] = (RY(side * 1.2) @ RX(-0.6)).slerp(pose["arm_upper" + tag], into)
        pose["sleeve_fore" + tag] = RX(0.5).slerp(pose["arm_fore" + tag], into)
    return pose


def clip_tumble(cycle):
    """The thrown jacket: the shell rocks and the empty sleeves flail."""
    pose = {"jacket": RX(0.25 * wave(cycle)) @ RZ(0.15 * wave(cycle, 2))}
    for side, tag in SIDES.items():
        pose["sleeve_upper" + tag] = RY(side * (1.0 + 0.4 * wave(cycle, 2, side))) @ RX(-0.3 + 0.5 * wave(cycle, 2))
        pose["sleeve_fore" + tag] = RX(0.6 * wave(cycle, 2, 1.0)) @ RY(side * 0.3 * wave(cycle, 3))
    return pose


RIDER_CLIPS = [("ride", 60, clip_ride), ("strip", STRIP_FRAMES, clip_strip),
               ("bare", 60, clip_bare), ("dress", DRESS_FRAMES, clip_dress)]
JACKET_CLIPS = [("tumble", 24, clip_tumble)]


def meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def build_rider():
    clear_scene()
    ORIGIN[:] = (0, 0, 0)
    add_rider()
    body = rigging.join(meshes(), "Yuda")
    add_jacket()
    jacket = rigging.join([obj for obj in meshes() if obj != body], "YudaJacket")
    rig = rigging.build_armature("YudaRig", rider_bones())
    rigging.skin(rig, body, jacket)
    rigging.author_clips(rig, rider_bones(), RIDER_CLIPS)
    rigging.export_rig(os.path.join(OUT_DIR, "yuda_rider.glb"), RIDER_CLIPS)
    return rig


# ---------------------------------------------------------------------------
# 4. The jacket in flight (yuda_jacket.glb)
# ---------------------------------------------------------------------------
def build_jacket():
    clear_scene()
    ORIGIN[:] = JACKET
    add_jacket()
    jacket = rigging.join(meshes(), "YudaJacket")
    ORIGIN[:] = (0, 0, 0)
    rig = rigging.build_armature("YudaJacketRig", jacket_bones())
    rigging.skin(rig, jacket)
    rigging.author_clips(rig, jacket_bones(), JACKET_CLIPS)
    rigging.export_rig(os.path.join(OUT_DIR, "yuda_jacket.glb"), JACKET_CLIPS)
    return rig


if __name__ == "__main__":
    build_bike()
    build_wheel()
    build_rider()
    build_jacket()
    print("[yuda] ALL DONE!")
