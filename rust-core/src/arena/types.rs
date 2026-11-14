use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all="camelCase")]
pub struct Point { pub wx:f64, pub wz:f64 }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all="camelCase")]
pub struct Sample { pub wx:f64,pub wz:f64,pub height:f64 }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all="camelCase")]
pub struct Actor {
    pub intelligence_bonus:u32,pub bicycles_stolen:u32,pub owl_boosting:bool,
    pub ring_blue:bool,pub ring_turn_grace:f64,pub ring_turn:f64,pub ring_heading:Option<f64>,pub ring_remaining:f64,pub ring_spent:bool,#[serde(skip)]pub ring_doses:BTreeMap<usize,f64>,
    pub bat_cooldown:f64,pub special_cooldown:f64,pub special_active:f64,
    pub id:usize,pub driver:usize,pub name:Option<String>,pub color:String,
    pub joined_after_kill:u32,
    pub wx:f64,pub wz:f64,pub heading:f64,pub motion_heading:f64,pub camera_heading:f64,
    pub speed:f64,pub health:f64,pub kills:f64,pub deaths:u32,pub kill_streak:u32,
    pub destroyed:f64,pub shield:f64,pub hedge_shield:f64,pub tehilim:f64,pub celebrate:f64,pub fire_cooldown:f64,
    pub heal_timer:f64,pub reload:f64,pub brain:f64,pub skill:f64,pub path:Vec<Point>,
    pub human:bool,pub bomber:bool,pub inactive:bool,pub afk:bool,
    pub bomb_ammo:u32,pub stink_ammo:u32,pub bomb_reload:f64,
    pub ammo:u32,pub missiles:u32,pub turbos:u32,pub item:String,
    pub chaff:u32,pub chaff_cooldown:f64,pub vulcan:f64,pub boost:f64,
    pub dizzy:f64,pub somersault:f64,pub somersault_cooldown:f64,pub somersault_camera_start:f64,
    pub yaw:f64,pub spin:f64,pub stun:f64,pub voice_cooldown:f64,pub wall_cooldown:f64,
    pub drift:f64,pub was_drifting:bool,pub drift_emit:f64,pub drift_trail:Option<Vec<Point>>,
    pub notice:String,pub notice_time:f64,
    #[serde(skip)] pub credits:BTreeMap<usize,f64>,
    #[serde(skip)] pub prediction_crash:bool,
    #[serde(flatten)] pub extra:BTreeMap<String,Value>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Shot {
    #[serde(default,skip_serializing_if="std::ops::Not::not")]pub quenched:bool,
    pub id:u32,pub owner:usize,pub kind:String,pub wx:f64,pub wz:f64,pub heading:f64,
    pub speed:f64,pub height:f64,pub vy:f64,pub life:f64,pub age:f64,pub bounces:u32,
    pub trail:Vec<Sample>,pub target:Option<usize>,pub vulcan:bool,pub action_id:Option<u32>,
    pub decoy:Option<u32>,pub decoy_owner:Option<usize>,pub decoy_center:Option<Point>,
    #[serde(skip_serializing_if="Option::is_none")]pub orbit_age:Option<f64>,pub orbit_angle:f64,pub orbit_radius:f64,pub orbit_height:f64,pub chaffed:bool,pub reflected:bool,
    #[serde(skip_serializing_if="Option::is_none")]pub repelled_from:Option<usize>,pub orbit_direction:f64,#[serde(skip_serializing_if="Option::is_none")]pub orbit_center:Option<Point>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Bomb { pub id:u32,pub owner:usize,pub kind:String,pub wx:f64,pub wz:f64,pub age:f64,pub color:String,pub action_id:Option<u32> }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Chaff {
    pub id:u32,pub owner:usize,pub wx:f64,pub wz:f64,pub origin_x:f64,pub origin_z:f64,
    pub color:String,pub age:f64,pub life:f64,pub diversions:u32,pub diverted_at:Option<f64>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Stink { pub id:u32,pub owner:usize,pub wx:f64,pub wz:f64,pub age:f64,pub life:f64,pub hits:Vec<usize> }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Supply { pub age:f64,pub heading:f64,pub owner:Option<usize>,pub drop_wx:f64,pub drop_wz:f64,pub drop_height:f64, pub id:u32,pub wx:f64,pub wz:f64,pub kind:String,pub cooldown:f64,pub version:u32,pub collector:Option<usize>,#[serde(skip_serializing_if="Option::is_none")]pub home_wx:Option<f64>,#[serde(skip_serializing_if="Option::is_none")]pub home_wz:Option<f64> }
impl Supply{pub fn restore_home(&mut self){if let Some(x)=self.home_wx.take(){self.wx=x;}if let Some(z)=self.home_wz.take(){self.wz=z;}}}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Effect { #[serde(skip_serializing_if="Option::is_none")]pub radius:Option<f64>, #[serde(skip_serializing_if="Option::is_none")]pub heading:Option<f64>,#[serde(rename="type")] pub kind:String,pub wx:f64,pub wz:f64,pub age:f64,pub life:f64,pub color:Option<String>,#[serde(skip_serializing_if="Option::is_none")]pub owner:Option<usize>,#[serde(skip_serializing_if="BTreeMap::is_empty")]pub doses:BTreeMap<String,f64> }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Skid { pub owner:usize,pub ax:f64,pub az:f64,pub bx:f64,pub bz:f64,pub time:f64 }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Particle { pub owner:usize,pub wx:f64,pub wz:f64,pub height:f64,pub vx:f64,pub vz:f64,pub vy:f64,pub age:f64,pub life:f64,pub kind:String,pub level:u32 }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Kill { pub id:u32,pub attacker:usize,pub victim:usize,pub attacker_name:String,pub victim_name:String,pub victim_color:String,pub kind:String,pub text:String,pub time:f64,pub assist:bool,pub radiation:bool }
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Globals {
    pub locusts:Vec<Locust>,pub locust_sequence:u32,
    pub bicycle_sequence:u32,
    #[serde(default="abilities_default")]pub special_abilities:bool,
    pub time_stop:f64,pub time_owner:Option<usize>,
    pub mode:String,pub phase:String,pub arena:usize,pub elapsed:f64,pub countdown:f64,pub duration:f64,pub target_score:f64,
    pub rank:usize,pub finish_rank:Option<usize>,pub finish_time:Option<f64>,pub finish_countdown:Option<f64>,pub winner:Value,
    pub multiplayer:bool,pub host:Option<usize>,pub sound_epoch:u64,pub sound_sequence:u64,pub shake:f64,
    pub projectile_sequence:u32,pub bomb_sequence:u32,pub chaff_sequence:u32,pub kill_sequence:u32,
    pub projectiles:Vec<Shot>,pub bombs:Vec<Bomb>,pub chaff_clouds:Vec<Chaff>,pub stink_clouds:Vec<Stink>,pub supplies:Vec<Supply>,
    pub effects:Vec<Effect>,pub skids:Vec<Skid>,pub drift_particles:Vec<Particle>,pub kill_feed:Vec<Kill>,pub events:Vec<Value>,pub voices:Vec<Value>,
}
pub fn abilities_default()->bool{true}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default,rename_all="camelCase")]
pub struct Locust {pub id:u32,pub owner:usize,pub wx:f64,pub wz:f64,pub heading:f64,pub age:f64,pub jump:f64,#[serde(skip)]pub brain:f64,#[serde(skip)]pub path:Vec<Point>}
#[derive(Deserialize)]
pub struct Seed { #[serde(flatten)]pub global:Globals,#[serde(flatten)]pub player:Actor,pub bots:Vec<Actor> }
#[derive(Clone, Default, Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct Move { pub sequence:i64,pub keys:u32,pub steer:Option<f64> }
#[derive(Clone, Default, Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct Action { #[serde(rename="type")]pub kind:String,pub id:Option<u32>,#[serde(default="before_first_move")]pub after_move:i64,pub wx:f64,pub wz:f64,pub item:String,#[serde(rename="kind")]pub bomb_kind:Option<String> }
fn before_first_move()->i64 { -1 }
#[derive(Default, Deserialize)]
#[serde(default,rename_all="camelCase")]
pub struct Input { pub actor:usize,pub keys:u32,pub steer:Option<f64>,pub moves:Option<Vec<Move>>,pub actions:Vec<Action>,pub action_clock:bool,pub sequence:Option<i64> }
#[derive(Deserialize)]
pub struct Frame { pub dt:f64,pub inputs:Vec<Input> }
#[derive(Serialize)]
pub struct View<'a> { #[serde(flatten)]pub global:&'a Globals,#[serde(flatten)]pub player:&'a Actor,pub bots:Vec<&'a Actor> }
#[derive(Clone)]
pub struct Game { pub global:Globals,pub actors:Vec<Actor>,pub input_ack:[i64;super::MAX_PLAYERS],pub movement_ack:[i64;super::MAX_PLAYERS],pub action_ack:[i64;super::MAX_PLAYERS],pub accepted_action:[i64;super::MAX_PLAYERS],pub pending:Vec<Vec<Action>>,pub network_time:f64,pub room:BTreeMap<String,Value> }
