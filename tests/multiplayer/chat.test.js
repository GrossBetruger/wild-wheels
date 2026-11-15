import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomChat } from '../../server/chat.js';
import { createGameServer } from '../../server.js';

const roster = () => new Map([0, 1, 2].map(id => [id, { id, name: ['Alice', 'Bob', 'Eve'][id], token: `session-${id}` }]));
test('separate rooms keep independent public and private chat histories', () => {
  const first = new RoomChat(), second = new RoomChat(), members = roster();
  first.exchange(members.get(0), members, { text: 'First room only' }, 1000);
  first.exchange(members.get(1), members, { text: 'First room private', to: 0 }, 1000);
  assert.deepEqual(second.exchange(members.get(0), members, {}).messages, []);
  second.exchange(members.get(0), members, { text: 'Second room only' }, 1000);
  assert.deepEqual(first.exchange(members.get(0), members, {}).messages.map(message => message.text), ['First room only', 'First room private']);
  assert.deepEqual(second.exchange(members.get(1), members, {}).messages.map(message => message.text), ['Second room only']);
});
test('public chat reaches everyone, private chat only reaches the two sessions and never exposes tokens', () => {
  const members = roster(), chat = new RoomChat(), alice = members.get(0), bob = members.get(1), eve = members.get(2);
  chat.exchange(alice, members, { text: 'Hello everyone' }, 1000);
  chat.exchange(alice, members, { text: 'Only Bob', to: 1 }, 1500);
  assert.deepEqual(chat.exchange(bob, members, {}).messages.map(message => message.text), ['Hello everyone', 'Only Bob']);
  const observer = chat.exchange(eve, members, {});
  assert.deepEqual(observer.messages.map(message => message.text), ['Hello everyone']);
  assert.equal(JSON.stringify(observer).includes('session-'), false);
  assert.equal(chat.exchange(alice, members, { after: 1 }).messages.length, 1);
  assert.equal(chat.exchange(bob, members, { after: 2 }).messages.length, 0);
  members.set(1, { ...bob, token: 'new-session' });
  assert.deepEqual(chat.exchange(members.get(1), members, {}).messages.map(message => message.text), ['Hello everyone']);
});
test('chat validates messages, recipients and cursors, limits sending, and bounds history', () => {
  const members = roster(), chat = new RoomChat(), alice = members.get(0);
  for (const body of [{ text: '' }, { text: ' ' }, { text: 'x'.repeat(501) }, { text: 42 }, { text: 'x', to: 0 }, { text: 'x', to: 99 }, { text: 'x', to: '1' }, { after: -1 }, { after: 1.5 }]) assert.throws(() => chat.exchange(alice, members, body), { status: 400 });
  chat.exchange(alice, members, { text: '  Hello  ' }, 1000);
  assert.throws(() => chat.exchange(alice, members, { text: 'Spam' }, 1100), { status: 429 });
  assert.equal(chat.exchange(alice, members, {}).messages[0].text, 'Hello');
  for (let n = 1; n <= 205; n++)chat.exchange(alice, members, { text: String(n) }, 1000 + n * 500);
  assert.equal(chat.messages.length, 200);
  assert.equal(chat.exchange(alice, members, {}).cursor, 206);
});
test('HTTP chat requires a room session, isolates private messages and serves its UI module', async t => {
  const app = createGameServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.multiplayer.close(); app.server.closeAllConnections(); app.server.close(); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, body, token) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  assert.equal((await post('/api/chat', {})).status, 401);
  const alice = await post('/api/rooms', { name: 'Alice', driver: 0, arena: 0, bots: 0 });
  const bob = await post('/api/join', { name: 'Bob', driver: 1, code: alice.code });
  const eve = await post('/api/join', { name: 'Eve', driver: 2, code: alice.code });
  const sent = await post('/api/chat', { text: '<b>Private hello</b>', to: bob.you }, alice.token);
  assert.equal(sent.status, 200); assert.equal(sent.messages[0].name, 'Alice');
  assert.equal((await post('/api/chat', {}, bob.token)).messages[0].text, '<b>Private hello</b>');
  assert.deepEqual((await post('/api/chat', {}, eve.token)).messages, []);
  assert.equal((await fetch(origin + '/ui/chat.js')).status, 200);
});

