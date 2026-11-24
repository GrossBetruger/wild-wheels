"""
Build KnowItOwl (#14), the monocled snowy owl scholar on his navy-and-brass
roadster bicycle, for the Bevy rig in wasm-poc/src/knowitowl.rs. Shapes, sizes
and colours follow drawOwl and drawBicycle in characters/knowitowl/knowitowl.js.

  - knowitowl.glb       : the owl as one skinned mesh on a skeleton, with his
                          eyelids as shape keys and his moves as animation clips
  - knowitowl_bike.glb  : lugged frame, saddle, satchel, bars, lamp, bell, chain
  - knowitowl_wheel.glb : one wheel about its axle (used twice)
  - knowitowl_crank.glb : chainring, crank arms and pedals about the spindle

    blender --background --python wasm-poc/blender/build_knowitowl.py -- wasm-poc/assets/models
"""
import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

argv = sys.argv
out_dir = argv[argv.index("--") + 1] if "--" in argv else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "assets", "models")
os.makedirs(out_dir, exist_ok=True)

# Where the part being built hinges, in the racer's model space.
ORIGIN = [0.0, 0.0, 0.0]
# The bones that carry what is being built, and their shares of it.
BIND = {}
# The eyelid being built, if any; lids are kept as a mesh of their own.
LID = [None]


def place(hinge, lid=None, **bones):
    """Build what follows relative to `hinge`, carried by `bones`."""
    ORIGIN[:] = [-h for h in hinge]
    BIND.clear()
    BIND.update(bones)
    LID[0] = lid


def bind(obj):
    vertices = list(range(len(obj.data.vertices)))
    for bone, share in BIND.items():
        obj.vertex_groups.new(name=bone).add(vertices, share, "REPLACE")
    if LID[0]:
        obj.vertex_groups.new(name=LID[0]).add(vertices, 1.0, "REPLACE")
        obj["lid"] = True
    return obj


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
    # Plumage: warm downy matte white/cream with natural snowy-owl ash-taupe flecks.
    "white": ("#f7f5ee", 0.92, 0.0),
    "ivory": ("#ece7db", 0.94, 0.0),
    "down": ("#e3dccd", 0.95, 0.0),
    "fleck": ("#a99f93", 0.90, 0.0),
    "edge": ("#c6ccd2", 0.82, 0.0),
    "sigma": ("#8f62ab", 0.86, 0.0),
    "sigma_soft": ("#b89dca", 0.89, 0.0),
    "disc": ("#eae2d2", 0.91, 0.0),
    "disc_rim": ("#cfc1a6", 0.89, 0.0),
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
    BIND.clear()
    LID[0] = None
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
    return bind(obj)


