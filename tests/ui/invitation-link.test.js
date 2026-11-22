import assert from 'node:assert/strict';
import test from 'node:test';
import { invitationUrl } from '../../networking/network.js';

test('localhost invitations use the dedicated server LAN address and port', () => {
  const lan = 'http://192.168.1.25:5174';
  for (const page of ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://[::1]:5174']) {
    assert.equal(invitationUrl(page, '00', {lan}), 'http://192.168.1.25:5174/?room=00');
  }
});

test('an invitation opened at a public hostname keeps that hostname', () => {
  assert.equal(
    invitationUrl('https://127.example.com/', '00', {lan: 'http://192.168.1.25:5174'}),
    'https://127.example.com/?room=00',
  );
});
