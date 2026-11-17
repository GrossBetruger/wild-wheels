// The all-time leaderboard the server keeps: each player's wins and games played.
export const ALL_TIME_ROWS = 8;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
// The rows to show: the top of the board and, if they are further down, the viewer's own line.
export function allTimeRows(players, you = '', limit = ALL_TIME_ROWS) {
  const ranked = players.map((player, index) => ({ rank: index + 1, name: player.name, wins: player.wins, games: player.games, you: Boolean(you) && same(player.name, you) }));
  const rows = ranked.slice(0, limit), own = ranked.find(row => row.you);
  if (own && own.rank > limit) rows.push(own);
  return rows;
}
// The board as the server sends it, or null when this server keeps none or sent something else.
export async function loadAllTime(load = () => fetch('/api/leaderboard', { cache: 'no-store', signal: AbortSignal.timeout(4000) })) {
  try {
    const response = await load(); if (!response.ok) return null;
    const { players } = await response.json();
    const sound = Array.isArray(players) && players.length <= 1000 && players.every(player => typeof player?.name === 'string' && player.name.length > 0 && player.name.length <= 24 && Number.isSafeInteger(player.wins) && Number.isSafeInteger(player.games) && player.wins >= 0 && player.games >= player.wins);
    return sound ? players : null;
  } catch { return null; }
}
