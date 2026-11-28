"""
Build an uplifted, heirloom-grade PBR Sefer Tehilim (Book of Psalms) for Wild Wheels:
  - tehilim_book.glb : Deep royal-navy Moroccan leather hardcover with beveled
                       boards, curved ribbed spine (5 raised binding bands + gold
                       fillets) on the authentic Hebrew right-hand side, gilt-edged
                       parchment page block with leaf striations, blue-and-gold
                       headbands, ornate double gold-foil cover frame with corner
                       filigree, 3D embossed gold Hebrew Bible lettering "תהילים"
                       (New Peninim MT serif) on both covers, and a draped crimson
                       silk bookmark ribbon with swallowtail tip.

    /opt/homebrew/bin/blender --background --python wasm/blender/build_tehilim.py -- wasm/assets/models
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Euler, Vector

sys.dont_write_bytecode = True

argv = sys.argv
out_dir = argv[argv.index("--") + 1] if "--" in argv else os.path.join(
    os.path.dirname(__file__), "..", "assets", "models"
)
os.makedirs(out_dir, exist_ok=True)

HEBREW_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/NewPeninimMT.ttc",
    "/System/Library/Fonts/Supplemental/Raanana.ttc",
    "/System/Library/Fonts/ArialHB.ttc",
]

# Blender's 3D Text lays out characters left-to-right without BiDi reordering,
# so we reverse "תהילים" (Tav-He-Yod-Lamed-Yod-FinalMem) into visual LTR order.
TEHILIM_VISUAL_LTR = "תהילים"[::-1]


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


def mat(name, hex_color, roughness=0.5, metallic=0.0, emission=0.0, emission_color=None, coat=0.0):
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


def box(x, y, z, sx, sy, sz, m, bevel=0.015, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.scale = (sx, sz, sy)
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def cyl(x, y, z, r, depth, m, verts=24, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc(x, y, z))
    obj = bpy.context.active_object
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.data.materials.append(m)
    return smooth(obj, bevel=bevel)


def load_hebrew_font():
    for path in HEBREW_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return bpy.data.fonts.load(path)
            except Exception:
                continue
    raise RuntimeError("No Hebrew Bible font found on system")


def add_ribbon(m_ribbon, m_gold, page_bottom_y, half_thick):
    """Build a gently draped crimson silk bookmark ribbon with a notched swallowtail tip."""
    mesh = bpy.data.meshes.new("RibbonMesh")
    bm = bmesh.new()
    segs = 14
    w = 0.075
    t = 0.014
    # Emerges from bottom of page block near x = -0.18, drapes down with a subtle S-wave.
    rings = []
    for i in range(segs + 1):
        u = i / segs
        x = -0.16 + 0.055 * math.sin(u * math.pi * 1.35)
        y = page_bottom_y + 0.06 - u * 0.52
        z = 0.04 * math.sin(u * math.pi * 1.1) + 0.02 * u
        # Slightly widen toward swallowtail tip
        hw = w * (0.9 + 0.25 * u)
        ht = t * 0.5
        v0 = bm.verts.new(loc(x - hw, y, z + ht))
        v1 = bm.verts.new(loc(x + hw, y, z + ht))
        v2 = bm.verts.new(loc(x + hw, y, z - ht))
        v3 = bm.verts.new(loc(x - hw, y, z - ht))
        rings.append((v0, v1, v2, v3))

    for i in range(segs):
        a = rings[i]
        b = rings[i + 1]
        for k in range(4):
            kn = (k + 1) % 4
            bm.faces.new((a[k], a[kn], b[kn], b[k]))

    # Swallowtail notch at the bottom tip
    last = rings[-1]
    u_end = 1.0
    x_tip = -0.16 + 0.055 * math.sin(u_end * math.pi * 1.35)
    y_tip = page_bottom_y + 0.06 - 0.52
    z_tip = 0.04 * math.sin(u_end * math.pi * 1.1) + 0.02
    hw = w * 1.15
    ht = t * 0.5
    # Two pointed tails + recessed center notch
    notch_f = bm.verts.new(loc(x_tip, y_tip + 0.07, z_tip + ht))
    notch_b = bm.verts.new(loc(x_tip, y_tip + 0.07, z_tip - ht))
    tip_l_f = bm.verts.new(loc(x_tip - hw, y_tip - 0.09, z_tip + ht))
    tip_l_b = bm.verts.new(loc(x_tip - hw, y_tip - 0.09, z_tip - ht))
    tip_r_f = bm.verts.new(loc(x_tip + hw, y_tip - 0.09, z_tip + ht))
    tip_r_b = bm.verts.new(loc(x_tip + hw, y_tip - 0.09, z_tip - ht))

    bm.faces.new((last[0], notch_f, tip_l_f))
    bm.faces.new((notch_f, last[1], tip_r_f))
    bm.faces.new((last[3], tip_l_b, notch_b))
    bm.faces.new((notch_b, tip_r_b, last[2]))
    # Cap edges
    bm.faces.new((last[0], tip_l_f, tip_l_b, last[3]))
    bm.faces.new((last[1], last[2], tip_r_b, tip_r_f))
    bm.faces.new((tip_l_f, notch_f, notch_b, tip_l_b))
    bm.faces.new((notch_f, tip_r_f, tip_r_b, notch_b))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("Ribbon", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m_ribbon)
    smooth(obj)
    return obj


def add_cover_ornament(side_z, font, m_gold, m_gold_bright, m_navy_inset, book_w, book_h):
    """Add double gold-foil border, corner filigree, title cartouche, and 3D Hebrew 'תהילים'."""
    parts = []
    sign = 1.0 if side_z > 0 else -1.0
    z_frame = side_z + sign * 0.012
    z_text = side_z + sign * 0.016

    # Shift ornament slightly left of the spine (spine is on +X)
    cx = -0.05
    outer_w = book_w * 0.78
    outer_h = book_h * 0.84
    inner_w = outer_w - 0.11
    inner_h = outer_h - 0.11
    bar_t = 0.024
    bar_d = 0.016

    # Outer gold foil border
    for sx_sign in (-1, 1):
        parts.append(box(cx + sx_sign * (outer_w * 0.5), 0.0, z_frame, bar_t, outer_h + bar_t, bar_d, m_gold, bevel=0.004))
    for sy_sign in (-1, 1):
        parts.append(box(cx, sy_sign * (outer_h * 0.5), z_frame, outer_w + bar_t, bar_t, bar_d, m_gold, bevel=0.004))

    # Inner hairline gold border
    thin = 0.014
    for sx_sign in (-1, 1):
        parts.append(box(cx + sx_sign * (inner_w * 0.5), 0.0, z_frame, thin, inner_h + thin, bar_d * 0.85, m_gold, bevel=0.003))
    for sy_sign in (-1, 1):
        parts.append(box(cx, sy_sign * (inner_h * 0.5), z_frame, inner_w + thin, thin, bar_d * 0.85, m_gold, bevel=0.003))

    # Corner diamond medallions (traditional Jewish bookbinding corner ornaments)
    for sx_sign in (-1, 1):
        for sy_sign in (-1, 1):
            px = cx + sx_sign * (inner_w * 0.5 - 0.045)
            py = sy_sign * (inner_h * 0.5 - 0.045)
            parts.append(box(px, py, z_frame + sign * 0.003, 0.065, 0.065, bar_d, m_gold_bright, bevel=0.006, rot=(0, math.pi / 4, 0)))

    # Decorative title plaque backdrop + top/bottom filigree rules
    title_y = 0.24
    parts.append(box(cx, title_y, side_z + sign * 0.006, inner_w * 0.88, 0.44, 0.010, m_navy_inset, bevel=0.005))
    for dy in (-0.23, 0.23):
        parts.append(box(cx, title_y + dy, z_frame, inner_w * 0.84, 0.020, bar_d, m_gold, bevel=0.004))
        parts.append(box(cx, title_y + dy, z_frame + sign * 0.004, 0.055, 0.055, bar_d, m_gold_bright, bevel=0.005, rot=(0, math.pi / 4, 0)))

    # Lower subtle Star-of-David-inspired / diamond emblem below the title
    emblem_y = -0.34
    for angle in (0.0, math.pi / 4):
        parts.append(box(cx, emblem_y, z_frame + sign * 0.002, 0.16, 0.16, bar_d * 0.9, m_gold, bevel=0.005, rot=(0, angle, 0)))
    parts.append(box(cx, emblem_y, z_frame + sign * 0.006, 0.08, 0.08, bar_d * 0.9, m_navy_inset, bevel=0.004, rot=(0, math.pi / 4, 0)))
    parts.append(box(cx, emblem_y, z_frame + sign * 0.009, 0.036, 0.036, bar_d * 0.9, m_gold_bright, bevel=0.004, rot=(0, 0, 0)))

    # 3D Hebrew Bible font text: תהילים
    bpy.ops.object.text_add(location=loc(cx, title_y - 0.025, z_text))
    txt = bpy.context.active_object
    txt.data.body = TEHILIM_VISUAL_LTR
    txt.data.font = font
    txt.data.size = 0.295
    txt.data.align_x = "CENTER"
    txt.data.align_y = "CENTER"
    txt.data.extrude = 0.016
    txt.data.bevel_depth = 0.003
    txt.data.bevel_resolution = 0
    txt.data.resolution_u = 3
    txt.data.space_character = 1.04

    if sign > 0:
        # Front cover (+Z in Bevy = -Y in Blender)
        txt.rotation_euler = Euler((math.pi / 2, 0.0, 0.0), "XYZ")
    else:
        # Back cover (-Z in Bevy = +Y in Blender)
        txt.rotation_euler = Euler((math.pi / 2, 0.0, math.pi), "XYZ")

    bpy.context.view_layer.objects.active = txt
    bpy.ops.object.convert(target="MESH")
    txt = bpy.context.active_object
    txt.data.materials.append(m_gold_bright)
    smooth(txt)
    parts.append(txt)

    return parts


def build_tehilim_book():
    reset_scene()
    font = load_hebrew_font()

    # Rich heirloom PBR materials
    m_leather = mat("LeatherNavy", "#143568", roughness=0.58, metallic=0.04, coat=0.15)
    m_leather_inset = mat("LeatherInset", "#0e2750", roughness=0.66, metallic=0.02)
    m_spine = mat("SpineNavy", "#1c447e", roughness=0.50, metallic=0.06, coat=0.2)
    m_gold = mat("GoldFoil", "#ecc258", roughness=0.22, metallic=0.92, emission=0.22, emission_color="#f5ce68")
    m_gold_bright = mat("GoldEmboss", "#ffe08c", roughness=0.18, metallic=0.94, emission=0.35, emission_color="#ffdf82")
    m_gilt_edge = mat("GiltPages", "#e3c57c", roughness=0.30, metallic=0.72, emission=0.08, emission_color="#f0d48a")
    m_page_groove = mat("PageGroove", "#bfa065", roughness=0.52, metallic=0.25)
    m_headband = mat("HeadbandBlue", "#2b62b8", roughness=0.55, metallic=0.05)
    m_ribbon = mat("SilkRibbon", "#bc2c45", roughness=0.38, metallic=0.05, emission=0.06, emission_color="#d93855")

    book_w = 1.38
    book_h = 1.88
    board_t = 0.075
    page_t = 0.34
    half_z = page_t * 0.5 + board_t * 0.5

    parts = []

    # 1. Gilt-edged parchment page block (recessed slightly inside cover boards on 3 sides)
    page_w = book_w - 0.12
    page_h = book_h - 0.14
    parts.append(box(-0.04, 0.0, 0.0, page_w, page_h, page_t, m_gilt_edge, bevel=0.012))

    # Fine page-leaf striations on the open left edge (-X), top (+Y), and bottom (-Y)
    for i in range(6):
        z_line = -page_t * 0.36 + i * (page_t * 0.72 / 5.0)
        parts.append(box(-0.04 - page_w * 0.5 - 0.002, 0.0, z_line, 0.008, page_h - 0.04, 0.008, m_page_groove, bevel=0.0))
        parts.append(box(-0.04, page_h * 0.5 + 0.002, z_line, page_w - 0.04, 0.008, 0.008, m_page_groove, bevel=0.0))
        parts.append(box(-0.04, -page_h * 0.5 - 0.002, z_line, page_w - 0.04, 0.008, 0.008, m_page_groove, bevel=0.0))

    # 2. Front (+Z) and back (-Z) beveled leather hardcover boards
    for sign in (-1, 1):
        parts.append(box(0.0, 0.0, sign * half_z, book_w, book_h, board_t, m_leather, bevel=0.022))
        # Subtle recessed French groove along the spine hinge (+X side)
        parts.append(box(book_w * 0.5 - 0.11, 0.0, sign * (half_z + board_t * 0.45), 0.026, book_h - 0.06, 0.018, m_leather_inset, bevel=0.004))

    # 3. Curved ribbed spine on the authentic Hebrew RIGHT side (+X)
    spine_x = book_w * 0.5 - 0.01
    spine_r = half_z + board_t * 0.48
    # Main rounded spine cylinder (axis along Bevy Y = Blender Z)
    parts.append(cyl(spine_x, 0.0, 0.0, spine_r, book_h, m_spine, verts=28, rot=(0, 0, 0), bevel=0.015))
    # 5 traditional raised spine binding hubs/bands + gold fillets
    for i in range(5):
        band_y = -0.64 + i * 0.32
        parts.append(cyl(spine_x + 0.015, band_y, 0.0, spine_r + 0.024, 0.055, m_spine, verts=24, rot=(0, 0, 0), bevel=0.01))
        for dy in (-0.042, 0.042):
            parts.append(cyl(spine_x + 0.012, band_y + dy, 0.0, spine_r + 0.014, 0.014, m_gold, verts=24, rot=(0, 0, 0)))

    # Woven headbands (top & bottom tucked between spine and page block)
    for sy in (-1, 1):
        parts.append(cyl(spine_x - 0.11, sy * (page_h * 0.5 - 0.01), 0.0, page_t * 0.48, 0.045, m_headband, verts=16, rot=(0, 0, 0)))

    # 4. Ornate gold-foil cover borders + 3D Hebrew Bible lettering "תהילים" on both covers
    parts.extend(add_cover_ornament(half_z + board_t * 0.5, font, m_gold, m_gold_bright, m_leather_inset, book_w, book_h))
    parts.extend(add_cover_ornament(-(half_z + board_t * 0.5), font, m_gold, m_gold_bright, m_leather_inset, book_w, book_h))

    # 5. Draped crimson silk bookmark ribbon emerging from bottom of pages
    parts.append(add_ribbon(m_ribbon, m_gold, -page_h * 0.5, half_z))

    # Apply modifiers cleanly and join into one crisp single-mesh asset
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    for obj in parts:
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    book = bpy.context.active_object
    book.name = "TehilimBook"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    tris = sum(len(p.vertices) - 2 for p in book.data.polygons)
    out_path = os.path.join(out_dir, "tehilim_book.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print(f"Exported {out_path} ({tris} triangles)")
    return book


if __name__ == "__main__":
    build_tehilim_book()
