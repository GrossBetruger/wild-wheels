const AGENT_URL='http://127.0.0.1:4040/api/tunnels';

export function tunnelOrigin(tunnels,port){
  if(!Array.isArray(tunnels))return null;
  for(const tunnel of tunnels){
    const address=tunnel?.config?.addr??tunnel?.forwards_to;
    if(typeof address!=='string'||typeof tunnel?.public_url!=='string')continue;
    let upstream,publicUrl;
    try{
      upstream=new URL(address.includes('://')?address:`http://${address}`);
      publicUrl=new URL(tunnel.public_url);
    }catch{continue;}
    if(!['localhost','127.0.0.1','[::1]'].includes(upstream.hostname)||Number(upstream.port)!==port)continue;
    if(publicUrl.protocol!=='https:'||!publicUrl.hostname||publicUrl.username||publicUrl.password||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash)continue;
    return publicUrl.origin;
  }
  return null;
}

export async function ngrokOrigin(port){
  try{
    const response=await fetch(AGENT_URL,{signal:AbortSignal.timeout(500),redirect:'error'});
    if(!response.ok||Number(response.headers.get('content-length')??0)>65536)return null;
    const body=await response.json();
    return tunnelOrigin(body.tunnels,port);
  }catch{return null;}
}
