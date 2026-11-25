import {isIP} from 'node:net';

const denied=message=>Object.assign(new Error(message),{status:403});
export function localHost(host){
  try{
    const name=new URL(`http://${host}`).hostname.replace(/^\[|\]$/g,'');
    return name==='localhost'||name==='::1'||isIP(name)===4&&(/^(127\.|10\.|192\.168\.)/.test(name)||/^172\.(1[6-9]|2\d|3[01])\./.test(name));
  }catch{return false;}
}
function trustedProxyPeer(peer){
  if(!peer)return false;
  const ip=peer.startsWith('::ffff:')?peer.slice(7):peer;
  if(ip==='127.0.0.1'||ip==='::1')return true;
  if(isIP(ip)!==4)return false;
  // Private VPC subnets + Google Cloud Load Balancer GFE ranges (35.191.0.0/16, 130.211.0.0/22).
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|35\.191\.|130\.211\.[0-3]\.)/.test(ip);
}
export class RequestSecurity {
  constructor({publicOrigin=process.env.PUBLIC_ORIGIN,trustProxy=process.env.TRUST_PROXY==='1'}={}){
    this.trustProxy=trustProxy;
    if(publicOrigin){
      const url=new URL(publicOrigin);
      if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, a path, query or fragment.');
      this.publicOrigin=url.origin;
    }
  }
  secure(req){
    const peer=req.socket.remoteAddress;
    const loopback=peer==='127.0.0.1'||peer==='::1'||peer==='::ffff:127.0.0.1';
    const forwarded=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https';
    return Boolean(req.socket.encrypted||forwarded&&(this.trustProxy&&trustedProxyPeer(peer)||this.tunnelOrigin&&req.headers.host===new URL(this.tunnelOrigin).host&&loopback));
  }
  origin(req){
    const host=req.headers.host;
    if(!host||!/^[a-zA-Z0-9.\[\]:-]+$/.test(host))throw denied('Invalid host.');
    const origin=`${this.secure(req)?'https':'http'}://${host}`;
    if(this.publicOrigin){if(origin!==this.publicOrigin)throw denied('Use the configured game origin.');}
    return new URL(origin).origin;
  }
  check(req,{websocket=false}={}){
    const expected=this.origin(req),origin=req.headers.origin,site=req.headers['sec-fetch-site'];
    if(site==='cross-site'||site==='same-site')throw denied('Use the game from the same origin.');
    if(origin!==undefined){if(origin!==expected)throw denied('Use the game from the same origin.');}
    else if(websocket||req.method&&req.method!=='GET'&&req.method!=='HEAD'&&req.headers.cookie&&site!=='same-origin'||!req.method&&req.headers.cookie&&site!=='same-origin')throw denied('An origin or same-origin browser metadata is required.');
    // Headerless, cookieless API clients cannot impersonate a browser session.
    return expected;
  }
}
