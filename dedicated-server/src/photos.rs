use super::*;
use axum::extract::Path;
use std::time::{SystemTime, UNIX_EPOCH};
const MAX: usize = 65536;
struct Photo {
    bytes: Bytes,
    owner: usize,
    name: String,
    elapsed: f64,
}
#[derive(Default)]
pub struct Album {
    epoch: u64,
    photos: Vec<Photo>,
    rates: HashMap<usize, (u64, u32)>,
    start_at: Option<u64>,
}
impl Album {
    fn ensure(&mut self, epoch: u64) {
        if self.epoch != epoch {
            *self = Self {
                epoch,
                ..Self::default()
            };
        }
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
fn valid(bytes: &[u8]) -> bool {
    if bytes.len() < 12
        || bytes.len() > MAX
        || !bytes.starts_with(&[255, 216])
        || !bytes.ends_with(&[255, 217])
    {
        return false;
    }
    let mut at = 2;
    while at + 4 <= bytes.len() {
        if bytes[at] != 255 {
            return false;
        }
        at += 1;
        while bytes.get(at) == Some(&255) {
            at += 1;
        }
        let Some(&marker) = bytes.get(at) else {
            return false;
        };
        at += 1;
        if matches!(marker, 218 | 217) {
            return false;
        }
        if at + 2 > bytes.len() {
            return false;
        }
        let length = u16::from_be_bytes([bytes[at], bytes[at + 1]]) as usize;
        if length < 2 || at + length > bytes.len() {
            return false;
        }
        if matches!(marker, 192 | 194) {
            if length < 8 || bytes[at + 2] != 8 {
                return false;
            }
            let height = u16::from_be_bytes([bytes[at + 3], bytes[at + 4]]);
            let width = u16::from_be_bytes([bytes[at + 5], bytes[at + 6]]);
            return width > 0 && height > 0 && width <= 960 && height <= 600;
        }
        at += length;
    }
    false
}
pub async fn upload(State(app): State<App>, h: HeaderMap, body: Bytes) -> Response {
    if !same_origin(&h) {
        return error((403, "Use the game from the same server."));
    }
    if h.get(header::CONTENT_TYPE)
        .is_none_or(|v| v != "image/jpeg")
    {
        return error((415, "Use a camera JPEG."));
    }
    let room = app.room.lock().unwrap();
    let Some(id) = room.find(session(&h)) else {
        return error((401, "Rejoin the room to reconnect."));
    };
    let person = room.members[id].as_ref().unwrap();
    if person.role != "bomber" || person.afk {
        return error((403, "Only active bombers can take photos."));
    }
    if room.core.phase() != "racing"
        || h.get("x-wild-wheels-epoch")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            != Some(room.core.epoch())
    {
        return error((409, "This match has ended."));
    }
    if !valid(&body) {
        return error((400, "Invalid camera image."));
    }
    let mut album = app.photos.lock().unwrap();
    album.ensure(room.core.epoch());
    let second = room.core.elapsed().floor() as u64;
    let rate = album.rates.entry(id).or_insert((second, 0));
    if rate.0 != second {
        *rate = (second, 0);
    }
    if rate.1 >= 2 {
        return error((429, "The camera is recharging. Try again."));
    }
    rate.1 += 1;
    let index = album.photos.len();
    album.photos.push(Photo {
        bytes: body,
        owner: id,
        name: person.name.clone(),
        elapsed: room.core.elapsed(),
    });
    response(200, json!({"ok":true,"id":index}))
}
pub async fn list(State(app): State<App>, h: HeaderMap) -> Response {
    if !same_origin(&h) {
        return error((403, "Use the game from the same server."));
    }
    let room = app.room.lock().unwrap();
    if room.find(session(&h)).is_none() {
        return error((401, "Rejoin the room to reconnect."));
    }
    let mut album = app.photos.lock().unwrap();
    album.ensure(room.core.epoch());
    let ready = room.core.phase() == "finished";
    let now = now();
    if ready && album.start_at.is_none() {
        album.start_at = Some(now);
    }
    let photos=match ready{true=>album.photos.iter().enumerate().map(|(id,p)|json!({"id":id,"owner":p.owner,"name":p.name,"elapsed":p.elapsed,"url":format!("/api/photos/{}/{id}",album.epoch)})).collect::<Vec<_>>(),false=>Vec::new()};
    response(
        200,
        json!({"epoch":album.epoch,"ready":ready,"photos":photos,"startAt":album.start_at,"serverTime":now}),
    )
}
pub async fn image(
    State(app): State<App>,
    Path((epoch, id)): Path<(u64, usize)>,
    h: HeaderMap,
) -> Response {
    if !same_origin(&h) {
        return error((403, "Use the game from the same server."));
    }
    let room = app.room.lock().unwrap();
    if room.find(session(&h)).is_none() {
        return error((401, "Rejoin the room to reconnect."));
    }
    if room.core.phase() != "finished" || room.core.epoch() != epoch {
        return error((404, "Photo unavailable."));
    }
    let mut album = app.photos.lock().unwrap();
    album.ensure(epoch);
    let Some(photo) = album.photos.get(id) else {
        return error((404, "Photo unavailable."));
    };
    let mut r = Response::new(Body::from(photo.bytes.clone()));
    r.headers_mut()
        .insert(header::CONTENT_TYPE, "image/jpeg".parse().unwrap());
    r
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(flavor = "current_thread")]
    async fn bomber_photos_are_shared_at_the_finish_and_do_not_leak_into_the_next_match() {
        let mut room = Room::new(0, 0);
        let bomber = room
            .join(&json!({"name":"Bomber","driver":0,"role":"bomber"}))
            .unwrap()["token"]
            .as_str()
            .unwrap()
            .to_owned();
        let driver = room
            .join(&json!({"name":"Driver","driver":1,"role":"driver"}))
            .unwrap()["token"]
            .as_str()
            .unwrap()
            .to_owned();
        room.control(0, "/api/control", &json!({"action":"start"}))
            .unwrap();
        for _ in 0..61 {
            room.core
                .step(wild_wheels_core::Frame {
                    dt: 0.05,
                    inputs: vec![],
                })
                .unwrap();
        }
        assert_eq!(room.core.phase(), "racing");
        let app = App {
            sessions: Arc::new(tokio::sync::Mutex::new(crate::sessions::Sessions::open(
                std::env::temp_dir().join(format!("wild-wheels-photo-sessions-{}", crate::room::token())), crate::sessions::now(),
            ).unwrap())),
            room: Arc::new(Mutex::new(room)),
            photos: Default::default(),
            limits: Default::default(),
            sockets: Arc::new(Semaphore::new(32)),
            origin: None,
        };
        let headers = |token: &str| {
            let mut h = HeaderMap::new();
            h.insert(
                header::AUTHORIZATION,
                format!("Bearer {token}").parse().unwrap(),
            );
            h.insert(header::CONTENT_TYPE, "image/jpeg".parse().unwrap());
            h.insert("x-wild-wheels-epoch", "2".parse().unwrap());
            h
        };
        let frame = Bytes::from_static(&[
            255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217,
        ]);
        assert_eq!(
            upload(State(app.clone()), headers(&driver), frame.clone())
                .await
                .status(),
            403
        );
        assert_eq!(
            upload(State(app.clone()), headers(&bomber), frame.clone())
                .await
                .status(),
            200
        );
        let early = list(State(app.clone()), headers(&driver)).await;
        let early: Value = serde_json::from_slice(
            &axum::body::to_bytes(early.into_body(), 100000)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(early["photos"], json!([]));
        assert_eq!(
            image(State(app.clone()), Path((2, 0)), headers(&driver))
                .await
                .status(),
            404
        );
        {
            let mut room = app.room.lock().unwrap();
            for _ in 0..3700 {
                room.core
                    .step(wild_wheels_core::Frame {
                        dt: 0.05,
                        inputs: vec![],
                    })
                    .unwrap();
            }
            assert_eq!(room.core.phase(), "finished");
        }
        let album = list(State(app.clone()), headers(&driver)).await;
        let album: Value = serde_json::from_slice(
            &axum::body::to_bytes(album.into_body(), 100000)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(album["photos"][0]["name"], "Bomber");
        assert_eq!(album["photos"][0]["url"], "/api/photos/2/0");
        let photo = image(State(app.clone()), Path((2, 0)), headers(&driver)).await;
        assert_eq!(photo.status(), 200);
        assert_eq!(
            axum::body::to_bytes(photo.into_body(), 65536)
                .await
                .unwrap(),
            frame
        );
        app.room
            .lock()
            .unwrap()
            .control(0, "/api/control", &json!({"action":"start"}))
            .unwrap();
        assert_eq!(
            image(State(app.clone()), Path((2, 0)), headers(&driver))
                .await
                .status(),
            404
        );
        assert_eq!(
            list(State(app.clone()), HeaderMap::new()).await.status(),
            401
        );
    }
}
