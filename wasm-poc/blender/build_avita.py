"""
Build faithful, lived-in PBR glTF (.glb) models of Avita-Jas (driver #8:
tiny aviator earthworm in a trusty weathered Cessna 172 Skyhawk):
  - wasm-poc/assets/models/avita_worm.glb  (skinned earthworm pilot with leather
                                            aviator cap, shearling trim, brass
                                            goggles, woven cloth aviator scarf
                                            with offline wind-physics shape keys,
                                            and animation clips: cruise, boost,
                                            accordion, wing_waggle)
  - wasm-poc/assets/avita_plane.glb        (weathered Cessna 172 fuselage, open
                                            cockpit, high airfoil wing + struts,
                                            tricycle gear, tailplane; pass --all)
  - wasm-poc/assets/avita_prop.glb         (pivot-centered twisted airfoil
                                            propeller w/ yellow tips; pass --all)

Run:
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_avita.py
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_avita.py -- --all
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Vector, Euler

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import rigging
import strands
from rigging import RX, RY, RZ, wave, ease

ROOT = os.path.abspath(os.path.join(HERE, ".."))
ASSETS_DIR = os.path.join(ROOT, "assets")
MODELS_DIR = os.path.join(ASSETS_DIR, "models")
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

Y0 = 0.13

# Scarf offline wind-physics passes: (shape-key prefix, frames, frames/sec).
# `avita.rs` reads these exact counts and rates.
SCARF_IDLE = ("idle", 12, 6)
SCARF_BOOST = ("boost", 10, 10)
SCARF_PASSES = (SCARF_IDLE, SCARF_BOOST)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# Wild Wheels (x=right, y=up, z=forward) -> Blender (X=x, Y=-z, Z=y)
# Blender glTF export_yup=True maps (X, Y, Z) -> (X, Z, -Y) = (x, y, z)!
def loc(x, y, z):
    return (x, -z, y)


def hex_to_linear(h):
    h = h.lstrip("#")
    vals = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in vals)


def make_mat(name, hex_color, roughness=0.45, metallic=0.0, emission=0.0, emission_color=None):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*hex_to_linear(hex_color), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0.0:
        ec = hex_to_linear(emission_color or hex_color)
        bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def add_ellipsoid(name, x, y, z, rx, ry, rz, mat, segs=24, rings=14, rot_xyz=(0, 0, 0), bind=False):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (rx, rz, ry)
    if rot_xyz != (0, 0, 0):
        obj.rotation_euler = Euler((rot_xyz[0], -rot_xyz[2], rot_xyz[1]), "XYZ")
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    obj.data.materials.append(mat)
    smooth(obj)
    if bind:
        rigging.bind(obj)
    return obj


def add_box(name, x, y, z, sx, sy, sz, mat, bevel=0.03, rot_xyz=(0, 0, 0), bind=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sz, sy)
    if rot_xyz != (0, 0, 0):
        obj.rotation_euler = Euler((rot_xyz[0], -rot_xyz[2], rot_xyz[1]), "XYZ")
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    smooth(obj)
    if bind:
        rigging.bind(obj)
    return obj


def add_cyl_between(name, p1, p2, r1, r2, mat, segs=14, bind=False):
    v1 = Vector(loc(*p1))
    v2 = Vector(loc(*p2))
    diff = v2 - v1
    length = diff.length
    if length < 1e-4:
        return None
    mid = (v1 + v2) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=segs, radius1=r1, radius2=r2, depth=length, location=mid
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = diff.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(rotation=True)
    obj.data.materials.append(mat)
    smooth(obj)
    if bind:
        rigging.bind(obj)
    return obj


def export_glb(filename):
    path = os.path.join(ASSETS_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_materials="EXPORT",
        export_apply=True,
    )
    print(f"[avita] Exported {path} ({os.path.getsize(path)} bytes)")


# ---------------------------------------------------------------------------
# 1. Weathered Cessna 172 Skyhawk (avita_plane.glb)
#    All heights include the +0.13 base offset from client/renderer.js:497
# ---------------------------------------------------------------------------
def build_plane():
    clear_scene()

    m_white = make_mat("CessnaCream", "#e8ebe0", roughness=0.34, metallic=0.22)
    m_soot_white = make_mat("CessnaBelly", "#cfd3c8", roughness=0.52, metallic=0.28)
    m_amber = make_mat("AvitaAmber", "#e69d52", roughness=0.28, metallic=0.16)
    m_amber_dark = make_mat("AvitaTrim", "#b86b24", roughness=0.42, metallic=0.20)
    m_dark = make_mat("CockpitDark", "#2d3944", roughness=0.68, metallic=0.18)
    m_steel = make_mat("StrutSteel", "#3d4c59", roughness=0.38, metallic=0.78)
    m_chrome = make_mat("Chrome", "#dce4e8", roughness=0.14, metallic=0.95)
    m_exhaust = make_mat("ExhaustHeat", "#4c3c34", roughness=0.55, metallic=0.72)
    m_glass = make_mat("Windscreen", "#84c2d1", roughness=0.08, metallic=0.15)
    m_tire = make_mat("TireRubber", "#1f242b", roughness=0.88, metallic=0.02)
    m_hub = make_mat("HubAluminum", "#b8c7cb", roughness=0.26, metallic=0.85)
    m_nav_r = make_mat("NavRed", "#ff3b30", roughness=0.15, emission=3.2, emission_color="#ff3020")
    m_nav_g = make_mat("NavGreen", "#34e865", roughness=0.15, emission=3.2, emission_color="#28f058")
    m_beacon = make_mat("TailBeacon", "#ff5238", roughness=0.2, emission=3.8, emission_color="#ff4528")
    m_dash = make_mat("InstrumentDash", "#1c2229", roughness=0.72, metallic=0.1)
    m_gauge = make_mat("GaugeDial", "#78e0ff", roughness=0.2, emission=1.2, emission_color="#60d5ff")

    sections = [
        (-3.25, 1.50, 0.16, 0.20),
        (-2.55, 1.46, 0.34, 0.36),
        (-1.60, 1.38, 0.62, 0.56),
        (-0.45, 1.32, 0.84, 0.72),
        (0.75, 1.36, 0.84, 0.70),
        (1.65, 1.50, 0.78, 0.64),
        (2.48, 1.58, 0.64, 0.54),
        (2.84, 1.62, 0.42, 0.38),
    ]
    bm = bmesh.new()
    segs = 22
    rings = []
    for z, yc, rx, ry in sections:
        ring = []
        for i in range(segs):
            a = (i / segs) * math.tau
            x = math.cos(a) * rx
            y = yc + math.sin(a) * ry + Y0
            if math.sin(a) < -0.5:
                y += (-0.5 - math.sin(a)) * 0.08 * ry
            ring.append(bm.verts.new(loc(x, y, z)))
        rings.append(ring)
    for r in range(len(rings) - 1):
        for i in range(segs):
            inext = (i + 1) % segs
            bm.faces.new((rings[r][i], rings[r][inext], rings[r + 1][inext], rings[r + 1][i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    fuse_mesh = bpy.data.meshes.new("Fuselage")
    bm.to_mesh(fuse_mesh)
    bm.free()
    fuse_obj = bpy.data.objects.new("Fuselage", fuse_mesh)
    bpy.context.collection.objects.link(fuse_obj)
    fuse_obj.data.materials.append(m_white)
    fuse_obj.data.materials.append(m_soot_white)
    for poly in fuse_obj.data.polygons:
        poly.use_smooth = True
        cz = poly.center.z
        poly.material_index = 1 if cz < 1.12 + Y0 else 0

    add_box("BellyStripe", 0, 1.07 + Y0, 0.55, 1.50, 0.22, 3.85, m_amber, bevel=0.05)
    for side in (-1, 1):
        add_box(f"SideLivery_{side}", side * 0.80, 1.38 + Y0, 0.45, 0.08, 0.24, 3.40, m_amber, bevel=0.025)
        add_box(f"SideAccent_{side}", side * 0.84, 1.53 + Y0, 0.50, 0.05, 0.08, 2.75, m_amber_dark, bevel=0.015)
        add_ellipsoid(f"CowlIntake_{side}", side * 0.44, 1.44 + Y0, 2.74, 0.17, 0.11, 0.08, m_dark, segs=14, rings=8)
        add_cyl_between(f"Exhaust_{side}", (side * 0.24, 1.04 + Y0, 2.35), (side * 0.28, 0.82 + Y0, 2.02), 0.055, 0.06, m_exhaust)

    add_cyl_between("SpinnerBack", (0, 1.65 + Y0, 2.82), (0, 1.65 + Y0, 2.92), 0.35, 0.34, m_chrome, segs=22)
    add_cyl_between("SpinnerCone", (0, 1.65 + Y0, 2.92), (0, 1.65 + Y0, 3.42), 0.33, 0.04, m_amber, segs=22)

    add_box("CockpitFloor", 0, 1.62 + Y0, -0.35, 1.18, 0.16, 1.38, m_dash, bevel=0.03)
    add_box("CockpitSeatBack", 0, 1.98 + Y0, -0.98, 1.14, 0.56, 0.18, m_amber_dark, bevel=0.04)
    for side in (-1, 1):
        add_box(f"CockpitCoaming_{side}", side * 0.59, 1.94 + Y0, -0.32, 0.14, 0.42, 1.44, m_dark, bevel=0.04)
    add_box("InstrumentPanel", 0, 1.98 + Y0, 0.42, 1.12, 0.32, 0.22, m_dash, bevel=0.02)
    for gx in (-0.34, -0.11, 0.11, 0.34):
        add_ellipsoid(f"Gauge_{gx}", gx, 2.02 + Y0, 0.30, 0.075, 0.075, 0.02, m_gauge, segs=12, rings=6)
    add_box("WindscreenGlass", 0, 2.12 + Y0, 0.78, 1.28, 0.56, 0.09, m_glass, bevel=0.02, rot_xyz=(0.34, 0, 0))
    for side in (-1, 1):
        add_cyl_between(f"WindPillar_{side}", (side * 0.64, 1.84 + Y0, 0.88), (side * 0.62, 2.38 + Y0, 0.66), 0.035, 0.035, m_chrome)
    add_cyl_between("WindTopFrame", (-0.63, 2.38 + Y0, 0.66), (0.63, 2.38 + Y0, 0.66), 0.035, 0.035, m_chrome)

    bm = bmesh.new()
    wing_span = 7.45
    airfoil = [
        (0.76, 0.00), (0.62, 0.09), (0.35, 0.13), (0.00, 0.11),
        (-0.40, 0.06), (-0.76, -0.01), (-0.40, -0.04), (0.10, -0.05),
        (0.55, -0.04),
    ]
    w_xs = [-wing_span / 2, -2.6, 0.0, 2.6, wing_span / 2]
    w_rings = []
    for wx in w_xs:
        taper = 0.86 if abs(wx) > 3.2 else 1.0
        dihedral = abs(wx) * 0.032
        ring = []
        for az, ay in airfoil:
            ring.append(bm.verts.new(loc(wx, 3.12 + Y0 + dihedral + ay * taper, -0.80 + az * taper)))
        w_rings.append(ring)
    nf = len(airfoil)
    for r in range(len(w_rings) - 1):
        for i in range(nf):
            inext = (i + 1) % nf
            bm.faces.new((w_rings[r][i], w_rings[r][inext], w_rings[r + 1][inext], w_rings[r + 1][i]))
    bm.faces.new(w_rings[0][::-1])
    bm.faces.new(w_rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    wmesh = bpy.data.meshes.new("HighWing")
    bm.to_mesh(wmesh)
    bm.free()
    wobj = bpy.data.objects.new("HighWing", wmesh)
    bpy.context.collection.objects.link(wobj)
    wobj.data.materials.append(m_white)
    smooth(wobj)

    for side in (-1, 1):
        tip_y = 3.24 + Y0 + 3.6 * 0.032
        add_box(f"WingTip_{side}", side * 3.55, tip_y, -0.80, 0.62, 0.12, 1.42, m_amber, bevel=0.04)
        add_ellipsoid(
            f"NavLight_{side}", side * 3.84, tip_y, -0.22, 0.08, 0.07, 0.12,
            m_nav_r if side < 0 else m_nav_g, segs=12, rings=8
        )
        add_cyl_between(
            f"WingStrut_{side}",
            (side * 0.72, 1.12 + Y0, -0.58),
            (side * 2.88, 3.16 + Y0, -0.68),
            0.055, 0.048, m_steel, segs=10,
        )
        add_cyl_between(
            f"MainGearLeg_{side}",
            (side * 0.64, 1.18 + Y0, -0.28),
            (side * 1.14, 0.46 + Y0, -0.30),
            0.065, 0.055, m_steel, segs=10,
        )
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.46, depth=0.24, location=loc(side * 1.15, 0.46 + Y0, -0.30))
        tire = bpy.context.active_object
        tire.name = f"MainTire_{side}"
        tire.rotation_euler = Euler((0, math.pi / 2, 0), "XYZ")
        bpy.ops.object.transform_apply(rotation=True)
        mod = tire.modifiers.new("Bevel", "BEVEL")
        mod.width = 0.06
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier="Bevel")
        tire.data.materials.append(m_tire)
        smooth(tire)
        add_ellipsoid(f"MainHub_{side}", side * 1.28, 0.46 + Y0, -0.30, 0.05, 0.22, 0.22, m_hub, segs=14, rings=8)

    add_cyl_between("NoseGearLeg", (0, 1.12 + Y0, 2.02), (0, 0.42 + Y0, 2.08), 0.055, 0.048, m_chrome, segs=10)
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.35, depth=0.19, location=loc(0, 0.38 + Y0, 2.08))
    ntire = bpy.context.active_object
    ntire.name = "NoseTire"
    ntire.rotation_euler = Euler((0, math.pi / 2, 0), "XYZ")
    bpy.ops.object.transform_apply(rotation=True)
    mod = ntire.modifiers.new("Bevel", "BEVEL")
    mod.width = 0.045
    mod.segments = 2
    bpy.ops.object.modifier_apply(modifier="Bevel")
    ntire.data.materials.append(m_tire)
    smooth(ntire)
    for side in (-1, 1):
        add_ellipsoid(f"NoseHub_{side}", side * 0.10, 0.38 + Y0, 2.08, 0.03, 0.16, 0.16, m_hub, segs=12, rings=6)

    add_box("TailPlane", 0, 1.50 + Y0, -2.85, 3.08, 0.12, 0.86, m_white, bevel=0.04)
    for side in (-1, 1):
        add_box(f"TailTip_{side}", side * 1.48, 1.50 + Y0, -2.85, 0.18, 0.13, 0.86, m_amber, bevel=0.03)
    bm = bmesh.new()
    fin_pts = [
        (-0.07, 1.50 + Y0, -2.28), (-0.07, 1.50 + Y0, -3.34),
        (-0.05, 2.74 + Y0, -3.30), (-0.05, 2.74 + Y0, -2.74),
    ]
    vL = [bm.verts.new(loc(x, y, z)) for (x, y, z) in fin_pts]
    vR = [bm.verts.new(loc(-x, y, z)) for (x, y, z) in fin_pts]
    bm.faces.new(vL)
    bm.faces.new(vR[::-1])
    for i in range(4):
        inext = (i + 1) % 4
        bm.faces.new((vL[i], vR[i], vR[inext], vL[inext]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    fmesh = bpy.data.meshes.new("VerticalFin")
    bm.to_mesh(fmesh)
    bm.free()
    fobj = bpy.data.objects.new("VerticalFin", fmesh)
    bpy.context.collection.objects.link(fobj)
    fobj.data.materials.append(m_amber)
    smooth(fobj)
    add_box("FinCap", 0, 2.79 + Y0, -3.02, 0.15, 0.12, 0.64, m_white, bevel=0.03)
    add_ellipsoid("TailBeacon", 0, 2.91 + Y0, -3.04, 0.065, 0.075, 0.065, m_beacon, segs=10, rings=6)

    export_glb("avita_plane.glb")


# ---------------------------------------------------------------------------
# 2. Pivot-centered Twisted Airfoil Propeller (avita_prop.glb)
# ---------------------------------------------------------------------------
def build_propeller():
    clear_scene()
    m_blade = make_mat("PropSteel", "#2c3a46", roughness=0.28, metallic=0.82)
    m_tip = make_mat("PropYellowTip", "#f8d86e", roughness=0.35, metallic=0.10, emission=0.25, emission_color="#ffe27a")
    m_hub = make_mat("PropHub", "#cdd8dc", roughness=0.18, metallic=0.92)

    add_ellipsoid("PropHub", 0, 0, 0, 0.15, 0.15, 0.12, m_hub, segs=16, rings=10)
    for side in (-1, 1):
        add_box(
            f"Blade_{side}",
            0.0, side * 0.72, 0.0,
            0.19, 1.16, 0.042,
            m_blade, bevel=0.015, rot_xyz=(0.0, side * 0.24, 0.0),
        )
        add_box(
            f"BladeTip_{side}",
            0.0, side * 1.24, 0.0,
            0.17, 0.20, 0.044,
            m_tip, bevel=0.012, rot_xyz=(0.0, side * 0.24, 0.0),
        )

    export_glb("avita_prop.glb")


# ---------------------------------------------------------------------------
# 3. Skinned Pilot Worm Avita-Jas + Offline-Simulated Woven Aviator Scarf
#    Exports to wasm-poc/assets/models/avita_worm.glb
# ---------------------------------------------------------------------------
WORM_BODY = [
    (0.00, 1.75, -0.15), (-0.35, 1.95, -0.08), (-0.70, 2.15, 0.00),
    (-1.02, 2.40, 0.05), (-1.28, 2.65, 0.10), (-1.43, 2.95, 0.13),
    (-1.40, 3.25, 0.16), (-1.22, 3.53, 0.18), (-0.95, 3.72, 0.20),
    (-0.62, 3.80, 0.23), (-0.28, 3.84, 0.26), (0.05, 3.97, 0.28),
    (0.23, 4.20, 0.31), (0.23, 4.45, 0.33),
]
HEAD_X, HEAD_Y, HEAD_Z = 0.15, 4.70 + Y0, 0.40


def worm_bones():
    """Smooth 8-bone spine + 2 aviator cap ear-flap bones in model space."""
    return [
        ("root",   None,   (0.00,  1.75 + Y0, -0.15)),
        ("seg1",   "root", (-0.70, 2.15 + Y0,  0.00)),
        ("seg2",   "seg1", (-1.28, 2.65 + Y0,  0.10)),
        ("seg3",   "seg2", (-1.40, 3.25 + Y0,  0.16)),
        ("seg4",   "seg3", (-0.95, 3.72 + Y0,  0.20)),
        ("seg5",   "seg4", (-0.28, 3.84 + Y0,  0.26)),
        ("neck",   "seg5", (0.22,  4.20 + Y0,  0.31)),
        ("head",   "neck", (HEAD_X, HEAD_Y,    HEAD_Z)),
        ("flap_l", "head", (HEAD_X - 0.68, HEAD_Y - 0.18, 0.25)),
        ("flap_r", "head", (HEAD_X + 0.68, HEAD_Y - 0.18, 0.25)),
    ]


# ---------------------------------------------------------------------------
# Offline Cloth-Ribbon Scarf Simulation (built on strands.Simulation)
# ---------------------------------------------------------------------------
class ScarfSimulation(strands.Simulation):
    """Pure `strands.Simulation` centerline physics for each scarf tail, with
    high-wing floor clearance so the drooping cloth never clips the Cessna wing."""

    def __init__(self, locks, flow, gust, period, wing_y=3.42 + Y0, **kwargs):
        self.wing_y = wing_y
        super().__init__(locks, flow, gust, period, **kwargs)

    def step(self):
        super().step()
        for chain in self.now:
            for k in range(1, len(chain)):
                if chain[k].y < self.wing_y:
                    chain[k].y = self.wing_y


def _scarf_specs():
    """Two layered woven aviator scarf tails emerging cleanly behind the neck
    knot: a long main tail and a slightly shorter, lower under-tail."""
    knot_x, knot_y, knot_z = HEAD_X - 0.34, 4.16 + Y0, 0.06
    return [
        # (Lock, w_root, w_tip, tilt_up)
        (strands.Lock((knot_x, knot_y, knot_z), (-0.30, -0.04, -1.0), 2.45, girth=0.02, points=8),
         0.32, 0.42, 0.72),
        (strands.Lock((knot_x + 0.05, knot_y - 0.15, knot_z - 0.06), (-0.42, -0.14, -1.0), 1.80, girth=0.02, points=8),
         0.26, 0.34, 0.56),
    ]


def _catmull_rom(pts, samples_per_seg=2):
    """Subdivide a simulated strand into a silky-smooth curve."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(0, i - 1)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(n - 1, i + 2)]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            p = 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
            out.append(p)
    out.append(pts[-1].copy())
    return out


