import test from 'node:test';
import assert from 'node:assert/strict';
import { tunnelOrigin } from '../../server/ngrok.js';
import { invitationUrl } from '../../networking/network.js';

test('a host on localhost gets an HTTPS invitation for the game tunnel',()=>{
  const tunnels=[
    {config:{addr:'http://localhost:8080'},public_url:'https://other.ngrok.app'},
    {config:{addr:'http://localhost:5173'},public_url:'https://wild-wheels.ngrok.app'}
  ];
  const publicOrigin=tunnelOrigin(tunnels,5173);
  assert.equal(invitationUrl('http://localhost:5173/', '07',{publicOrigin,lan:'http://192.168.1.8:5173'}),'https://wild-wheels.ngrok.app/?room=07');
});

test('a host without a matching tunnel still gets a LAN invitation',()=>{
  const tunnels=[{config:{addr:'http://localhost:8080'},public_url:'https://other.ngrok.app'}];
  const publicOrigin=tunnelOrigin(tunnels,5173);
  assert.equal(invitationUrl('http://localhost:5173/', '07',{publicOrigin,lan:'http://192.168.1.8:5173'}),'http://192.168.1.8:5173/?room=07');
});

test('a friend opening the public link keeps that address when sharing the room',()=>{
  assert.equal(invitationUrl('https://wild-wheels.ngrok.app/?room=07','07',{lan:'http://192.168.1.8:5173'}),'https://wild-wheels.ngrok.app/?room=07');
});

test('non-HTTPS and unrelated tunnel addresses are ignored',()=>{
  const tunnels=[
    {config:{addr:'http://localhost:5173'},public_url:'http://insecure.ngrok.app'},
    {config:{addr:'http://other-computer:5173'},public_url:'https://other.ngrok.app'},
    {config:{addr:'http://localhost:5173'},public_url:'https://invalid@bad.ngrok.app'}
  ];
  assert.equal(tunnelOrigin(tunnels,5173),null);
});
