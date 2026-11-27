"""
Headless Blender 5.3 generator for Wild Wheels WASM PoC explosion assets:
  1. 3 sculpted 3D metal wreckage/debris .glb models:
       - wasm-poc/assets/models/debris_plate.glb
       - wasm-poc/assets/models/debris_girder.glb
       - wasm-poc/assets/models/debris_shard.glb
  2. Baked radial blast-crater floor decal (512x512 RGBA):
       - wasm-poc/assets/textures/scorch_decal.png
  3. 36-frame (6x6) Mantaflow volumetric fire+smoke flipbook atlas (768x768 RGBA):
       - wasm-poc/assets/textures/explosion_flipbook.png

Run:
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_explosion_assets.py
"""
import math
import os
import random
import tempfile
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS_DIR = os.path.join(ROOT, "assets", "models")
TEX_DIR = os.path.join(ROOT, "assets", "textures")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(TEX_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, base_color, metallic=0.5, roughness=0.45, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_materials="EXPORT",
        export_apply=True,
    )
    print(f"[explosion_assets] Exported {path} ({os.path.getsize(path)} bytes)")


# ---------------------------------------------------------------------------
# 1. Sculpted 3D Metal Wreckage / Debris .glb models
# ---------------------------------------------------------------------------
def build_debris_plate():
    clear_scene()
    mat_steel = make_pbr_mat("ScorchedSteel", (0.14, 0.13, 0.14), metallic=0.82, roughness=0.46)
    mat_soot = make_pbr_mat("CharredEdge", (0.04, 0.04, 0.045), metallic=0.35, roughness=0.82)
    mat_hot = make_pbr_mat("HotTear", (1.0, 0.34, 0.05), metallic=0.2, roughness=0.35, emission=(1.0, 0.32, 0.04), emission_strength=6.5)

    # Bent jagged armor plate
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=5, y_segments=4, size=0.42)
    rng = random.Random(42)
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        # Jagged outer edges
        if abs(x) > 0.35 or abs(y) > 0.35:
            v.co.x += rng.uniform(-0.08, 0.08)
            v.co.y += rng.uniform(-0.08, 0.08)
        # Crumpled bend from blast wave
        v.co.z = 0.14 * (x * x * 3.5) + 0.09 * math.sin(y * 5.0) + rng.uniform(-0.02, 0.02)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.045)
    mesh = bpy.data.meshes.new("DebrisPlate")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("DebrisPlate", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat_steel)
    obj.data.materials.append(mat_soot)
    obj.data.materials.append(mat_hot)

    # Assign charred & hot torn materials to perimeter faces
    for poly in obj.data.polygons:
        cx, cy, _ = poly.center
        if cx > 0.30:
            poly.material_index = 2
        elif abs(cx) > 0.28 or abs(cy) > 0.28:
            poly.material_index = 1
        else:
            poly.material_index = 0
        poly.use_smooth = False

    # Add 4 small rivets along the intact side
    for rx, ry in [(-0.24, -0.20), (-0.24, 0.0), (-0.24, 0.20), (-0.08, -0.20)]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.032, location=(rx, ry, 0.06))
        riv = bpy.context.active_object
        riv.scale = (1.0, 1.0, 0.55)
        riv.data.materials.append(mat_steel)

    export_glb(os.path.join(MODELS_DIR, "debris_plate.glb"))


