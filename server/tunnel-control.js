import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export function createTunnelControl(gamePort,{launch=spawn}={}){
  let child=null,state='idle';
  const allowedOrigins=new Set([`http://localhost:${gamePort}`,`http://127.0.0.1:${gamePort}`]);
  const server=createServer((req,res)=>{
    const controlHost=`127.0.0.1:${server.address()?.port}`;
    if(req.headers.host!==controlHost||!allowedOrigins.has(req.headers.origin)){
      res.writeHead(403);res.end();return;
    }
    const headers={'Access-Control-Allow-Origin':req.headers.origin,'Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
    if(req.method==='OPTIONS'){
      res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'POST, GET','Access-Control-Allow-Private-Network':'true'});res.end();return;
    }
    if(req.url==='/status'&&req.method==='GET'){
      res.writeHead(200,headers);res.end(JSON.stringify({state}));return;
    }
    if(req.url!=='/start'||req.method!=='POST'){
      res.writeHead(404,headers);res.end(JSON.stringify({error:'Not found.'}));return;
    }
    if(child){res.writeHead(202,headers);res.end(JSON.stringify({state}));return;}
    try{
      child=launch('ngrok',['http',String(gamePort),'--log=stdout','--log-format=json'],{stdio:'ignore'});
      state='starting';
      const current=child;
      current.once('spawn',()=>{if(child===current)state='running';});
      current.once('error',()=>{if(child===current){child=null;state='failed';}});
      current.once('exit',()=>{if(child===current){child=null;state='failed';}});
      res.writeHead(202,headers);res.end(JSON.stringify({state}));
    }catch{child=null;state='failed';res.writeHead(503,headers);res.end(JSON.stringify({error:'Could not start ngrok.'}));}
  });
  const stop=()=>{child?.kill();child=null;};
  const close=()=>{stop();server.close();};
  return {server,stop,close};
}
