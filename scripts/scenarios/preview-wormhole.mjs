import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createGameServer } from '../../server.js';

const { server: game } = createGameServer();
const script = await readFile(new URL('./wormhole-preview-client.js', import.meta.url));
const preview = createServer((req, res) => {
  if (req.url === '/preview.js') {
    res.writeHead(200, {'Content-Type':'text/javascript'});
    res.end(script);
    return;
  }
  if (req.url !== '/') return game.emit('request',req,res);
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Avita’s Wormhole</title><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#181726;color:white;font:16px system-ui}main{max-width:1080px;margin:auto;padding:1rem}main>.viewport{aspect-ratio:16/9}canvas{width:100%;aspect-ratio:16/9;display:block}button{color:#181726;margin:.5rem .5rem 0 0;padding:.5rem}</style><main><h1>Avita’s Wormhole</h1><div class="viewport"><canvas aria-label="Wormhole capture replay"></canvas></div><button id="replay">Replay with sound</button><button id="speed">Slow motion</button> <output></output></main><script type="module" src="/preview.js"></script></html>');
});
preview.listen(0,'127.0.0.1',() => {
  const url = 'http://127.0.0.1:'+preview.address().port+'/';
  console.log(url);
  if (process.argv.includes('--open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    spawn(opener,[url],{stdio:'ignore'}).on('error',() => console.log('Open the URL above.'));
  }
});