def build_debris_girder():
    clear_scene()
    mat_iron = make_pbr_mat("TwistedIron", (0.18, 0.17, 0.16), metallic=0.88, roughness=0.42)
    mat_paint = make_pbr_mat("ScorchedYellow", (0.52, 0.34, 0.06), metallic=0.15, roughness=0.68)

    # I-beam cross section extruded & twisted
    bm = bmesh.new()
    segs = 7
    length = 1.05
    profile = [
        (-0.14, -0.14), (0.14, -0.14), (0.14, -0.09),
        (0.035, -0.09), (0.035, 0.09), (0.14, 0.09),
        (0.14, 0.14), (-0.14, 0.14), (-0.14, 0.09),
        (-0.035, 0.09), (-0.035, -0.09), (-0.14, -0.09),
    ]
    rings = []
    for i in range(segs + 1):
        t = i / segs
        z = (t - 0.5) * length
        twist = (t - 0.5) * 0.95
        bend_x = 0.11 * math.sin(t * math.pi)
        ct, st = math.cos(twist), math.sin(twist)
        ring = []
        for px, py in profile:
            rx = px * ct - py * st + bend_x
            ry = px * st + py * ct
            ring.append(bm.verts.new((rx, ry, z)))
        rings.append(ring)

    n = len(profile)
    for i in range(segs):
        for j in range(n):
            jn = (j + 1) % n
            bm.faces.new((rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    mesh = bpy.data.meshes.new("DebrisGirder")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("DebrisGirder", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat_iron)
    obj.data.materials.append(mat_paint)
    for poly in obj.data.polygons:
        if -0.22 < poly.center.z < 0.18 and abs(poly.normal.x) > 0.5:
            poly.material_index = 1
        poly.use_smooth = False

    export_glb(os.path.join(MODELS_DIR, "debris_girder.glb"))


def build_debris_shard():
    clear_scene()
    mat_char = make_pbr_mat("CharredHull", (0.06, 0.055, 0.06), metallic=0.45, roughness=0.72)
    mat_ember = make_pbr_mat("GlowingCore", (1.0, 0.42, 0.06), metallic=0.1, roughness=0.3, emission=(1.0, 0.45, 0.06), emission_strength=9.0)

    # Jagged triangular/polygonal shrapnel wedge
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.32)
    rng = random.Random(108)
    for v in bm.verts:
        v.co.x *= 1.9 + rng.uniform(-0.35, 0.35)
        v.co.y *= 0.65 + rng.uniform(-0.2, 0.2)
        v.co.z *= 0.32 + rng.uniform(-0.12, 0.12)
    mesh = bpy.data.meshes.new("DebrisShard")
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("DebrisShard", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat_char)
    obj.data.materials.append(mat_ember)
    for poly in obj.data.polygons:
        poly.material_index = 1 if poly.center.x > 0.18 else 0
        poly.use_smooth = False

    export_glb(os.path.join(MODELS_DIR, "debris_shard.glb"))


# ---------------------------------------------------------------------------
# 2. Baked Scorched Blast-Crater Floor Decal (512x512 RGBA)
# ---------------------------------------------------------------------------
def build_scorch_decal():
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    # Orthographic top-down camera framing [-1, 1] x [-1, 1]
    cam_data = bpy.data.cameras.new("DecalCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.0
    cam_obj = bpy.data.objects.new("DecalCam", cam_data)
    cam_obj.location = (0.0, 0.0, 2.0)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0.0, 0.0, 0.0))
    plane = bpy.context.active_object

    mat = bpy.data.materials.new("ScorchDecalMat")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    emit = nt.nodes.new("ShaderNodeEmission")

    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    # Centered radial distance from Object coords (-1..1 -> length 0..1)
    vec_len = nt.nodes.new("ShaderNodeVectorMath")
    vec_len.operation = "LENGTH"
    nt.links.new(tex_coord.outputs["Object"], vec_len.inputs[0])

    # Angular starburst distortion via stretched noise
    noise_ray = nt.nodes.new("ShaderNodeTexNoise")
    noise_ray.inputs["Scale"].default_value = 6.5
    noise_ray.inputs["Detail"].default_value = 8.0
    noise_ray.inputs["Roughness"].default_value = 0.65

    # Normalize Object coords to get radial streak rays
    vec_norm = nt.nodes.new("ShaderNodeVectorMath")
    vec_norm.operation = "NORMALIZE"
    nt.links.new(tex_coord.outputs["Object"], vec_norm.inputs[0])
    nt.links.new(vec_norm.outputs["Vector"], noise_ray.inputs["Vector"])

    # Fine charcoal grain noise
    noise_fine = nt.nodes.new("ShaderNodeTexNoise")
    noise_fine.inputs["Scale"].default_value = 14.0
    noise_fine.inputs["Detail"].default_value = 10.0
    noise_fine.inputs["Roughness"].default_value = 0.72
    nt.links.new(tex_coord.outputs["Object"], noise_fine.inputs["Vector"])

    # Combine distance + ray perturbation + fine grain
    ray_scale = nt.nodes.new("ShaderNodeMath")
    ray_scale.operation = "MULTIPLY"
    ray_scale.inputs[1].default_value = 0.34
    nt.links.new(noise_ray.outputs["Fac"], ray_scale.inputs[0])

    fine_scale = nt.nodes.new("ShaderNodeMath")
    fine_scale.operation = "MULTIPLY"
    fine_scale.inputs[1].default_value = 0.14
    nt.links.new(noise_fine.outputs["Fac"], fine_scale.inputs[0])

    add1 = nt.nodes.new("ShaderNodeMath")
    add1.operation = "ADD"
    nt.links.new(vec_len.outputs["Value"], add1.inputs[0])
    nt.links.new(ray_scale.outputs["Value"], add1.inputs[1])

    add2 = nt.nodes.new("ShaderNodeMath")
    add2.operation = "ADD"
    nt.links.new(add1.outputs["Value"], add2.inputs[0])
    nt.links.new(fine_scale.outputs["Value"], add2.inputs[1])

    # Alpha ramp: solid dark crater center -> wispy soot rays -> transparent edge
    ramp_a = nt.nodes.new("ShaderNodeValToRGB")
    ramp_a.color_ramp.elements[0].position = 0.25
    ramp_a.color_ramp.elements[0].color = (0.94, 0.94, 0.94, 1.0)
    e_mid = ramp_a.color_ramp.elements.new(0.68)
    e_mid.color = (0.48, 0.48, 0.48, 1.0)
    ramp_a.color_ramp.elements[-1].position = 1.12
    ramp_a.color_ramp.elements[-1].color = (0.0, 0.0, 0.0, 1.0)
    nt.links.new(add2.outputs["Value"], ramp_a.inputs["Fac"])

    # Color ramp: pitch black burnt center -> warm dark ash -> smoky brown-gray soot rim
    ramp_c = nt.nodes.new("ShaderNodeValToRGB")
    ramp_c.color_ramp.elements[0].position = 0.22
    ramp_c.color_ramp.elements[0].color = (0.015, 0.012, 0.012, 1.0)
    e_c1 = ramp_c.color_ramp.elements.new(0.45)
    e_c1.color = (0.06, 0.045, 0.038, 1.0)
    ramp_c.color_ramp.elements[-1].position = 0.95
    ramp_c.color_ramp.elements[-1].color = (0.14, 0.12, 0.11, 1.0)
    nt.links.new(add2.outputs["Value"], ramp_c.inputs["Fac"])

    nt.links.new(ramp_c.outputs["Color"], emit.inputs["Color"])
    emit.inputs["Strength"].default_value = 1.0

    nt.links.new(ramp_a.outputs["Color"], mix_sh.inputs["Fac"])
    nt.links.new(transp.outputs["BSDF"], mix_sh.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])

    plane.data.materials.append(mat)

    out_path = os.path.join(TEX_DIR, "scorch_decal.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[explosion_assets] Rendered {out_path} ({os.path.getsize(out_path)} bytes)")


