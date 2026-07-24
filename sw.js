var CACHE = 'mercaz-bakara-v1';
var CORE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(CORE_FILES); }).catch(function(){})
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.filter(function(n){ return n!==CACHE; }).map(function(n){ return caches.delete(n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  if(e.request.method!=='GET') return;
  var url = e.request.url;
  if(url.indexOf('supabase.co')>=0) return;
  e.respondWith(
    fetch(e.request).then(function(resp){
      if(resp&&resp.status===200){
        var copy=resp.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); }).catch(function(){});
      }
      return resp;
    }).catch(function(){
      return caches.match(e.request).then(function(cached){
        return cached || caches.match('./index.html');
      });
    })
  );
});
