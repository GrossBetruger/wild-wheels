const ink='#293a42',shell='#b6634e',pink='#f2b7a0';
function link(m,a,b,r,color){for(let i=0;i<=8;i++)m.ball(...a.map((v,j)=>v+(b[j]-v)*i/8),r,r,r,color,6,4);}
function digit(m,n,x,y,z,size,color){
  const segments=[[0,1,.7,.1],[.36,.75,.1,.45],[.36,.25,.1,.45],[0,0,.7,.1],[-.36,.25,.1,.45],[-.36,.75,.1,.45],[0,.5,.7,.1]];
  for(const k of [[0,1,2,3,4,5],[1,2],[0,1,6,4,3],[0,1,6,2,3],[5,6,1,2],[0,5,6,2,3],[0,5,6,4,2,3],[0,1,2],[0,1,2,3,4,5,6],[0,1,2,3,5,6]][n]){const [dx,dz,w,d]=segments[k];m.box(x+dx*size,y,z+dz*size,w*size,.025,d*size,color);}
}
export function drawCalculator(m,color){
  for(const x of [-1.6,1.6])for(const z of [-1.6,1.6]){m.ball(x,.6,z,.48,.6,.65,ink,10,6);m.ball(x+Math.sign(x)*.4,.6,z,.08,.29,.29,'#dce6d6',8,5);}
  m.box(0,.45,0,3.15,.7,4.9,color);m.box(0,1.15,0,2.95,.12,4.7,'#f1e4cc');
  m.box(0,1.28,-1.75,2.5,.08,.75,ink);m.box(0,1.37,-1.75,2.25,.025,.57,'#a6d9a0');
  for(let i=0;i<5;i++)digit(m,[3,1,4,1,5][i],-.82+i*.4,1.4,-1.97,.33,'#315947');
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){const x=(col-1)*.82,z=.4+row*.63;m.box(x,1.28,z,.65,.16,.5,ink);digit(m,9-row*3-col,x,1.46,z-.15,.3,'#fff1ce');}
  m.box(1.25,1.3,1.1,.25,.15,1.7,'#ef9c64');
  for(const x of [-1.12,1.12]){m.ball(x,.95,2.48,.24,.15,.06,'#fff6b8',8,4);m.ball(x,.8,-2.48,.18,.1,.06,'#f86b67',8,4);}
}
export function drawAnt(m,phase,wave){
  const twitch=Math.sin(phase*Math.PI/4),headX=twitch*.045;
  m.ball(0,1.85,-.95,.65,.5,.85,shell,12,7);m.ball(0,2.35,-.25,.35,.6,.4,shell,12,7);
  // Six limbs: two driving, two checking the figures, two feet beside the calculator.
  for(const side of [-1,1]){
    if(!(wave&&side===1)){link(m,[side*.2,2.6,-.1],[side*.7,2.15,.4],.1,shell);link(m,[side*.7,2.15,.4],[side*.45,1.7,.7],.1,pink);}
    link(m,[side*.25,2.2,-.4],[side*.9,1.8,-.1],.1,shell);link(m,[side*.9,1.8,-.1],[side*1.15,1.5,.5],.1,pink);
    link(m,[side*.35,1.9,-.9],[side*.95,1.55,-1.1],.12,shell);m.ball(side*1.1,1.5,-.9,.24,.12,.3,ink,8,5);
    if(wave&&side===1){link(m,[.25,2.6,-.1],[.95,3.6+twitch*.12,0],.13,shell);m.ball(.95,3.65+twitch*.12,0,.17,.2,.15,pink,8,5);}
  }
  m.ball(headX,3.15,.05,.85,.76,.7,shell,16,9);
  for(const side of [-1,1]){
    m.ball(headX+side*.34,3.25,.65,.31,.36,.12,'#fff9df',12,6);m.ball(headX+side*.31,3.28,.76,.13,.18,.07,ink,10,6);m.ball(headX+side*.27,3.36,.82,.055,.065,.025,'#ffffff',8,4);
    for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;link(m,[headX+side*.34+Math.cos(a)*.34,3.25+Math.sin(a)*.39,.78],[headX+side*.34+Math.cos(b)*.34,3.25+Math.sin(b)*.39,.78],.025,'#bfa365');}
    m.ball(side*.58,2.97,.63,.18,.09,.06,pink,8,4);
    link(m,[side*.34,3.72,0],[side*(.6+twitch*.07),4.25,-.03],.065,shell);link(m,[side*(.6+twitch*.07),4.25,-.03],[side*(.88+twitch*.1),4.4,.24],.065,shell);m.ball(side*(.88+twitch*.1),4.4,.24,.12,.12,.12,pink,8,4);
    link(m,[side*.12,3.76,.6],[side*.5,3.65,.64],.045,ink);
  }
  m.box(0,3.26,.79,.13,.035,.04,'#bfa365');m.ball(0,2.82,.67,.12,.08,.03,ink,8,4);
}
export function drawTaxAudit(m,e,angle){
  const t=e.age,fade=Math.min(1,(e.life-t)*2),height=7+Math.sin(Math.min(1,t*4)*Math.PI)*1.1;
  m.at(e.wx,height,e.wz,angle);
  m.box(0,-1.6,0,3,3.8,.09,'#fff4d4');m.box(0,1.65,.08,2.7,.12,.04,'#355e54');
  // Clearly lettered TAX form, itemized rows and a red assessment stamp.
  const letters={T:['111','010','010','010','010'],A:['010','101','111','101','101'],X:['101','101','010','101','101']};
  for(const [i,c]of [...'TAX'].entries())for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(letters[c][y][x]==='1')m.box(-1+i*.78+x*.18,1.4-y*.18,.1,.16,.16,.04,ink);
  for(let i=0;i<5;i++){m.box(-.25,.1-i*.28,.1,1.8,.045,.025,'#8c9c8a');m.box(1,.1-i*.28,.1,.3,.08,.025,'#355e54');}
  const stamp=Math.max(0,1-t*4);m.box(0,-1.25,.2+stamp*3,2.5,.18,.12,'#d83e4b');m.box(0,-.75,.2+stamp*3,2.5,.18,.12,'#d83e4b');
  for(let i=0;i<12;i++){const a=i*2.399+t*2,r=1.6+t*.9;m.box(Math.cos(a)*r,Math.sin(a)*r,.2,.25*fade,.4*fade,.03,'#e3bd61');}
}
const glyphs=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001010010010','111101111101111','111101111001111','000010111010000','000000111000000','000111000111000','010000111000010','111101101101101','111100010100111'];
export function drawMathDust(m,p,angle,clock,jump){
  m.at(p.x,(jump?.height??0)+.8,p.z,angle);m.pitch=jump?.pitch??0;
  for(let i=0;i<36;i++){
    const t=(clock*1.2+i/36)%1,spread=.25+t*2.6,x=Math.sin(i*12.9)*spread,y=t*2.4+Math.cos(i*3.7)*t*.5,z=-2.6-t*9,size=.1+(1-t)*.08,pattern=glyphs[i%glyphs.length],color=i%3?'#b6efb5':'#ffe18c';
    for(let row=0;row<5;row++)for(let col=0;col<3;col++)if(pattern[row*3+col]==='1')m.box(x+(col-1)*size,y+(4-row)*size,z,size*.82,size*.82,.025,color);
  }
}
