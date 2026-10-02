const CACHE='company-workspace-shell-v2';
const STATIC=['/offline.html','/images/company-logo.png','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));
    return;
  }
  if(url.pathname.startsWith('/css/')||url.pathname.startsWith('/js/')){
    event.respondWith(fetch(new Request(request,{cache:'reload'})).then(response=>{
      if(response.ok&&response.type==='basic')event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,response.clone())));
      return response;
    }).catch(()=>caches.match(request)));
    return;
  }
  if(STATIC.includes(url.pathname)||url.pathname.startsWith('/images/')){
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok&&response.type==='basic')caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
      return response;
    })));
  }
});
