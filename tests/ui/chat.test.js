import test from 'node:test';
import assert from 'node:assert/strict';
import { GameChat, conversationMessages } from '../../ui/chat.js';

const messages = [
  { id: 1, from: 0, to: null, text: 'Hello room' },
  { id: 2, from: 0, to: 1, text: 'Hello Bob' },
  { id: 3, from: 1, to: 0, text: 'Reply from Bob' },
  { id: 4, from: 2, to: 0, text: 'Hello from Eve' },
  { id: 5, from: 0, to: 2, text: 'Reply to Eve' },
];
test('Everyone conversation excludes every private message', () => {
  assert.deepEqual(conversationMessages(messages, 0, '').map(message => message.id), [1]);
});
test('private conversations include both directions and exclude other conversations', () => {
  assert.deepEqual(conversationMessages(messages, 0, '1').map(message => message.id), [2, 3]);
  assert.deepEqual(conversationMessages(messages, 0, '2').map(message => message.id), [4, 5]);
  assert.deepEqual(conversationMessages(messages, 1, '0').map(message => message.id), [2, 3]);
});
test('empty and unrelated private conversations do not fall back to public history', () => {
  assert.deepEqual(conversationMessages(messages, 0, '5'), []);
  assert.deepEqual(conversationMessages(messages, 2, '1'), []);
  assert.deepEqual(conversationMessages([], 0, ''), []);
});

test('notification routing identifies Everyone and the other private participant', async () => {
  const { messageConversation } = await import('../../ui/chat.js');
  assert.equal(messageConversation({ from: 1, to: null }, 0), '');
  assert.equal(messageConversation({ from: 1, to: 0 }, 0), '1');
  assert.equal(messageConversation({ from: 0, to: 2 }, 0), '2');
});

test('switching conversations preserves independent drafts and clears only the selected unread count', async () => {
  const { GameChat } = await import('../../ui/chat.js');
  const chat = { conversation: '', input: { value: 'Group draft' }, recipient: { options: [{ value: '' }, { value: '1' }, { value: '2' }], value: '' }, drafts: new Map([['1', 'Private draft']]), unread: new Map([['1', new Set([10])], ['2', new Set([11, 12])]]), notice: { classList: { add() { } } }, updateBadges() { }, render() { }, updateControls() { } };
  GameChat.prototype.switchConversation.call(chat, '1');
  assert.equal(chat.input.value, 'Private draft'); assert.equal(chat.recipient.value, '1'); assert.equal(chat.drafts.get(''), 'Group draft'); assert.equal(chat.unread.has('1'), false); assert.equal(chat.unread.get('2').size, 2);
  chat.input.value = 'Edited private draft'; GameChat.prototype.switchConversation.call(chat, '');
  assert.equal(chat.input.value, 'Group draft'); assert.equal(chat.drafts.get('1'), 'Edited private draft');
  GameChat.prototype.switchConversation.call(chat, '1'); assert.equal(chat.input.value, 'Edited private draft');
  GameChat.prototype.switchConversation.call(chat, 'invalid'); assert.equal(chat.conversation, '1');
});

test('background polling leaves the send button enabled; actual sends disable it', async () => {
  const { GameChat } = await import('../../ui/chat.js');
  const chat = {
    network: { token: 'session' },
    tabs: { querySelectorAll: () => [] },
    log: { querySelectorAll: () => [] },
    input: {},
    recipient: { selectedOptions: [{}] },
    send: {},
    busy: true,
    sending: false,
    emojiButton: { setAttribute() { } },
    emojiPicker: { classList: { add() { } } }
  };
  GameChat.prototype.updateControls.call(chat); assert.equal(chat.send.disabled, false);
  chat.sending = true; GameChat.prototype.updateControls.call(chat); assert.equal(chat.send.disabled, true);
  chat.network.token = null; chat.sending = false; GameChat.prototype.updateControls.call(chat); assert.equal(chat.send.disabled, true);
});

