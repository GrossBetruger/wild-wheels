import assert from 'node:assert/strict';
import test from 'node:test';
import { MobileBevyQuality, versionAssetUrl } from '../../client/bevy-presentation.js';
import { usesBevyRenderer } from '../../client/build-refresh.js';

test('home and existing arena invitations use Bevy unless the player selects classic graphics', () => {
  assert.equal(usesBevyRenderer('/', '?room=07'), true);
  assert.equal(usesBevyRenderer('/experimental/', '?solo=1'), true);
  assert.equal(usesBevyRenderer('/', '?room=07&renderer=classic'), false);
});

test('a phone that misses the frame budget drops resolution, then caps rendering at 20 FPS', () => {
  const quality = new MobileBevyQuality();
  quality.measure(0, 0);
  quality.measure(1000, 18);
  assert.equal(quality.profile.name, 'Balanced');
  quality.measure(2000, 37);
  assert.equal(quality.profile.name, 'Low');
  quality.measure(3000, 55);
  quality.measure(4000, 74);
  assert.equal(quality.profile.name, 'Minimum');
  assert.equal(quality.profile.fps, 20);
});

test('a phone raises quality after sustained smooth rendering and ignores time spent offscreen', () => {
  const quality = new MobileBevyQuality();
  quality.measure(0, 0);
  quality.measure(1000, 20);
  quality.reset();
  quality.measure(30000, 20);
  quality.measure(31000, 50);
  assert.equal(quality.profile.name, 'Balanced');
  for (let second = 2; second <= 10; second++) quality.measure(30000 + second * 1000, 20 + second * 30);
  assert.equal(quality.profile.name, 'High');
});

test('Retina and landscape views stay within the same mobile pixel budget', () => {
  const quality = new MobileBevyQuality();
  const phoneScale = quality.scale(390, 380, 3);
  assert.equal(Math.round(390 * phoneScale * 3), 234);
  assert.equal(Math.round(380 * phoneScale * 3), 228);
  const landscapeScale = quality.scale(844, 390, 3);
  assert.equal(Math.round(844 * 390 * (landscapeScale * 3) ** 2), 80000);
});

test('versionAssetUrl appends ?v=<build> only to unversioned Bevy asset paths', () => {
  assert.equal(versionAssetUrl('assets/models/knowitowl.glb', 'ABC123'), '/experimental/assets/models/knowitowl.glb?v=ABC123');
  assert.equal(versionAssetUrl('/experimental/assets/models/knowitowl.glb', 'ABC123'), '/experimental/assets/models/knowitowl.glb?v=ABC123');
  assert.equal(versionAssetUrl('assets/models/knowitowl.glb?v=OLD', 'ABC123'), '/experimental/assets/models/knowitowl.glb?v=OLD');
  assert.equal(versionAssetUrl('/api/session', 'ABC123'), '/api/session');
  assert.equal(versionAssetUrl('assets/models/knowitowl.glb', ''), '/experimental/assets/models/knowitowl.glb');
});
