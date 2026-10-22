// Exercise the real Express stack without opening a network socket.
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';

export async function request(app, url, options = {}) {
  const prepared = new Request(url, options);
  const body = prepared.body ? Buffer.from(await prepared.arrayBuffer()) : null;
  return new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(_data, _encoding, done) { done(); } });
    socket.remoteAddress = '127.0.0.1'; socket.setTimeout = () => socket;
    const req = new IncomingMessage(socket);
    req.method = prepared.method; req.url = new URL(url).pathname+new URL(url).search; req.httpVersion='1.1';req.httpVersionMajor=1;req.httpVersionMinor=1;
    req.headers = Object.fromEntries(prepared.headers);req.headers.host = new URL(url).host;
    if(body) req.headers['content-length']=String(body.length);
    const res = new ServerResponse(req); res.assignSocket(socket);
    // A real HTTP server forwards socket drain to its response. Do the same so
    // static files larger than the writable high-water mark do not stall.
    socket.on('drain',()=>res.emit('drain'));
    const chunks=[];
    const write=res.write.bind(res), end=res.end.bind(res);
    res.write=(chunk,...args)=>{if(chunk)chunks.push(Buffer.from(chunk));return write(chunk,...args);};
    res.end=(chunk,...args)=>{if(chunk)chunks.push(Buffer.from(chunk));return end(chunk,...args);};
    res.on('error',reject);
    res.on('finish',()=>{
      const raw=Buffer.concat(chunks);const all=res.getHeaders();
      const headers=new Headers();for(const [name,value]of Object.entries(all))for(const v of Array.isArray(value)?value:[value])headers.append(name,String(v));
      res.emit('close');
      resolve({status:res.statusCode,headers,arrayBuffer:async()=>raw});socket.destroy();
    });
    app.handle(req,res);
    if(body)req.push(body);req.push(null);req.complete=true;
  });
}