test('sending during a poll preserves the clicked conversation and prevents duplicate submits', async () => {
  const { GameChat } = await import('../../ui/chat.js');
  let finishPoll; const calls = [];
  const chat = { scope: 'room-a', input: { value: 'Hello Bob' }, conversation: '1', replies: new Map(), sending: false, inFlight: new Promise(resolve => { finishPoll = resolve; }), updateControls() { }, roomScope: () => 'room-a', async exchange(...args) { calls.push(args); } };
  const pending = GameChat.prototype.sendMessage.call(chat);
  await GameChat.prototype.sendMessage.call(chat); assert.equal(calls.length, 0);
  chat.conversation = '2'; chat.input.value = 'Draft for Eve'; finishPoll(); await pending;
  assert.equal(calls.length, 1); assert.equal(calls[0][2].to, '1'); assert.equal(calls[0][2].text, 'Hello Bob'); assert.equal(chat.input.value, 'Draft for Eve'); assert.equal(chat.sending, false);
});

test('delete icons stay enabled through background polls and lock only for user actions or disconnection', () => {
  const button = {};
  const chat = {
    network: { token: 'session' },
    tabs: { querySelectorAll: () => [] },
    log: { querySelectorAll: () => [button] },
    input: {},
    recipient: { selectedOptions: [{}] },
    send: {},
    busy: false,
    sending: false,
    deleting: false,
    emojiButton: { setAttribute() { } },
    emojiPicker: { classList: { add() { } } }
  };
  for (const busy of [false, true, false, true, false]) {
    chat.busy = busy; GameChat.prototype.updateControls.call(chat); assert.equal(button.disabled, false);
  }
  chat.deleting = true; GameChat.prototype.updateControls.call(chat);
  assert.equal(button.disabled, true); assert.equal(chat.send.disabled, true);
  chat.deleting = false; chat.sending = true; GameChat.prototype.updateControls.call(chat); assert.equal(button.disabled, true);
  chat.sending = false; chat.network.token = null; GameChat.prototype.updateControls.call(chat); assert.equal(button.disabled, true);
});

function deletingChat(overrides = {}) {
  return Object.assign(Object.create(GameChat.prototype), { deleting: false, sending: false, network: { token: 'session' }, scope: 'room-a', roomScope: () => 'room-a', updateControls() { }, ...overrides });
}

test('clicking delete during a poll queues one deletion and prevents overlapping sends', async () => {
  let finishPoll, finishDelete; const calls = [];
  const chat = deletingChat({ inFlight: new Promise(resolve => finishPoll = resolve), exchange(...args) { calls.push(args); return new Promise(resolve => finishDelete = resolve); } });
  const pending = chat.deleteMessage(12);
  assert.equal(chat.deleting, true); assert.equal(calls.length, 0);
  await chat.deleteMessage(12); await chat.deleteMessage(13); await chat.sendMessage();
  finishPoll(); await Promise.resolve();
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], [false, 12, { scope: 'room-a' }]);
  assert.equal(chat.deleting, true); finishDelete(); await pending; assert.equal(chat.deleting, false);
});

test('a queued delete is discarded when the session or room changes', async () => {
  let finishPoll, calls = 0;
  const chat = deletingChat({ inFlight: new Promise(resolve => finishPoll = resolve), exchange() { calls++; } });
  const pending = chat.deleteMessage(12);
  chat.roomScope = () => 'room-b'; finishPoll(); await pending;
  assert.equal(calls, 0); assert.equal(chat.deleting, false);
});

test('deletion failures release the button for another attempt', async () => {
  let calls = 0;
  const chat = deletingChat({ exchange() { if (++calls === 1) throw new Error('Network failure'); } });
  await assert.rejects(chat.deleteMessage(12), /Network failure/);
  assert.equal(chat.deleting, false); await chat.deleteMessage(12); assert.equal(calls, 2);
});

test('delete clicks do nothing while sending or disconnected', async () => {
  let calls = 0; const chat = deletingChat({ sending: true, exchange() { calls++; } });
  await chat.deleteMessage(12); chat.sending = false; chat.network.token = null; await chat.deleteMessage(12);
  assert.equal(calls, 0); assert.equal(chat.deleting, false);
});