def sphere(x, y, z, rx, ry, rz, material, segs=12, rings=8, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (rx, rz, ry)
    obj.rotation_euler = Euler(rot, "XYZ")
    return finish(obj, material)


def sculpted_feather(x, y, z, width, length, thickness, material, rot=(0, 0, 0), curl=0.06, tip_mat=None):
    """A broad, soft, rounded snowy-owl flight feather blade (real owls have soft
    rounded silent-flight tips, never sharp spiky daggers)."""
    bm = bmesh.new()
    steps = 7
    rings = []
    for i in range(steps + 1):
        t = i / steps
        # Broad, soft, rounded-tip feather contour
        if t < 0.15:
            w = width * (0.45 + 0.55 * (t / 0.15))
        elif t < 0.78:
            w = width * (1.0 - 0.12 * ((t - 0.15) / 0.63))
        else:
            u = (t - 0.78) / 0.22
            w = width * 0.88 * math.sqrt(max(0.02, 1.0 - u * u))
        th = thickness * (1.0 - 0.55 * t)
        cy = -t * length
        cz = math.sin(t * math.pi) * curl
        pts = [
            (-w, cy, cz),
            (-w * 0.55, cy, cz + th),
            (w * 0.55, cy, cz + th),
            (w, cy, cz),
            (w * 0.55, cy, cz - th * 0.6),
            (-w * 0.55, cy, cz - th * 0.6),
        ]
        rings.append([bm.verts.new((px, -pz, py)) for (px, py, pz) in pts])
    n = 6
    for r in range(steps):
        for j in range(n):
            jn = (j + 1) % n
            bm.faces.new((rings[r][j], rings[r][jn], rings[r + 1][jn], rings[r + 1][j]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("Feather")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Feather", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc(x, y, z)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(mat(material) if isinstance(material, str) else material)
    if tip_mat is not None:
        obj.data.materials.append(mat(tip_mat) if isinstance(tip_mat, str) else tip_mat)
        for p in obj.data.polygons:
            if p.center.z < -length * 0.76:
                p.material_index = 1
    return bind(obj)


def scale_feather(x, y, z, rx, ry, rz, material, facing=0.0, tuck=0.3):
    """Soft, flush-tucked downy contour tuft."""
    return sculpted_feather(
        x, y + ry * 0.55, z, rx * 1.05, ry * 1.65, rz * 0.55, material,
        rot=(-tuck * 0.55, 0, facing), curl=rz * 0.4,
    )


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


SIDES = {-1: "_l", 1: "_r"}
LIDS = {-1: "lid_l", 1: "lid_r"}
CHEST = (0, 3.3, -0.3)
NECK = (0, 4.3, 0.05)
CLASP = (0.84, 0.36, 0.9)
SHOULDER = (0.75, 3.55, -0.35)
HIP = (0.42, 2.75, -0.35)
BRACKET_HEIGHT, CRANK_RADIUS, SOLE = 0.95, 0.3, 0.16
# In flight the feet trail here, below and behind the hips: (height, forward).
TRAIL = (-0.9, -1.5)




def add_body():
    place((0, 0, 0), body=1.0)
    # Velvety, plush snowy-owl torso with soft downy surface (no uncanny bumpy scales!)
    torso = sphere(0, 3.35, -0.3, 1.0, 0.96, 0.73, "white", segs=40, rings=24)
    torso.data.materials.append(mat("ivory"))
    torso.data.materials.append(mat("fleck"))
    torso.data.materials.append(mat("sigma"))
    torso.data.materials.append(mat("sigma_soft"))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Paint soft snowy-owl mantle flecks on the back; draw crisp flush Sigma on the plush breast!
    for poly in torso.data.polygons:
        px = poly.center.x
        py = poly.center.z + 3.35   # WW y
        pz = -poly.center.y - 0.30  # WW z
        if pz > 0.05:
            poly.material_index = 0 if py > 3.10 else 1
        else:
            band = math.sin(py * 11.0 + math.sin(px * 6.0) * 0.9)
            speck = math.sin(px * 9.5 + py * 4.2) * math.cos(py * 7.8 - px * 3.1)
            if py > 2.8 and py < 4.05 and band > 0.62 and speck > 0.25:
                poly.material_index = 2
            elif band > 0.15:
                poly.material_index = 1
            else:
                poly.material_index = 0

    # Smooth, flush-curved purple Sigma embroidered cleanly across the plush breast
    for (ax, ay), (bx, by) in SIGMA:
        pts = []
        for s in range(7):
            t = s / 6.0
            sx = ax + (bx - ax) * t
            sy = ay + (by - ay) * t
            sz = -0.3 + 0.73 * math.sqrt(max(0.02, 1 - sx * sx - ((sy - 3.35) / 0.96) ** 2)) + 0.012
            pts.append((sx, sy, sz))
        for p, q in zip(pts, pts[1:]):
            rod(p, q, 0.048, "sigma", verts=8)
        sphere(*pts[0], 0.050, 0.050, 0.032, "sigma", segs=8, rings=5)
        sphere(*pts[-1], 0.050, 0.050, 0.032, "sigma", segs=8, rings=5)

    # Soft lower belly fluff & smooth draped collar ruff
    sphere(0, 2.86, -0.24, 0.80, 0.52, 0.64, "ivory", segs=22, rings=12)
    torus(0, 4.14, -0.22, 0.62, 0.19, "white", rot=(0.12, 0, 0), major=28, minor=10, scale=(1.08, 0.85, 0.92))

    # Softly overlapped broad rounded tail fan (7 feathers), on its own bone
    place((0, 0, 0), tail=1.0)
    for i in range(7):
        frac = (i - 3) / 3.0
        spread = frac * 0.52
        length = 0.98 - abs(frac) * 0.12
        sculpted_feather(
            spread, 3.00 - abs(frac) * 0.04, -0.94 - (1.0 - abs(frac)) * 0.04,
            0.18, length, 0.028,
            "white" if i % 2 else "ivory",
            rot=(0.46, frac * 0.20, math.pi),
            curl=-0.05,
            tip_mat="down" if i % 2 == 0 else None,
        )


def skull_surface(x, y):
    """How far forward the skull reaches at (x, y), in the head's own space."""
    inside = 1 - (x / 1.12) ** 2 - ((y - 0.45) / 1.05) ** 2
    return 0.83 * math.sqrt(inside) if inside > 0.04 else None


def add_head():
    place(NECK, head=1.0)
    sphere(0, 0.45, 0, 1.12, 1.05, 0.83, "white", segs=28, rings=16)
    for side in (-1, 1):
        place(NECK, head=1.0)
        # Plush, soft facial disc framed by a smooth downy rim (no bumpy bead ring!)
        sphere(side * 0.48, 0.48, 0.63, 0.52, 0.61, 0.24, "disc", segs=22, rings=12)
        torus(side * 0.48, 0.48, 0.72, 0.48, 0.065, "disc_rim", rot=(HALF_PI, 0, 0), major=28, minor=8, scale=(1.0, 1.18, 0.7))
        sphere(side * 0.46, 0.48, 0.8, 0.36, 0.4, 0.07, "white", segs=16, rings=8)
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
        # An eyelid over each eye: built shut here, opened below, and closed
        # again in the game by the shape key named after it.
        place(NECK, lid=LIDS[side], head=1.0)
        sphere(side * 0.43, 0.48, 0.905, 0.27, 0.27, 0.05, "disc", segs=14, rings=8)
        # Graceful sculpted ear tufts tapering to soft pointed owl-plume tips
        place(NECK, **{"tuft" + SIDES[side]: 1.0})
        for i in range(3):
            sculpted_feather(
                side * (0.68 + i * 0.10), 1.02 + i * 0.06, -0.05 - i * 0.04,
                0.13 - i * 0.015, 0.46 - i * 0.06, 0.04,
                "white" if i != 1 else "ivory",
                rot=(math.pi - 0.15, side * (-0.36 - i * 0.08), 0),
                curl=0.04,
                tip_mat="fleck" if i == 2 else None,
            )
    place(NECK, head=1.0)
    # Soft nape feathers blending smoothly down the back of the head (chase camera view)
    rng_h = random.Random(1402)
    for row in range(3):
        for i in range(5):
            a = (i - 2.0) * 0.36 + rng_h.uniform(-0.04, 0.04)
            x, y = math.sin(a) * (0.90 - row * 0.06), 1.05 - row * 0.34
            z = skull_surface(x, y)
            if z is not None:
                sculpted_feather(
                    x, y + 0.06, -z - 0.01,
                    0.20, 0.34, 0.025,
                    "ivory" if (row + i) % 2 else "white",
                    rot=(0.14, 0, math.pi - a),
                    curl=-0.02,
                    tip_mat="fleck" if (row == 1 and i % 2 == 0) else None,
                )
    # Hooked beak: a rounded cere and a tip that curves down.
    sphere(0, 0.2, 0.9, 0.15, 0.17, 0.17, "horn", segs=10, rings=7)
    cone(0, 0.05, 0.98, 0.13, 0.0, 0.34, "horn", verts=10, rot=(2.5, 0, 0))
    # Gold monocle on the right eye; its chain swings from the clasp to a fob.
    torus(0.46, 0.48, 0.96, 1.0, 0.065, "brass", rot=(HALF_PI, 0, 0), major=32, minor=6,
          scale=(0.39, 0.39, 0.43))
    sphere(*CLASP, 0.05, 0.05, 0.05, "brass", segs=6, rings=4)
    place(NECK, chain=1.0)
    links = [CLASP, (0.93, -0.25, 0.6), (0.6, -0.6, 0.65)]
    for (ax, ay, az), (bx, by, bz) in zip(links, links[1:]):
        for i in range(1, 8):
            t = i / 8
            sag = math.sin(t * math.pi) * 0.05
            sphere(ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t, 0.03, 0.03, 0.03,
                   "brass" if i % 2 else "brass_aged", segs=5, rings=3)
    sphere(0.6, -0.66, 0.65, 0.075, 0.09, 0.04, "brass", segs=8, rings=5)


def wing_weights(side, along):
    """Shares of the upper-arm, forearm and hand bones for a feather `along`
    the wing from shoulder (0) to tip (1), so the fan opens feather by feather."""
    upper, hand = max(0.0, 1 - 2 * along), max(0.0, 2 * along - 1)
    shares = {"wing_upper": upper, "wing_fore": 1 - upper - hand, "wing_hand": hand}
    return {bone + SIDES[side]: share for bone, share in shares.items() if share > 0.0}


def add_wing(side):
    """A soft, cohesive, broad-feathered snowy-owl wing hanging from its
    shoulder; +x * side points away from the body."""
    shoulder = (SHOULDER[0] * side, SHOULDER[1], SHOULDER[2])
    # Smooth, plush curved wing-shoulder / covert pillow (no scaly plates!)
    place(shoulder, **wing_weights(side, 0.0))
    sphere(side * 0.52, -0.24, 0.02, 0.72, 0.64, 0.25, "white", segs=22, rings=12, rot=(0.0, side * -0.18, 0.0))
    place(shoulder, **wing_weights(side, 0.3))
    sphere(side * 0.96, -0.44, -0.02, 0.62, 0.46, 0.18, "ivory", segs=18, rings=10, rot=(0.0, side * -0.28, 0.0))
    # Nine broad, tightly-overlapping, rounded-tip primary & secondary feathers
    for i in range(9):
        t = i / 8.0
        x = 0.16 + i * 0.175
        y = -0.18 - i * 0.085
        length = 1.05 + i * 0.12
        splay = side * (-0.04 - t * 0.15)
        place(shoulder, **wing_weights(side, t))
        sculpted_feather(
            side * x, y, -0.02 - i * 0.012,
            0.22 - t * 0.02,
            length,
            0.036,
            "white" if i % 2 else "ivory",
            rot=(0.08, splay, 0.0),
            curl=0.09 + t * 0.03,
            tip_mat="down" if i < 5 else "fleck",
        )


THIGH, SHIN, ANKLE = 1.0, 1.1, 0.98


def add_leg(side):
    """One leg hanging straight down from its hip: feathered 'trousers' as a
    single skin that bends at the knee, a bare horn tarsus, and a level taloned
    foot whose sole sits THIGH + SHIN below the hip."""
    hip = (HIP[0] * side, HIP[1], HIP[2])
    thigh, shin, foot = "thigh" + SIDES[side], "shin" + SIDES[side], "foot" + SIDES[side]
    place(hip)
    # (drop below the hip, half-width, half-depth, colour, share of the shin bone)
    rings = [(-0.05, 0.2, 0.22, "white", 0.0), (0.15, 0.26, 0.3, "white", 0.0), (0.45, 0.27, 0.31, "white", 0.0),
             (0.75, 0.21, 0.24, "white", 0.0), (0.9, 0.18, 0.19, "ivory", 0.2), (1.0, 0.17, 0.175, "ivory", 0.5),
             (1.1, 0.165, 0.17, "ivory", 0.8), (1.25, 0.16, 0.17, "ivory", 1.0), (1.45, 0.12, 0.13, "ivory", 1.0),
             (1.56, 0.065, 0.065, "ivory", 1.0)]
    around = 12
    bm = bmesh.new()
    loops = [[bm.verts.new(loc(math.cos(i * math.tau / around) * rx, -drop, math.sin(i * math.tau / around) * rz))
              for i in range(around)] for drop, rx, rz, _, _ in rings]
    mesh = bpy.data.meshes.new("Leg")
    for colour in ("white", "ivory"):
        mesh.materials.append(mat(colour))
    for upper, lower, ring in zip(loops, loops[1:], rings):
        for i in range(around):
            face = bm.faces.new((upper[i], upper[(i + 1) % around], lower[(i + 1) % around], lower[i]))
            face.material_index = 0 if ring[3] == "white" else 1
    bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    trousers = bpy.data.objects.new("Leg", mesh)
    bpy.context.collection.objects.link(trousers)
    for bone in (thigh, shin):
        trousers.vertex_groups.new(name=bone)
    for index, ring in enumerate(rings):
        row = list(range(index * around, (index + 1) * around))
        trousers.vertex_groups[thigh].add(row, 1 - ring[4], "REPLACE")
        trousers.vertex_groups[shin].add(row, ring[4], "REPLACE")
    place(hip, **{shin: 1.0})
    rod((0, -1.5, 0), (0, -THIGH - ANKLE, 0), 0.062, "horn", verts=8)
    place(hip, **{foot: 1.0})
    sphere(0, -THIGH - ANKLE, 0, 0.085, 0.085, 0.085, "horn", segs=8, rings=5)
    sole = -THIGH - SHIN + 0.07
    sphere(0, sole, 0.04, 0.15, 0.075, 0.17, "horn", segs=10, rings=6)
    toes = [(math.sin(s) * 0.4, math.cos(s) * 0.4) for s in (-0.5, 0.0, 0.5)] + [(0.0, -0.26)]
    for dx, dz in toes:
        tip = (dx, sole, 0.04 + dz)
        rod((0, sole, 0.04), tip, 0.05, "horn", verts=7)
        sphere(*tip, 0.055, 0.055, 0.055, "horn", segs=6, rings=4)
        # Dark hooked talon curling down from each toe.
        reach = 0.1 if dz > 0 else -0.08
        cone(dx * 1.12, tip[1] - 0.05, tip[2] + reach, 0.045, 0.0, 0.16, "talon", verts=6,
             rot=(2.2 if dz > 0 else -2.2, 0, 0))


# =============================================================================
# SKELETON
# =============================================================================
def skeleton():
    """Every bone: (name, parent, hinge in model space)."""
    bones = [("body", None, CHEST), ("tail", "body", (0, 3.0, -0.9)), ("head", "body", NECK),
             ("chain", "head", tuple(n + c for n, c in zip(NECK, CLASP)))]
    for side, tag in SIDES.items():
        sx, sy, sz = SHOULDER[0] * side, SHOULDER[1], SHOULDER[2]
        hx, hy, hz = HIP[0] * side, HIP[1], HIP[2]
        bones += [
            ("tuft" + tag, "head", (NECK[0] + side * 0.7, NECK[1] + 1.0, NECK[2] - 0.05)),
            ("wing_upper" + tag, "body", (sx, sy, sz)),
            ("wing_fore" + tag, "wing_upper" + tag, (sx + side * 0.62, sy - 0.4, sz)),
            ("wing_hand" + tag, "wing_fore" + tag, (sx + side * 1.15, sy - 0.66, sz)),
            ("thigh" + tag, "body", (hx, hy, hz)),
            ("shin" + tag, "thigh" + tag, (hx, hy - THIGH, hz)),
            ("foot" + tag, "shin" + tag, (hx, hy - THIGH - ANKLE, hz)),
        ]
    return bones


LEGS = [bone + tag for tag in SIDES.values() for bone in ("thigh", "shin", "foot")]
UPPER = [name for name, _, _ in skeleton() if name not in LEGS]


def build_armature():
    """Bones lie along Blender's +Y with no roll, so each joint's own axes are
    the model's axes: a rotation about a bone's x is a rotation about the
    racer's x, and things parented to a joint in the game sit in model axes."""
    data = bpy.data.armatures.new("KnowItOwlRig")
    rig = bpy.data.objects.new("KnowItOwlRig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    ORIGIN[:] = (0, 0, 0)
    for name, parent, hinge in skeleton():
        bone = data.edit_bones.new(name)
        bone.head = loc(*hinge)
        bone.tail = Vector(loc(*hinge)) + Vector((0, 0.3, 0))
        bone.roll = 0.0
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in data.bones:
        assert (bone.matrix_local.to_3x3() - Matrix.Identity(3)).median_scale < 1e-5, bone.name
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
    return rig


# =============================================================================
# CLIPS
# =============================================================================
# Poses are written in model space: a turn about the racer's own x, y or z
# axis at each bone's hinge, relative to its parent.
def RX(angle):
    return Quaternion((1, 0, 0), angle)


def RY(angle):
    return Quaternion((0, 1, 0), angle)


def RZ(angle):
    return Quaternion((0, 0, 1), angle)


def wave(cycle, turns=1, lag=0.0):
    return math.sin(math.tau * turns * cycle - lag)


def leg_angles(height, forward):
    """Turns about x for a thigh and for the shin below it so the sole reaches
    (height, forward), with the knee bent forward."""
    reach = (height - HIP[1], forward - HIP[2])
    distance = max(abs(THIGH - SHIN) + 0.02, min(THIGH + SHIN - 0.01, math.hypot(*reach)))
    toward = math.atan2(-reach[1], -reach[0])
    bend = math.acos(max(-1.0, min(1.0, (THIGH ** 2 + distance ** 2 - SHIN ** 2) / (2 * THIGH * distance))))
    thigh = toward - bend
    knee = (-math.cos(thigh) * THIGH, -math.sin(thigh) * THIGH)
    sole = (-math.cos(toward) * distance - knee[0], -math.sin(toward) * distance - knee[1])
    return thigh, math.atan2(-sole[1], -sole[0])


def legs(pose, side, height, forward, foot):
    """Bend one leg to put its sole at (height, forward), its foot turned `foot`
    from level."""
    thigh, shin = leg_angles(height, forward)
    pose["thigh" + SIDES[side]] = RX(thigh)
    pose["shin" + SIDES[side]] = RX(shin - thigh)
    pose["foot" + SIDES[side]] = RX(foot - shin)


def wings(pose, side, upper, fore=0.0, hand=0.0, feather=0.0):
    """Open one wing: each bone's spread adds to the one before it."""
    pose["wing_upper" + SIDES[side]] = RZ(side * upper) @ RX(feather)
    pose["wing_fore" + SIDES[side]] = RZ(side * fore)
    pose["wing_hand" + SIDES[side]] = RZ(side * hand)


def perched(cycle):
    """The upper body at rest: wings folded and ruffling, a slow look around."""
    pose = {
        "body": RX(0.012 * wave(cycle, 2)),
        "head": RY(0.14 * wave(cycle)) @ RX(0.03 * wave(cycle, 2, 0.5)),
        "chain": RZ(0.07 * wave(cycle, 2)) @ RX(0.05 * wave(cycle, 1, 0.4)),
        "tail": RY(0.07 * wave(cycle, 1, 0.8)),
    }
    for side in SIDES:
        pose["tuft" + SIDES[side]] = RX(0.06 * wave(cycle, 3, side))
        wings(pose, side, 0.07 + 0.1 * wave(cycle, 2), 0.04 * wave(cycle, 2, 0.6), 0.06 * wave(cycle, 2, 1.2))
    return pose


def still():
    """The folded upper body that gestures start from."""
    pose = {bone: Quaternion() for bone in UPPER}
    for side in SIDES:
        wings(pose, side, 0.1)
    return pose


def clip_pedal(cycle):
    """One turn of the crank: each sole stays on its pedal."""
    pose, turn = {}, math.tau * cycle
    for side in SIDES:
        height = BRACKET_HEIGHT + SOLE + math.cos(turn) * CRANK_RADIUS * side
        legs(pose, side, height, math.sin(turn) * CRANK_RADIUS * side, 0.12 * math.sin(turn) * side)
    return pose


def clip_fly(cycle):
    """Two wingbeats: the stroke runs out along the wing, so the tips lag the
    shoulders, and the body rides the beat."""
    beat = 2
    stroke = wave(cycle, beat)
    pose = {
        "body": (RX(0.2), (0, -0.12 * stroke + 0.08 * wave(cycle), 0)),
        "head": RX(-0.16 + 0.03 * wave(cycle, beat, 0.5)),
        "chain": RX(0.5 + 0.1 * wave(cycle, beat, 1.0)) @ RZ(0.06 * wave(cycle)),
        "tail": RX(-0.22 + 0.08 * wave(cycle, beat, 0.8)),
    }
    for side in SIDES:
        pose["tuft" + SIDES[side]] = RX(-0.35 + 0.08 * wave(cycle, beat * 2, side))
        wings(pose, side, 0.55 + 0.38 * stroke, 0.22 + 0.22 * wave(cycle, beat, 0.6),
              0.22 + 0.3 * wave(cycle, beat, 1.2), 0.24 * math.cos(math.tau * beat * cycle))
    return pose


def clip_trail(cycle):
    """Legs in flight: trailing under the tail, talons curled, swaying a little."""
    pose = {}
    for side in SIDES:
        legs(pose, side, HIP[1] + TRAIL[0] + 0.08 * wave(cycle, 1, side), HIP[2] + TRAIL[1], 0.6)
    return pose


def clip_wave(cycle):
    pose = still()
    pose["head"] = RZ(-0.08) @ RY(0.1)
    wings(pose, 1, 1.0, 0.45 + 0.35 * wave(cycle, 2), 0.35 + 0.4 * wave(cycle, 2, 0.8))
    return pose


def clip_cheer(cycle):
    pose = still()
    pose["body"], pose["head"], pose["tail"] = RX(0.15), RX(0.3), RX(-0.2)
    for side in SIDES:
        wings(pose, side, 0.95 + 0.08 * wave(cycle, 2), 0.3 + 0.1 * wave(cycle, 2, 0.6), 0.25)
    return pose


def clip_wink(cycle):
    pose = still()
    pose["head"] = RZ(0.3) @ RX(0.06)
    pose["tuft_l"] = RX(0.1 * wave(cycle, 2))
    return pose


def clip_flourish(cycle):
    pose = still()
    pose["body"] = RY(0.45 * wave(cycle))
    pose["chain"] = RZ(-0.3 * wave(cycle, 1, 0.5))
    for side in SIDES:
        wings(pose, side, 1.2, 0.3 + 0.08 * wave(cycle, 2), 0.25)
    return pose


def clip_monocle(cycle):
    """The right wingtip comes up to adjust the monocle."""
    pose = still()
    pose["head"] = RX(0.05)
    reach = Vector((NECK[0] + 0.46 + 0.32 - SHOULDER[0], NECK[1] + 0.43 - SHOULDER[1], NECK[2] + 1.06 - SHOULDER[2]))
    held = Vector((0.9, -1.6, 0.0)).rotation_difference(reach)
    pose["wing_upper_r"] = held @ RY(0.03 * wave(cycle, 2))
    pose["wing_fore_r"] = pose["wing_hand_r"] = Quaternion()
    return pose


# (name, frames at 30 a second, bones it moves, pose at each point of its cycle)
CLIPS = [
    ("pedal", 32, LEGS, clip_pedal),
    ("trail", 42, LEGS, clip_trail),
    ("perch", 120, UPPER, perched),
    ("fly", 42, UPPER, clip_fly),
    ("wave", 30, UPPER, clip_wave),
    ("cheer", 30, UPPER, clip_cheer),
    ("wink", 30, UPPER, clip_wink),
    ("flourish", 45, UPPER, clip_flourish),
    ("monocle", 30, UPPER, clip_monocle),
]
# Model space -> Blender space, as `loc` does for points.
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def placements(pose):
    """Where a pose puts every bone, as armature-space matrices."""
    placed, moved = {}, {}
    for name, parent, hinge in skeleton():
        turn, shift = pose.get(name, Quaternion()), (0, 0, 0)
        if isinstance(turn, tuple):
            turn, shift = turn
        about = Matrix.Translation(hinge) @ turn.to_matrix().to_4x4() @ Matrix.Translation(hinge).inverted()
        moved[name] = moved.get(parent, Matrix.Identity(4)) @ Matrix.Translation(shift) @ about
        placed[name] = TO_BLENDER @ moved[name] @ TO_BLENDER.inverted()
    return placed


def set_pose(rig, pose, bones=None, frame=None, last=None):
    """Pose the rig; with a frame, key the listed bones there."""
    placed = placements(pose)
    for name, parent, _ in skeleton():
        bone = rig.pose.bones[name]
        rest = rig.data.bones[name].matrix_local
        at_rest, parent_now = rest, Matrix.Identity(4)
        if parent:
            parent_rest = rig.data.bones[parent].matrix_local
            at_rest, parent_now = parent_rest.inverted() @ rest, placed[parent] @ parent_rest
        bone.matrix_basis = at_rest.inverted() @ parent_now.inverted() @ placed[name] @ rest
        if frame is None or name not in bones:
            continue
        # Keep each key on the same side of the quaternion sphere as the last.
        if last is not None and name in last and bone.rotation_quaternion.dot(last[name]) < 0:
            bone.rotation_quaternion.negate()
        if last is not None:
            last[name] = bone.rotation_quaternion.copy()
        bone.keyframe_insert("rotation_quaternion", frame=frame)
        bone.keyframe_insert("location", frame=frame)


def author_clips(rig):
    """One action per clip, each stashed on its own NLA track for the exporter.
    A clip keys only the bones it moves, so the game can layer legs and upper
    body from different clips."""
    rig.animation_data_create()
    bpy.context.scene.render.fps = 30
    for name, frames, bones, pose_at in CLIPS:
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        last = {}
        for frame in range(frames + 1):
            set_pose(rig, pose_at(frame / frames), bones, frame, last)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        rig.animation_data.action = None
        set_pose(rig, {})
    bpy.context.scene.frame_end = max(frames for _, frames, _, _ in CLIPS)


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    obj.data.update()
    return obj


def open_lids(lids):
    """The lids were built shut. Keep that as one shape key per eye, and rest
    them open: folded to a sliver tucked under each brow."""
    shut = [vertex.co.copy() for vertex in lids.data.vertices]
    groups = {lids.vertex_groups[name].index: name for name in LIDS.values()}
    owner = [next(groups[g.group] for g in vertex.groups if g.group in groups) for vertex in lids.data.vertices]
    brow = NECK[1] + 0.48 + 0.25
    for vertex in lids.data.vertices:
        vertex.co.z = brow + (vertex.co.z - brow) * 0.06
        vertex.co.y += 0.03
    lids.shape_key_add(name="Basis")
    for name in LIDS.values():
        key = lids.shape_key_add(name=name)
        for index, co in enumerate(shut):
            if owner[index] == name:
                key.data[index].co = co
        key.value = 0.0
    for name in LIDS.values():
        lids.vertex_groups.remove(lids.vertex_groups[name])


def build_owl():
    reset_scene()
    add_body()
    add_head()
    for side in SIDES:
        add_wing(side)
        add_leg(side)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    eyelids = [obj for obj in meshes if obj.get("lid")]
    rest = [obj for obj in meshes if not obj.get("lid")]
    lids, owl = join(eyelids, "KnowItOwlLids"), join(rest, "KnowItOwl")
    open_lids(lids)
    rig = build_armature()
    for skin in (owl, lids):
        skin.parent = rig
        skin.modifiers.new("Armature", "ARMATURE").object = rig
    author_clips(rig)
    triangles = sum(len(p.vertices) - 2 for skin in (owl, lids) for p in skin.data.polygons)
    path = os.path.join(out_dir, "knowitowl.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_materials="EXPORT",
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=False,
    )
    print(f"Exported KnowItOwl -> {path} ({triangles} triangles, {len(CLIPS)} clips, "
          f"{os.path.getsize(path) // 1024} KiB)")
    TOTAL["owl"] = triangles
    return rig


if __name__ == "__main__":
    build_bike()
    build_wheel()
    build_crank()
    build_owl()
    racer = TOTAL["bike"] + 2 * TOTAL["wheel"] + TOTAL["crank"] + TOTAL["owl"]
    print(f"KnowItOwl on his bicycle: {racer} triangles")
