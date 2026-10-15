// Cache static shell only; API calls always go to the network.
const C='wp-v4',F=['/','/index.html','/styles.css','/app.js','/track.html','/manifest.json','/icon.svg','/icon-192.png','/icon-512.png','/fonts/greatvibes-400.woff2','/fonts/cinzel-var.woff2','/fonts/poppins-400.woff2','/fonts/poppins-600.woff2','/fonts/poppins-700.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.pathname.startsWith('/api')||u.pathname.startsWith('/admin'))return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});
