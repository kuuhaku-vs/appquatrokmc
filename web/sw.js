// Permite instalar o site como aplicativo e usar sem internet depois do primeiro acesso.
// Estratégia: rede primeiro (sempre a versão mais nova); se estiver offline, usa a cópia guardada.
const CACHE = 'busca-mc-v1';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'motor.js', 'cofre.js', 'logo.png', 'mc-background.jpeg',
  'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'dados/usuarios.json', 'dados/base.bin'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
