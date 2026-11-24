"""
Build KnowItOwl (#14), the monocled snowy owl scholar on his navy-and-brass
roadster bicycle, as articulated PBR parts for the Bevy rig in
wasm-poc/src/knowitowl.rs. Shapes, sizes and colours follow drawOwl and
drawBicycle in characters/knowitowl/knowitowl.js.

Every moving part is authored with its hinge at (0, 0, 0):
  - knowitowl_bike.glb    : lugged frame, saddle, satchel, bars, lamp, bell, chain
  - knowitowl_wheel.glb   : one wheel about its axle (used twice)
  - knowitowl_crank.glb   : chainring, crank arms and pedals about the spindle
  - knowitowl_body.glb    : torso, layered plumage, breast Sigma, tail fan
  - knowitowl_head.glb    : head about the neck, facial discs, monocle and chain
  - knowitowl_wing_l/r.glb: each wing about its shoulder
  - knowitowl_thigh.glb   : feathered thigh about the hip (used twice)
  - knowitowl_shin.glb    : shin, tarsus and taloned foot about the knee (used twice)

    blender --background --python wasm-poc/blender/build_knowitowl.py -- wasm-poc/assets/models
"""
import math
import os
import sys
import bpy
from mathutils import Euler, Vector

argv = sys.argv
out_dir = argv[argv.index("--") + 1] if "--" in argv else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "assets", "models")
os.makedirs(out_dir, exist_ok=True)

# Where the part being built hinges, in the racer's model space.
ORIGIN = [0.0, 0.0, 0.0]


# Wild Wheels (x across, y up, z forward) -> Blender (X, -z, y); the glTF
# exporter's Y-up conversion brings it back to the game's axes.
def loc(x, y, z):
    return (x - ORIGIN[0], -(z - ORIGIN[2]), y - ORIGIN[1])


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


MATS = {}
PALETTE = {
    # Plumage: soft and matte, with a cooler grey for shafts and barring.
    "white": ("#f5f4ec", 0.88, 0.0),
    "ivory": ("#e2e4dc", 0.9, 0.0),
    "edge": ("#c1cbd4", 0.72, 0.0),
    "sigma": ("#9164ac", 0.82, 0.0),
    "sigma_soft": ("#b59ac7", 0.85, 0.0),
    "disc": ("#e8dfce", 0.86, 0.0),
    "disc_rim": ("#cdbfa3", 0.84, 0.0),
    # Beak and feet are horn, not metal.
    "horn": ("#d3ab58", 0.38, 0.0),
    "talon": ("#2a2b33", 0.22, 0.0),
    "iris": ("#ddb665", 0.12, 0.0),
    "pupil": ("#263749", 0.06, 0.0),
    "glint": ("#ffffff", 0.05, 0.0),
    # Bicycle: navy enamel, brass that is polished where it is handled and
    # tarnished where it is not, worn leather, gum-wall tyres.
    "navy": ("#273b4c", 0.3, 0.35),
    "navy_worn": ("#34495c", 0.55, 0.2),
    "brass": ("#d3ab58", 0.22, 0.95),
    "brass_aged": ("#a07e3c", 0.5, 0.85),
    "steel": ("#d8dee0", 0.2, 0.95),
    "chain": ("#4a4f55", 0.45, 0.9),
    "leather": ("#79523f", 0.58, 0.0),
    "leather_dark": ("#5a3b2c", 0.7, 0.0),
    "grip": ("#755140", 0.74, 0.0),
    "tyre": ("#28303c", 0.92, 0.0),
    "gumwall": ("#a98a5e", 0.86, 0.0),
    "pedal": ("#1f2a36", 0.8, 0.0),
}


def reset_scene(origin=(0.0, 0.0, 0.0)):
    global MATS
    MATS = {}
    ORIGIN[:] = origin
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, emission=0.0, emission_color=None):
    if name in MATS:
        return MATS[name]
    hex_color, roughness, metallic = PALETTE[name]
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*hex_to_linear(hex_color), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*hex_to_linear(emission_color or hex_color), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    MATS[name] = m
    return m


def finish(obj, material, bevel=0.0):
    obj.data.materials.append(mat(material) if isinstance(material, str) else material)
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return obj