def _ribbon_vertices_for_pose(specs, pose):
    """Skin each simulated centerline into a flat double-sided woven cloth
    ribbon with subtle aerodynamic edge roll and trailing fringe tassels."""
    verts = []
    u_fracs = (0.0, 0.16, 0.32, 0.68, 0.84, 1.0)
    half_t = 0.017
    n_tassels = 5
    tassel_len = 0.17

    for (_, w_root, w_tip, tilt_up), raw_pts in zip(specs, pose):
        pts = _catmull_rom(raw_pts, samples_per_seg=2)
        n = len(pts)
        # Parallel-transport ribbon width frame along the curve so cloth never kinks
        tang0 = (pts[1] - pts[0]).normalized()
        side0 = tang0.cross(Vector((0, 1, 0)))
        side0 = side0.normalized() if side0.length > 1e-4 else Vector((1, 0, 0))
        up0 = side0.cross(tang0).normalized()
        w_dir = (up0 * tilt_up + side0 * math.sqrt(max(0.05, 1.0 - tilt_up * tilt_up))).normalized()

        for i in range(n):
            p = pts[i]
            tang = (pts[i + 1] - p) if i < n - 1 else (p - pts[i - 1])
            tang = tang.normalized() if tang.length > 1e-5 else Vector((0, 0, -1))
            w_dir = (w_dir - tang * w_dir.dot(tang))
            w_dir = w_dir.normalized() if w_dir.length > 1e-5 else Vector((0, 1, 0))
            normal = tang.cross(w_dir).normalized()
            frac = i / (n - 1)
            w = w_root + (w_tip - w_root) * frac
            tp = p + w_dir * (w * 0.5)
            bp = p - w_dir * (w * 0.5)
            for side_sign in (1.0, -1.0):
                for u in u_fracs:
                    q = tp.lerp(bp, u)
                    edge_taper = 0.65 if (u <= 0.01 or u >= 0.99) else 1.0
                    verts.append(q + normal * (side_sign * half_t * edge_taper))

        # Trailing fringe tassels extending from the hem
        p_end = pts[-1]
        tang = (p_end - pts[-2]).normalized()
        w_end = w_tip
        tp_end = p_end + w_dir * (w_end * 0.5)
        bp_end = p_end - w_dir * (w_end * 0.5)
        edge_unit = (bp_end - tp_end).normalized()
        normal = tang.cross(edge_unit).normalized()
        for t_i in range(n_tassels):
            u = (t_i + 0.5) / n_tassels
            base = tp_end.lerp(bp_end, u)
            tip = base + tang * tassel_len + Vector((0, -0.025, 0))
            tw = 0.015
            verts.append(base - edge_unit * tw + normal * 0.009)
            verts.append(base + edge_unit * tw + normal * 0.009)
            verts.append(base + edge_unit * tw - normal * 0.009)
            verts.append(base - edge_unit * tw - normal * 0.009)
            verts.append(tip)
    return verts


