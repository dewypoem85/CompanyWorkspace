// Test-only host adapter. Import the real production bundle after confining it.
import {Server, Socket} from 'node:net';

if(process.env.WORKSPACE_RUNTIME_SMOKE!=='1')throw Error('This fixture is only for isolated runtime tests.');
process.stderr.write('Runtime fixture: importing production bundle.\n');
Socket.prototype.connect=function(){throw Error('SMOKE_OUTBOUND_BLOCKED');};
const listen=Server.prototype.listen;
Server.prototype.listen=function(_port,callback){
  return listen.call(this,{port:0,host:'127.0.0.1'},()=>{
    const address=this.address();
    process.stdout.write(`SHEET_SMOKE_ORIGIN=http://127.0.0.1:${address.port}\n`);
    if(typeof callback==='function')callback();
  });
};
await import(new URL('../dist/server/index.js',import.meta.url));
process.stderr.write('Runtime fixture: production bundle imported.\n');
