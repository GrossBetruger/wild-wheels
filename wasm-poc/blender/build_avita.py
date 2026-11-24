"""
Build faithful, lived-in PBR glTF (.glb) models of Avita-Jas (driver #8:
tiny aviator earthworm in a trusty weathered Cessna 172 Skyhawk):
  - wasm-poc/assets/avita_plane.glb  (weathered Cessna 172 fuselage, open cockpit,
                                      high airfoil wing + struts, tricycle gear, tailplane)
  - wasm-poc/assets/avita_prop.glb   (pivot-centered twisted airfoil propeller w/ yellow tips)
  - wasm-poc/assets/avita_worm.glb   (segmented earthworm pilot with leather aviator cap,
                                      shearling trim, oversized brass goggles & flowing scarf)

Run:
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_avita.py
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS_DIR = os.path.join(ROOT, "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)


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


def add_ellipsoid(name, x, y, z, rx, ry, rz, mat, segs=24, rings=14, rot_xyz=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (rx, rz, ry)
    if rot_xyz != (0, 0, 0):
        # Map WW (rx, ry, rz) -> Blender
        obj.rotation_euler = Euler((rot_xyz[0], -rot_xyz[2], rot_xyz[1]), "XYZ")
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def add_box(name, x, y, z, sx, sy, sz, mat, bevel=0.03, rot_xyz=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sz, sy)
    if rot_xyz != (0, 0, 0):
        obj.rotation_euler = Euler((rot_xyz[0], -rot_xyz[2], rot_xyz[1]), "XYZ")
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0.0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def add_cyl_between(name, p1, p2, r1, r2, mat, segs=14):
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
    obj.data.materials.append(mat)
    smooth(obj)
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
    Y0 = 0.13

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

    # Sculpted tapered fuselage loft (authentic Cessna 172 silhouette: blunt cowling -> wide cabin -> slender tailcone)
    sections = [
        # (z, yc, rx, ry)
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
            # Slight flat belly for authentic fuselage cross-section
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
        cz = poly.center.z  # Blender Z = WW y
        poly.material_index = 1 if cz < 1.12 + Y0 else 0

    # Clean painted amber livery cheatlines & belly fairing (no jagged polygon boundaries!)
    add_box("BellyStripe", 0, 1.07 + Y0, 0.55, 1.50, 0.22, 3.85, m_amber, bevel=0.05)
    for side in (-1, 1):
        add_box(f"SideLivery_{side}", side * 0.80, 1.38 + Y0, 0.45, 0.08, 0.24, 3.40, m_amber, bevel=0.025)
        add_box(f"SideAccent_{side}", side * 0.84, 1.53 + Y0, 0.50, 0.05, 0.08, 2.75, m_amber_dark, bevel=0.015)
        # Twin nose air-intake nostrils + chrome exhaust pipes underneath cowling
        add_ellipsoid(f"CowlIntake_{side}", side * 0.44, 1.44 + Y0, 2.74, 0.17, 0.11, 0.08, m_dark, segs=14, rings=8)
        add_cyl_between(f"Exhaust_{side}", (side * 0.24, 1.04 + Y0, 2.35), (side * 0.28, 0.82 + Y0, 2.02), 0.055, 0.06, m_exhaust)

    # Nose spinner cone (Avita amber) + chrome backplate (blades emerge cleanly at z=3.16)
    add_cyl_between("SpinnerBack", (0, 1.65 + Y0, 2.82), (0, 1.65 + Y0, 2.92), 0.35, 0.34, m_chrome, segs=22)
    add_cyl_between("SpinnerCone", (0, 1.65 + Y0, 2.92), (0, 1.65 + Y0, 3.42), 0.33, 0.04, m_amber, segs=22)

    # Recessed open cockpit: dark floor, padded leather coaming walls, pilot seat back, instrument panel & windscreen
    add_box("CockpitFloor", 0, 1.62 + Y0, -0.35, 1.18, 0.16, 1.38, m_dash, bevel=0.03)
    add_box("CockpitSeatBack", 0, 1.98 + Y0, -0.98, 1.14, 0.56, 0.18, m_amber_dark, bevel=0.04)
    for side in (-1, 1):
        add_box(f"CockpitCoaming_{side}", side * 0.59, 1.94 + Y0, -0.32, 0.14, 0.42, 1.44, m_dark, bevel=0.04)
    add_box("InstrumentPanel", 0, 1.98 + Y0, 0.42, 1.12, 0.32, 0.22, m_dash, bevel=0.02)
    for gx in (-0.34, -0.11, 0.11, 0.34):
        add_ellipsoid(f"Gauge_{gx}", gx, 2.02 + Y0, 0.30, 0.075, 0.075, 0.02, m_gauge, segs=12, rings=6)
    # Angled windscreen with chrome side pillars
    add_box("WindscreenGlass", 0, 2.12 + Y0, 0.78, 1.28, 0.56, 0.09, m_glass, bevel=0.02, rot_xyz=(0.34, 0, 0))
    for side in (-1, 1):
        add_cyl_between(f"WindPillar_{side}", (side * 0.64, 1.84 + Y0, 0.88), (side * 0.62, 2.38 + Y0, 0.66), 0.035, 0.035, m_chrome)
    add_cyl_between("WindTopFrame", (-0.63, 2.38 + Y0, 0.66), (0.63, 2.38 + Y0, 0.66), 0.035, 0.035, m_chrome)

    # High cantilevered airfoil wing (real cambered cross-section!)
    bm = bmesh.new()
    wing_span = 7.45
    chord = 1.52
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

    # Wingtip fairings, nav lights, aileron trim & diagonal steel wing struts
    for side in (-1, 1):
        tip_y = 3.24 + Y0 + 3.6 * 0.032
        add_box(f"WingTip_{side}", side * 3.55, tip_y, -0.80, 0.62, 0.12, 1.42, m_amber, bevel=0.04)
        add_ellipsoid(
            f"NavLight_{side}", side * 3.84, tip_y, -0.22, 0.08, 0.07, 0.12,
            m_nav_r if side < 0 else m_nav_g, segs=12, rings=8
        )
        # Diagonal wing strut (authentic single Cessna strut from lower cabin to mid-wing)
        add_cyl_between(
            f"WingStrut_{side}",
            (side * 0.72, 1.12 + Y0, -0.58),
            (side * 2.88, 3.16 + Y0, -0.68),
            0.055, 0.048, m_steel, segs=10,
        )
        # Main landing gear leg + tire + spun aluminum hubcap
        add_cyl_between(
            f"MainGearLeg_{side}",
            (side * 0.64, 1.18 + Y0, -0.28),
            (side * 1.14, 0.46 + Y0, -0.30),
            0.065, 0.055, m_steel, segs=10,
        )
        # Tire (axis along X)
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

    # Nose landing gear strut + nose tire + fork
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

    # Horizontal stabilizer + swept vertical tail fin + white rudder cap + tail beacon
    add_box("TailPlane", 0, 1.50 + Y0, -2.85, 3.08, 0.12, 0.86, m_white, bevel=0.04)
    for side in (-1, 1):
        add_box(f"TailTip_{side}", side * 1.48, 1.50 + Y0, -2.85, 0.18, 0.13, 0.86, m_amber, bevel=0.03)
    # Swept vertical fin
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
#    Spins around local Z axis at (0, 1.65 + 0.13, 3.24)
# ---------------------------------------------------------------------------
def build_propeller():
    clear_scene()
    m_blade = make_mat("PropSteel", "#2c3a46", roughness=0.28, metallic=0.82)
    m_tip = make_mat("PropYellowTip", "#f8d86e", roughness=0.35, metallic=0.10, emission=0.25, emission_color="#ffe27a")
    m_hub = make_mat("PropHub", "#cdd8dc", roughness=0.18, metallic=0.92)

    add_ellipsoid("PropHub", 0, 0, 0, 0.15, 0.15, 0.12, m_hub, segs=16, rings=10)
    for side in (-1, 1):
        # Sculpted tapered blade along +Y / -Y with slight aerodynamic twist
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
# 3. Pilot Worm Avita-Jas (avita_worm.glb)
#    Faithful to drawPilotWorm() in client/characters.js:89-124
# ---------------------------------------------------------------------------
def build_worm():
    clear_scene()
    Y0 = 0.13

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
    m_scarf = make_mat("AviatorScarf", "#f4d473", roughness=0.72)

    body = [
        (0.0, 1.75, -0.15), (-0.35, 1.95, -0.08), (-0.70, 2.15, 0.0),
        (-1.02, 2.40, 0.05), (-1.28, 2.65, 0.10), (-1.43, 2.95, 0.13),
        (-1.40, 3.25, 0.16), (-1.22, 3.53, 0.18), (-0.95, 3.72, 0.20),
        (-0.62, 3.80, 0.23), (-0.28, 3.84, 0.26), (0.05, 3.97, 0.28),
        (0.23, 4.20, 0.31), (0.23, 4.45, 0.33),
    ]
    for i, (bx, by, bz) in enumerate(body):
        r = 0.34 + i * 0.004
        add_ellipsoid(
            f"Seg_{i}", bx, by + Y0, bz, r, 0.28, r,
            m_pink_a if i % 2 else m_pink_b, segs=18, rings=10,
        )
        add_ellipsoid(
            f"Crease_{i}", bx, by - 0.10 + Y0, bz, r + 0.014, 0.042, r + 0.014,
            m_crease, segs=18, rings=6,
        )
        add_ellipsoid(
            f"Belly_{i}", bx, by + Y0, bz + r * 0.84, 0.22, 0.18, 0.07,
            m_belly, segs=12, rings=8,
        )

    # Head
    hx, hy = 0.15, 4.70 + Y0
    add_ellipsoid("Head", hx, hy, 0.40, 0.64, 0.60, 0.58, m_head, segs=24, rings=14)
    add_box("Smile", hx, hy - 0.34, 0.96, 0.30, 0.055, 0.05, m_mouth, bevel=0.015)
    for side in (-1, 1):
        add_ellipsoid(f"Cheek_{side}", hx + side * 0.43, hy - 0.18, 0.88, 0.15, 0.09, 0.05, m_cheek, segs=12, rings=8)

    # Leather aviator flying cap + cream shearling trim + center seam + ear flaps w/ brass buckles
    add_ellipsoid("AviatorCap", hx, hy + 0.36, 0.27, 0.76, 0.44, 0.69, m_leather, segs=24, rings=14)
    add_box("CapSeam", hx, hy + 0.75, -0.18, 0.09, 0.055, 0.96, m_shearling, bevel=0.02)
    for i in range(13):
        a = i * math.pi / 12.0
        add_ellipsoid(
            f"Shearling_{i}",
            hx + math.cos(a) * 0.69, hy + 0.20, 0.30 + math.sin(a) * 0.60,
            0.13, 0.10, 0.10, m_shearling, segs=10, rings=6,
        )
    add_box("GoggleBackStrap", hx, hy + 0.01, -0.37, 1.36, 0.17, 0.12, m_strap, bevel=0.02)
    for side in (-1, 1):
        add_box(f"EarFlap_{side}", hx + side * 0.68, hy - 0.55, 0.25, 0.24, 0.79, 0.38, m_leather, bevel=0.04)
        add_box(f"EarShear_{side}", hx + side * 0.78, hy - 0.54, 0.28, 0.07, 0.70, 0.36, m_shearling, bevel=0.02)
        add_box(f"EarBuckle_{side}", hx + side * 0.69, hy - 0.51, 0.63, 0.22, 0.16, 0.06, m_brass, bevel=0.015)
        # Oversized brass-rimmed sky-blue goggles on the face
        add_ellipsoid(f"GoggleRim_{side}", hx + side * 0.34, hy + 0.05, 0.94, 0.37, 0.32, 0.18, m_brass, segs=22, rings=12)
        add_ellipsoid(f"GoggleLens_{side}", hx + side * 0.34, hy + 0.05, 1.07, 0.28, 0.24, 0.10, m_lens, segs=20, rings=10)
        add_ellipsoid(f"GogglePupil_{side}", hx + side * 0.34, hy + 0.04, 1.15, 0.085, 0.115, 0.03, m_pupil, segs=12, rings=8)
        add_ellipsoid(f"GoggleGlint_{side}", hx + side * 0.26, hy + 0.14, 1.17, 0.09, 0.055, 0.025, m_glint, segs=10, rings=6)
        add_box(f"GoggleSideStrap_{side}", hx + side * 0.65, hy - 0.03, 0.59, 0.16, 0.18, 0.45, m_strap, bevel=0.02)

    add_box("GoggleBridge", hx, hy + 0.06, 1.09, 0.20, 0.10, 0.10, m_brass, bevel=0.02)
    add_box("ChinStrap", hx, hy - 0.48, 0.80, 0.62, 0.10, 0.12, m_strap, bevel=0.02)

    # Flowing golden aviator scarf trailing in the slipstream
    for i in range(8):
        add_ellipsoid(
            f"Scarf_{i}",
            hx - 0.52 - i * 0.10,
            4.03 + Y0 - i * 0.09 + math.sin(i * 0.8) * 0.04,
            0.05 - i * 0.18,
            0.19 - i * 0.014, 0.08, 0.17, m_scarf, segs=12, rings=8,
        )

    export_glb("avita_worm.glb")


if __name__ == "__main__":
    build_plane()
    build_propeller()
    build_worm()
    print("[avita] ALL DONE!")