def _build_scarf_mesh(specs, materials):
    """Create the initial woven scarf mesh (`Avita_Scarf`) in its rest shape."""
    rest_pose = [lock.rest for lock, *_ in specs]
    verts = [strands.to_blender(v) for v in _ribbon_vertices_for_pose(specs, rest_pose)]

    faces = []
    looks = []
    # Material indices: 0=Gold, 1=CreamSelvedge, 2=RustStripe, 3=FringeCream
    col_mat = (1, 2, 0, 2, 1)
    n_u = 6
    n_tassels = 5
    cursor = 0

    for lock, *_ in specs:
        n = (len(lock.rest) - 1) * 2 + 1
        stride = n_u * 2
        for i in range(n - 1):
            r0 = cursor + i * stride
            r1 = cursor + (i + 1) * stride
            for c in range(n_u - 1):
                faces.append((r0 + c, r0 + c + 1, r1 + c + 1, r1 + c))
                looks.append(col_mat[c])
            for c in range(n_u - 1):
                b0, b1 = r0 + n_u + c, r1 + n_u + c
                faces.append((b0 + 1, b0, b1, b1 + 1))
                looks.append(col_mat[c])
            faces.append((r0 + n_u, r0, r1, r1 + n_u))
            looks.append(1)
            faces.append((r0 + n_u - 1, r0 + 2 * n_u - 1, r1 + 2 * n_u - 1, r1 + n_u - 1))
            looks.append(1)
        rlast = cursor + (n - 1) * stride
        for c in range(n_u - 1):
            faces.append((rlast + c, rlast + c + 1, rlast + n_u + c + 1, rlast + n_u + c))
            looks.append(col_mat[c])
        cursor += n * stride

        for _ in range(n_tassels):
            b0, b1, b2, b3, tip = cursor, cursor + 1, cursor + 2, cursor + 3, cursor + 4
            faces.append((b0, b1, tip))
            faces.append((b1, b2, tip))
            faces.append((b2, b3, tip))
            faces.append((b3, b0, tip))
            looks.extend([3, 3, 3, 3])
            cursor += 5

    mesh = bpy.data.meshes.new("Avita_Scarf")
    mesh.from_pydata(verts, [], faces)
    for m in materials:
        mesh.materials.append(m)
    for poly, m_idx in zip(mesh.polygons, looks):
        poly.material_index = m_idx
        poly.use_smooth = True
    mesh.update()
    obj = bpy.data.objects.new("Avita_Scarf", mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def _bake_scarf_keys(obj, specs, poses, prefix):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    for number, pose in enumerate(poses):
        key = obj.shape_key_add(name=f"{prefix}{number:02d}")
        for idx, v in enumerate(_ribbon_vertices_for_pose(specs, pose)):
            key.data[idx].co = strands.to_blender(v)
        key.value = 0.0


def build_scarf(m_gold, m_cream, m_rust):
    """Build the woven aviator scarf tails, run offline wind/gust/turn cloth
    physics, and bake all shape keys onto `Avita_Scarf`."""
    specs = _scarf_specs()
    locks = [lock for lock, *_ in specs]
    scarf = _build_scarf_mesh(specs, [m_gold, m_cream, m_rust, m_cream])
    rigging.carry(neck=1.0)
    rigging.bind(scarf)

    # Collision spheres kept strictly clear of the scarf roots
    balls = [
        ((HEAD_X + 0.04, HEAD_Y + 0.14, HEAD_Z + 0.06), 0.52),
        ((-0.62, 3.76 + Y0, 0.25), 0.36),
    ]
    winds = {
        "idle":  ((-0.30, -0.25, -4.5), 1.25),
        "boost": ((-0.20,  0.15, -11.0), 2.15),
    }

    def as_the_neck_sees(direction, clip_name):
        """Transform a world-space wind/gravity vector into the neck bone's
        frame during `clip_name` so the scarf streams straight back in world
        space even when Avita's body is whipped horizontal over the wing!"""
        pose_fn = pose_boost if clip_name == "boost" else pose_cruise
        bones = worm_bones()
        seen = Vector()
        for step in range(8):
            neck_mat = rigging.placements(bones, pose_fn(step / 8.0))["neck"].to_3x3()
            seen += neck_mat.inverted() @ Vector(direction)
        return seen / 8.0

    for prefix, frames, rate in SCARF_PASSES:
        flow, gust = winds[prefix]
        sim = ScarfSimulation(
            locks,
            as_the_neck_sees(flow, prefix),
            gust,
            frames / rate,
            wing_y=-99.0 if prefix == "boost" else 3.42 + Y0,
            spring=20.0,
            drag=3.0,
            weight=4.5,
            balls=balls,
            down=as_the_neck_sees((0, -1, 0), prefix),
        )
        poses = sim.loop(frames, rate, warm_up=3)
        tip = poses[0][0][-1]
        print(f"[avita] scarf {prefix} main tip (neck-local): ({tip.x:.2f}, {tip.y:.2f}, {tip.z:.2f})")
        _bake_scarf_keys(scarf, specs, poses, prefix)

    # Settled centrifugal throw poses for banking turns & wing-waggle
    for name, shove in (("left", -9.0), ("right", 9.0)):
        sim = ScarfSimulation(
            locks, winds["idle"][0], 0.0, 1.0,
            spring=18.0, drag=3.0, weight=4.0, balls=balls, push=(shove, 0.25, 0.0),
        )
        _bake_scarf_keys(scarf, specs, [sim.settle(seconds=2.2)], name)
        scarf.data.shape_keys.key_blocks[-1].name = name

    return scarf


# ---------------------------------------------------------------------------
# Animation Clips: cruise, boost, accordion, wing_waggle
# ---------------------------------------------------------------------------
def pose_cruise(cycle):
    """Organic S-curve earthworm ripple traveling up the spine + gentle ear-flap flutter."""
    w = lambda lag: wave(cycle, 1, lag)
    w2 = lambda lag: wave(cycle, 2, lag)
    return {
        "seg1":   RZ(0.05 * w(0.0)),
        "seg2":   RZ(0.07 * w(0.55)) @ RX(0.03 * w(0.3)),
        "seg3":   RZ(0.08 * w(1.10)) @ RX(0.04 * w(0.8)),
        "seg4":   RZ(0.08 * w(1.65)),
        "seg5":   RZ(0.07 * w(2.20)) @ RY(0.05 * w(1.5)),
        "neck":   RZ(0.06 * w(2.75)) @ RX(0.04 * w(2.1)),
        "head":   RY(0.10 * w(2.4)) @ RZ(-0.07 * w(2.75)) @ RX(0.04 * w2(0.4)),
        "flap_l": RZ(-0.10 - 0.08 * w2(0.3)) @ RX(-0.12 - 0.07 * w2(0.8)),
        "flap_r": RZ(0.10 + 0.08 * w2(0.7)) @ RX(-0.12 - 0.07 * w2(1.2)),
    }


# ---------------------------------------------------------------------------
# Offline Flag-Flutter Physics for Avita's Worm Body During Boost
# ---------------------------------------------------------------------------
class BoostFlagSimulation(strands.Simulation):
    """Offline physics for Avita's earthworm spine whipping backward over the
    Cessna's high wing like a cartoonish flag / rag in roaring propwash."""

    def __init__(self, lock, flow, gust, period, wing_y=3.62 + Y0, **kwargs):
        self.wing_y = wing_y
        super().__init__([lock], flow, gust, period, **kwargs)

    def step(self):
        dt = 1.0 / strands.RATE
        lock = self.locks[0]
        now = self.now[0]
        before = self.before[0]
        last = len(now) - 1
        for i in range(1, last + 1):
            point, along = now[i], i / last
            speed = (point - before[i]) / dt
            # Lower tail (i=1,2) clings firmly to cockpit & wing strut; upper
            # body (i=3..7) catches full roaring slipstream and flaps like a flag!
            if i <= 2:
                wind_scale = 0.15 * i
                spring_k = 85.0
            else:
                wind_scale = 0.75 + 1.15 * ((i - 2) / (last - 2))
                spring_k = 2.5 * (1.0 - along)
            pull = (self.wind(point) - speed) * self.drag * wind_scale
            hold = (lock.rest[i] - point) * spring_k
            # Cartoonish traveling flag-whip wave propagating from seg3 -> head
            beat = math.tau * self.time / self.period
            flag_amp = max(0.0, (i - 2) / (last - 2))
            whip = Vector((
                math.sin(beat - i * 0.95) * 12.0 * flag_amp,
                math.cos(2.0 * beat - i * 1.15) * 17.0 * flag_amp,
                0.0,
            ))
            force = pull + hold + whip + self.weight
            before[i], now[i] = point.copy(), point + (point - before[i]) * 0.982 + force * dt * dt
        for _ in range(strands.PASSES):
            for i in range(1, last + 1):
                span = now[i] - now[i - 1]
                reach = (lock.rest[i] - lock.rest[i - 1]).length
                now[i] = now[i - 1] + span.normalized() * reach
                # Keep upper worm body skimming cleanly OVER the Cessna high wing
                if i >= 3 and now[i].y < self.wing_y:
                    now[i].y = self.wing_y
                # Keep lower tail clear of fuselage center
                if i == 2 and now[i].x > -0.95:
                    now[i].x = -0.95
        self.time += dt


_BOOST_FLAG_CACHE = None


def _boost_flag_poses():
    """Simulate 24 looping frames (0.8s @ 30fps) of Avita fluttering backward
    over the high wing like a flag, converted into exact skeleton bone poses."""
    global _BOOST_FLAG_CACHE
    if _BOOST_FLAG_CACHE is not None:
        return _BOOST_FLAG_CACHE

    bones = worm_bones()
    spine_names = ("root", "seg1", "seg2", "seg3", "seg4", "seg5", "neck", "head")
    hinges = [Vector(dict((n, h) for n, _, h in bones)[name]) for name in spine_names]

    lock = strands.Lock(hinges[0], (0, 1, 0), 1.0, girth=0.34, points=len(hinges))
    lock.rest = [h.copy() for h in hinges]

    frames, rate = 24, 30
    sim = BoostFlagSimulation(
        lock,
        flow=(0.15, 0.9, -14.5),
        gust=3.6,
        period=frames / rate,
        drag=3.1,
        weight=3.2,
    )
    chains = [frame_pose[0] for frame_pose in sim.loop(frames, rate, warm_up=4)]

    # Diagnostic range check
    heads = [c[-1] for c in chains]
    print(
        f"[avita] boost flag head range: "
        f"x=[{min(p.x for p in heads):.2f}, {max(p.x for p in heads):.2f}] "
        f"y=[{min(p.y for p in heads):.2f}, {max(p.y for p in heads):.2f}] "
        f"z=[{min(p.z for p in heads):.2f}, {max(p.z for p in heads):.2f}]"
    )

    poses = []
    for f_idx, pts in enumerate(chains):
        cycle = f_idx / frames
        world_rot = {}
        pose = {}
        parent_rot = RX(0.0)
        for k in range(len(spine_names) - 1):
            name = spine_names[k]
            rest_dir = (hinges[k + 1] - hinges[k]).normalized()
            sim_dir = (pts[k + 1] - pts[k]).normalized()
            cur_dir = parent_rot @ rest_dir
            delta = cur_dir.rotation_difference(sim_dir)
            new_world = delta @ parent_rot
            local_turn = parent_rot.inverted() @ new_world
            world_rot[name] = new_world
            pose[name] = local_turn
            parent_rot = new_world

        # Head trails with the whipping tip + frantic cartoonish slipstream flutter
        head_lag = wave(cycle, 1, 2.2)
        head_vibe = wave(cycle, 2, 0.6)
        pose["head"] = RX(0.28 + 0.14 * head_vibe) @ RZ(0.22 * head_lag) @ RY(0.16 * head_lag)
        # Ear flaps whip straight back rapidly in the roaring airflow
        flap_v = wave(cycle, 3, 0.0)
        flap_v2 = wave(cycle, 3, 1.1)
        pose["flap_l"] = RX(-0.85 + 0.24 * flap_v) @ RZ(-0.35 - 0.16 * flap_v2)
        pose["flap_r"] = RX(-0.85 + 0.24 * flap_v2) @ RZ(0.35 + 0.16 * flap_v)
        poses.append(pose)

    _BOOST_FLAG_CACHE = poses
    return poses


def pose_boost(cycle):
    """Offline-simulated flag-flutter boost: Avita streams backward over the
    high wing like a flapping rag/windsock in the roaring propwash!"""
    poses = _boost_flag_poses()
    n = len(poses)
    idx = int(round(cycle * n)) % n
    return poses[idx]


def pose_accordion(cycle):
    """Earthworm accordion scrunch (1.2s one-shot): rapid compression down into the
    cockpit with zig-zag segment folds & squash, brief tremble, then springy
    rebound stretch and damped settle!"""
    # Compute signed amplitude: +1.0 = full scrunch down, -0.45 = springy overshoot stretch
    if cycle < 0.22:
        c = ease(cycle / 0.22)
    elif cycle < 0.42:
        u = (cycle - 0.22) / 0.20
        c = 1.0 - 0.06 * math.sin(u * math.tau * 2.0)
    elif cycle < 0.72:
        u = ease((cycle - 0.42) / 0.30)
        # Compress (+1) -> overshoot stretch (-0.42)
        c = 1.0 - 1.42 * u
    else:
        u = ease((cycle - 0.72) / 0.28)
        # Rebound overshoot (-0.42) -> rest (0.0) with a tiny secondary bob
        c = -0.42 * (1.0 - u) + 0.08 * math.sin(u * math.pi) * (1.0 - u)

    tremble = 0.06 * math.sin(cycle * math.tau * 7.0) if (0.18 < cycle < 0.44) else 0.0

    # Keep scale=1.0 on the parent chain so head & scarf never inflate cumulatively;
    # pure alternating accordion zig-zag folds + downward compression read crisply!
    return {
        "root":   (RX(0.06 * c), (0.0, -0.10 * c, 0.0)),
        "seg1":   (RZ(0.32 * c) @ RX(0.16 * c), (0.06 * c, -0.16 * c, 0.0)),
        "seg2":   (RZ(-0.42 * c) @ RX(-0.14 * c), (0.08 * c, -0.20 * c, 0.0)),
        "seg3":   (RZ(0.44 * c) @ RX(0.18 * c), (0.06 * c, -0.22 * c, 0.0)),
        "seg4":   (RZ(-0.38 * c) @ RX(-0.16 * c), (0.04 * c, -0.20 * c, 0.0)),
        "seg5":   (RZ(0.30 * c) @ RX(0.14 * c), (0.0, -0.18 * c, 0.0)),
        "neck":   (RZ(-0.22 * c) @ RX(-0.10 * c), (0.0, -0.14 * c, 0.0)),
        "head":   (RX(-0.24 * c) @ RZ(tremble + 0.08 * c), (0.0, -0.08 * c, 0.0)),
        # Ear flaps flare outward during impact scrunch, snap down on rebound
        "flap_l": RZ(-0.58 * max(0.0, c) + 0.18 * max(0.0, -c)) @ RX(-0.15 * c),
        "flap_r": RZ(0.58 * max(0.0, c) - 0.18 * max(0.0, -c)) @ RX(-0.15 * c),
    }


def pose_wing_waggle(cycle):
    """Wing-waggle ace salute (1.6s): Avita rises tall above the high wing, turns
    180 degrees to face the camera, rocks joyfully in sync with the Cessna's
    left-right-left-right wing-waggle, and gives a jaunty cap-tilt salute!"""
    # Smooth rise/turn envelope matching the 1.6s celebrate window
    env = ease(min(cycle / 0.18, (1.0 - cycle) / 0.22))
    # Two full left-right wing waggles over the clip
    waggle = math.sin(cycle * math.tau * 2.0) * env
    bounce = abs(math.sin(cycle * math.tau * 2.0)) * env
    # Distribute the 180-degree camera-facing turn smoothly up the upper spine + neck
    turn_total = math.pi * env

    return {
        "seg1":   (RZ(0.06 * waggle), (0.0, 0.04 * env, 0.0)),
        "seg2":   (RZ(0.09 * waggle), (0.0, 0.05 * env, 0.0)),
        "seg3":   (RZ(0.11 * waggle), (0.0, 0.06 * env, 0.0)),
        "seg4":   (RY(0.20 * turn_total) @ RZ(0.12 * waggle), (0.0, 0.07 * env, 0.0)),
        "seg5":   (RY(0.30 * turn_total) @ RZ(0.10 * waggle), (0.0, 0.08 * env + 0.06 * bounce, 0.0)),
        "neck":   (RY(0.30 * turn_total) @ RZ(0.08 * waggle) @ RX(-0.08 * bounce), (0.0, 0.06 * env, 0.0)),
        # Jaunty head tilt & celebratory bob facing the camera
        "head":   (RY(0.20 * turn_total) @ RZ(-0.22 * waggle) @ RX(-0.14 * bounce), (0.0, 0.05 * bounce, 0.0)),
        "flap_l": RZ(-0.34 * bounce - 0.18 * waggle) @ RX(-0.15 * env),
        "flap_r": RZ(0.34 * bounce - 0.18 * waggle) @ RX(-0.15 * env),
    }


CLIPS = [
    ("cruise",      48, pose_cruise),
    ("boost",       24, pose_boost),
    ("accordion",   36, pose_accordion),
    ("wing_waggle", 48, pose_wing_waggle),
]


def _spine_weights(index, total):
    """Smoothly distribute each of the 14 worm segments across the 7 spine bones."""
    spine = ("root", "seg1", "seg2", "seg3", "seg4", "seg5", "neck")
    pos = (index / (total - 1)) * (len(spine) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(spine) - 1)
    frac = pos - lo
    if lo == hi or frac < 1e-4:
        return {spine[lo]: 1.0}
    return {spine[lo]: 1.0 - frac, spine[hi]: frac}


def build_worm_rig(out_path=None):
    """Build the skinned Avita-Jas worm + woven physics-baked scarf and export."""
    clear_scene()

    m_pink_a = make_mat("WormPinkA", "#efa5a8", roughness=0.42, metallic=0.02)
    m_pink_b = make_mat("WormPinkB", "#e695a0", roughness=0.44, metallic=0.02)
    m_crease = make_mat("WormCrease", "#bd6c85", roughness=0.55)
    m_belly = make_mat("WormBelly", "#ffc7b5", roughness=0.40)
    m_head = make_mat("WormHead", "#f4b3ad", roughness=0.38)
    m_mouth = make_mat("WormMouth", "#9b4a67", roughness=0.45)
    m_cheek = make_mat("WormCheek", "#e57e98", roughness=0.50)
    m_leather = make_mat("AviatorLeather", "#9a5f2c", roughness=0.58, metallic=0.05)
    m_strap = make_mat("LeatherStrap", "#4a352e", roughness=0.65)
    m_shearling = make_mat("ShearlingTrim", "#f4deb2", roughness=0.88)
    m_brass = make_mat("GoggleBrass", "#e8bd63", roughness=0.22, metallic=0.88)
    m_lens = make_mat("GoggleLens", "#55b9dd", roughness=0.06, metallic=0.18, emission=0.35, emission_color="#6fd2f5")
    m_pupil = make_mat("GogglePupil", "#1e3d52", roughness=0.12)
    m_glint = make_mat("GoggleGlint", "#ecffff", roughness=0.05, emission=1.4, emission_color="#ffffff")
    m_scarf_gold = make_mat("AviatorScarfGold", "#f4d473", roughness=0.78)
    m_scarf_cream = make_mat("AviatorScarfCream", "#f9ebd0", roughness=0.80)
    m_scarf_rust = make_mat("AviatorScarfRust", "#c96c28", roughness=0.76)

    parts = []
    # 1. Segmented earthworm body weighted smoothly along the spine chain
    n_segs = len(WORM_BODY)
    for i, (bx, by, bz) in enumerate(WORM_BODY):
        rigging.carry(**_spine_weights(i, n_segs))
        r = 0.34 + i * 0.004
        parts.append(add_ellipsoid(
            f"Seg_{i}", bx, by + Y0, bz, r, 0.28, r,
            m_pink_a if i % 2 else m_pink_b, segs=16, rings=9, bind=True,
        ))
        parts.append(add_ellipsoid(
            f"Crease_{i}", bx, by - 0.10 + Y0, bz, r + 0.014, 0.042, r + 0.014,
            m_crease, segs=16, rings=5, bind=True,
        ))
        parts.append(add_ellipsoid(
            f"Belly_{i}", bx, by + Y0, bz + r * 0.84, 0.22, 0.18, 0.07,
            m_belly, segs=10, rings=7, bind=True,
        ))

    # 2. Wrapped woven neck scarf collar + side knot (bound to `neck`)
    rigging.carry(neck=1.0)
    cx, cy, cz = 0.20, 4.18 + Y0, 0.32
    # Two layered draped torus-like collar rings around the neck
    for ring_i, (dy, rx, ry, rz, rot_z, mat) in enumerate((
        (0.00, 0.44, 0.14, 0.44, 0.12, m_scarf_gold),
        (0.11, 0.42, 0.12, 0.42, -0.10, m_scarf_cream),
        (-0.10, 0.43, 0.11, 0.43, 0.08, m_scarf_rust),
    )):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=rx, minor_radius=ry, major_segments=20, minor_segments=10,
            location=loc(cx, cy + dy, cz),
        )
        t_obj = bpy.context.active_object
        t_obj.name = f"ScarfCollar_{ring_i}"
        t_obj.rotation_euler = Euler((0.0, rot_z, 0.0), "XYZ")
        t_obj.scale = (1.0, rz / rx, 0.85)
        bpy.ops.object.transform_apply(rotation=True, scale=True)
        t_obj.data.materials.append(mat)
        smooth(t_obj)
        rigging.bind(t_obj)
        parts.append(t_obj)
    # Tucked scarf knot on the left side of the collar where both tails emerge
    parts.append(add_ellipsoid(
        "ScarfKnotMain", HEAD_X - 0.32, 4.16 + Y0, 0.22, 0.20, 0.17, 0.18,
        m_scarf_gold, segs=14, rings=8, rot_xyz=(0.2, 0.3, -0.2), bind=True,
    ))
    parts.append(add_ellipsoid(
        "ScarfKnotFold", HEAD_X - 0.35, 4.06 + Y0, 0.19, 0.16, 0.13, 0.14,
        m_scarf_rust, segs=12, rings=7, rot_xyz=(-0.1, 0.2, 0.3), bind=True,
    ))

    # 3. Head, face, aviator leather cap, shearling trim, oversized brass goggles
    rigging.carry(head=1.0)
    hx, hy = HEAD_X, HEAD_Y
    parts.append(add_ellipsoid("Head", hx, hy, 0.40, 0.64, 0.60, 0.58, m_head, segs=22, rings=12, bind=True))
    parts.append(add_box("Smile", hx, hy - 0.34, 0.96, 0.30, 0.055, 0.05, m_mouth, bevel=0.015, bind=True))
    for side in (-1, 1):
        parts.append(add_ellipsoid(f"Cheek_{side}", hx + side * 0.43, hy - 0.18, 0.88, 0.15, 0.09, 0.05, m_cheek, segs=12, rings=8, bind=True))

    parts.append(add_ellipsoid("AviatorCap", hx, hy + 0.36, 0.27, 0.76, 0.44, 0.69, m_leather, segs=22, rings=12, bind=True))
    parts.append(add_box("CapSeam", hx, hy + 0.75, -0.18, 0.09, 0.055, 0.96, m_shearling, bevel=0.02, bind=True))
    for i in range(13):
        a = i * math.pi / 12.0
        parts.append(add_ellipsoid(
            f"Shearling_{i}",
            hx + math.cos(a) * 0.69, hy + 0.20, 0.30 + math.sin(a) * 0.60,
            0.13, 0.10, 0.10, m_shearling, segs=9, rings=6, bind=True,
        ))
    parts.append(add_box("GoggleBackStrap", hx, hy + 0.01, -0.37, 1.36, 0.17, 0.12, m_strap, bevel=0.02, bind=True))
    for side in (-1, 1):
        parts.append(add_ellipsoid(f"GoggleRim_{side}", hx + side * 0.34, hy + 0.05, 0.94, 0.37, 0.32, 0.18, m_brass, segs=20, rings=10, bind=True))
        parts.append(add_ellipsoid(f"GoggleLens_{side}", hx + side * 0.34, hy + 0.05, 1.07, 0.28, 0.24, 0.10, m_lens, segs=18, rings=9, bind=True))
        parts.append(add_ellipsoid(f"GogglePupil_{side}", hx + side * 0.34, hy + 0.04, 1.15, 0.085, 0.115, 0.03, m_pupil, segs=10, rings=7, bind=True))
        parts.append(add_ellipsoid(f"GoggleGlint_{side}", hx + side * 0.26, hy + 0.14, 1.17, 0.09, 0.055, 0.025, m_glint, segs=9, rings=6, bind=True))
        parts.append(add_box(f"GoggleSideStrap_{side}", hx + side * 0.65, hy - 0.03, 0.59, 0.16, 0.18, 0.45, m_strap, bevel=0.02, bind=True))
    parts.append(add_box("GoggleBridge", hx, hy + 0.06, 1.09, 0.20, 0.10, 0.10, m_brass, bevel=0.02, bind=True))
    parts.append(add_box("ChinStrap", hx, hy - 0.48, 0.80, 0.62, 0.10, 0.12, m_strap, bevel=0.02, bind=True))

    # 4. Articulated leather ear flaps w/ shearling trim & brass buckles
    for side, bone_name in ((-1, "flap_l"), (1, "flap_r")):
        rigging.carry(**{bone_name: 1.0})
        parts.append(add_box(f"EarFlap_{side}", hx + side * 0.68, hy - 0.55, 0.25, 0.24, 0.79, 0.38, m_leather, bevel=0.04, bind=True))
        parts.append(add_box(f"EarShear_{side}", hx + side * 0.78, hy - 0.54, 0.28, 0.07, 0.70, 0.36, m_shearling, bevel=0.02, bind=True))
        parts.append(add_box(f"EarBuckle_{side}", hx + side * 0.69, hy - 0.51, 0.63, 0.22, 0.16, 0.06, m_brass, bevel=0.015, bind=True))

    worm_mesh = rigging.join(parts, "Avita_Worm")

    # 5. Woven cloth scarf tails with offline wind-physics shape keys
    scarf_mesh = build_scarf(m_scarf_gold, m_scarf_cream, m_scarf_rust)

    # 6. Build skeleton, skin both meshes, author all 4 clips, and export!
    bones = worm_bones()
    rig = rigging.build_armature("AvitaRig", bones)
    rigging.skin(rig, worm_mesh, scarf_mesh)
    rigging.author_clips(rig, bones, CLIPS)

    target = out_path or os.path.join(MODELS_DIR, "avita_worm.glb")
    rigging.export_rig(target, CLIPS, morph_normals=True)
    return rig


def set_pose(rig, pose):
    rigging.set_pose(rig, worm_bones(), pose)


if __name__ == "__main__":
    extra = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--all" in extra:
        build_plane()
        build_propeller()
    out = next((a for a in extra if a.endswith(".glb")), None)
    build_worm_rig(out)
    print("[avita] ALL DONE!")
