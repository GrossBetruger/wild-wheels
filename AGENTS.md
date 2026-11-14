# Development workflow

- Keep README.md focused on running the game and basic gameplay. Put technical details and test criteria in separate documentation; do not add a README entry for every feature or fix.

- Run lightweight checks such as `npm test` before pushing.
- Push completed changes to the personal `GrossBetruger/wild-wheels` repository on `main` before running the heavy browser or full regression suites (`npm run test:browser-netcode` and `npm run test:regression`).
- Run heavy checks after pushing. Keep developing independent authorized work while waiting for commands or checks whenever useful work remains.
- If post-push checks identify a regression, fix it forward and push the fix. The user explicitly prefers keeping this recreational game's new features available while fixing issues; do not automatically revert. Preserve repository history; do not reset or force-push.
- Do not ask for conversational confirmation to edit code or run tests in this repository. Honor any tool-enforced sandbox approvals.

# Native client graphics

- The native client's graphics are ported from the browser renderer at build time. Before adding or changing visuals, or when one is missing natively, follow `.claude/skills/native-graphics-port/SKILL.md` and `docs/native-graphics-port.md`. Do not hand-model in the native client what the browser already draws.
