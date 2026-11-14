import test from 'node:test';
import assert from 'node:assert/strict';
import {gameKey, returnsToGame} from '../../client/keyboard.js';
import {keyMask} from '../../gameplay/arena-core.js';

const controls = [
  ['KeyW', "'", 'w'], ['KeyA', 'ש', 'a'], ['KeyS', 'ד', 's'], ['KeyD', 'ג', 'd'],
  ['KeyQ', '/', 'q'], ['KeyX', 'ס', 'x'], ['KeyC', 'ב', 'c'], ['KeyZ', 'ז', 'z'],
  ['KeyF', 'כ', 'f'], ['KeyP', 'פ', 'p'],
];

test('English and Hebrew layouts produce the same controls, including shifted letters', () => {
  for (const [code, hebrew, english] of controls) {
    for (const key of [hebrew, english, english.toUpperCase()]) assert.equal(gameKey({code, key}), english);
  }
});

test('Hebrew controls still work when physical key codes are missing', () => {
  for (const [, key, expected] of controls) {
    assert.equal(gameKey({key}), expected);
    assert.equal(gameKey({key, code:'Unidentified'}), expected);
  }
});

test('releasing a key after changing keyboard layout clears the original held control', () => {
  for (const [code, hebrew, english] of controls) {
    const held = new Set([gameKey({code, key:hebrew})]);
    held.delete(gameKey({code, key:english}));
    assert.equal(held.size, 0);
  }
});

test('Hebrew driving and fire keys use the existing multiplayer input mask', () => {
  const events = [{code:'KeyW', key:"'"}, {code:'KeyA', key:'ש'}, {code:'ShiftLeft', key:'Shift'}, {code:'Space', key:' '}];
  assert.equal(keyMask(new Set(events.map(gameKey))), keyMask(new Set(['w','a','shift',' '])));
  assert.equal(keyMask(new Set(events.map(gameKey))), 1|8|16|32);
});

test('real punctuation keys do not become Hebrew-layout movement or weapon commands', () => {
  assert.equal(gameKey({code:'Quote', key:"'"}), "'");
  assert.equal(gameKey({code:'Slash', key:'/'}), '/');
  for (const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Tab','Meta',' ']) assert.equal(gameKey({key}), key.toLowerCase());
  assert.equal(gameKey({code:'KeyB', key:'נ'}), 'נ');
});

test('only plain Up or Down returns from chat to an active game', () => {
  for (const phase of ['countdown','racing']) {
    for (const key of ['ArrowUp','ArrowDown']) assert.equal(returnsToGame({key},phase),true);
    for (const key of ['ArrowLeft','ArrowRight','w','ס','Enter','Escape']) assert.equal(returnsToGame({key},phase),false);
    for (const modifier of ['shiftKey','ctrlKey','altKey','metaKey','isComposing']) assert.equal(returnsToGame({key:'ArrowUp',[modifier]:true},phase),false);
  }
  for (const phase of ['ready','paused','finished']) assert.equal(returnsToGame({key:'ArrowUp'},phase),false);
});
