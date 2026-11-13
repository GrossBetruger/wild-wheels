import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationMessages} from '../../ui/chat.js';

const messages=[
  {id:1,from:0,to:null,text:'Hello room'},
  {id:2,from:0,to:1,text:'Hello Bob'},
  {id:3,from:1,to:0,text:'Reply from Bob'},
  {id:4,from:2,to:0,text:'Hello from Eve'},
  {id:5,from:0,to:2,text:'Reply to Eve'},
];
test('Everyone conversation excludes every private message',()=>{
  assert.deepEqual(conversationMessages(messages,0,'').map(message=>message.id),[1]);
});
test('private conversations include both directions and exclude other conversations',()=>{
  assert.deepEqual(conversationMessages(messages,0,'1').map(message=>message.id),[2,3]);
  assert.deepEqual(conversationMessages(messages,0,'2').map(message=>message.id),[4,5]);
  assert.deepEqual(conversationMessages(messages,1,'0').map(message=>message.id),[2,3]);
});
test('empty and unrelated private conversations do not fall back to public history',()=>{
  assert.deepEqual(conversationMessages(messages,0,'5'),[]);
  assert.deepEqual(conversationMessages(messages,2,'1'),[]);
  assert.deepEqual(conversationMessages([],0,''),[]);
});

test('notification routing identifies Everyone and the other private participant',async()=>{
  const {messageConversation}=await import('../../ui/chat.js');
  assert.equal(messageConversation({from:1,to:null},0),'');
  assert.equal(messageConversation({from:1,to:0},0),'1');
  assert.equal(messageConversation({from:0,to:2},0),'2');
});

test('switching conversations preserves independent drafts and clears only the selected unread count',async()=>{
  const {GameChat}=await import('../../ui/chat.js');
  const chat={conversation:'',input:{value:'Group draft'},recipient:{options:[{value:''},{value:'1'},{value:'2'}],value:''},drafts:new Map([['1','Private draft']]),unread:new Map([['1',new Set([10])],['2',new Set([11,12])]]),notice:{classList:{add(){}}},updateBadges(){},render(){},updateControls(){}};
  GameChat.prototype.switchConversation.call(chat,'1');
  assert.equal(chat.input.value,'Private draft');assert.equal(chat.recipient.value,'1');assert.equal(chat.drafts.get(''),'Group draft');assert.equal(chat.unread.has('1'),false);assert.equal(chat.unread.get('2').size,2);
  chat.input.value='Edited private draft';GameChat.prototype.switchConversation.call(chat,'');
  assert.equal(chat.input.value,'Group draft');assert.equal(chat.drafts.get('1'),'Edited private draft');
  GameChat.prototype.switchConversation.call(chat,'1');assert.equal(chat.input.value,'Edited private draft');
  GameChat.prototype.switchConversation.call(chat,'invalid');assert.equal(chat.conversation,'1');
});

test('background polling leaves the send button enabled; actual sends disable it',async()=>{
  const {GameChat}=await import('../../ui/chat.js');
  const chat={network:{token:'session'},tabs:{querySelectorAll:()=>[]},log:{querySelectorAll:()=>[]},input:{},recipient:{selectedOptions:[{}]},send:{},busy:true,sending:false};
  GameChat.prototype.updateControls.call(chat);assert.equal(chat.send.disabled,false);
  chat.sending=true;GameChat.prototype.updateControls.call(chat);assert.equal(chat.send.disabled,true);
  chat.network.token=null;chat.sending=false;GameChat.prototype.updateControls.call(chat);assert.equal(chat.send.disabled,true);
});

test('sending during a poll preserves the clicked conversation and prevents duplicate submits',async()=>{
  const {GameChat}=await import('../../ui/chat.js');
  let finishPoll;const calls=[];
  const chat={scope:'room-a',input:{value:'Hello Bob'},conversation:'1',replies:new Map(),sending:false,inFlight:new Promise(resolve=>{finishPoll=resolve;}),updateControls(){},roomScope:()=> 'room-a',async exchange(...args){calls.push(args);}};
  const pending=GameChat.prototype.sendMessage.call(chat);
  await GameChat.prototype.sendMessage.call(chat);assert.equal(calls.length,0);
  chat.conversation='2';chat.input.value='Draft for Eve';finishPoll();await pending;
  assert.equal(calls.length,1);assert.equal(calls[0][2].to,'1');assert.equal(calls[0][2].text,'Hello Bob');assert.equal(chat.input.value,'Draft for Eve');assert.equal(chat.sending,false);
});
