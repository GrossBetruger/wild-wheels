# Player color preferences

The browser, Node server, native Rust server and Wasm simulation use the literal swatches in `gameplay/player-colors.js`. The Rust build script extracts the quoted hex colors without evaluating JavaScript, validates that at least eight distinct colors exist, and generates the Rust palette. After editing the palette, rebuild Wasm and the dedicated server.

Players receive an unused color automatically. Human colors are reserved before bot allocation, so bots yield their colors to humans when necessary. Changing character, starting a new match, or reconnecting does not reset the assigned color. The palette highlights the actual assigned color and disables colors occupied by other humans; bot colors remain available to humans. Taken vehicle colors keep their original appearance with a diagonal line and a “Color taken” tooltip, while remaining disabled.

Colors can be chosen only before a match (`ready`) or after it ends (`finished`). During countdown, play and pause, every swatch is disabled; the compact match layout keeps the selected vehicle color visible. Both servers reject live `/api/color` changes with 409; reconnecting preserves the current assignment and preference even if a different preference is submitted. New players joining a running match still receive an unused color.

## Preference versus assignment

A preferred color is the user's remembered choice. An assigned color is their current room color. Joining with an occupied preference succeeds with an available fallback. The preference is preserved, a notice explains the fallback, and a later join can use the original preference if free. The game does not automatically steal a color or change a connected player's assignment when a preferred swatch becomes available.

An explicit in-room `/api/color` request for an occupied color returns 409 and leaves both the current assignment and saved preference unchanged. Inputs outside the palette return 400. Requests can only update the authenticated player; client-supplied player IDs do not select the account being changed.

## Saving and restoring

- The browser stores `wild-wheels-color` as a non-secret preference cookie, with the same one-year browser lifetime as its name preference. HTTPS adds Secure. The server validates submitted preferences; this cookie is not authentication.
- Offline choices update solo/Grand Prix colors immediately and are sent with the next room join or session resume. New solo games, character changes and mode/map changes retain the preference. Solo bots use distinct unclaimed palette colors.
- Node retains the preference with the live room member and returns it during resume. The browser cookie carries the preference across Node restarts/new rooms, just as the existing browser name preference does. Node room identities and matches remain in memory.
- The dedicated server also saves the preferred color with the authenticated profile in the existing private session file. Color updates use the existing atomic write path. If a color-profile save fails, the live color/preference is rolled back and the request returns 503, allowing a retry.
- Older saved profiles without a color field remain valid. If a previously valid swatch is removed from the palette, restoring that profile uses an automatic fallback without losing the player's saved identity.

Map dots and kart colors use the changeable assigned vehicle color. Chat names, floating game messages and new reply quotes use a separate fixed `chatColor`, assigned when joining. It starts with the assigned vehicle color if that chat color is free; otherwise another unused chat color is allocated. Only humans reserve chat colors, independently of their vehicle colors. Vehicle changes, rematches, refresh and AFK never change this chat color. A new room gets a fresh assignment. The dedicated server also saves it with the authenticated profile so restarting does not unnecessarily change chat colors; old profiles without it receive an automatic assignment. Client-submitted `chatColor` values are ignored. Chat messages and reply quotes retain the original author's color at send time. Old messages without colors use default styling. Names and message text remain plain DOM text; only validated six-digit hex values are used for author styling.

Chat delete buttons stay enabled during background polling. A delete click waits for the current request, disables duplicate user actions until it finishes, and is discarded if the session or room changes.

## Verification

```sh
npm run test:colors
cargo test --locked --manifest-path dedicated-server/Cargo.toml
npm run test:security-browser
npm run test:dedicated-security
```

Browser checks cover pre-join choices, occupied fallbacks, cookie preservation and refresh, and actual map drawing in Grand Prix, solo arena and multiplayer. Dedicated-server tests cover restart persistence, legacy profiles, simultaneous claims, rejected changes and disk-write failures. The broader security checks continue exercising XSS payloads, private-message authorization, CSRF and WebSocket abuse.
