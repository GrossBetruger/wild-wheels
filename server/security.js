import {isIP} from 'node:net';

const denied=message=>Object.assign(new Error(message),{status:403});
export function localHost(host){
  try{
    const name=new URL(`http://${host}`).hostname.replace(/^\[|\]$/g,'');
    return name==='localhost'||name==='::1'||isIP(name)===4&&(/^(127\.|10\.|192\.168\.)/.test(name)||/^172\.(1[6-9]|2\d|3[01])\./.test(name));
  }catch{return false;}
}
export class RequestSecurity {
  constructor({publicOrigin=process.env.PUBLIC_ORIGIN,trustProxy=process.env.TRUST_PROXY==='1'}={}){
    this.trustProxy=trustProxy;
    if(publicOrigin){
      const url=new URL(publicOrigin);
      if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!['http:','https:'].includes(url.protocol)||url.protocol!=='https:'&&!localHost(url.host))throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (HTTP is allowed for local development).');
      this.publicOrigin=url.origin;
    }
  }
  secure(req){
    const peer=req.socket.remoteAddress;
    const loopback=peer==='127.0.0.1'||peer==='::1'||peer==='::ffff:127.0.0.1';
    return Boolean(req.socket.encrypted||(this.trustProxy||this.tunnelOrigin&&req.headers.host===new URL(this.tunnelOrigin).host)&&loopback&&req.headers['x-forwarded-proto']==='https');
  }
  origin(req){
    const host=req.headers.host;
    if(!host||!/^[a-zA-Z0-9.\[\]:-]+$/.test(host))throw denied('Invalid host.');
    const origin=`${this.secure(req)?'https':'http'}://${host}`;
    if(this.publicOrigin){if(origin!==this.publicOrigin)throw denied('Use the configured game origin.');}
    else if(origin!==this.tunnelOrigin&&!localHost(host))throw denied('Configure PUBLIC_ORIGIN before public hosting.');
    if(!this.secure(req)&&!localHost(host))throw denied('HTTPS is required.');
    return new URL(origin).origin;
  }
  check(req,{websocket=false}={}){
    const expected=this.origin(req),origin=req.headers.origin,site=req.headers['sec-fetch-site'];
    if(site==='cross-site'||site==='same-site')throw denied('Use the game from the same origin.');
    if(origin!==undefined){if(origin!==expected)throw denied('Use the game from the same origin.');}
    else if(websocket||req.headers.cookie&&site!=='same-origin')throw denied('An origin or same-origin browser metadata is required.');
    // Headerless, cookieless API clients cannot impersonate a browser session.
    return expected;
  }
}
