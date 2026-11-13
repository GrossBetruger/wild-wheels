import {validPhoto} from '../photos/photo-protocol.js';
export class PhotoAlbum{
  epoch=null;photos=[];rates=new Map();startAt=null;
  ensure(epoch){if(this.epoch===epoch)return;this.epoch=epoch;this.photos=[];this.rates.clear();this.startAt=null;}
  add(bytes,{id,name},elapsed){
    if(!validPhoto(bytes))throw Object.assign(new Error('Invalid camera image.'),{status:400});
    const second=Math.floor(elapsed);let rate=this.rates.get(id);if(!rate||second!==rate.second){rate={second,count:0};this.rates.set(id,rate);}
    if(rate.count>=2)throw Object.assign(new Error('The camera is recharging. Try again.'),{status:429});rate.count++;
    const photo={id:this.photos.length,owner:id,name,elapsed,bytes};this.photos.push(photo);return photo.id;
  }
  manifest(ready,now=Date.now()){
    if(ready&&this.startAt===null)this.startAt=now;
    return {epoch:this.epoch,ready,startAt:this.startAt,serverTime:now,photos:ready?this.photos.map(({id,owner,name,elapsed})=>({id,owner,name,elapsed,url:`/api/photos/${this.epoch}/${id}`})):[]};
  }
}
