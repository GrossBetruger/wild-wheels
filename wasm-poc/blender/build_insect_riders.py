"""Build the three insect armatures from the browser's own sculpting primitives."""
import json
import math
from pathlib import Path
import subprocess
import sys
import bpy

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
from specialist_rigs import bind_piece, finish
from rigging import join

parts = json.loads(subprocess.check_output(['node', str(HERE/'rider-parts.mjs')]))
out = HERE.parent/'assets/models'


def bone_for(rider, x, y, z, wings):
    side = '_l' if x < 0 else '_r'
    if wings:
        return 'wing'+side
    if (rider == 'tammy' and y >= 4.1 or
            rider == 'catheterpillar' and y >= 4.12 and abs(x) >= .29 or
            rider == 'fourmidable' and y >= 3.72 and z < .4):
        return 'feeler'+side
    if y >= {'tammy':3, 'catheterpillar':3.08, 'fourmidable':2.75}[rider]:
        return 'head'
    if rider == 'tammy' and abs(x) > .9 and z < 0:
        return ('shin' if y < 1.5 else 'thigh')+side
    if rider == 'fourmidable' and abs(x) > .18:
        return ('leg' if z < -.65 else 'middle' if y < 2.25 and z < .1 or abs(x) > .74 else 'arm')+side
    if abs(x) >= (.44 if rider == 'catheterpillar' else .7):
        return 'arm'+side
    return 'spine'


def model_point(point, origin):
    x,y,z = point
    dx,dy,dz,angle = origin
    c,s = math.cos(angle),math.sin(angle)
    return (dx+x*c+z*s, -(dz-x*s+z*c), dy+y)


def build(rider):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = {}
    objects = []
    def add(part, wings=False):
        shape,args,origin = part['shape'],part['args'],part['origin']
        if shape == 'tri':
            verts = [model_point(p, origin) for p in args[:3]]
            data = bpy.data.meshes.new('Marking')
            data.from_pydata(verts, [], [(0,1,2)])
            obj = bpy.data.objects.new('Marking', data)
            bpy.context.collection.objects.link(obj)
            x,y,z = args[0]
            color = args[3]
        else:
            x,y,z,w,h,d,color,*resolution = args
            # Ant spectacle rims are continuous brass hoops. Skip overlapping beads
            # and build each rim once below.
            if rider == 'fourmidable' and shape == 'ball' and color == '#bfa365':
                return
            location = model_point((x, y+h/2 if shape=='box' else y, z),origin)
            if shape == 'box':
                bpy.ops.mesh.primitive_cube_add(size=1,location=location)
                scale=(w,d,h)
            else:
                seg,rings = (resolution or [10,6])
                bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=location)
                scale=(w,d,h)
            obj=bpy.context.object
            obj.scale=scale
            obj.rotation_euler.z=origin[3]
        if color not in materials:
            mat=bpy.data.materials.new(color)
            channels=[int(color[i:i+2],16)/255 for i in (1,3,5)]
            mat.diffuse_color=tuple(((c+.055)/1.055)**2.4 if c>.04045 else c/12.92 for c in channels)+(1,)
            mat.use_nodes=True
            shader=mat.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value=mat.diffuse_color
            shader.inputs['Roughness'].default_value=.45
            materials[color]=mat
        obj.data.materials.append(materials[color])
        bind_piece(obj,bone_for(rider,x,y,z,wings))
        objects.append(obj)
    for item in parts[rider]:
        add(item)
    if rider=='catheterpillar':
        for item in parts['wings']:
            add(item, wings=True)
    if rider=='fourmidable':
        for x in (-.34,.34):
            bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=6,major_radius=.34,minor_radius=.025,
                                            location=(x,-.78,3.25), rotation=(math.pi/2,0,0))
            rim=bpy.context.object
            rim.scale.y=.39/.34
            rim.data.materials.append(materials['#bfa365'])
            bind_piece(rim,'head')
            objects.append(rim)
    mesh=join(objects,rider.title()+'Rider')
    return finish(rider,[mesh],out/(rider+'.glb'))


if __name__ == '__main__':
    for rider in ('tammy','catheterpillar','fourmidable'):
        build(rider)