function gameReplyChat(t, fields = {}) {
  for (const [name, value] of Object.entries({ document: { fullscreenElement: null, querySelector: () => null }, matchMedia: () => ({ matches: true }) })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  return Object.assign(Object.create(GameChat.prototype), {
    you: 0, roomScope: () => 'room-a', messages: [], replies: new Map(), recipient: { options: [{ value: '' }, { value: '1' }] }, status: {},
    switchConversation(value) { this.conversation = value; }, removeGameNotice(id) { this.removed = id; },
    panel: { scrollIntoView() { } }, input: { focus() { } }, ...fields
  });
}

for (const to of [null, 0]) test(`game notification reply opens the ${to === null ? 'public' : 'private'} conversation and quotes the latest message`, async t => {
  const message = { id: 12, from: 1, to, name: 'Other', text: 'Original text', color: '#a4198b' };
  const chat = gameReplyChat(t, { messages: [message] });
  await chat.replyFromGameNotice(12, 'room-a');
  const target = to === null ? '' : '1';
  assert.equal(chat.conversation, target); assert.equal(chat.replies.get(target), message); assert.equal(chat.removed, 12);
});

test('a notification from a previous session cannot open a reply in the current room', async () => {
  const chat = Object.assign(Object.create(GameChat.prototype), { roomScope: () => 'room-b' });
  await chat.replyFromGameNotice(12, 'room-a');
  assert.equal(chat.conversation, undefined);
});

test('deleted notification messages cannot be quoted', async t => {
  const chat = gameReplyChat(t, { messages: [{ id: 12, from: 1, to: null, deleted: true }] });
  await chat.replyFromGameNotice(12, 'room-a');
  assert.equal(chat.replies.size, 0); assert.equal(chat.removed, 12);
});

test('a notification cannot misroute a private reply when its recipient has left', async t => {
  const chat = gameReplyChat(t, { messages: [{ id: 12, from: 2, to: 0, text: 'Private' }] });
  await chat.replyFromGameNotice(12, 'room-a');
  assert.equal(chat.replies.size, 0); assert.equal(chat.status.textContent, 'This player has left the room.');
});

for (const {name,conversation,message,existing=[],sending=false,to=conversation,expected} of [
  {name:'new public message in Everyone',conversation:'',message:{id:1,from:1,to:null,text:'Public'},expected:true},
  {name:'new private message in the open conversation',conversation:'1',message:{id:1,from:1,to:0,text:'Private'},expected:true},
  {name:'private message while reading Everyone',conversation:'',message:{id:1,from:1,to:0,text:'Private'},expected:false},
  {name:'message in a different private conversation',conversation:'1',message:{id:1,from:2,to:0,text:'Other private'},expected:false},
  {name:'repeated history without new messages',conversation:'',message:{id:1,from:1,to:null,text:'History'},existing:[{id:1,from:1,to:null,text:'History'}],expected:false},
  {name:'send completed after switching to another conversation',conversation:'1',to:'',sending:true,message:{id:1,from:0,to:null,text:'Public'},expected:false},
]) test(`chat auto-scroll: ${name}`,async()=>{
  const chat=Object.assign(Object.create(GameChat.prototype),{
    scope:'room-a',roomScope:()=> 'room-a',you:0,conversation,
    network:{request:async()=>({you:0,players:[],cursor:1,messages:[message]})},
    input:{value:'Draft'},recipient:{selectedOptions:[{}]},log:{scrollHeight:1000,clientHeight:100,scrollTop:0},
    rosterKey:'[]',renderedRoster:'[]',messages:existing,initialized:true,
    replies:new Map(),unread:new Map(),drafts:new Map(),status:{},
    updateControls(){},updateBadges(){},showGameNotice(){},notify(){},isVisible:()=>true,renderReply(){},
    render(scroll){this.didScroll=scroll;}
  });
  await chat.performExchange(sending,undefined,{scope:'room-a',text:'Public',to});
  assert.equal(chat.status.textContent,'Connected');assert.equal(chat.didScroll,expected);
});
