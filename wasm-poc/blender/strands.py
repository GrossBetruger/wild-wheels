"""
Offline physics for manes, hair, tufts and ribbons, baked into shape keys.

Each lock is a chain of points with its root pinned. `Simulation` steps the
chains under gravity, wind with travelling gusts, a spring toward each lock's
groomed rest shape, and collisions with spheres standing in for the body.
`loop` runs a wind whose gusts repeat exactly over a clip, lets the locks
settle into that rhythm, then records one pass; `settle` records where they
come to rest under a steady push. `skin_locks` turns the locks into one mesh of
tapered tubes, and `bake` stores every recorded pose as a shape key on it.

The game plays the result by fading each key into the next: two weights at a
time, nothing to simulate at run time. All points are in the racer's model
space (x across, y up, z forward).
"""
import math
import bpy
from mathutils import Vector

# Steps a second, and passes over the length and collision limits per step.
RATE, PASSES = 120, 4


class Lock:
    """One lock: where it is rooted, its groomed rest shape, and its girth."""

    def __init__(self, root, direction, length, girth, points=6, look=0):
        self.root = Vector(root)
        self.reach = length / (points - 1)
        aim = Vector(direction).normalized()
        self.rest = [self.root + aim * self.reach * i for i in range(points)]
        self.girth = girth
        self.look = look


class Simulation:
    """Locks swinging in a wind. `flow` is the steady air speed past the head;
    `gust` how hard it flutters; `spring` how firmly locks hold their groomed
    shape (strongest at the root); `push` a steady sideways shove, as in a turn;
    `down` the way things fall, for a body that is not upright while it plays."""

    def __init__(self, locks, flow, gust, period, spring=22.0, drag=3.2, weight=7.0, balls=(), push=(0, 0, 0),
                 down=(0, -1, 0)):
        self.locks, self.flow, self.gust, self.period = locks, Vector(flow), gust, period
        self.spring, self.drag, self.push = spring, drag, Vector(push)
        self.weight = Vector(down).normalized() * weight
        self.balls = [(Vector(centre), radius) for centre, radius in balls]
        self.now = [[point.copy() for point in lock.rest] for lock in locks]
        self.before = [[point.copy() for point in lock.rest] for lock in locks]
        self.time = 0.0

    def wind(self, point):
        """The air at a point: the steady flow plus gusts that travel down
        the flow and repeat exactly once per `period`."""
        beat = math.tau * self.time / self.period
        along = point.dot(self.flow.normalized()) if self.flow.length > 1e-6 else point.z
        gust = Vector((
            math.sin(2 * beat - along * 2.6 + point.y * 1.3) + 0.5 * math.sin(3 * beat - along * 4.1 + point.x * 2.0),
            math.sin(beat - along * 2.1 + point.x * 1.7 + 0.8) + 0.5 * math.cos(4 * beat - along * 3.3),
            0.6 * math.sin(2 * beat - along * 1.5 + point.x + point.y),
        ))
        return self.flow + gust * self.gust

    def step(self):
        dt = 1.0 / RATE
        for lock, now, before in zip(self.locks, self.now, self.before):
            last = len(now) - 1
            for i in range(1, last + 1):
                point, along = now[i], i / last
                speed = (point - before[i]) / dt
                # Air drags the lock toward the wind; the tip is lighter and follows it more.
                pull = (self.wind(point) - speed) * self.drag * (0.6 + 0.8 * along)
                hold = (lock.rest[i] - point) * self.spring * (1 - along) ** 2
                force = pull + hold + self.push + self.weight
                before[i], now[i] = point.copy(), point + (point - before[i]) * 0.985 + force * dt * dt
            for _ in range(PASSES):
                for i in range(1, last + 1):
                    span = now[i] - now[i - 1]
                    now[i] = now[i - 1] + span.normalized() * lock.reach
                    for centre, radius in self.balls:
                        out = now[i] - centre
                        if out.length < radius:
                            now[i] = centre + out.normalized() * radius
        self.time += 1.0 / RATE

    def pose(self):
        return [[point.copy() for point in lock] for lock in self.now]

    def loop(self, frames, rate, warm_up=3):
        """`frames` poses, `rate` a second, of one pass through the gusts once
        the locks have fallen into their rhythm. The pass loops seamlessly."""
        assert abs(frames / rate - self.period) < 1e-6, "the clip must last one period of the gusts"
        per_frame = round(RATE / rate)
        for _ in range(warm_up * frames * per_frame):
            self.step()
        poses = []
        for _ in range(frames + 1):
            poses.append(self.pose())
            for _ in range(per_frame):
                self.step()
        # The last pose should equal the first; ease out what little it missed by.
        drift, blend = [[b - a for a, b in zip(first, final)] for first, final in zip(poses[0], poses[-1])], frames // 3
        for step in range(blend):
            amount = (step + 1) / blend
            pose = poses[frames - blend + step]
            for lock, missed in zip(pose, drift):
                for i, miss in enumerate(missed):
                    lock[i] -= miss * amount * amount * (3 - 2 * amount)
        return poses[:frames]

    def settle(self, seconds=2.5):
        """The pose the locks come to rest in."""
        for _ in range(round(seconds * RATE)):
            self.step()
        return self.pose()


