var CACHE = 'mercaz-bakara-v2';
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
    fetch(e.request, {cache:'no-store'}).then(function(resp){
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

self.addEventListener('push', function(e){
  var data = {};
  try{ data = e.data ? e.data.json() : {}; }catch(err){}
  var title = data.title || '\u05de\u05e8\u05db\u05d6 \u05d1\u05e7\u05e8\u05d4';
  var options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'general',
    dir: 'rtl',
    lang: 'he'
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window'}).then(function(clients){
      for(var i=0;i<clients.length;i++){
        if('focus' in clients[i]) return clients[i].focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
