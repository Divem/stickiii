import http from 'node:http';
import path from 'node:path';
import {readFile, realpath} from 'node:fs/promises';
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json','.wav':'audio/wav','.mp3':'audio/mpeg','.mp4':'video/mp4'};
export async function serve(port=0){
 const base=await realpath('dist');
 const server=http.createServer(async(req,res)=>{
  try{
   const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const isFinal=name==='/final.mp4';
   const file=await realpath(isFinal?'renders/stickiii-product-promo-1080p.mp4':path.join(base,name==='/'?'index.html':name));
   if(!isFinal&&file!==base&&!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
   const body=await readFile(file),type=types[path.extname(file)]||'application/octet-stream';
   const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
   if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),body.length-1):body.length-1;if(start> end||start>=body.length){res.writeHead(416,{'Content-Range':`bytes */${body.length}`});res.end();return;}res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1});res.end(body.subarray(start,end+1));}
   else{res.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':body.length});res.end(body);}
  }catch{res.writeHead(404);res.end('Not found');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return{server,url:`http://127.0.0.1:${server.address().port}`};
}
