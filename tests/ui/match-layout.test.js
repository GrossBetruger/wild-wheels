import test from 'node:test';
import assert from 'node:assert/strict';
import {MatchLayout,usesMatchLayout} from '../../ui/match-layout.js';

test('live layout applies during countdown, play and pause, and restores after the match',()=>{
  for(const phase of ['countdown','racing','paused'])assert.equal(usesMatchLayout(phase),true);
  for(const phase of ['ready','finished'])assert.equal(usesMatchLayout(phase),false);
});

test('moving chat and the live map preserves their nodes and restores their original positions',t=>{
  class Node {
    children=[];parent=null;classes=new Set();
    classList={toggle:(name,enabled)=>{if(enabled)this.classes.add(name);else this.classes.delete(name);}};
    setAttribute(){}
    detach(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
    append(child){child.detach();child.parent=this;this.children.push(child);}
    prepend(child){child.detach();child.parent=this;this.children.unshift(child);}
    before(child){child.detach();child.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),0,child);}
    after(child){child.detach();child.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this)+1,0,child);}
  }
  const original=globalThis.document;
  globalThis.document={createComment:()=>new Node(),createElement:()=>new Node()};
  t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  const layout=new Node(),column=new Node(),sidebar=new Node(),viewport=new Node(),game=new Node(),chat=new Node(),playground=new Node(),map=new Node(),driver=new Node();
  layout.append(column);layout.append(sidebar);column.append(game);column.append(chat);sidebar.append(driver);sidebar.append(playground);playground.append(map);
  const controller=new MatchLayout({layout,sidebar,chat,map,playground,viewport});
  controller.update('ready','combat');assert.equal(chat.parent,column);assert.equal(map.parent,playground);
  controller.update('countdown','combat');assert.equal(chat.parent,sidebar);assert.equal(sidebar.children[0],chat);assert.equal(map.parent,controller.minimap);assert.equal(playground.classes.has('hidden'),true);
  const children=[...sidebar.children];controller.update('racing','combat');assert.deepEqual(sidebar.children,children);
  controller.update('paused','combat');assert.equal(map.parent,controller.minimap);
  controller.update('finished','combat');assert.equal(chat.parent,column);assert.equal(map.parent,playground);assert.equal(playground.classes.has('hidden'),false);assert.equal(layout.classes.has('match-layout'),false);
  controller.update('racing','race');assert.equal(controller.minimap.classes.has('combat-minimap'),false);assert.equal(map.parent,controller.minimap);
});
