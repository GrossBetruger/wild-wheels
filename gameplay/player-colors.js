export const playerColors =
  [['purple', '#907bcf'],
  ['Red', '#e72845'],
  ['Teal', '#3fb1a2'],
  ['Orange', '#d36516'],
  ['Blue', '#3c75d8'],
  ['Pink', '#e370b1'],
  ['Green', '#3b6329'],
  ['Brown', '#805333'],
  ['Indigo', '#494594'],
  ['Cyan', '#087b91'],
  ['Olive', '#72701c'],
  ['Charcoal', '#4b4b55'],
  ['magenta', '#a4198b'],
  ['yellow', '#edd040'],
  ];

export const canChoosePlayerColor = phase => phase === 'ready' || phase === 'finished';

export const isPlayerColor = value => typeof value === 'string' && playerColors.some(([, color]) => color === value);

export function availablePlayerColor(used, preferred) {
  if (isPlayerColor(preferred) && !used.has(preferred)) return preferred;
  return playerColors.find(([, color]) => !used.has(color))?.[1] ?? null;
}

export function savedPlayerColor(cookies) {
  const value = cookies.split(';').map(part => part.trim()).find(part => part.startsWith('wild-wheels-color='))?.slice('wild-wheels-color='.length);
  try { const color = decodeURIComponent(value ?? ''); return isPlayerColor(color) ? color : null; }
  catch { return null; }
}

// Solo races use the same palette and human-first allocation as online rooms.
export function applyPlayerColors(world, preferred) {
  world.color = isPlayerColor(preferred) ? preferred : playerColors[0][1];
  const used = new Set([world.color]);
  for (const bot of world.bots) {
    bot.color = availablePlayerColor(used, bot.color);
    if (!bot.color) throw new Error('Not enough player colors for this race.');
    used.add(bot.color);
  }
  return world;
}