def rings(lock, points, sides):
    """A lock's skin for one pose: a ring of `sides` vertices around each point,
    tapering to a tip, with no twist between rings from pose to pose."""
    aim = (points[1] - points[0]).normalized()
    across = aim.cross(Vector((0, 1, 0)))
    across = across.normalized() if across.length > 1e-4 else Vector((1, 0, 0))
    vertices = []
    for i, point in enumerate(points[:-1]):
        ahead = (points[i + 1] - point).normalized()
        # Carry the ring's orientation along the lock instead of re-deriving it,
        # so a bend does not spin the skin.
        across = (across - ahead * across.dot(ahead)).normalized()
        up = ahead.cross(across)
        girth = lock.girth * (1 - 0.82 * i / (len(points) - 1)) * (1.12 if i == 1 else 1.0)
        for side in range(sides):
            angle = math.tau * side / sides
            vertices.append(point + (across * math.cos(angle) + up * math.sin(angle)) * girth)
    vertices.append(points[-1].copy())
    return vertices


def to_blender(point):
    return Vector((point.x, -point.z, point.y))


def skin_locks(name, locks, materials, sides=6):
    """One mesh of every lock in its rest shape. `materials[lock.look]` colours
    a lock; the last material is the highlight along each lock's upper face."""
    mesh = bpy.data.meshes.new(name)
    vertices, faces, looks = [], [], []
    for lock in locks:
        start, count = len(vertices), len(lock.rest) - 1
        vertices += [to_blender(v) for v in rings(lock, lock.rest, sides)]
        tip = start + count * sides
        for ring in range(count):
            for side in range(sides):
                a, b = start + ring * sides + side, start + ring * sides + (side + 1) % sides
                faces.append((a, b, b + sides, a + sides) if ring < count - 1 else (a, b, tip))
                looks.append(len(materials) - 1 if side == 1 and ring < count - 2 else lock.look % (len(materials) - 1))
    mesh.from_pydata(vertices, [], faces)
    for material in materials:
        mesh.materials.append(material)
    for polygon, look in zip(mesh.polygons, looks):
        polygon.material_index, polygon.use_smooth = look, True
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def bake(obj, locks, poses, prefix, sides=6):
    """Store each pose as a shape key named `prefix` and its number."""
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    for number, pose in enumerate(poses):
        key = obj.shape_key_add(name=f"{prefix}{number:02d}")
        index = 0
        for lock, points in zip(locks, pose):
            for vertex in rings(lock, points, sides):
                key.data[index].co = to_blender(vertex)
                index += 1
        key.value = 0.0
