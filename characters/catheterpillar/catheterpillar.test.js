import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaCore, ArenaClient } from '../../gameplay/arena-core.js';

test('Catheterpillar can host a race and remains the nurse butterfly for both players', () => {
  const core = ArenaCore.room({ code: '12', host: 0, arena: 0, bots: 0, epoch: 1, players: [{ id: 0, name: 'Catheterpillar', driver: 12, role: 'driver' }, { id: 1, name: 'Guest', driver: 0, role: 'driver' }] });
  for (const viewer of [0, 1]) {
    const client = new ArenaClient(); client.accept(core.packet(viewer), 0); client.frame(0, [], 0);
    const view = client.present(), nurse = viewer === 0 ? view : view.bots.find(actor => actor.id === 0);
    assert.equal(nurse.driver, 12); assert.equal(nurse.name, 'Catheterpillar'); assert.equal(nurse.health, 3); assert.equal(nurse.ammo, 10);
  }
});
