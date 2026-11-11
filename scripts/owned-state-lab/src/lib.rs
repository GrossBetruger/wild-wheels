use serde_json::{json, Value};
const MAX: usize = 512 * 1024;
static mut INPUT: [u8; MAX] = [0; MAX];
static mut LAB: Option<Lab> = None;
struct Lab {
    meta: Value,
    layout: Value,
    skids: Vec<[f64; 6]>,
    particles: Vec<[f64; 11]>,
    trails: Vec<Vec<[f64; 3]>>,
    output: Vec<u8>,
}
fn number(v: &Value, key: &str) -> Result<f64, ()> {
    v[key].as_f64().filter(|n| n.is_finite()).ok_or(())
}
fn array(v: &Value) -> Result<&Vec<Value>, ()> {
    let a = v.as_array().ok_or(())?;
    if a.len() > 512 { return Err(()); }
    Ok(a)
}
fn bump(v: &mut Value, key: &str, delta: f64) {
    let Some(n) = v[key].as_f64() else { return; };
    v[key] = Value::from(n + delta);
}
impl Lab {
    fn new(mut meta: Value) -> Result<Self, ()> {
        if meta["type"] != "state" { return Err(()); }
        meta["wireVersion"] = json!(3);
        let world = &mut meta["world"];
        let skids = array(&world["skids"] )?.iter().map(|s| Ok([
            number(s,"ax")?,number(s,"az")?,number(s,"bx")?,number(s,"bz")?,number(s,"time")?,s["owner"].as_f64().unwrap_or(-1.0)
        ])).collect::<Result<Vec<_>, ()>>()?;
        let particles = array(&world["driftParticles"])?.iter().map(|p| Ok([
            number(p,"wx")?,number(p,"wz")?,number(p,"height")?,number(p,"vx")?,number(p,"vz")?,number(p,"vy")?,number(p,"age")?,number(p,"life")?,
            match p["kind"].as_str() { Some("spark") => 1.0, _ => 0.0 },number(p,"level")?,p["owner"].as_f64().unwrap_or(-1.0)
        ])).collect::<Result<Vec<_>, ()>>()?;
        let mut trails = Vec::new();
        for shot in array(&world["projectiles"])? {
            let points = array(&shot["trail"])?;
            if points.len() > 24 { return Err(()); }
            trails.push(points.iter().map(|p| Ok([number(p,"wx")?,number(p,"wz")?,number(p,"height")?])).collect::<Result<Vec<_>, ()>>()?);
        }
        world["skids"] = json!([]);world["driftParticles"] = json!([]);
        for shot in world["projectiles"].as_array_mut().ok_or(())? { shot["trail"] = json!([]); }
        let layout = json!({"skids":skids.len(),"particles":particles.len(),"trails":trails.iter().map(Vec::len).collect::<Vec<_>>()});
        Ok(Self { meta, layout, skids, particles, trails, output: Vec::with_capacity(MAX) })
    }
    fn advance(&mut self, dt: f64, dx: f64, dz: f64, turn: f64) {
        bump(&mut self.meta,"time",dt);
        let world = &mut self.meta["world"];
        bump(world,"elapsed",dt);bump(world,"wx",dx);bump(world,"wz",dz);bump(world,"heading",turn);
        for key in ["bots","projectiles"] {
            if let Some(actors) = world[key].as_array_mut() {
                for actor in actors { bump(actor,"wx",dx);bump(actor,"wz",dz);bump(actor,"heading",turn); }
            }
        }
        for skid in &mut self.skids { skid[4] += dt; }
        for p in &mut self.particles {
            p[0] += p[3]*dt;p[1] += p[4]*dt;p[2] += p[5]*dt;p[6] += dt;
            if p[6] >= p[7] { p[6] = 0.0; }
        }
        for trail in &mut self.trails { for p in trail { p[0] += dx;p[1] += dz; } }
    }
    fn pack(out: &mut Vec<u8>, value: f64, scale: f64) -> Result<(), ()> {
        let scaled = value * scale;let floor = scaled.floor();
        let rounded = match scaled-floor < 0.5 { true => floor, false => floor+1.0 };
        if !rounded.is_finite() || rounded < i32::MIN as f64 || rounded > i32::MAX as f64 { return Err(()); }
        out.extend_from_slice(&(rounded as i32).to_le_bytes());Ok(())
    }
    fn encode(&mut self) -> Result<usize, ()> {
        let out = &mut self.output;out.clear();out.extend_from_slice(&[0;16]);
        out.extend_from_slice(b"{\"layout\":");serde_json::to_writer(&mut *out,&self.layout).map_err(|_| ())?;
        out.extend_from_slice(b",\"state\":");serde_json::to_writer(&mut *out,&self.meta).map_err(|_| ())?;out.push(b'}');
        let meta_len = out.len()-16;
        while out.len()%4 != 0 { out.push(0); }
        let offset = out.len();
        for s in &self.skids { for (value,scale) in s.iter().zip([100.0,100.0,100.0,100.0,1000.0,1.0]) { Self::pack(out,*value,scale)?; } }
        for p in &self.particles { for (value,scale) in p.iter().zip([100.0,100.0,100.0,100.0,100.0,100.0,1000.0,1000.0,1.0,1.0,1.0]) { Self::pack(out,*value,scale)?; } }
        for trail in &self.trails { for p in trail { for value in p { Self::pack(out,*value,100.0)?; } } }
        let total = out.len();if total > MAX { return Err(()); }
        out[0..4].copy_from_slice(&0x33535757u32.to_le_bytes());out[4..8].copy_from_slice(&(meta_len as u32).to_le_bytes());
        out[8..12].copy_from_slice(&(((total-offset)/4) as u32).to_le_bytes());out[12..16].copy_from_slice(&(total as u32).to_le_bytes());
        Ok(total)
    }
}
#[no_mangle]
pub extern "C" fn input_ptr() -> *mut u8 { core::ptr::addr_of_mut!(INPUT).cast() }
#[no_mangle]
pub extern "C" fn initialize(len: usize) -> u32 {
    if len > MAX { return 0; }
    // Wasm calls are synchronous on one JS thread; no memory views survive growth.
    let input = unsafe { core::slice::from_raw_parts(input_ptr(),len) };
    let Ok(value) = serde_json::from_slice(input) else { return 0; };
    let Ok(lab) = Lab::new(value) else { return 0; };
    unsafe { *core::ptr::addr_of_mut!(LAB) = Some(lab); }1
}
#[no_mangle]
pub extern "C" fn advance(dt: f64, dx: f64, dz: f64, turn: f64) -> u32 {
    if ![dt,dx,dz,turn].iter().all(|n| n.is_finite()) || !(0.0..=0.05).contains(&dt) || dx.abs()>1.0 || dz.abs()>1.0 || turn.abs()>1.0 { return 0; }
    let Some(lab) = (unsafe { &mut *core::ptr::addr_of_mut!(LAB) }) else { return 0; };
    lab.advance(dt,dx,dz,turn);1
}
#[no_mangle]
pub extern "C" fn encode() -> usize {
    let Some(lab) = (unsafe { &mut *core::ptr::addr_of_mut!(LAB) }) else { return 0; };
    lab.encode().unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    let Some(lab) = (unsafe { &*core::ptr::addr_of!(LAB) }) else { return core::ptr::null(); };
    lab.output.as_ptr()
}
