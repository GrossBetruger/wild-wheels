import {Renderer} from './renderer.js';
import {drivers} from './engine.js';

export class CharacterPreview{
  clock=0;last=null;nextFrame=0;driver=null;color=null;dirty=true;inView=false;renderer=null;presentation=null;
  constructor(panel){
    this.element=document.createElement('figure');this.element.className='character-preview';
    this.canvas=document.createElement('canvas');this.canvas.id='character-preview';this.canvas.setAttribute('role','img');
    const caption=document.createElement('figcaption');this.label=document.createElement('span');
    this.button=document.createElement('button');this.button.type='button';
    this.paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.button.onclick=()=>{this.paused=!this.paused;this.dirty=true;this.updateButton();};this.updateButton();
    caption.append(this.label,this.button);this.element.append(this.canvas,caption);panel.querySelector('.driver-info').after(this.element);
    this.observer=new IntersectionObserver(entries=>{this.inView=entries[0].isIntersecting;this.last=null;this.dirty=true;});this.observer.observe(this.element);
  }
  updateButton(){this.button.textContent=this.paused?'▶ PLAY':'Ⅱ PAUSE';this.button.setAttribute('aria-label',this.paused?'Play character preview animation':'Pause character preview animation');}
  frame(now,driver,color,phase){
    const available=['ready','finished'].includes(phase);this.element.classList.toggle('hidden',!available);
    if(!available||!this.inView||document.hidden){this.last=null;return;}
    if(this.driver!==driver||this.color!==color){this.driver=driver;this.color=color;this.clock=0;this.dirty=true;this.canvas.setAttribute('aria-label',`Animated 3D preview of ${drivers[driver].name}`);}
    const dt=this.last===null?0:Math.min(.1,(now-this.last)/1000);this.last=now;
    if(!this.paused)this.clock+=dt;
    if(!this.dirty&&(this.paused||now<this.nextFrame))return;
    this.nextFrame=now+1000/30;this.dirty=false;
    if(!this.renderer){this.renderer=new Renderer(this.canvas);this.renderer.setQuality('balanced');}
    this.presentation=this.renderer.drawPreview(driver,color,this.clock);if(this.label.textContent!==this.presentation.label)this.label.textContent=this.presentation.label;
  }
}
