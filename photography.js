import {PHOTO_BYTES,photoIndex} from './photo-protocol.js';
export function snapshotCanvas(canvas){
  const image=document.createElement('canvas'),scale=Math.min(800/canvas.width,500/canvas.height,1);image.width=Math.max(1,Math.round(canvas.width*scale));image.height=Math.max(1,Math.round(canvas.height*scale));image.getContext('2d').drawImage(canvas,0,0,image.width,image.height);return image;
}
export async function cameraJpeg(image){
  for(const quality of [.75,.55,.4,.3]){const blob=await new Promise(resolve=>image.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=PHOTO_BYTES)return blob;}
  if(image.width<=160&&image.height<=100)throw new Error('Camera encoding unavailable');
  const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(image.width*.65));smaller.height=Math.max(1,Math.round(image.height*.65));smaller.getContext('2d').drawImage(image,0,0,smaller.width,smaller.height);return cameraJpeg(smaller);
}
const dataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
export class BomberPhotography{
  identity=null;local=[];photos=[];requested=false;busy=false;cooldown=0;count=0;closed=false;visible=false;pollAt=0;polling=false;offset=null;lastSlide=null;serverOffset=0;anchor=0;
  constructor({canvas,viewport,network,sound,unlock}){
    Object.assign(this,{canvas,viewport,network,sound,unlock});
    this.button=document.createElement('button');this.button.type='button';this.button.id='take-photo';this.button.className='photo-button hidden';this.button.textContent='📸 PHOTO ∞';this.button.onclick=()=>this.request();this.button.title='Take a photograph · unlimited shots';
    this.status=document.createElement('span');this.status.className='photo-status';this.status.setAttribute('role','status');
    this.flash=document.createElement('div');this.flash.className='camera-flash';this.flash.setAttribute('aria-hidden','true');
    this.gallery=document.createElement('section');this.gallery.id='photo-slideshow';this.gallery.className='photo-slideshow hidden';this.gallery.setAttribute('aria-label','Match photographs');
    const title=document.createElement('strong');title.textContent='📸 THE BOMBER’S CUT';
    this.image=document.createElement('img');this.image.alt='Arena photograph';this.image.draggable=false;
    this.caption=document.createElement('p');this.caption.setAttribute('aria-live','polite');
    const controls=document.createElement('div');controls.className='photo-slideshow-controls';
    const button=(label,action)=>{const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=action;return node;};
    this.previous=button('← PREVIOUS',()=>this.advance(-1));this.next=button('NEXT →',()=>this.advance(1));
    const close=button('✕ CLOSE',()=>{this.closed=true;this.gallery.classList.add('hidden');});close.setAttribute('aria-label','Close photographs and see results');
    controls.append(this.previous,this.next,close);this.gallery.append(title,this.image,this.caption,controls);this.gallery.addEventListener('keydown',event=>event.stopPropagation());
    this.reopen=button('📸 PHOTOS',()=>{this.closed=false;this.lastSlide=null;});this.reopen.className='photo-reopen hidden';
    viewport.append(this.button,this.status,this.flash,this.gallery,this.reopen);
  }
  request(){
    if(!this.world?.bomber||this.world.phase!=='racing'||this.busy||performance.now()<this.cooldown)return;
    this.unlock().catch(()=>{});this.requested=true;this.busy=true;this.button.disabled=true;
  }
  update(world){
    const restarted=this.elapsed!==undefined&&world.elapsed<this.elapsed;this.elapsed=world.elapsed;this.world=world;const identity=[world.mode,world.arena,world.soundEpoch??0].join(':');
    if(identity!==this.identity||restarted){this.identity=identity;this.local=[];this.photos=[];this.count=0;this.closed=false;this.lastSlide=null;this.offset=null;this.pollAt=0;this.anchor=0;this.serverOffset=0;this.gallery.classList.add('hidden');this.status.textContent='';this.requested=false;}
    this.button.classList.toggle('hidden',!world.bomber||world.mode!=='combat');this.button.disabled=this.busy||world.phase!=='racing'||performance.now()<this.cooldown;
    this.button.textContent=this.busy?'📸 SAVING…':`📸 PHOTO ∞${this.count?` · ${this.count}`:''}`;
    const finished=world.mode==='combat'&&world.phase==='finished';
    if(!finished){this.gallery.classList.add('hidden');this.reopen.classList.add('hidden');return;}
    if(this.network.active&&performance.now()>=this.pollAt&&!this.polling)this.loadAlbum();
    if(!this.network.active){this.photos=this.local;this.anchor||=performance.now();}
    this.reopen.classList.toggle('hidden',!this.photos.length);this.gallery.classList.toggle('hidden',!this.photos.length||this.closed);
    if(this.photos.length&&!this.closed)this.slide();
  }
  async afterDraw(){
    if(!this.requested)return;this.requested=false;const identity=this.identity,epoch=this.world.soundEpoch??0,name=this.world.name??'Bomber',elapsed=this.world.elapsed;
    try{
      const image=snapshotCanvas(this.canvas);this.sound('cameraShutter');this.flash.animate([{opacity:.65},{opacity:0}],{duration:180});
      const blob=await cameraJpeg(image);
      if(this.network.active){const response=await fetch('/api/photos',{method:'POST',headers:{'content-type':'image/jpeg',authorization:`Bearer ${this.network.token}`,'x-wild-wheels-epoch':String(epoch)},body:blob,signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Upload failed');}
      else this.local.push({id:this.local.length,name,elapsed,url:await dataUrl(blob)});
      if(identity===this.identity){this.count++;this.status.textContent=`${this.count} PHOTO${this.count===1?'':'S'} SAVED`;}
    }catch{if(identity===this.identity)this.status.textContent='Photo could not be saved. Try again.';}
    finally{this.busy=false;this.cooldown=performance.now()+600;}
  }
  async loadAlbum(){
    const identity=this.identity,started=performance.now();this.polling=true;this.pollAt=started+2000;
    try{const response=await fetch('/api/photos',{headers:{authorization:`Bearer ${this.network.token}`},signal:AbortSignal.timeout(3000)});if(!response.ok)return;const album=await response.json();if(identity!==this.identity||album.epoch!==this.world.soundEpoch||!album.ready)return;
      this.photos=album.photos;this.serverOffset=Math.max(0,album.serverTime-album.startAt)+(performance.now()-started)/2;this.anchor=performance.now();
    }catch{}finally{this.polling=false;}
  }
  slide(){
    const index=this.offset===null?photoIndex(this.serverOffset+performance.now()-this.anchor,this.photos.length):((this.offset%this.photos.length)+this.photos.length)%this.photos.length;
    const photo=this.photos[index],key=`${this.identity}:${photo.id}`;if(key===this.lastSlide)return;this.lastSlide=key;
    this.image.src=photo.url;const seconds=Math.max(0,Math.floor(photo.elapsed));this.image.alt=`Photograph by ${photo.name} at ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;this.caption.textContent=`${index+1} / ${this.photos.length} · ${this.image.alt}`;
    this.image.animate([{opacity:0,transform:'translateX(18px) rotate(-2deg)'},{opacity:1,transform:'translateX(0) rotate(-1deg)'}],{duration:450,easing:'ease-out'});this.sound('photoSlide');
  }
  advance(direction){if(!this.photos.length)return;const current=this.offset??photoIndex(this.serverOffset+performance.now()-this.anchor,this.photos.length);this.offset=current+direction;this.lastSlide=null;}
}
