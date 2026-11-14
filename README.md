# Wild Wheels

A browser kart game with characters, solo racing, and multiplayer arena battles. Drive on desktop or play as a bomber on mobile. Players need only a browser with WebGL enabled—no accounts or installation.

## Run the game

Install Node.js 18 or newer, then run these commands in the project directory:

```sh
npm install --ignore-scripts
npm start
```

Open [localhost:5173](http://localhost:5173). Keep the terminal open while playing.

## Dedicated Rust server

On an Ubuntu/Debian VM, install build dependencies with `./install_ubuntu.sh`. With Rust installed, run this alongside the Node server:

```sh
PORT=5174 ./run_server.sh
```

The command builds and starts the server detached; you can close SSH. Stop it with `./kill_server.sh`, or pull updates and restart with `./update_server.sh`. Logs are in `.wild-wheels/server.log`.

Open [localhost:5174](http://localhost:5174). Everyone joins one shared arena automatically, with up to eight players. Anyone can start a match or change room settings between matches. The server keeps playing when someone disconnects. After building, the executable runs independently with no Node.js dependency. See [dedicated server setup](docs/dedicated-server.md) for public hosting.

## Native Rust client POC

On macOS with Rust and the Xcode command line tools installed, connect to a running dedicated Rust server:

```sh
./run_client.sh --server http://localhost:5173 --name "Native Pip"
```

The launcher builds and opens the native client using its pinned Rust toolchain. Run `./run_client.sh --help` for options. This POC supports arena racers; see [native client instructions](native-client/README.md) for its current scope.

## Play with friends

1. Enter your name, choose a character, and click **Host Arena**.
2. On the same Wi-Fi, copy the invitation and send it to your friends.
3. For internet play, [install ngrok and connect your account](https://ngrok.com/docs/start) once, then click **Start Internet Link** and **Copy Invite**.
4. Friends open the link to join. The host can start directly; a guest’s **Let’s Play** request starts automatically after three seconds unless the host refuses.

Arena rooms support up to six participants. Choose a map and bot count in the lobby. Phones join as bombers automatically, and everyone can edit their player name.

Each running server keeps one room. Refresh to reconnect; names are remembered in cookies. Use **AFK** to step away and **Back to Arena** to return. Clicking **Host Arena** again replaces the room and creates a new invitation.

## Basic gameplay

**Grand Prix:** race three laps against computer opponents. Collect weapons and turbo cells, drift for boosts, and use alternate routes to get ahead. This mode is solo.

**Arena Battle:** fight other players and computer opponents. First to ten points wins, or the highest score after three minutes. In player-hosted rooms, a host tied for the highest points wins the tie; the dedicated server breaks ties by fewer deaths. Everyone starts with ten hedgehogs. Destroyed drivers respawn; collect ammo, health, and turbos around the arena. Cuteness determines recovery speed; Intelligence determines how much ammo and how many items you can carry. Two consecutive kills unlock the rapid-fire Hedgehog Vulcan.

### Desktop controls

| Key | Action |
| --- | --- |
| Arrow keys / WASD | Drive and steer; Down / S brakes and reverses in arenas |
| Shift + steering | Drift; release for a boost |
| Space | Fire the selected weapon |
| Q / Tab / ⌘ Command | Switch hedgehogs and missiles |
| X | Use a turbo |
| C | Deploy chaff to divert incoming missiles in arenas |
| Z | Somersault and turn 180° in arenas |
| F | Activate your character's special ability (20-second recharge) |
| Escape | Pause; multiplayer continues for everyone else |

You can also click the ammo cards to select weapons. Watch for the incoming missile warning and use chaff to break the lock.

### Mobile bombers

Tap the arena to drop the selected bomb. Drag to pan, use **+ / −** to zoom, and **⌖** to recenter. Switch between **3D VIEW** and **2D MAP** at any time. Use **PHOTO ∞** to take unlimited photographs without spending bombs; everyone gets a shared photo slideshow after the match. **Let’s Bomb / Let’s Play** opens the game in fullscreen.

Start with two A-bombs and two stinkbombs. A-bombs refill every ten seconds; stinkbombs refill every five seconds. Select **A-BOMBS** for explosions or **STINK** to make drivers dizzy. If an affected driver dies, the killer earns one point and each contributing bomber earns half a point. Bombers cannot be hit by drivers.

## Troubleshooting

- **Slow graphics:** try **Graphics → Balanced** or **Low**, and check that your browser has hardware acceleration enabled.
- **Different behavior between computers:** restart the server, refresh both browsers, and compare the **BUILD** identifiers below the game.
- **Friends cannot connect:** keep the server running and use **Start Internet Link** for friends outside your Wi-Fi.

For development checks and browser benchmarks, see [Testing](docs/testing.md).

An independent homage with original graphics and synthesized audio; not an official Wacky Wheels release.
