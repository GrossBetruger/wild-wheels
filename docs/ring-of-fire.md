# Master-Yuda: Ring of Fire

An additional passive ability alongside Reefer Madness. With abilities enabled, complete a full turn in one direction while drifting, with drift charge at least 0.85 (the normal maximum-charge threshold). Reversing direction or interrupting the drift resets the charging circle.

An ignited ring follows Yuda at a radius of 10 units. Its flames absorb projectiles crossing in either direction, including missiles, Vulcan shots and chaff-diverted missiles. Absorbed missiles do not cause splash damage. Yuda is immune to his own ring; enemies touching the perimeter receive 2 damage immediately and then every 0.3 seconds. Normal damage shields apply. The interior is safe from the fire itself.

Keep steering to sustain the ring; continuing to hold drift is optional after ignition. Stopping, death, AFK or disabling abilities extinguishes it. It expires after 20 seconds even if Yuda keeps turning, and another charged circle requires first stopping the turn. Avita’s time warp pauses its lifetime with Yuda.

`fire-ring.test.js` covers full-circle activation in both solo JS and Rust arenas, stopping, the 20-second cap, ability toggle, perimeter damage timing, swept projectile blocking in both directions, and native/solo missile absorption without splash. After pushing, `npm run test:dedicated-browser -- --fire-ring` checks ignition, remote visibility, WebGL rendering and extinction in two real Chrome players against the native server.
