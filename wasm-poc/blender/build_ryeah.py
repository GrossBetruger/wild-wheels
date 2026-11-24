"""Headless Blender 5.3 PBR generator for R-Yeah (#11):
- Skinned hanging lion pilot (`ryeah_lion.glb`) rooted at the Bell 206 left skid grip
  `(0.31, 4.77, 0.45)` so his gripping paw stays 100% locked to the skid bar!
- Offline coupled multi-pendulum physics simulation (gravity + forward airspeed drag +
  helicopter rotor downwash turbulence + knee-bend limits + secondary tail whip)
  baked cleanly into 4 seamlessly looping animation clips (`hang`, `boost`, `roar`, `fire`),
  plus eyelid blink shape keys (`MorphWeights`).

Run: /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_ryeah.py
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import rigging  # noqa: E402
from rigging import RX, RY, RZ, wave  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, color, metallic=0.0, roughness=0.45, emission=None, emission_strength=0.0, coat=0.0):
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


def loc(x, y, z):
    """Model space (x across, y up, z forward) -> Blender space (x, -z, y)."""
    return Vector((x, -z, y))


def hanging_model(x, y, z):
    """hangingLion rest pose in model space (x, y, z), anchored naturally under the
    Bell 206 left skid while keeping the kippah clear of the Vulcan pod."""
    c, s = math.cos(0.27), math.sin(0.27)
    cp, sp = math.cos(0.18), math.sin(0.18)
    x += 0.85
    y -= 5.15
    xx = x * c - y * s
    yy = x * s + y * c
    return (0.22 + xx, 4.64 + yy * cp - z * sp, 0.08 + yy * sp + z * cp)


def hanging_pt(x, y, z):
    return loc(*hanging_model(x, y, z))


def add_sphere(bm, center, rx, ry, rz, segs=16, rings=10):
    m = Matrix.Translation(center) @ Matrix.Diagonal((rx, rz, ry, 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)


def add_box(bm, center, sx, sy, sz):
    m = Matrix.Translation(center) @ Matrix.Diagonal((sx, sz, sy, 1.0))
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


def add_capsule(bm, p0, p1, r, segs=10):
    add_tube(bm, p0, p1, r, r, segs=segs)
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=6, radius=r, matrix=Matrix.Translation(p0))
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=6, radius=r, matrix=Matrix.Translation(p1))


def make_piece(name, bm, mat, bucket):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    rigging.bind(obj)
    bucket.append(obj)
    return obj


# --- Skeleton Hinges (Rooted at the Bell 206 Left Skid Grip!) ---
HINGE_GRIP_L = (0.31, 4.77, 0.45)
HINGE_SHOULDER_L = hanging_model(-0.58, 2.95, 0.28)
HINGE_HEAD = hanging_model(0.0, 3.65, 0.52)
HINGE_JAW = hanging_model(0.0, 3.72, 1.02)
HINGE_EAR_L = hanging_model(-0.60, 4.68, 0.48)
HINGE_EAR_R = hanging_model(0.60, 4.68, 0.48)
HINGE_ARM_R_UP = hanging_model(0.58, 2.95, 0.28)
HINGE_ARM_R_LO = hanging_model(0.80, 3.16, 0.68)
HINGE_HIP_L = hanging_model(-0.36, 2.08, 0.16)
HINGE_KNEE_L = hanging_model(-0.42, 1.54, 0.36)
HINGE_HIP_R = hanging_model(0.36, 2.08, 0.16)
HINGE_KNEE_R = hanging_model(0.42, 1.54, 0.48)
HINGE_TAIL_0 = hanging_model(0.0, 2.10, -0.32)
HINGE_TAIL_1 = hanging_model(-0.18, 1.80, -0.95)


def lion_bones():
    """Rooted at `arm_l` (the gripping paw on the Bell 206 skid) so the paw
    never drifts off the steel skid bar while the entire lion hangs & swings!"""
    return [
        ("arm_l", None, HINGE_GRIP_L),
        ("torso", "arm_l", HINGE_SHOULDER_L),
        ("head", "torso", HINGE_HEAD),
        ("jaw", "head", HINGE_JAW),
        ("ear_l", "head", HINGE_EAR_L),
        ("ear_r", "head", HINGE_EAR_R),
        ("arm_r_upper", "torso", HINGE_ARM_R_UP),
        ("arm_r_lower", "arm_r_upper", HINGE_ARM_R_LO),
        ("leg_l_upper", "torso", HINGE_HIP_L),
        ("leg_l_lower", "leg_l_upper", HINGE_KNEE_L),
        ("leg_r_upper", "torso", HINGE_HIP_R),
        ("leg_r_lower", "leg_r_upper", HINGE_KNEE_R),
        ("tail_base", "torso", HINGE_TAIL_0),
        ("tail_tip", "tail_base", HINGE_TAIL_1),
    ]


# ---------------------------------------------------------------------------
# Offline Coupled Multi-Pendulum Physics Simulation
# ---------------------------------------------------------------------------
def _step_pendulum(angle, vel, target, stiffness, damping, torque, dt, lo=-1.4, hi=1.4):
    acc = (target - angle) * stiffness - vel * damping + torque
    vel += acc * dt
    angle += vel * dt
    if angle < lo:
        angle = lo
        vel = max(0.0, vel * -0.25)
    elif angle > hi:
        angle = hi
        vel = min(0.0, vel * -0.25)
    return angle, vel, acc


def simulate_hang_clip(frames, airspeed_drag, gust_amp, boost=False, roar=False, fire=False):
    """Run a 240 Hz coupled multi-pendulum simulation of R-Yeah hanging from
    his left paw on the Bell 206 skid under gravity, forward airspeed drag,
    and periodic rotor downwash gusts. Warms up 3.5s to reach the limit cycle,
    then records `frames + 1` samples with seamless periodic wrap!"""
    fps = 30.0
    duration = frames / fps
    substeps = 8
    dt = 1.0 / (fps * substeps)
    warmup_steps = int(round(3.5 * fps * substeps))
    total_steps = warmup_steps + frames * substeps

    # Generalized coordinates: (angle, vel)
    arm_p, arm_vp = 0.0, 0.0        # Left arm pitch (backward trail under drag)
    arm_r, arm_vr = 0.0, 0.0        # Left arm roll (sideways sway in downwash)
    tor_p, tor_vp = 0.0, 0.0        # Torso pitch hanging from shoulder
    tor_r, tor_vr = 0.0, 0.0        # Torso roll
    leg_lp, leg_lvp = 0.0, 0.0      # Left thigh pitch
    leg_rp, leg_rvp = 0.0, 0.0      # Right thigh pitch
    knee_l, knee_lv = 0.12, 0.0     # Left knee bend (positive = bends backward)
    knee_r, knee_rv = 0.18, 0.0     # Right knee bend
    tail0_y, tail0_vy = 0.0, 0.0    # Tail base yaw
    tail0_p, tail0_vp = 0.0, 0.0    # Tail base pitch
    tail1_y, tail1_vy = 0.0, 0.0    # Tail tip yaw (secondary lag!)

    recorded = []
    omega = math.tau / duration

    for step in range(total_steps + 1):
        t = step * dt
        # Periodic rotor downwash & flight turbulence (integer harmonics of clip cycle!)
        g1 = math.sin(omega * t)
        g2 = math.sin(2.0 * omega * t + 0.7)
        g3 = math.cos(3.0 * omega * t - 0.4)

        # 1. Left arm hanging from fixed Bell 206 skid grip
        # Gravity restores toward 0, forward airspeed drag tilts backward (+pitch)
        arm_target_p = airspeed_drag * 0.42
        arm_torque_p = gust_amp * (0.55 * g1 + 0.35 * g2)
        arm_torque_r = gust_amp * (0.75 * math.cos(omega * t + 0.3) + 0.30 * g3)
        arm_p, arm_vp, arm_ap = _step_pendulum(arm_p, arm_vp, arm_target_p, 16.0, 3.8, arm_torque_p, dt, -0.35, 0.65)
        arm_r, arm_vr, arm_ar = _step_pendulum(arm_r, arm_vr, 0.0, 14.0, 3.4, arm_torque_r, dt, -0.35, 0.35)

        # 2. Torso hanging from left shoulder (coupled with inertial reaction -arm_acc!)
        tor_target_p = airspeed_drag * 0.46 + (-0.12 if roar else 0.0)
        tor_p, tor_vp, tor_ap = _step_pendulum(
            tor_p, tor_vp, tor_target_p, 20.0, 4.4,
            -0.55 * arm_ap + gust_amp * 0.45 * g2, dt, -0.45, 0.75,
        )
        tor_r, tor_vr, tor_ar = _step_pendulum(
            tor_r, tor_vr, 0.0, 18.0, 4.0,
            -0.50 * arm_ar + gust_amp * 0.40 * g1, dt, -0.35, 0.35,
        )

        # 3. Double-pendulum dangling legs (left & right slightly out of phase for organic feel)
        body_ap = arm_ap + tor_ap
        leg_target = airspeed_drag * 0.62
        leg_lp, leg_lvp, leg_lap = _step_pendulum(
            leg_lp, leg_lvp, leg_target, 14.0, 3.0,
            -0.65 * body_ap + gust_amp * (1.2 * g1 + 0.55 * g2), dt, -0.35, 0.95,
        )
        leg_rp, leg_rvp, leg_rap = _step_pendulum(
            leg_rp, leg_rvp, leg_target, 14.0, 3.0,
            -0.65 * body_ap + gust_amp * (-1.1 * g1 + 0.60 * g3), dt, -0.35, 0.95,
        )
        # Knees bend backward naturally (clamped >= 0.04 so knees never hyper-extend forward!)
        knee_target = 0.18 + airspeed_drag * 0.35
        knee_l, knee_lv, _ = _step_pendulum(
            knee_l, knee_lv, knee_target, 18.0, 3.6,
            -0.75 * leg_lap + gust_amp * 0.85 * g2, dt, 0.04, 1.15,
        )
        knee_r, knee_rv, _ = _step_pendulum(
            knee_r, knee_rv, knee_target, 18.0, 3.6,
            -0.75 * leg_rap - gust_amp * 0.85 * g2, dt, 0.04, 1.15,
        )

        # 4. Light double-pendulum lion tail (high drag & whip lag!)
        tail0_p, tail0_vp, _ = _step_pendulum(
            tail0_p, tail0_vp, airspeed_drag * 0.55, 16.0, 3.2,
            -0.55 * body_ap + gust_amp * 1.1 * g2, dt, -0.35, 1.05,
        )
        tail0_y, tail0_vy, tail0_ay = _step_pendulum(
            tail0_y, tail0_vy, 0.0, 12.0, 2.6,
            -0.65 * (arm_ar + tor_ar) + gust_amp * 1.8 * g1, dt, -0.65, 0.65,
        )
        tail1_y, tail1_vy, _ = _step_pendulum(
            tail1_y, tail1_vy, 0.0, 10.0, 2.2,
            -0.85 * tail0_ay + gust_amp * 1.6 * g3, dt, -0.85, 0.85,
        )

        if step >= warmup_steps and (step - warmup_steps) % substeps == 0:
            recorded.append((
                arm_p, arm_r, tor_p, tor_r,
                leg_lp, leg_rp, knee_l, knee_r,
                tail0_p, tail0_y, tail1_y,
            ))

    # Cross-blend the last 6 frames into frame 0 for a mathematically seamless loop
    n = len(recorded) - 1
    blend_len = min(6, n // 4)
    start_state = recorded[0]
    end_state = recorded[n]
    for i in range(blend_len + 1):
        u = i / blend_len
        idx = n - blend_len + i
        s = recorded[idx]
        recorded[idx] = tuple(s[k] + (start_state[k] - end_state[k]) * (u * u * (3 - 2 * u)) for k in range(len(s)))

    def pose_at(cycle):
        f = cycle * n
        i0 = int(f) % n
        i1 = (i0 + 1) % (n + 1)
        frac = f - math.floor(f)
        s0, s1 = recorded[i0], recorded[i1]
        (arm_p, arm_r, tor_p, tor_r,
         leg_lp, leg_rp, knee_l, knee_r,
         tail0_p, tail0_y, tail1_y) = [s0[k] + (s1[k] - s0[k]) * frac for k in range(len(s0))]

        # Head horizon stabilization (counter-rotates ~60% of body hang pitch so R-Yeah looks forward!)
        head_stab_p = -(arm_p + tor_p) * 0.62
        head_stab_r = -(arm_r + tor_r) * 0.55

        if roar:
            cheer = 0.5 + 0.5 * wave(cycle, 1, -1.2)
            w2 = wave(cycle, 2)
            head_q = RX(head_stab_p - 0.24 * cheer - 0.08) @ RY(wave(cycle, 1) * 0.12) @ RZ(head_stab_r)
            jaw_q = RX(0.42 * cheer + 0.18)
            ear_l_q = RZ(-0.22 * cheer)
            ear_r_q = RZ(0.22 * cheer)
            arm_ru = RX(-0.82 - w2 * 0.20) @ RZ(0.28 + w2 * 0.12)
            arm_rl = RX(-0.34 + w2 * 0.22)
        elif boost:
            head_q = RX(head_stab_p - 0.12) @ RY(wave(cycle, 1) * 0.04) @ RZ(head_stab_r)
            jaw_q = RX(0.14)
            ear_l_q = RX(-0.34) @ RZ(0.18)
            ear_r_q = RX(-0.34) @ RZ(-0.18)
            arm_ru = RX(0.42 + tor_p * 0.35) @ RZ(-0.38)
            arm_rl = RX(0.26)
        elif fire:
            rec = wave(cycle, 3)
            head_q = RX(head_stab_p - 0.05) @ RY(0.06) @ RZ(head_stab_r)
            jaw_q = RX(0.20 + abs(rec) * 0.08)
            ear_l_q = RX(-0.18)
            ear_r_q = RX(-0.18)
            arm_ru = RX(-0.22 + rec * 0.06) @ RZ(0.16)
            arm_rl = RX(-0.30)
        else:
            # Natural relaxed hanging right arm swinging with body inertia
            head_q = RX(head_stab_p) @ RY(wave(cycle, 1, 0.5) * 0.09) @ RZ(head_stab_r)
            jaw_q = RX(0.03 + max(0.0, wave(cycle, 1)) * 0.04)
            ear_l_q = RZ(arm_r * 0.5 + wave(cycle, 1, 0.6) * 0.07)
            ear_r_q = RZ(arm_r * 0.5 - wave(cycle, 1, 0.8) * 0.07)
            arm_ru = RX(0.14 + tor_p * 0.5 + wave(cycle, 1, 0.4) * 0.10) @ RZ(0.06 + tor_r * 0.6)
            arm_rl = RX(-0.16 + wave(cycle, 1, 0.8) * 0.14)

        return {
            "arm_l": RX(arm_p) @ RZ(arm_r),
            "torso": RX(tor_p) @ RZ(tor_r),
            "head": head_q,
            "jaw": jaw_q,
            "ear_l": ear_l_q,
            "ear_r": ear_r_q,
            "arm_r_upper": arm_ru,
            "arm_r_lower": arm_rl,
            "leg_l_upper": RX(leg_lp),
            "leg_l_lower": RX(knee_l),
            "leg_r_upper": RX(leg_rp),
            "leg_r_lower": RX(knee_r),
            "tail_base": RX(tail0_p) @ RY(tail0_y),
            "tail_tip": RY(tail1_y) @ RX(tail0_p * 0.35),
        }

    return pose_at


LION_CLIPS = [
    ("hang", 48, simulate_hang_clip(48, airspeed_drag=0.22, gust_amp=1.35)),
    ("boost", 30, simulate_hang_clip(30, airspeed_drag=0.92, gust_amp=2.20, boost=True)),
    ("roar", 48, simulate_hang_clip(48, airspeed_drag=0.18, gust_amp=1.55, roar=True)),
    ("fire", 24, simulate_hang_clip(24, airspeed_drag=0.35, gust_amp=1.40, fire=True)),
]


def add_blink_shape_key(lids_obj):
    shut = [v.co.copy() for v in lids_obj.data.vertices]
    brow_z = max(v.co.z for v in lids_obj.data.vertices)
    for v in lids_obj.data.vertices:
        v.co.z = brow_z - (brow_z - v.co.z) * 0.08
        v.co.y += 0.02
    lids_obj.shape_key_add(name="Basis")
    key = lids_obj.shape_key_add(name="blink")
    for idx, co in enumerate(shut):
        key.data[idx].co = co
    key.value = 0.0


def build_lion_rig():
    clear_scene()
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

    body_parts = []

    # 1. Left gripping arm (ROOT bone locked onto the Bell 206 left skid!)
    rigging.carry(arm_l=1.0)
    left_grip_w = loc(*HINGE_GRIP_L)
    bm = bmesh.new()
    add_capsule(bm, hanging_pt(-0.58, 2.95, 0.28), left_grip_w, 0.21, segs=10)
    add_sphere(bm, left_grip_w, 0.27, 0.25, 0.25, segs=12, rings=8)
    make_piece("ArmL", bm, mat_gold, body_parts)
    bm = bmesh.new()
    for finger in range(3):
        add_sphere(bm, loc(0.31 + (finger - 1) * 0.10, 4.88, 0.52), 0.065, 0.10, 0.09, segs=8, rings=5)
    make_piece("ArmLFingers", bm, mat_cream, body_parts)

    # Smooth shared shoulder joint ball (50/50 arm_l + torso)
    rigging.carry(arm_l=0.5, torso=0.5)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(-0.58, 2.95, 0.28), 0.23, 0.23, 0.23, segs=10, rings=6)
    make_piece("ShoulderLJoint", bm, mat_gold, body_parts)

    # 2. Sculpted athletic torso (broad chest, tapered waist, natural hips)
    rigging.carry(torso=1.0)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 2.74, 0.22), 0.74, 0.64, 0.60, segs=18, rings=10)
    add_sphere(bm, hanging_pt(0, 2.26, 0.16), 0.56, 0.54, 0.50, segs=16, rings=8)
    make_piece("Torso", bm, mat_gold, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 2.64, 0.60), 0.44, 0.52, 0.24, segs=12, rings=8)
    make_piece("Chest", bm, mat_cream, body_parts)

    # 3. Right two-bone articulated arm
    rigging.carry(arm_r_upper=1.0)
    bm = bmesh.new()
    add_capsule(bm, hanging_pt(0.58, 2.95, 0.28), hanging_pt(0.80, 3.16, 0.68), 0.20, segs=10)
    make_piece("ArmRUpper", bm, mat_gold, body_parts)
    rigging.carry(arm_r_upper=0.5, arm_r_lower=0.5)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0.80, 3.16, 0.68), 0.20, 0.20, 0.20, segs=10, rings=6)
    make_piece("ArmRElbow", bm, mat_gold, body_parts)
    rigging.carry(arm_r_lower=1.0)
    bm = bmesh.new()
    add_capsule(bm, hanging_pt(0.80, 3.16, 0.68), hanging_pt(0.96, 3.48, 0.98), 0.19, segs=10)
    add_sphere(bm, hanging_pt(0.96, 3.48, 0.98), 0.26, 0.25, 0.24, segs=12, rings=8)
    make_piece("ArmRLower", bm, mat_gold, body_parts)

    # 4. Two-bone physics-driven legs (thigh + knee joint + calf + paw!)
    for side, up_b, lo_b, hip_m, knee_m in (
        (-1, "leg_l_upper", "leg_l_lower", HINGE_HIP_L, HINGE_KNEE_L),
        (1, "leg_r_upper", "leg_r_lower", HINGE_HIP_R, HINGE_KNEE_R),
    ):
        hip = loc(*hip_m)
        knee = loc(*knee_m)
        ankle = hanging_pt(side * 0.44, 1.02, 0.16 + side * 0.06)
        paw = hanging_pt(side * 0.45, 0.92, 0.38 + side * 0.06)
        rigging.carry(**{up_b: 1.0})
        bm = bmesh.new()
        add_capsule(bm, hip, knee, 0.22, segs=10)
        make_piece(f"Thigh_{up_b}", bm, mat_gold, body_parts)
        rigging.carry(**{up_b: 0.5, lo_b: 0.5})
        bm = bmesh.new()
        add_sphere(bm, knee, 0.20, 0.20, 0.20, segs=10, rings=6)
        make_piece(f"Knee_{up_b}", bm, mat_gold, body_parts)
        rigging.carry(**{lo_b: 1.0})
        bm = bmesh.new()
        add_capsule(bm, knee, ankle, 0.18, segs=10)
        add_sphere(bm, paw, 0.27, 0.21, 0.36, segs=12, rings=8)
        make_piece(f"Calf_{lo_b}", bm, mat_gold, body_parts)

    # 5. Two-bone tufted lion tail
    t0, t1, t2 = hanging_pt(0.0, 2.10, -0.32), hanging_pt(-0.18, 1.80, -0.95), hanging_pt(-0.30, 1.68, -1.55)
    rigging.carry(tail_base=1.0)
    bm = bmesh.new()
    add_capsule(bm, t0, t1, 0.095, segs=8)
    make_piece("TailBase", bm, mat_gold, body_parts)
    rigging.carry(tail_tip=1.0)
    bm = bmesh.new()
    add_capsule(bm, t1, t2, 0.085, segs=8)
    make_piece("TailTip", bm, mat_gold, body_parts)
    bm = bmesh.new()
    add_sphere(bm, t2 + Vector((0, 0.20, -0.04)), 0.20, 0.22, 0.30, segs=12, rings=8)
    make_piece("TailTuft", bm, mat_mane, body_parts)

    # 6. Head, inner mane collar, face, kippah
    rigging.carry(head=1.0)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.05, 0.65), 0.80, 0.80, 0.68, segs=20, rings=12)
    make_piece("HeadGold", bm, mat_gold, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.02, 0.34), 1.00, 1.02, 0.70, segs=20, rings=12)
    for side in (-1, 1):
        add_box(bm, hanging_pt(side * 0.32, 4.48, 1.20), 0.36, 0.075, 0.08)
    make_piece("HeadMane", bm, mat_mane, body_parts)
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.24, 3.88, 1.27), 0.29, 0.23, 0.23, segs=12, rings=8)
    make_piece("HeadMuzzle", bm, mat_cream, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.02, 1.45), 0.17, 0.12, 0.12, segs=12, rings=8)
    make_piece("HeadNose", bm, mat_nose, body_parts)
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.30, 4.24, 1.22), 0.16, 0.19, 0.07, segs=10, rings=6)
    make_piece("HeadEyeW", bm, mat_eye_w, body_parts)
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.30, 4.25, 1.28), 0.075, 0.11, 0.04, segs=10, rings=6)
    make_piece("HeadPupil", bm, mat_eye_p, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 4.92, 0.58), 0.41, 0.14, 0.35, segs=16, rings=8)
    make_piece("HeadKippah", bm, mat_kippah, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 5.04, 0.58), 0.055, 0.025, 0.055, segs=8, rings=4)
    make_piece("HeadKippahBtn", bm, mat_kippah_btn, body_parts)

    # 7. Articulated ears
    for side, bone in ((-1, "ear_l"), (1, "ear_r")):
        rigging.carry(**{bone: 1.0})
        bm = bmesh.new()
        add_sphere(bm, hanging_pt(side * 0.66, 4.74, 0.48), 0.27, 0.28, 0.18, segs=12, rings=8)
        make_piece(f"Ear_{bone}", bm, mat_gold, body_parts)
        bm = bmesh.new()
        add_sphere(bm, hanging_pt(side * 0.66, 4.74, 0.62), 0.15, 0.16, 0.06, segs=10, rings=6)
        make_piece(f"EarIn_{bone}", bm, mat_ear, body_parts)

    # 8. Articulated lower jaw & fangs
    rigging.carry(jaw=1.0)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 3.60, 1.15), 0.32, 0.14, 0.20, segs=12, rings=6)
    make_piece("JawMouth", bm, mat_mouth, body_parts)
    bm = bmesh.new()
    add_sphere(bm, hanging_pt(0, 3.50, 1.18), 0.28, 0.13, 0.18, segs=10, rings=6)
    for side in (-1, 1):
        add_tube(bm, hanging_pt(side * 0.14, 3.66, 1.24), hanging_pt(side * 0.14, 3.55, 1.26), 0.038, 0.008, segs=6)
    make_piece("JawChinFangs", bm, mat_cream, body_parts)

    # 9. Separate eyelids mesh with `blink` shape key
    rigging.carry(head=1.0)
    lids_parts = []
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, hanging_pt(side * 0.30, 4.25, 1.25), 0.175, 0.205, 0.09, segs=12, rings=6)
    lids = make_piece("Lion_Eyelids", bm, mat_gold, lids_parts)
    bpy.context.view_layer.objects.active = lids
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    add_blink_shape_key(lids)

    body = rigging.join(body_parts, "Lion_Body")
    bones = lion_bones()
    rig = rigging.build_armature("LionRig", bones)
    rigging.skin(rig, body, lids)
    rigging.author_clips(rig, bones, LION_CLIPS)
    rigging.export_rig(os.path.join(OUT_DIR, "ryeah_lion.glb"), LION_CLIPS)
    return rig


if __name__ == "__main__":
    build_lion_rig()
