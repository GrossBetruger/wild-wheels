# KnowItOwl's dropped bicycles

Each boost takeoff leaves one full-size bicycle. It follows a 1.2-second arc, tips onto its side, and eases to rest while a purple pickup halo fades in. The thrown object and the floor pickup use the same bicycle geometry. There is no size change, disappearance, or respawn timer.

Other racers can collect it after it lands. It grants BatYouDidn'tKnow's automatic Uzi during their normal Vulcan periods, at the existing 150 ms firing interval. It does not grant Vulcan immediately. Manual missiles still work; manual Vulcan is replaced by the bat. The upgrade survives Vulcan expiry and is lost on death. Owls and racers already holding the upgrade leave bicycles for others.

Rust owns multiplayer drops and collection. JavaScript solo follows the same rules. Remote bicycle ages advance with the interpolated arena clock, rather than jumping at snapshot cadence. Local takeoff prediction blends its bicycle into the server's trajectory over 180 ms.

Regression criteria:

- One persistent drop per boost transition, unique item IDs, and safe landing positions.
- No collection in flight, immediate inventory feedback on collection, no extra ammunition or premature Vulcan, and no bicycle respawn.
- Automatic targeting, manual missile support, no duplicate manual Vulcan fire, and upgrade removal on death in both engines.
- Continuous floor position and zero landing velocity; presentation preserves source pose, ownership, age, and acquired upgrades.
- Real Chrome renders exactly one thrown/pickup bicycle through landing, with no frame-to-frame step of 2 units or more when frames are less than 100 ms apart; then verifies pickup HUD and borrowed bat fire.

Run `node --test bicycle-pickup.test.js` or `npm test` before pushing. After pushing, run `npm run test:browser-netcode -- --specials --profile --output /private/tmp/wild-wheels-bicycles.json` for the Chrome checks and screenshots.
