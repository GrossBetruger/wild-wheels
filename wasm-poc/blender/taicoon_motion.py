"""Tai-Coon's seated poses in model space, including the pickup's singing bowl."""
import math
from mathutils import Quaternion, Vector
from rigging import RX, RY, RZ, wave

HAT = Vector((.04, 4.18, .06))
PETAL = (-.38, 4.56, .49)
TAIL = ('tail', 'tail_1', 'tail_2', 'tail_mid', 'tail_4', 'tail_5', 'tail_6', 'tail_tip')


def rest_point(t):
    angle = math.pi*1.48*t
    return Vector((-.52*math.sin(angle), 1.86+.16*math.sin(math.pi*t),
                   -.65-.73*(1-math.cos(angle))))


def bones():
    result = [('hat','head',HAT), ('feather','hat',(.52,4.42,.10)), ('petal','seat',PETAL)]
    for i,name in enumerate(TAIL):
        parent = TAIL[i-1] if i else 'spine'
        result.append((name,parent,rest_point(i/7)))
    return result


def ramp(t, start, end):
    x = max(0.,min(1.,(t-start)/(end-start)))
    return x*x*(3-2*x)


def pose(mode, t):
    breath = wave(t)
    turn = {'turn_l':-1,'turn_r':1}.get(mode,0)
    bank = turn*.24
    motion = {
        'spine': (RZ(bank) @ RX(.055*breath),(0,.065*breath,0)),
        'head': RZ(-bank) @ RX(-.045*breath),
        'feather': RZ(.14*wave(t,lag=.8)-turn*.21),
        'ear_l': RX(.07*breath), 'ear_r': RX(.07*wave(t,lag=.3)),
        'petal': (Quaternion(),(0,0,0),.001),
    }
    reach = wiggle = 0.
    hat_shift = Vector((0,0,0))
    if mode == 'boost':
        # Tip meets the rear brim at the bottom of its arc, then carries it home.
        hang = ramp(t,0,.25)-ramp(t,.45,.82)
        dip = ramp(t,.25,.45)-ramp(t,.45,.82)
        hat_shift = Vector((.12*hang,.33*hang-.76*dip,-1.18*hang))
        reach = ramp(t,.12,.45)-ramp(t,.82,1)
        motion['hat'] = (RX(-.25*hang),hat_shift)
        motion['head'] = RX(-.10*hang)
        motion['feather'] = RX(.47*hang) @ RZ(.18*wave(t,2))
        # The loose petal crosses the rear camera's sightline, then leaves the truck.
        flight = ramp(t,.16,.93)
        size = ramp(t,.15,.22)-ramp(t,.88,.98)
        motion['petal'] = (RZ(8*flight) @ RX(5*flight),
                           (.9*math.sin(flight*math.pi),1.3*math.sin(flight*math.pi),-11*flight),
                           max(.001,size))
    if mode == 'bow':
        glance = ramp(t,0,.19)-ramp(t,.22,.44)
        bow = ramp(t,.26,.48)-ramp(t,.50,.69)
        wiggle = (ramp(t,.62,.72)-ramp(t,.90,1))*wave(t,5)
        motion['spine'] = RX(.48*bow) @ RY(.52*glance)
        motion['head'] = RY(1.56*glance) @ RX(.39*bow)
        for side,suffix in [(-1,'_l'),(1,'_r')]:
            motion['arm'+suffix] = RX(-.44*bow) @ RZ(side*.24*bow)
        motion['feather'] = RX(.34*(ramp(t,.33,.54)-ramp(t,.59,.79)))
    if mode == 'special':
        motion['head'] = RY(.15*breath)
        motion['arm_r'] = RZ(.48+.16*breath)
    # Each puff follows the preceding ring. Solve the offsets in its parent's
    # coordinates so the tip can touch the moving brim at the authored frame.
    root = rest_point(0)
    brim = HAT+hat_shift+Vector((.15,-.04,-.76))
    previous_turn, previous_point, previous_rest = Quaternion(), root, root
    for i,name in enumerate(TAIL):
        u = i/7
        rest = rest_point(u)
        point = rest+Vector((u*(.15*breath+.59*wiggle),u*.10*breath,-u*.12*breath))
        lifted = root.lerp(brim,u)+Vector((.39*math.sin(math.pi*u),0,-.52*math.sin(math.pi*u)))
        point = point.lerp(lifted,reach)
        rotation = RY(u*(.32*breath+.85*wiggle))
        local_offset = previous_turn.inverted() @ (point-previous_point) - (rest-previous_rest)
        motion[name] = (previous_turn.inverted() @ rotation,local_offset)
        previous_turn, previous_point, previous_rest = rotation,point,rest
    return motion
