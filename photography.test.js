import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoAlbum} from './photo-album.js';
import {photoIndex} from './photo-protocol.js';

test('unlimited bomber photographs are shared only after the match and cleared for the next match',()=>{
  const album=new PhotoAlbum();album.ensure(1);const cameraFrame=Uint8Array.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
  for(let shot=0;shot<100;shot++)album.add(cameraFrame,{id:2,name:'Photographer'},shot,shot*1000);
  assert.equal(album.manifest(false,100000).photos.length,0);
  const finished=album.manifest(true,101000);assert.equal(finished.photos.length,100);assert.deepEqual(finished.photos[0],{id:0,owner:2,name:'Photographer',elapsed:0,url:'/api/photos/1/0'});assert.equal(album.manifest(true,105000).startAt,101000);
  album.ensure(2);assert.equal(album.manifest(true,106000).photos.length,0);
});

test('photos reject non-camera data and oversized dimensions while allowing more shots after a brief burst',()=>{
  const album=new PhotoAlbum();album.ensure(1);const cameraFrame=Uint8Array.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]),person={id:1,name:'Bomber'};
  assert.throws(()=>album.add(new TextEncoder().encode('<script>alert(1)</script>'),person,0,0));
  const oversized=cameraFrame.slice();oversized[9]=255;oversized[10]=255;assert.throws(()=>album.add(oversized,person,0,0));
  album.add(cameraFrame,person,0,0);album.add(cameraFrame,person,0,0);assert.throws(()=>album.add(cameraFrame,person,0,0),{status:429});assert.equal(album.add(cameraFrame,person,1,1000),2);
});

test('all players advance through the shared photo reel on the same four-second schedule',()=>{
  assert.equal(photoIndex(0,3),0);assert.equal(photoIndex(3999,3),0);assert.equal(photoIndex(4000,3),1);assert.equal(photoIndex(8000,3),2);assert.equal(photoIndex(12000,3),0);
});
