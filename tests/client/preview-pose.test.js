import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPose} from '../../client/preview-pose.js';
test('KnowItOwl preview cycles six gestures including monocle adjustment and X-ray scan',()=>{
  assert.deepEqual([1,5,9,13,17,21].map(t=>previewPose(14,t).id),['hello','cheer','look','rev','monocle','xray']);
  assert.equal(previewPose(14,17).label,'MONOCLE CHECK');assert.equal(previewPose(14,21).label,'X-RAY MONOCLE');
  assert.equal(previewPose(14,17).boost,false);assert.equal(previewPose(14,21).boost,false);assert.equal(previewPose(14,25).id,'hello');
});
test('monocle gestures ease in and out instead of snapping the raised wing into position',()=>{
  assert.equal(previewPose(14,16).monocle,0);assert.equal(previewPose(14,17).monocle,1);assert.ok(previewPose(14,19.9).monocle<.2);
  assert.equal(previewPose(14,20).monocle,0);assert.equal(previewPose(14,21).monocle,1);assert.ok(previewPose(14,23.9).monocle<.2);
});
