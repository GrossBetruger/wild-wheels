export const PHOTO_BYTES=65536;
export const PHOTO_SLIDE_MS=4000;
// Read only bounded JPEG frame metadata; the server never decompresses images.
export function validPhoto(bytes){
  if(bytes.length<12||bytes.length>PHOTO_BYTES||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return false;
  let at=2;
  while(at+4<=bytes.length){
    if(bytes[at++]!==255)return false;while(bytes[at]===255)at++;
    const marker=bytes[at++];if(marker===218||marker===217)return false;
    if(at+2>bytes.length)return false;const length=bytes[at]*256+bytes[at+1];if(length<2||at+length>bytes.length)return false;
    if(marker===192||marker===194){if(length<8||bytes[at+2]!==8)return false;const height=bytes[at+3]*256+bytes[at+4],width=bytes[at+5]*256+bytes[at+6];return width>0&&height>0&&width<=960&&height<=600;}
    at+=length;
  }return false;
}
export function photoIndex(elapsedMs,count){return count?Math.floor(Math.max(0,elapsedMs)/PHOTO_SLIDE_MS)%count:0;}
