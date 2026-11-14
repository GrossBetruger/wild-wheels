# Chat and multiplayer security

These changes harden both the Node development server and Rust dedicated server. They do not certify the game as vulnerability-free. No SQL database is used: injection tests verify that SQL-looking strings remain literal chat text and never become authentication or executable instructions.

## What changed

| File | Purpose |
| --- | --- |
| `server/security.js` (new) | Central Node origin and transport policy. Requires full scheme/host/port matches, rejects cross-site/sibling-site browser requests, rejects cookie requests without an Origin or same-origin Fetch Metadata, and limits forwarded HTTPS trust to explicitly enabled loopback proxies or the locally discovered ngrok tunnel. |
| `server.js` | Applies transport policy before serving content, adds HSTS for trusted HTTPS and a no-referrer policy, restricts WebSocket CSP destinations to the actual transport, caches/coalesces build fingerprint work, and caps concurrent TCP connections at 256. Supports `BIND`. |
| `server/multiplayer.js` | Uses that policy for HTTP/WebSockets and cookie security. Public HTTPS joins require random invitation secrets. WebSockets are capped at 32 total/12 per network peer, idle sockets are terminated after approximately 30–40 seconds, writes time out after two seconds, rate-limit bookkeeping is capped at 4,096 entries, and sessions without activity expire after 15 minutes. Adds host-only player removal and invitation rotation. |
| `server/chat.js` | Returns the same 404 for nonexistent and unauthorized message deletions, avoiding disclosure of private-message existence. Existing server-side participant, reply, and sender checks remain authoritative. |
| `networking/network.js` | Reads/writes invitation secrets in URL fragments and includes them in join requests. Adds the host's REMOVE controls, updates the share link after removal, and handles the removed-player socket close code. |
| `dedicated-server/src/security.rs` (new) | Rust equivalents of exact-origin, cookie metadata, private-development-host, and trusted-loopback HTTPS checks; includes focused policy tests. |
| `dedicated-server/src/main.rs` | Applies Rust transport checks before body extraction, HSTS/referrer headers, public invitation-secret enforcement, shared rate buckets for ordinary API paths, and a 30-second incoming WebSocket inactivity timeout. |
| `dedicated-server/src/chat.rs` | Uniform deletion errors and tests of malicious input, private-message access, forged sender IDs, and reply authorization. |
| `dedicated-server/src/photos.rs` | Uses the shared Rust origin policy for photo reads/uploads and updates the test fixture for the security configuration. |
| `dedicated-server/src/room.rs` | Expires sessions with no activity for 15 minutes even if their socket never formally disconnected; notifies the socket writer and tests that the stale identity cannot return. |
| `tests/multiplayer/security.test.js` (new) | Local HTTP/WebSocket attack tests: CSRF, IDOR, forged identities, SQL/HTML/prototype-looking payloads, body/rate/map/connection limits, auth deadlines, cookie-only WebSocket hijacking, public invitation secrets, proxy spoofing, and slot recovery. |
| `tests/multiplayer/chat.test.js` | Updates the expected unauthorized-delete response to the uniform 404. |
| `tests/multiplayer/multiplayer.test.js` | Makes cookie-only test clients explicitly send their Origin, and explicitly enables proxy trust in the existing forwarded-HTTPS test fixture. |
| `scripts/checks/check-chat-browser.mjs` | Real Chrome tests send script/image/SVG and SQL-looking payloads, malicious names, and replies. They assert literal DOM text, absence of injected elements, and absence of script execution, while retaining the normal chat tests. Legitimate SVG delete icons are excluded from injection checks. |
| `scripts/checks/check-dedicated-security.mjs` (new) | Launches isolated Rust servers and attacks real HTTP/WebSocket endpoints, including a simulated trusted HTTPS proxy and secret-protected public joins. |
| `package.json` | Adds convenient security test commands without adding dependencies. |
| `docs/dedicated-server.md` | Updates public-hosting configuration and session-expiration documentation. |
| `docs/security.md` (new) | This explanation, deployment requirements, test commands, and remaining boundaries. |

