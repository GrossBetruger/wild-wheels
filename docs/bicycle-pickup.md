# KnowItOwl's dropped bicycles

Each boost takeoff leaves one full-size bicycle. It follows a 1.2-second arc, tips onto its side, and eases to rest while a purple pickup halo fades in. The thrown object and the floor pickup use the same bicycle geometry. It stays collectible for three seconds after landing, then disappears. Collected bicycles never respawn.

Any racer can collect it after it lands for +1 intelligence. Bonuses stack beyond 5 and last for the whole match, including death and respawn; the next match starts at the character’s base intelligence. Each extra intelligence gives capacity for two more hedgehogs and one more missile, turbo, or bomb of each kind. Intelligence 6 carries 20 hedgehogs and 7 other items of each kind; intelligence 7 carries 22 and 8. Bicycles grant no ammunition or Vulcan. KnowItOwl keeps his normal bat companion; other racers keep their normal weapons.

Rust owns multiplayer drops and collection. JavaScript solo follows the same rules. Remote bicycle ages advance with the interpolated arena clock, rather than jumping at snapshot cadence. Local takeoff prediction blends its bicycle into the server's trajectory over 180 ms.

Regression criteria:

- One drop per boost transition, unique item IDs, safe landing positions, and expiry after three seconds on the floor.
- No collection in flight, immediate inventory feedback on collection, no extra ammunition or premature Vulcan, and no bicycle respawn.
- Actual carrying limits at intelligence 6 and 7, stacking collections, normal Vulcan fire, and bonuses surviving death and respawn in both engines.
- Continuous floor position and zero landing velocity; presentation preserves source pose, ownership, age, and acquired upgrades.
- Real Chrome renders exactly one thrown/pickup bicycle through landing, with no frame-to-frame step of 2 units or more when frames are less than 100 ms apart; then verifies numeric intelligence HUD and increased inventory above the base carrying limits.

Run `node --test tests/gameplay/bicycle-pickup.test.js` or `npm test` before pushing. After pushing, run `npm run test:browser-netcode -- --specials --profile --output /private/tmp/wild-wheels-bicycles.json` for the Chrome checks and screenshots.
