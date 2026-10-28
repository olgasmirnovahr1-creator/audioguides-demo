/*
  Помощник для работы без интернета (service worker).
  - Сохраняет сам сайт в памяти телефона, чтобы он открывался без сети.
  - Отдаёт скачанные экскурсии (аудио, фото) из памяти телефона.

  ВАЖНО: после изменения файлов сайта увеличь номер версии ниже (v2 → v3 и т. д.),
  иначе телефоны туристов будут показывать старую версию.
*/
const VERSION = "v13";
const SHELL = "shell-" + VERSION;
const SHELL_FILES = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "data/catalog.js",
  "data/test-codes.js",
  "manifest.webmanifest",
  "icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Плеер на iPhone просит аудио кусочками — отдаём нужный кусочек из сохранённого файла
async function partial(request, response) {
  const buf = await response.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Number(m[2]) : buf.byteLength - 1;
  const chunk = buf.slice(start, end + 1);
  return new Response(chunk, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(chunk.byteLength),
      "Accept-Ranges": "bytes"
    }
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Шрифты Google: сохраняем при первом показе, потом берём из памяти
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open("fonts").then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    // Скачанные экскурсии и сохранённый сайт
    const hit = await caches.match(req, { ignoreSearch: true }) ||
      (req.mode === "navigate" ? await caches.match("index.html") : undefined);

    const isShell = SHELL_FILES.some((f) => url.pathname.endsWith("/" + f) || (f === "./" && url.pathname.endsWith("/")));
    if (isShell || req.mode === "navigate") {
      // Сайт: сначала пробуем свежую версию из сети (не дольше 3 секунд), без сети — сохранённую
      try {
        const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("долго")), 3000))]);
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; }
      } catch (e) { /* нет сети — берём сохранённое */ }
      if (hit) return hit;
    }
    if (hit) return req.headers.get("range") ? partial(req, hit) : hit;
    return fetch(req);
  })());
});