## Running the tests

```sh
npm run test:security
npm run test:security-browser
cargo test --locked --manifest-path dedicated-server/Cargo.toml
npm run test:dedicated-security
```

Node caches the build fingerprint for the process lifetime; restart it after changing assets when checking build IDs.

The Chrome check requires Google Chrome, or `CHROME_PATH` pointing to a compatible Chromium executable. The tests use isolated localhost servers and test-only identities. They do not attack a deployed site or generate a large external flood.

`npm test` includes the Node security tests automatically. The browser and dedicated integration commands are separate. SQL-payload pass results do not demonstrate database query safety: there is no SQL execution path to test. If persistent SQL storage is introduced, use parameterized queries and add database integration tests then.

## Public hosting

Localhost and private IPv4 LAN addresses continue to support HTTP development. Public HTTP and arbitrary public Host headers are rejected. HTTPS is terminated by a reverse proxy, which must run on loopback next to the game server. For both servers configure:

```sh
PUBLIC_ORIGIN=https://game.example
TRUST_PROXY=1
BIND=127.0.0.1
```

The proxy must preserve the public `Host`, overwrite `X-Forwarded-Proto` with `https` for HTTPS requests, forward WebSocket upgrades, and redirect HTTP visitors to HTTPS. Expose the proxy's TLS port, rather than the backend port. The game rejects insecure public requests instead of redirecting them, so it never processes credentials sent to an insecure endpoint. These changes do not install certificates, configure a proxy, or update a running deployment.

For Node, the host creates the room and COPY INVITE includes a random 256-bit secret. The built-in START INTERNET LINK flow also works: the local ngrok agent must report an HTTPS tunnel forwarding to this game's port. Only that discovered hostname gets automatic loopback-proxy trust; arbitrary forwarded headers do not enable it.

For Rust, also configure `INVITE_SECRET` with at least 32 random characters (for example, generate 32 bytes with `openssl rand -hex 32`). Public HTTPS configuration fails at startup if this value is missing or too short. Give friends the complete URL:

```text
https://game.example/?room=00#invite=YOUR_RANDOM_SECRET
```

URL fragments are not sent in HTTP request targets or Referer headers. The browser sends the secret in the HTTPS JSON join body. Do not log request bodies containing secrets. Local development remains open by room code; public admission is secret-protected. The Rust dedicated server intentionally has no host, so it has no host-only REMOVE control. Rotate its server-level invitation by changing `INVITE_SECRET` and restarting; active matches and scores end on restart, while saved sessions and chat history persist.

Node REMOVE invalidates the player's session and rotates the room invitation. Existing authorized participants stay connected; the host's COPY INVITE gets the new secret. Previously shared links cannot admit new public players after that rotation. A current participant can still reconnect with their valid session. After 15 minutes without any API/socket activity, a session's place and scores are released; actively polling AFK players retain their places.

## Remaining boundaries

- Rate limits reduce application abuse; they cannot prevent distributed bandwidth exhaustion. Put public hosting behind a proxy/service with connection, request and traffic limits. Multiple players behind the same proxy/IP share network rate limits, by design; forwarded client IP headers are not trusted.
- Anyone holding a valid invitation can join until the room is full. Invitation secrets are access credentials, not verified user accounts or one-use tickets. An authorized participant can still behave abusively; Node provides host removal, while Rust intentionally uses an equal-player shared room.
- WebSocket authentication still uses a JavaScript-accessible session token, and an XSS anywhere on the same origin could act as the user. HttpOnly does not neutralize XSS. The chat renders untrusted values with safe text APIs and CSP provides another layer.
- Private chat is server-access-controlled, not end-to-end encrypted. The game server can read it.
- No CSRF-token subsystem was added: exact-origin checks, Fetch Metadata, SameSite cookies and non-simple JSON requests are the browser defenses. Cookieless command-line clients may omit browser-origin headers and must supply a valid bearer token for authenticated actions.
- The deterministic tests cover specific attacks and regressions. They are not a full penetration test or a volumetric load benchmark.