test('replies quote server-owned text and cannot expose another conversation', () => {
  const members = roster(), chat = new RoomChat(), alice = members.get(0), bob = members.get(1), eve = members.get(2);
  const original = chat.exchange(alice, members, { text: 'Private question', to: 1 }, 1000).messages[0];
  const response = chat.exchange(bob, members, { text: 'The answer', to: 0, replyTo: original.id, reply: { text: 'Forged' } }, 1500).messages.at(-1);
  assert.deepEqual(response.reply, { id: original.id, name: 'Alice', text: 'Private question' });
  assert.throws(() => chat.exchange(alice, members, { text: 'Leak to public', replyTo: original.id }, 2000), { status: 400 });
  assert.throws(() => chat.exchange(eve, members, { text: 'Leak to Eve', to: 0, replyTo: original.id }, 2000), { status: 400 });
  assert.throws(() => chat.exchange(bob, members, { text: 'Missing quote', to: 0, replyTo: 999 }, 2000), { status: 400 });
  const publicMessage = chat.exchange(eve, members, { text: 'Public question' }, 2000).messages.at(-1);
  assert.equal(chat.exchange(alice, members, { text: 'Public answer', replyTo: publicMessage.id }, 2500).messages.at(-1).reply.text, 'Public question');
});

test('only the sender can delete messages; deletion and quote removal reach the conversation', () => {
  const members = roster(), chat = new RoomChat(), alice = members.get(0), bob = members.get(1), eve = members.get(2);
  const original = chat.exchange(alice, members, { text: 'Remove this', to: 1 }, 1000).messages[0];
  chat.exchange(bob, members, { text: 'Reply', to: 0, replyTo: original.id }, 1500);
  assert.throws(() => chat.exchange(bob, members, { deleteId: original.id }), { status: 404 });
  assert.throws(() => chat.exchange(alice, members, { deleteId: 999 }), { status: 404 });
  const deletion = chat.exchange(alice, members, { after: 2, deleteId: original.id });
  assert.equal(deletion.messages[0].deleted, true);
  assert.equal(deletion.messages[0].text, '');
  assert.deepEqual(deletion.messages[1].reply, { id: original.id, name: 'Alice', text: '', deleted: true });
  assert.equal(chat.exchange(bob, members, { after: 2 }).messages.length, 2);
  assert.deepEqual(chat.exchange(eve, members, { after: 2 }).messages, []);
  assert.throws(() => chat.exchange(bob, members, { text: 'Old quote', to: 0, replyTo: original.id }, 2500), { status: 400 });
});

test('chat uses the authenticated sender color, not a submitted color', () => {
  const alice = {
    id: 0,
    name: 'Alice',
    token: 'alice-session',
    color: '#a4198b'
  };

  const members = new Map([[alice.id, alice]]);
  const chat = new RoomChat();

  const response = chat.exchange(alice, members, {
    text: 'Hello!',
    color: '#000000'
  }, 1000);

  assert.equal(response.messages[0].color, alice.color);
});

test('reply colors come from the original message, survive color changes, and cannot be forged', () => {
  const members = roster(), chat = new RoomChat();
  const alice = members.get(0), bob = members.get(1);
  alice.color = '#a4198b';
  bob.color = '#3c75d8';
  const original = chat.exchange(alice, members, { text: 'Original question', to: bob.id }, 1000).messages[0];
  alice.color = '#3b6329';
  const answer = chat.exchange(bob, members, {
    text: 'Answer', to: alice.id, replyTo: original.id,
    color: '#000000', reply: { name: 'Forged', color: '#000000' }
  }, 1500).messages.at(-1);
  assert.equal(answer.color, bob.color);
  assert.deepEqual(answer.reply, {
    id: original.id, name: 'Alice', text: 'Original question', color: '#a4198b'
  });
  assert.deepEqual(chat.exchange(members.get(2), members, {}).messages, []);
  const removed = chat.exchange(alice, members, { deleteId: original.id, after: answer.id });
  assert.deepEqual(removed.messages[1].reply, { id: original.id, name: 'Alice', text: '', deleted: true });
});

test('changing the vehicle cannot change chat author, roster, or reply colors',()=>{
  const members=roster(),chat=new RoomChat(),alice=members.get(0),bob=members.get(1);
  Object.assign(alice,{color:'#a4198b',chatColor:'#a4198b'});
  Object.assign(bob,{color:'#3c75d8',chatColor:'#3c75d8'});
  const original=chat.exchange(alice,members,{text:'Before'},1000).messages[0];
  alice.color='#3b6329';
  const response=chat.exchange(alice,members,{text:'After',color:alice.color,chatColor:alice.color},1500);
  assert.equal(response.messages.at(-1).color,alice.chatColor);
  assert.equal(response.players.find(player=>player.id===alice.id).color,alice.chatColor);
  assert.equal(chat.exchange(bob,members,{text:'Reply',replyTo:original.id},2000).messages.at(-1).reply.color,alice.chatColor);
});