def sphere(x, y, z, rx, ry, rz, material, segs=12, rings=8, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    return finish(obj, material)


def scale_feather(x, y, z, rx, ry, rz, material, facing=0.0, tuck=0.3):
    """One overlapping body feather: a flat low-polygon ellipsoid whose face
    turns `facing` radians about the vertical and whose top tucks under the
    row above."""
    return sphere(x, y, z, rx, ry, rz, material, segs=6, rings=3, rot=(-tuck, 0, facing))


def box(x, y, z, sx, sy, sz, material, bevel=0.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    return finish(obj, material, bevel)


def rod(a, b, r, material, verts=10, bevel=0.0):
    """A tube from a to b, both in the racer's model space."""
    start, end = Vector(loc(*a)), Vector(loc(*b))
    span = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=span.length, location=(start + end) / 2)
    obj = bpy.context.active_object
    obj.rotation_euler = span.to_track_quat("Z", "Y").to_euler()
    return finish(obj, material, bevel)


def cone(x, y, z, r1, r2, depth, material, verts=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    return finish(obj, material)


def torus(x, y, z, major_r, minor_r, material, rot=(0, 0, 0), major=36, minor=8, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=major, minor_segments=minor,
        major_radius=major_r, minor_radius=minor_r, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.scale = scale
    return finish(obj, material)


def export_part(filename, name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    # Joining keeps one piece's placement; bake it so the part's hinge is its origin.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.update()
    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    path = os.path.join(out_dir, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
    )
    print(f"Exported {name} -> {path} ({triangles} triangles, {os.path.getsize(path) // 1024} KiB)")
    return triangles


TOTAL = {}
HALF_PI = math.pi / 2

# =============================================================================
# BICYCLE: lugged navy roadster with brass fittings
# =============================================================================
REAR, BRACKET, SEAT, HEAD, FRONT = (0, 1.1, -1.9), (0, 0.95, 0), (0, 2.35, -0.65), (0, 2.4, 1.25), (0, 1.1, 1.9)
CROWN = (0, 2.12, 1.39)


def build_bike():
    reset_scene()
    # Main triangle; tubes meet inside brass lugs.
    rod(BRACKET, SEAT, 0.09, "navy")
    rod(SEAT, HEAD, 0.085, "navy")
    rod(BRACKET, (0, 2.2, 1.31), 0.095, "navy")
    rod(HEAD, CROWN, 0.12, "navy", verts=12)
    for joint, r in ((BRACKET, 0.17), (SEAT, 0.14), (HEAD, 0.15), (CROWN, 0.14)):
        sphere(*joint, r, r, r, "brass_aged", segs=10, rings=6)
    # Brass pinstripe bands either side of the top-tube lugs.
    for t in (0.14, 0.86):
        p = [SEAT[i] + (HEAD[i] - SEAT[i]) * t for i in range(3)]
        q = [SEAT[i] + (HEAD[i] - SEAT[i]) * (t + 0.03) for i in range(3)]
        rod(p, q, 0.094, "brass", verts=10)
    for side in (-1, 1):
        # Paired chainstays, seat stays and fork blades.
        rod((side * 0.07, 0.95, -0.05), (side * 0.14, 1.1, -1.9), 0.05, "navy", verts=8)
        rod((side * 0.06, 2.3, -0.68), (side * 0.14, 1.1, -1.9), 0.045, "navy", verts=8)
        rod((side * 0.14, 2.12, 1.39), (side * 0.14, 1.1, 1.9), 0.055, "navy", verts=8)
        rod((0, 2.12, 1.39), (side * 0.14, 2.12, 1.39), 0.06, "navy", verts=8)
        for axle in (REAR, FRONT):
            sphere(side * 0.15, axle[1], axle[2], 0.05, 0.09, 0.09, "brass", segs=8, rings=5)
            sphere(side * 0.2, axle[1], axle[2], 0.04, 0.055, 0.055, "steel", segs=6, rings=4)
    # Chain along the drive side, from the chainring back to the sprocket.
    for lift in (0.29, -0.29):
        rod((0.2, 0.95 + lift, 0), (0.2, 1.1 + lift * 0.42, -1.9), 0.022, "chain", verts=6)
    rod((0.17, 1.1, -1.9), (0.23, 1.1, -1.9), 0.13, "chain", verts=14)
    # Sprung leather saddle on a brass post, with a scholar's satchel behind.
    rod(SEAT, (0, 2.62, -0.72), 0.06, "brass", verts=8)
    sphere(0, 2.72, -0.78, 0.36, 0.1, 0.42, "leather", segs=14, rings=8)
    sphere(0, 2.72, -0.36, 0.17, 0.085, 0.26, "leather", segs=10, rings=6)
    sphere(0, 2.69, -0.78, 0.38, 0.045, 0.44, "leather_dark", segs=14, rings=5)
    for side in (-1, 1):
        rod((side * 0.2, 2.44, -1.02), (side * 0.2, 2.66, -1.02), 0.055, "steel", verts=8)
        sphere(side * 0.24, 2.74, -1.14, 0.03, 0.03, 0.03, "brass", segs=6, rings=4)
    box(0, 2.4, -1.3, 0.62, 0.36, 0.24, "leather_dark", bevel=0.05)
    box(0, 2.5, -1.31, 0.66, 0.2, 0.26, "leather", bevel=0.05)
    for side in (-1, 1):
        box(side * 0.17, 2.42, -1.44, 0.07, 0.3, 0.02, "leather_dark", bevel=0.008)
        box(side * 0.17, 2.36, -1.455, 0.1, 0.07, 0.02, "brass", bevel=0.008)
    # Stem, bars and worn leather grips.
    rod(HEAD, (0, 3, 1.3), 0.065, "brass", verts=8)
    sphere(0, 3, 1.3, 0.1, 0.1, 0.1, "brass", segs=8, rings=5)
    rod((-0.75, 3, 1.3), (0.75, 3, 1.3), 0.06, "navy", verts=10)
    for side in (-1, 1):
        sphere(side * 0.75, 3, 1.3, 0.065, 0.065, 0.065, "navy", segs=8, rings=5)
        rod((side * 0.75, 3, 1.3), (side * 0.78, 2.86, 1.5), 0.09, "grip", verts=10)
        sphere(side * 0.78, 2.86, 1.5, 0.1, 0.1, 0.1, "leather_dark", segs=8, rings=5)
        sphere(side * 0.75, 3, 1.3, 0.1, 0.1, 0.1, "brass_aged", segs=8, rings=5)
    # Brass headlamp with a warm lens, and a thumb bell.
    rod((0, 2.62, 1.3), (0, 2.62, 1.52), 0.03, "brass_aged", verts=6)
    rod((0, 2.62, 1.5), (0, 2.62, 1.8), 0.17, "brass", verts=14, bevel=0.03)
    torus(0, 2.62, 1.8, 0.17, 0.028, "brass_aged", rot=(HALF_PI, 0, 0), major=16, minor=6)
    lens = bpy.data.materials.new(name="lamp_lens")
    lens.use_nodes = True
    glow = lens.node_tree.nodes.get("Principled BSDF")
    glow.inputs["Base Color"].default_value = (*hex_to_linear("#fff3c4"), 1.0)
    glow.inputs["Roughness"].default_value = 0.12
    glow.inputs["Emission Color"].default_value = (*hex_to_linear("#ffe2a0"), 1.0)
    glow.inputs["Emission Strength"].default_value = 2.4
    sphere(0, 2.62, 1.8, 0.15, 0.15, 0.06, lens, segs=12, rings=6)
    sphere(-0.42, 3.09, 1.3, 0.11, 0.075, 0.11, "brass", segs=10, rings=6)
    sphere(-0.42, 3.165, 1.3, 0.025, 0.025, 0.025, "steel", segs=6, rings=4)
    TOTAL["bike"] = export_part("knowitowl_bike.glb", "KnowItOwlBike")


def build_wheel():
    reset_scene()
    wheel_axis = (0, HALF_PI, 0)
    torus(0, 0, 0, 0.97, 0.085, "tyre", rot=wheel_axis, major=28, minor=6)
    # Tan gum walls either side of the tread, then the brass rim.
    for side in (-1, 1):
        torus(side * 0.035, 0, 0, 0.93, 0.062, "gumwall", rot=wheel_axis, major=28, minor=4)
    torus(0, 0, 0, 0.865, 0.045, "brass", rot=wheel_axis, major=28, minor=5)
    rod((-0.16, 0, 0), (0.16, 0, 0), 0.07, "brass_aged", verts=10)
    for side in (-1, 1):
        rod((side * 0.1, 0, 0), (side * 0.13, 0, 0), 0.13, "brass", verts=12)
    # Sixteen spokes, laced alternately to either hub flange.
    for i in range(16):
        a = i * math.pi / 8
        flange = 0.115 if i % 2 else -0.115
        rod((flange, math.cos(a + 0.35) * 0.12, math.sin(a + 0.35) * 0.12),
            (0, math.cos(a) * 0.85, math.sin(a) * 0.85), 0.014, "steel", verts=5)
    # The valve: the one mark that shows a smooth wheel turning.
    rod((0, 0.74, 0), (0, 0.84, 0), 0.025, "brass", verts=6)
    TOTAL["wheel"] = export_part("knowitowl_wheel.glb", "KnowItOwlWheel")


def build_crank():
    reset_scene()
    rod((-0.34, 0, 0), (0.34, 0, 0), 0.05, "steel", verts=8)
    rod((0.18, 0, 0), (0.215, 0, 0), 0.31, "brass", verts=20)
    rod((0.215, 0, 0), (0.225, 0, 0), 0.2, "brass_aged", verts=14)
    for side in (-1, 1):
        rod((side * 0.31, 0, 0), (side * 0.31, side * 0.3, 0), 0.045, "steel", verts=8)
        sphere(side * 0.31, 0, 0, 0.075, 0.075, 0.075, "brass_aged", segs=8, rings=5)
        # Round rubber pedals: they turn with the crank yet always look level.
        rod((side * 0.34, side * 0.3, 0), (side * 0.64, side * 0.3, 0), 0.085, "pedal", verts=10, bevel=0.02)
        rod((side * 0.64, side * 0.3, 0), (side * 0.67, side * 0.3, 0), 0.095, "brass", verts=10)
    TOTAL["crank"] = export_part("knowitowl_crank.glb", "KnowItOwlCrank")


# =============================================================================
# KNOWITOWL
# =============================================================================
# The Sigma is pigment in the breast feathers, following their curved surface.
SIGMA = [((-0.36, 3.68), (0.36, 3.68)), ((-0.36, 3.68), (0.02, 3.28)),
         ((0.02, 3.28), (-0.36, 2.88)), ((-0.36, 2.88), (0.36, 2.88))]


def sigma_distance(x, y):
    best = 9.0
    for (ax, ay), (bx, by) in SIGMA:
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
    return best


def build_body():
    reset_scene()
    sphere(0, 3.35, -0.3, 1, 0.95, 0.72, "white", segs=24, rings=14)
    # Breast: eight rows of overlapping feathers carrying the Sigma.
    for row in range(8):
        for i in range(11):
            a = (i - 5) * 0.21
            x, y = math.sin(a) * (0.9 - row * 0.04), 3.78 - row * 0.145
            distance = sigma_distance(x, y)
            color = "sigma" if distance < 0.065 else "sigma_soft" if distance < 0.11 else "white" if row % 2 else "ivory"
            surface = -0.3 + 0.72 * math.sqrt(max(0.02, 1 - x * x - ((y - 3.35) / 0.95) ** 2))
            scale_feather(x, y, surface + 0.035, 0.115, 0.17, 0.06, color, facing=a * 1.4, tuck=0.22)
    # Mantle: the back the chase camera sees, shingled in alternating white and ivory.
    for row in range(5):
        for i in range(7):
            a = (i - 3) * 0.34
            x, y = math.sin(a) * (0.92 - row * 0.07), 3.95 - row * 0.3
            depth = -0.3 - 0.72 * math.sqrt(max(0.02, 1 - x * x * 0.92 - ((y - 3.35) / 0.95) ** 2))
            color = "white" if (row + i) % 2 else "ivory"
            sphere(x, y, depth - 0.02, 0.23, 0.3, 0.09, color, segs=10, rings=5,
                   rot=(0.22, 0, math.pi - a * 1.2))
    # Fluffed flanks soften the join between breast and mantle.
    for side in (-1, 1):
        for i in range(4):
            scale_feather(side * (0.93 - i * 0.05), 3.6 - i * 0.3, -0.3, 0.09, 0.24, 0.26,
                          "ivory" if i % 2 else "white", tuck=0)
    # Tail fan: eight blades swept down and back.
    for side in (-1, 1):
        for i in range(4):
            spread = side * (0.15 + i * 0.17)
            sphere(spread, 2.72 - i * 0.03, -1.04 - (3 - i) * 0.02, 0.15, 0.52, 0.06,
                   "white" if i % 2 else "ivory", segs=8, rings=5, rot=(0.42, side * (0.05 + i * 0.07), 0))
    # Neck ruff under the head.
    for i in range(12):
        a = i * math.pi / 6
        scale_feather(math.sin(a) * 0.72, 4.18, -0.2 + math.cos(a) * 0.56, 0.2, 0.2, 0.1,
                      "white" if i % 2 else "ivory", facing=a, tuck=0.5)
    TOTAL["body"] = export_part("knowitowl_body.glb", "KnowItOwlBody")


NECK = (0, 4.3, 0.05)


def skull_surface(x, y):
    """How far forward the skull reaches at (x, y), in the head's own space."""
    inside = 1 - (x / 1.12) ** 2 - ((y - 0.45) / 1.05) ** 2
    return 0.83 * math.sqrt(inside) if inside > 0.04 else None


def build_head():
    reset_scene()
    sphere(0, 0.45, 0, 1.12, 1.05, 0.83, "white", segs=28, rings=16)
    for side in (-1, 1):
        # Facial disc, ringed by a ruffle of short darker feathers.
        sphere(side * 0.48, 0.48, 0.63, 0.51, 0.61, 0.23, "disc", segs=18, rings=10)
        for i in range(16):
            a = i * math.tau / 16
            x, y = side * 0.48 + math.cos(a) * 0.47, 0.48 + math.sin(a) * 0.57
            z = skull_surface(x, y)
            if z is None or abs(x) < 0.07:
                continue
            sphere(x, y, max(z, 0.5) + 0.01, 0.1, 0.12, 0.035, "disc_rim" if i % 2 else "disc",
                   segs=8, rings=4, rot=(0, HALF_PI - a, 0))
        sphere(side * 0.46, 0.48, 0.8, 0.36, 0.4, 0.07, "white", segs=14, rings=6)
        # Glossy amber eye, navy pupil and a catchlight.
        sphere(side * 0.43, 0.48, 0.87, 0.22, 0.22, 0.04, "iris", segs=14, rings=6)
        sphere(side * 0.4, 0.48, 0.91, 0.105, 0.14, 0.025, "pupil", segs=10, rings=5)
        sphere(side * 0.37, 0.54, 0.94, 0.035, 0.04, 0.015, "glint", segs=6, rings=4)
        # Heavy white brow and the stern ridge above it.
        sphere(side * 0.47, 0.71, 0.9, 0.28, 0.095, 0.03, "white", segs=10, rings=5)
        rod((side * 0.2, 0.85, 0.82), (side * 0.7, 0.77, 0.8), 0.055, "edge", verts=8)
        for end in (0.2, 0.7):
            sphere(side * end, 0.85 - (end - 0.2) * 0.16, 0.82 - (end - 0.2) * 0.04, 0.055, 0.055, 0.055,
                   "edge", segs=6, rings=4)
        # Ear tufts, leaning outward.
        for i in range(4):
            sphere(side * (0.73 + i * 0.065), 1.01 + i * 0.1, -0.07, 0.13, 0.25 - i * 0.035, 0.12,
                   "white", segs=8, rings=5, rot=(0, side * 0.3, 0))
    # Crown and nape feathers for the chase camera.
    for row in range(3):
        for i in range(6):
            a = (i - 2.5) * 0.36
            x, y = math.sin(a) * (0.95 - row * 0.05), 1.0 - row * 0.36
            z = skull_surface(x, y)
            if z is not None:
                scale_feather(x, y, -z - 0.02, 0.2, 0.26, 0.06, "ivory" if (row + i) % 2 else "white",
                              facing=math.pi - a, tuck=-0.25)
    # Hooked beak: a rounded cere and a tip that curves down.
    sphere(0, 0.2, 0.9, 0.15, 0.17, 0.17, "horn", segs=10, rings=7)
    cone(0, 0.05, 0.98, 0.13, 0.0, 0.34, "horn", verts=10, rot=(2.5, 0, 0))
    # Gold monocle on the right eye, its chain hanging to a fob.
    torus(0.46, 0.48, 0.96, 1.0, 0.065, "brass", rot=(HALF_PI, 0, 0), major=32, minor=6,
          scale=(0.39, 0.39, 0.43))
    sphere(0.84, 0.36, 0.9, 0.05, 0.05, 0.05, "brass", segs=6, rings=4)
    links = [(0.84, 0.36, 0.9), (0.93, -0.25, 0.6), (0.6, -0.6, 0.65)]
    for (ax, ay, az), (bx, by, bz) in zip(links, links[1:]):
        for i in range(1, 8):
            t = i / 8
            sag = math.sin(t * math.pi) * 0.05
            sphere(ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t, 0.03, 0.03, 0.03,
                   "brass" if i % 2 else "brass_aged", segs=5, rings=3)
    sphere(0.6, -0.66, 0.65, 0.075, 0.09, 0.04, "brass", segs=8, rings=5)
    TOTAL["head"] = export_part("knowitowl_head.glb", "KnowItOwlHead")


def build_wing(side, filename, name):
    """A wing hanging from its shoulder at the origin; +x * side points away
    from the body, so turning it about z spreads it."""
    reset_scene()
    sphere(side * 0.4, -0.3, 0, 0.6, 0.8, 0.26, "ivory", segs=14, rings=8)
    # Nine primaries, lengthening outward and shingled so each overlaps the next.
    for i in range(9):
        x, y, length = 0.15 + i * 0.19, -0.2 - i * 0.1, 0.9 + i * 0.11
        sphere(side * x, y - length * 0.45, -0.05 - i * 0.012, 0.15, length * 0.58, 0.085,
               "white" if i % 2 else "ivory", segs=8, rings=6)
        # The shaft shows on both faces.
        for face in (0.03, -0.13 - i * 0.012):
            box(side * x, y - length * 0.5, face, 0.022, length * 0.8, 0.02, "edge", bevel=0)
    # Coverts over the shoulder, front and back.
    for face in (1, -1):
        for row in range(2):
            for i in range(4 - row):
                scale_feather(side * (0.2 + i * 0.25 + row * 0.12), -0.1 - row * 0.36 - i * 0.12,
                              face * (0.2 - row * 0.03), 0.17, 0.26, 0.07,
                              "white" if (i + row) % 2 else "ivory",
                              facing=0 if face > 0 else math.pi, tuck=face * 0.2)
    TOTAL[name] = export_part(filename, name)


THIGH, SHIN = 1.0, 1.1


def build_thigh():
    """Feathered 'trousers' hanging from the hip at the origin to the knee."""
    reset_scene()
    sphere(0, -0.42, 0, 0.27, 0.64, 0.31, "white", segs=12, rings=8)
    sphere(0, -THIGH, 0, 0.17, 0.17, 0.17, "ivory", segs=10, rings=6)
    TOTAL["thigh"] = export_part("knowitowl_thigh.glb", "KnowItOwlThigh")


def build_shin():
    """Knee at the origin; feathered above, bare horn tarsus and a taloned foot
    whose sole sits SHIN below the knee. The foot is pitched toes-up so that it
    lies level on a pedal while the shin slopes back."""
    reset_scene()
    sphere(0, -0.24, 0, 0.16, 0.4, 0.17, "ivory", segs=10, rings=7)
    rod((0, -0.5, 0), (0, -0.98, 0), 0.062, "horn", verts=8)
    sphere(0, -0.98, 0, 0.085, 0.085, 0.085, "horn", segs=8, rings=5)
    pitch = 0.45
    sole = -SHIN + 0.07
    sphere(0, sole, 0.04, 0.15, 0.075, 0.17, "horn", segs=10, rings=6, rot=(pitch, 0, 0))
    toes = [(math.sin(s) * 0.4, math.cos(s) * 0.4) for s in (-0.5, 0.0, 0.5)] + [(0.0, -0.26)]
    for dx, dz in toes:
        rise = dz * math.tan(pitch) * 0.8
        tip = (dx, sole + rise, 0.04 + dz)
        rod((0, sole, 0.04), tip, 0.05, "horn", verts=7)
        sphere(*tip, 0.055, 0.055, 0.055, "horn", segs=6, rings=4)
        # Dark hooked talon curling down from each toe.
        reach = 0.1 if dz > 0 else -0.08
        cone(dx * 1.12, tip[1] - 0.05, tip[2] + reach, 0.045, 0.0, 0.16, "talon", verts=6,
             rot=(2.2 if dz > 0 else -2.2, 0, 0))
    TOTAL["shin"] = export_part("knowitowl_shin.glb", "KnowItOwlShin")


build_bike()
build_wheel()
build_crank()
build_body()
build_head()
build_wing(-1, "knowitowl_wing_l.glb", "KnowItOwlWingL")
build_wing(1, "knowitowl_wing_r.glb", "KnowItOwlWingR")
build_thigh()
build_shin()
racer = (TOTAL["bike"] + 2 * TOTAL["wheel"] + TOTAL["crank"] + TOTAL["body"] + TOTAL["head"]
         + TOTAL["KnowItOwlWingL"] + TOTAL["KnowItOwlWingR"] + 2 * (TOTAL["thigh"] + TOTAL["shin"]))
print(f"KnowItOwl on his bicycle: {racer} triangles")
