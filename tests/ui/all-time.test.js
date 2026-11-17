import test from 'node:test';
import assert from 'node:assert/strict';
import { allTimeRows, loadAllTime } from '../../ui/all-time.js';

const board = Array.from({ length: 12 }, (_, index) => ({ name: `Player ${index + 1}`, wins: 12 - index, games: 20 }));
test('the board shows its top and marks the viewer, whatever the capitals of their name', () => {
  const rows = allTimeRows(board, 'player 2');
  assert.equal(rows.length, 8); assert.deepEqual(rows[0], { rank: 1, name: 'Player 1', wins: 12, games: 20, you: false });
  assert.deepEqual(rows.filter(row => row.you).map(row => row.rank), [2]);
});
test('a viewer further down the board still sees their own line, and a stranger sees only the top', () => {
  const rows = allTimeRows(board, 'Player 11');
  assert.equal(rows.length, 9); assert.deepEqual(rows.at(-1), { rank: 11, name: 'Player 11', wins: 2, games: 20, you: true });
  assert.equal(allTimeRows(board, 'Nobody').length, 8); assert.equal(allTimeRows(board).some(row => row.you), false); assert.deepEqual(allTimeRows([], 'Player 1'), []);
});
test('only a well-formed board from the server is shown', async () => {
  const reply = (body, ok = true) => async () => ({ ok, json: async () => body });
  assert.deepEqual(await loadAllTime(reply({ players: board })), board);
  assert.deepEqual(await loadAllTime(reply({ players: [] })), []);
  assert.equal(await loadAllTime(reply({ players: board }, false)), null, 'a server that keeps no board');
  for (const bad of [{}, { players: 'x' }, { players: [{ name: 'A', wins: 2, games: 1 }] }, { players: [{ name: '', wins: 0, games: 1 }] }, { players: [{ name: 'A', wins: -1, games: 1 }] }, { players: [{ name: 'A'.repeat(25), wins: 0, games: 1 }] }, { players: [{ name: 'A', wins: 0.5, games: 1 }] }])
    assert.equal(await loadAllTime(reply(bad)), null, JSON.stringify(bad));
  assert.equal(await loadAllTime(async () => { throw new Error('offline'); }), null);
});
