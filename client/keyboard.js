// Keep game controls on the same physical keys across keyboard layouts.
const physicalControls = new Map([
  ['KeyW', 'w'], ['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'],
  ['KeyQ', 'q'], ['KeyX', 'x'], ['KeyC', 'c'], ['KeyZ', 'z'],
  ['KeyF', 'f'], ['KeyP', 'p'],
]);

// Fallback for keyboard events that do not provide a physical key code.
const hebrewControls = new Map([
  ["'", 'w'], ['ש', 'a'], ['ד', 's'], ['ג', 'd'],
  ['/', 'q'], ['ס', 'x'], ['ב', 'c'], ['ז', 'z'],
  ['כ', 'f'], ['פ', 'p'],
]);

export function gameKey(event) {
  const physical = physicalControls.get(event.code);
  if (physical) return physical;
  const key = event.key?.toLowerCase() ?? '';
  if (!event.code || event.code === 'Unidentified') return hebrewControls.get(key) ?? key;
  return key;
}

export function returnsToGame(event, phase) {
  return ['countdown', 'racing'].includes(phase)
    && ['arrowup', 'arrowdown'].includes(gameKey(event))
    && !event.isComposing
    && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}