# ---------------------------------------------------------------------------
# 3. 36-Frame (6x6) Mantaflow Volumetric Fire+Smoke Flipbook Atlas
# ---------------------------------------------------------------------------
def build_mantaflow_flipbook():
    clear_scene()
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 42
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.cycles.volume_bounces = 1
    scene.cycles.volume_step_rate = 1.25
    scene.cycles.volume_max_steps = 96
    scene.render.resolution_x = 128
    scene.render.resolution_y = 128
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"

    # Subtle bright ambient + crisp top-right sun so volumetric smoke has gorgeous shading
    world = bpy.data.worlds.new("FlipbookWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.32, 0.34, 0.40, 1.0)
    bg.inputs["Strength"].default_value = 0.75

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 4.2
    sun_data.color = (1.0, 0.94, 0.85)
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    sun_obj.rotation_euler = Euler((math.radians(48), math.radians(15), math.radians(-35)), "XYZ")
    bpy.context.collection.objects.link(sun_obj)

    # Angled camera matching Wild Wheels isometric-ish perspective
    cam_data = bpy.data.cameras.new("FlipCam")
    cam_data.lens = 40.0
    cam_obj = bpy.data.objects.new("FlipCam", cam_data)
    cam_obj.location = (0.0, -10.8, 4.4)
    direction = Vector((0.0, 0.0, 1.85)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # Large open-border Fluid Domain so smoke curls freely and NEVER clips a cube wall!
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 2.4))
    domain = bpy.context.active_object
    domain.name = "SmokeDomain"
    domain.scale = (8.8, 8.8, 9.2)
    bpy.ops.object.transform_apply(scale=True)

    dom_mod = domain.modifiers.new(name="Fluid", type="FLUID")
    dom_mod.fluid_type = "DOMAIN"
    ds = dom_mod.domain_settings
    ds.domain_type = "GAS"
    ds.resolution_max = 44
    ds.use_adaptive_domain = True
    ds.use_collision_border_front = False
    ds.use_collision_border_back = False
    ds.use_collision_border_left = False
    ds.use_collision_border_right = False
    ds.use_collision_border_top = False
    ds.use_noise = True
    ds.noise_scale = 2
    ds.noise_strength = 2.0
    ds.vorticity = 2.8
    ds.alpha = 0.22
    ds.beta = 1.65
    ds.use_dissolve_smoke = True
    ds.dissolve_speed = 22
    ds.flame_smoke = 1.4
    ds.flame_vorticity = 1.8
    ds.burning_rate = 0.72
    ds.cache_type = "ALL"
    tmp_cache = tempfile.mkdtemp(prefix="ww_manta_")
    ds.cache_directory = tmp_cache
    ds.cache_frame_start = 1
    ds.cache_frame_end = 42

    # Volumetric Fire + Smoke Material (Principled Volume)
    vmat = bpy.data.materials.new("BlastVolumeMat")
    vmat.use_nodes = True
    nt = vmat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pvol = nt.nodes.new("ShaderNodeVolumePrincipled")
    pvol.inputs["Color"].default_value = (0.28, 0.26, 0.27, 1.0)
    pvol.inputs["Density"].default_value = 5.2
    pvol.inputs["Anisotropy"].default_value = 0.42
    pvol.inputs["Blackbody Intensity"].default_value = 3.2
    pvol.inputs["Blackbody Tint"].default_value = (1.0, 0.62, 0.20, 1.0)
    pvol.inputs["Temperature"].default_value = 2800.0
    pvol.inputs["Temperature Attribute"].default_value = "flame"

    # Boost flame intensity via Attribute -> Math -> Emission Strength for punchy fireballs
    attr_flame = nt.nodes.new("ShaderNodeAttribute")
    attr_flame.attribute_name = "flame"
    ramp_fire = nt.nodes.new("ShaderNodeValToRGB")
    ramp_fire.color_ramp.elements[0].position = 0.03
    ramp_fire.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    e_f1 = ramp_fire.color_ramp.elements.new(0.24)
    e_f1.color = (0.98, 0.20, 0.01, 1.0)
    e_f2 = ramp_fire.color_ramp.elements.new(0.58)
    e_f2.color = (1.0, 0.68, 0.10, 1.0)
    ramp_fire.color_ramp.elements[-1].position = 0.90
    ramp_fire.color_ramp.elements[-1].color = (1.0, 0.97, 0.80, 1.0)

    mul_emit = nt.nodes.new("ShaderNodeMath")
    mul_emit.operation = "MULTIPLY"
    mul_emit.inputs[1].default_value = 22.0

    nt.links.new(attr_flame.outputs["Fac"], ramp_fire.inputs["Fac"])
    nt.links.new(attr_flame.outputs["Fac"], mul_emit.inputs[0])
    nt.links.new(ramp_fire.outputs["Color"], pvol.inputs["Emission Color"])
    nt.links.new(mul_emit.outputs["Value"], pvol.inputs["Emission Strength"])
    nt.links.new(pvol.outputs["Volume"], out.inputs["Volume"])
    domain.data.materials.append(vmat)

    # Fluid Flow Emitter (explosive burst frames 1..7)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.62, location=(0.0, 0.0, 0.45))
    emitter = bpy.context.active_object
    emitter.name = "BlastEmitter"
    emitter.hide_render = True
    flow_mod = emitter.modifiers.new(name="Fluid", type="FLUID")
    flow_mod.fluid_type = "FLOW"
    fs = flow_mod.flow_settings
    fs.flow_type = "BOTH"
    fs.flow_behavior = "INFLOW"
    fs.fuel_amount = 2.8
    fs.smoke_color = (0.24, 0.22, 0.23)
    fs.density = 2.0
    fs.temperature = 3.0
    fs.use_initial_velocity = True
    fs.velocity_normal = 2.4
    fs.velocity_coord = (0.0, 0.0, 2.2)
    fs.use_inflow = True

    # Keyframe inflow ON for frames 1..7, OFF at frame 8
    fs.keyframe_insert(data_path="use_inflow", frame=1)
    fs.keyframe_insert(data_path="use_inflow", frame=7)
    fs.use_inflow = False
    fs.keyframe_insert(data_path="use_inflow", frame=8)

    # Bake Mantaflow simulation
    bpy.context.view_layer.objects.active = domain
    print("[explosion_assets] Baking Mantaflow simulation...")
    bpy.ops.fluid.bake_all()
    print("[explosion_assets] Bake complete! Rendering 36 flipbook frames...")

    # Render 36 frames (frames 2..37) and stitch into 6x6 atlas (768x768 RGBA)
    cols, rows = 6, 6
    tile = 128
    atlas = np.zeros((rows * tile, cols * tile, 4), dtype=np.float32)
    frame_dir = tempfile.mkdtemp(prefix="ww_flip_")

    for idx in range(cols * rows):
        frame = 2 + idx
        scene.frame_set(frame)
        fpath = os.path.join(frame_dir, f"f_{idx:02d}.png")
        scene.render.filepath = fpath
        bpy.ops.render.render(write_still=True)

        img = bpy.data.images.load(fpath, check_existing=False)
        px = np.array(img.pixels[:], dtype=np.float32).reshape((tile, tile, 4))
        bpy.data.images.remove(img)

        # Smooth circular edge feather so no tile border ever shows on billboards
        yy, xx = np.mgrid[0:tile, 0:tile]
        rr = np.sqrt(((xx + 0.5) / tile * 2.0 - 1.0) ** 2 + ((yy + 0.5) / tile * 2.0 - 1.0) ** 2)
        mask = np.clip((0.98 - rr) / (0.98 - 0.68), 0.0, 1.0)
        mask = mask * mask * (3.0 - 2.0 * mask)
        px[:, :, 3] *= mask

        r = idx // cols
        c = idx % cols
        # Blender image pixels are bottom-to-top; place row 0 at the TOP of the PNG
        atlas_r = (rows - 1 - r) * tile
        atlas_c = c * tile
        atlas[atlas_r : atlas_r + tile, atlas_c : atlas_c + tile, :] = px

    # Save stitched atlas using Blender's image writer
    out_img = bpy.data.images.new("ExplosionFlipbook", width=cols * tile, height=rows * tile, alpha=True)
    out_img.pixels.foreach_set(atlas.ravel())
    out_path = os.path.join(TEX_DIR, "explosion_flipbook.png")
    out_img.filepath_raw = out_path
    out_img.file_format = "PNG"
    out_img.save()
    print(f"[explosion_assets] Saved 6x6 Mantaflow flipbook {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == "__main__":
    build_debris_plate()
    build_debris_girder()
    build_debris_shard()
    build_scorch_decal()
    build_mantaflow_flipbook()
    print("[explosion_assets] ALL DONE!")
