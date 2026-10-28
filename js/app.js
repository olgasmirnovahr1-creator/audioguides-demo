/*
  Логика сайта. Экраны (адрес после #):
    #/             — главная с плитками категорий
    #/c/<id>       — экскурсии одной категории (с фильтром длительности)
    #/all          — все экскурсии
    #/my           — «Мои экскурсии»: скачанные на этот телефон
    #/t/<id>       — страница экскурсии (описание, скачивание, начать)
    #/play/<id>/<n> — прохождение: остановка номер n
    #/done/<id>    — экскурсия пройдена
    #/code[/<id>]  — ввести код (если пришли со страницы экскурсии — её id)
    #/restore      — восстановить покупки по почте
  Данные берутся из data/catalog.js (window.CATALOG).
*/
(function () {
  "use strict";

  let DATA = window.CATALOG; // тестовые данные; если есть сервер — заменим на каталог с сервера
  let serverMode = false;     // true — сайт работает с сервером (каталог и коды — оттуда)
  const root = document.getElementById("app");
  const DEFAULT_AUDIO = "media/test/stop.mp3"; // тестовый звук, пока нет настоящих записей
  const state = { filter: "all", flash: null }; // flash — сообщение «Готово!», показывается один раз

  // ================== Помощники ==================
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const stopsWord = (n) => `${n} ${plural(n, "остановка", "остановки", "остановок")}`;
  const duration = (min) => (min > 300 ? "Весь день" : (min / 60).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " ч");
  const durationGroup = (min) => (min <= 120 ? "short" : min <= 300 ? "mid" : "day");
  const km = (n) => n.toLocaleString("ru-RU") + " км";
  const rub = (n) => n.toLocaleString("ru-RU") + " ₽";
  const GROUPS = [
    { id: "all", title: "Все" },
    { id: "short", title: "До 2 часов" },
    { id: "mid", title: "2–3 часа" },
    { id: "day", title: "На целый день" }
  ];
  const KIND = { walk: "Пешая", quest: "Квест", sport: "Спортивная" };
  const toursIn = (catId) => DATA.tours.filter((t) => t.categories.includes(catId));
  const category = (id) => DATA.categories.find((c) => c.id === id);
  const tour = (id) => DATA.tours.find((t) => t.id === id);
  const stopAudio = (s) => s.audio || DEFAULT_AUDIO;
  const mmss = (sec) => {
    if (!isFinite(sec)) return "0:00";
    const s = Math.max(0, Math.floor(sec));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  function distanceM(a, b) { // расстояние между двумя точками в метрах
    const R = 6371000, toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const distText = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " м" : (m / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " км");

  // Память браузера (может быть недоступна — тогда просто не запоминаем)
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ничего страшного */ }
  }

  // ================== Иконки ==================
  const ICONS = {
    walk: '<circle cx="13" cy="4" r="2"/><path d="M11 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-2 5"/>',
    kids: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5M10 6.8l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/>',
    scooter: '<circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 18h9M19 15.5L16 4h-3M14.5 18l1.5-7"/>',
    bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h6l3 8M9.5 9l3 8M14 6h3"/>',
    forest: '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
    run: '<circle cx="15" cy="4" r="2"/><path d="M5 20l4-4 2 1 2-5 3 3h3M9 9l3-2 3 2-2 5"/>'
  };
  const icon = (name, cls) =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  // ================== Скачивание (работа без интернета) ==================
  // Каждая скачанная экскурсия хранится в браузере отдельной «коробкой» tour-<id>.
  const offline = { ok: false, downloaded: {}, busy: {} };
  const boxName = (id) => "tour-" + id;
  function tourFiles(t) {
    const files = new Set();
    t.stops.forEach((s) => { files.add(stopAudio(s)); if (s.photo) files.add(s.photo); });
    if (t.cover) files.add(t.cover);
    return Array.from(files);
  }
  async function checkOffline() {
    try {
      if (!("caches" in window) || !/^https?:$/.test(location.protocol)) return;
      const keys = await caches.keys();
      offline.ok = true;
      offline.downloaded = {};
      keys.forEach((k) => { if (k.startsWith("tour-") && !k.endsWith("-loading")) offline.downloaded[k.slice(5)] = true; });
      // Срок доступа закончился — убираем скачанные файлы с телефона
      for (const id of Object.keys(offline.downloaded)) if (!hasAccess(id)) await removeTour(id);
    } catch (e) { offline.ok = false; }
  }
  async function downloadTour(t, onProgress) {
    const files = tourFiles(t);
    const box = await caches.open(boxName(t.id) + "-loading");
    let done = 0;
    for (const url of files) {
      if (!(await box.match(url))) { // уже скачанное не качаем заново — так загрузка продолжается после обрыва
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Файл не скачался: " + url);
        await box.put(url, res);
      }
      onProgress(++done, files.length);
    }
    // Всё скачалось — переносим в «готовую» коробку
    const ready = await caches.open(boxName(t.id));
    for (const req of await box.keys()) await ready.put(req, await box.match(req));
    await caches.delete(boxName(t.id) + "-loading");
    offline.downloaded[t.id] = true;
  }
  async function removeTour(id) {
    await caches.delete(boxName(id));
    await caches.delete(boxName(id) + "-loading");
    delete offline.downloaded[id];
  }
  // Аудио скачанной экскурсии берём прямо из памяти телефона
  async function localUrl(t, url) {
    if (!offline.ok || !offline.downloaded[t.id]) return url;
    try {
      const res = await (await caches.open(boxName(t.id))).match(url);
      if (res) return URL.createObjectURL(await res.blob());
    } catch (e) { /* возьмём из сети */ }
    return url;
  }

  // ================== Коды доступа ==================
  // Сейчас коды проверяются по тестовому списку data/test-codes.js.
  // На шаге 5 функция checkCode будет спрашивать сервер — остальное не изменится.
  const DEVICE_LIMIT = 2; // на скольких телефонах работает один код
  let access = load("access", {}); // { "<КОД>": { tours: [...] | "all", type, from, until } }
  const cleanCode = (c) => String(c).toUpperCase().replace(/[^A-Z0-9А-ЯЁ]/g, "");
  const dateText = (ms) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(/\s?г\.$/, "");
  function deviceId() { // номер этого телефона — понадобится серверу для лимита устройств
    let id = load("device-id", null);
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); save("device-id", id); }
    return id;
  }
  async function checkCode(input) {
    // Ответ: { ok: true, grant } или { ok: false, error }
    if (serverMode) {
      try {
        const r = await fetch("api/codes/check", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: input, device: deviceId() })
        });
        return await r.json();
      } catch (e) { return { ok: false, error: "offline" }; }
    }
    // Без сервера — тестовый список
    const c = cleanCode(input);
    const found = (window.TEST_CODES || []).find((x) => cleanCode(x.code) === c);
    if (!found) return { ok: false, error: "notfound" };
    if (found.test === "devices") return { ok: false, error: "devices" };
    if (found.test === "used") return { ok: false, error: "used" };
    return { ok: true, grant: found, device: deviceId() };
  }
  function activate(grant) {
    const key = cleanCode(grant.code);
    if (access[key] && grant.until) { access[key].until = grant.until; save("access", access); } // сервер мог продлить срок
    if (!access[key]) { // срок считается с первого ввода кода
      const from = Date.now(), until = new Date(from);
      if (grant.days) until.setDate(until.getDate() + grant.days);
      else until.setMonth(until.getMonth() + (grant.months || 6));
      access[key] = { tours: grant.tours, type: grant.type, from,
        until: grant.until || (grant.test === "expired" ? from - 86400000 : until.getTime()) }; // grant.until присылает сервер
      save("access", access);
    }
    return access[key];
  }
  // Есть ли доступ к экскурсии: действующий — { ok: true, until }, истёкший — { ok: false, expiredAt }, нет — null
  function accessFor(tourId) {
    let best = null, old = null;
    Object.values(access).forEach((a) => {
      if (a.tours !== "all" && !a.tours.includes(tourId)) return;
      if (a.until > Date.now()) { if (!best || a.until > best.until) best = a; }
      else if (!old || a.until > old.until) old = a;
    });
    if (best) return { ok: true, until: best.until, type: best.type };
    return old ? { ok: false, expiredAt: old.until } : null;
  }
  const hasAccess = (id) => !!(accessFor(id) || {}).ok;
  const activeSubscription = () => Object.values(access)
    .filter((a) => a.tours === "all" && a.until > Date.now()).sort((a, b) => b.until - a.until)[0];
  const CODE_ERRORS = {
    notfound: "Такого кода нет. Проверьте буквы и цифры — вводить можно без дефисов и пробелов.",
    devices: `Этот код уже используется на ${DEVICE_LIMIT} других телефонах. Если вы сменили телефон, напишите нам — мы сбросим.`,
    used: "Этот код уже использован: одноразовый код срабатывает только один раз.",
    promo_over: "Этот промокод уже закончился.",
    expired: "Срок доступа по этому коду закончился.",
    offline: "Нет интернета. Чтобы ввести код, нужен интернет — потом экскурсия будет работать и без него."
  };
  function codeLabel(c) {
    if (c.test === "expired") return "срок уже истёк";
    if (c.test === "devices") return "занят на других телефонах";
    if (c.test === "used") return "уже использован";
    if (c.type === "test") return "универсальный: открывает все экскурсии";
    if (c.tours === "all") return "абонемент на все экскурсии";
    const names = c.tours.map((id) => (tour(id) || {}).title).filter(Boolean).join(", ");
    return { promo: "промокод: ", single: "одноразовый: " }[c.type] ? ({ promo: "промокод: ", single: "одноразовый: " }[c.type] + names) : names;
  }

  // ================== Установка на экран телефона ==================
  const install = { prompt: null };
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
  const inAppBrowser = () => /Telegram|VKAndroidApp|VKClient|Instagram|FBAN|FBAV/i.test(navigator.userAgent);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    install.prompt = e;
    if (currentRoute()[0] === "") render();
  });

  // ================== Общие части экрана ==================
  function header(backTo, backLabel) {
    const left = backTo
      ? `<button class="back" data-go="${backTo}">← ${backLabel || "Назад"}</button>`
      : `<a class="brand" href="#/">Аудио<b>Москва</b></a>`;
    const right = backTo ? "" : `<a class="top-link" href="#/my" data-go="#/my">Мои экскурсии</a>`;
    const warn = inAppBrowser()
      ? `<p class="warn">Вы открыли сайт внутри мессенджера. Откройте его в обычном браузере (меню ⋮ → «Открыть в браузере»), иначе скачанные экскурсии могут потеряться.</p>`
      : "";
    const flash = state.flash ? `<p class="flash">${esc(state.flash)}</p>` : "";
    return `<header class="top">${left}${right}</header>
      <p class="test-banner">Тестовая версия: экскурсии, цены, координаты и звук — примеры.</p>${warn}${flash}`;
  }

  // ================== Экран: главная ==================
  function installBlock() {
    if (isStandalone()) return "";
    if (install.prompt) {
      return `<div class="install"><span>Установите приложение на телефон — экскурсии будут под рукой.</span>
        <button class="btn small" data-action="install">Установить</button></div>`;
    }
    if (isIOS()) {
      return `<div class="install"><span>Чтобы добавить на экран «Домой»: нажмите <b>Поделиться</b> (или <b>⋯</b> → <b>Поделиться</b>) → <b>На экран «Домой»</b>.</span></div>`;
    }
    return "";
  }
  function renderHome() {
    const tiles = DATA.categories.map((c) => {
      const n = toursIn(c.id).length;
      return `<a class="tile" href="#/c/${c.id}" data-go="#/c/${c.id}">
        ${icon(c.icon, "tile-icon")}
        <span><span class="tile-title">${esc(c.title)}</span><br><span class="tile-sub">${esc(c.subtitle)}</span>
        <span class="tile-count">${n} ${plural(n, "экскурсия", "экскурсии", "экскурсий")}</span></span></a>`;
    }).join("");
    return `${header()}
      <h1>Как хотите узнать Москву?</h1>
      <p class="lead">Аудиоэкскурсии от аттестованного гида. Скачайте и слушайте без интернета.</p>
      <div class="tiles">${tiles}</div>
      <button class="all-link" data-go="#/all">Все экскурсии</button>
      <button class="btn secondary code-home" data-go="#/code">У меня есть код</button>
      ${installBlock()}`;
  }

  // ================== Экран: список экскурсий ==================
  function card(t) {
    const saved = (hasAccess(t.id) ? `<span class="saved">✓ Открыта</span>` : "") +
      (offline.downloaded[t.id] ? `<span class="saved">✓ Скачана</span>` : "");
    return `<a class="card" href="#/t/${t.id}" data-go="#/t/${t.id}">
      <span class="meta"><span class="badge${t.kind === "quest" ? " quest" : ""}">${KIND[t.kind]}</span>${t.note ? `<span>${esc(t.note)}</span>` : ""}${saved}</span>
      <h2>${esc(t.title)}</h2>
      <p>${esc(t.short)}</p>
      <span class="card-foot"><span class="meta"><strong>${duration(t.minutes)}</strong><span>${km(t.km)}</span><span>${stopsWord(t.stops.length)}</span></span>
      <span class="price">${rub(t.price)}</span></span></a>`;
  }
  function renderList(title, subtitle, tours, emptyText, top) {
    const present = {};
    tours.forEach((t) => { present[durationGroup(t.minutes)] = true; });
    const showFilters = Object.keys(present).length > 1;
    if (!showFilters) state.filter = "all";
    const visible = tours.filter((t) => state.filter === "all" || durationGroup(t.minutes) === state.filter);
    const filters = showFilters
      ? `<div class="filters" role="group" aria-label="Длительность">${GROUPS.filter((g) => g.id === "all" || present[g.id])
          .map((g) => `<button class="chip" data-filter="${g.id}" aria-pressed="${state.filter === g.id}">${g.title}</button>`).join("")}</div>`
      : "";
    const list = visible.length
      ? `<div class="list">${visible.map(card).join("")}</div>`
      : `<p class="empty">${emptyText || "Здесь пока нет экскурсий. Скоро появятся."}</p>`;
    return `${header("#/")}<h1>${esc(title)}</h1>
      ${subtitle ? `<p class="lead">${esc(subtitle)}</p>` : `<div class="spacer"></div>`}${top || ""}${filters}${list}`;
  }
  function renderMy() {
    const tours = DATA.tours.filter((t) => hasAccess(t.id) || offline.downloaded[t.id]);
    const sub = activeSubscription();
    const top = `${sub ? `<p class="flash">Абонемент до ${dateText(sub.until)}: открыты все экскурсии.</p>` : ""}
      <div class="my-actions"><button class="btn secondary small" data-go="#/code">Ввести код</button>
      <button class="link-btn" data-go="#/restore">Восстановить покупки</button></div>
      ${offline.ok ? "" : `<p class="dl-note left">Скачивание без интернета работает на настоящем сайте, в этом просмотре — нет.</p>`}`;
    return renderList("Мои экскурсии", "Купленные экскурсии на этом телефоне. Скачанные работают без интернета.", tours,
      "Пока здесь пусто. Купите экскурсию или введите код — она появится здесь.", top);
  }

  function renderCode(tourId) {
    const t = tour(tourId);
    const tests = (window.TEST_CODES || []).map((c) => `<li><code>${esc(c.code)}</code> — ${esc(codeLabel(c))}</li>`).join("");
    return `${header(t ? "#/t/" + t.id : "#/my")}
      <h1>Ввести код</h1>
      <p class="lead">${t ? `Код к экскурсии «${esc(t.title)}»: из письма после покупки, подарочный или абонемент.` : "Код из письма после покупки, подарочный код или абонемент."}</p>
      <form class="code-form" id="code-form" autocomplete="off">
        <label for="code-input">Код</label>
        <input id="code-input" type="text" autocapitalize="characters" spellcheck="false" placeholder="Например, TEST" enterkeyhint="go">
        <button class="btn" type="submit">Открыть</button>
        <p class="q-result bad" id="code-error" hidden></p>
      </form>
      <p class="notice left">Срок доступа начинается с первого ввода кода. Один код работает на ${DEVICE_LIMIT} телефонах.</p>
      <button class="link-btn" data-go="#/restore">Потеряли код? Восстановить покупки</button>
      ${serverMode ? "" : `<details class="test-codes"><summary>Тестовые коды — только для проверки</summary><ul>${tests}</ul></details>`}`;
  }

  function renderRestore() {
    return `${header("#/my")}
      <h1>Восстановить покупки</h1>
      <p class="lead">Введите почту, которую указывали при покупке. Пришлём письмо со всеми вашими кодами.</p>
      <form class="code-form" id="restore-form" autocomplete="on">
        <label for="restore-email">Почта</label>
        <input id="restore-email" type="email" autocomplete="email" placeholder="you@mail.ru" enterkeyhint="send">
        <button class="btn" type="submit">Прислать коды</button>
        <p class="notice left" id="restore-msg" hidden></p>
      </form>`;
  }

  // ================== Схема маршрута (без карты-подложки) ==================
  function projection(stops) {
    const W = 320, H = 210, P = 22;
    const k = Math.cos(stops[0].lat * Math.PI / 180); // долгота «сжимается» на широте Москвы
    const xs = stops.map((s) => s.lng * k), ys = stops.map((s) => s.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((W - 2 * P) / ((maxX - minX) || 1e-6), (H - 2 * P) / ((maxY - minY) || 1e-6));
    const offX = (W - (maxX - minX) * scale) / 2, offY = (H - (maxY - minY) * scale) / 2;
    return { W, H, at: (lat, lng) => [offX + (lng * k - minX) * scale, offY + (maxY - lat) * scale] };
  }
  function routeSvg(stops, current) {
    const pr = projection(stops);
    const pts = stops.map((s) => pr.at(s.lat, s.lng));
    const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const many = stops.length > 10, r = many ? 7 : 9, fs = many ? 8 : 10;
    const dots = pts.map((p, i) => {
      const q = stops[i].question, x = p[0].toFixed(1), y = p[1].toFixed(1);
      const ring = i === current ? `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="none" stroke="var(--ink)" stroke-width="2"/>` : "";
      return `${ring}<circle cx="${x}" cy="${y}" r="${r}" fill="${q ? "var(--ochre)" : "var(--green)"}"/>
        <text x="${x}" y="${(p[1] + fs * 0.36).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${q ? "var(--ochre-ink)" : "var(--surface)"}">${i + 1}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${pr.W} ${pr.H}" role="img" aria-label="Схема маршрута">
      <polyline points="${line}" fill="none" stroke="var(--green)" stroke-opacity=".35" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}<circle id="me" r="7" fill="var(--me)" stroke="var(--surface)" stroke-width="3" cx="-50" cy="-50"/></svg>`;
  }

  // ================== Экран: экскурсия ==================
  function downloadBlock(t) {
    if (!offline.ok) {
      return `<p class="dl-note">Скачивание для прогулки без интернета заработает на настоящем сайте.</p>`;
    }
    if (offline.busy[t.id]) {
      return `<div class="dl"><div class="bar"><span id="dl-bar" style="width:0%"></span></div><p class="dl-note" id="dl-text">Скачиваем…</p></div>`;
    }
    if (offline.downloaded[t.id]) {
      return `<div class="dl done"><span>✓ Скачано — можно слушать без интернета</span>
        <button class="link-btn" data-action="remove" data-id="${t.id}">Удалить с телефона</button></div>`;
    }
    return `<button class="btn secondary" data-action="download" data-id="${t.id}">Скачать для прогулки без интернета</button>
      <p class="dl-note">Лучше скачивать по Wi-Fi, накануне или в день прогулки.</p>`;
  }
  function tourActions(t, gpx) {
    const a = accessFor(t.id);
    if (a && a.ok) {
      return `<div class="tour-tools" id="dl-box">${downloadBlock(t)}${gpx}</div>
        <div class="actions">
          <button class="btn" data-go="#/play/${t.id}/1">Начать экскурсию</button>
          <p class="notice">${a.type === "subscription" ? "По абонементу до" : "Доступ до"} ${dateText(a.until)}</p>
        </div>`;
    }
    const expired = a ? `<p class="warn">Срок доступа закончился ${dateText(a.expiredAt)}. Чтобы послушать снова, купите экскурсию ещё раз.</p>` : "";
    return `${expired}<div class="actions">
        <button class="btn" data-soon="Оплата">Купить · ${rub(t.price)}</button>
        <button class="btn secondary" data-go="#/code/${t.id}">У меня есть код</button>
        <p class="notice" id="soon" hidden></p>
      </div>`;
  }
  function renderTour(t) {
    const stops = t.stops.map((s, i) => `<li><span class="num${s.question ? " q" : ""}">${i + 1}</span>
      <span>${esc(s.title)}${s.question ? `<br><span class="stop-q">Вопрос квеста</span>` : ""}</span></li>`).join("");
    const gpx = t.kind === "sport"
      ? `<button class="btn secondary" data-action="gpx" data-id="${t.id}">Маршрут для часов (GPX)</button>` : "";
    return `${header("#/")}
      <div class="tour-head"><span class="meta"><span class="badge${t.kind === "quest" ? " quest" : ""}">${KIND[t.kind]}</span>${t.note ? `<span>${esc(t.note)}</span>` : ""}</span>
      <h1>${esc(t.title)}</h1><p class="lead flush">${esc(t.description)}</p></div>
      <div class="facts">
        <div class="fact"><span>Время</span><strong>${duration(t.minutes)}</strong></div>
        <div class="fact"><span>Маршрут</span><strong>${km(t.km)}</strong></div>
        <div class="fact"><span>Доступ</span><strong>${t.accessMonths} мес.</strong></div>
      </div>
      <h2>Маршрут</h2>
      <p class="lead small">Старт: ${esc(t.start)} · Финиш: ${esc(t.finish)}</p>
      <div class="route">${routeSvg(t.stops, -1)}</div>
      <p class="route-caption">Так маршрут выглядит и без интернета: линия, остановки и ваша точка.</p>
      <h2>${stopsWord(t.stops.length)}</h2>
      <ol class="stops">${stops}</ol>
      ${tourActions(t, gpx)}`;
  }

  // ================== Квест: проверка ответа ==================
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/[.,!?;:"'«»()\-–—]/g, " ").replace(/\s+/g, " ").trim();
  const isRight = (answer, q) => q.answers.some((a) => norm(a) === norm(answer));
  let quest = load("quest-progress", {}); // { "<экскурсия>:<остановка>": "right" | "shown" }
  const qKey = (t, i) => t.id + ":" + i;

  function questBlock(t, i) {
    const q = t.stops[i].question;
    if (!q) return "";
    const st = quest[qKey(t, i)];
    if (st) {
      return `<div class="quest solved"><p class="q-text">${esc(q.text)}</p>
        <p class="q-result ${st === "right" ? "ok" : ""}">${st === "right" ? "Верно!" : "Ответ: " + esc(q.answers[0])}</p>
        <p class="q-explain">${esc(q.explain || "")}</p></div>`;
    }
    if (Array.isArray(q.options) && q.options.length) { // вопрос с вариантами ответа
      return `<div class="quest" id="quest-choice">
        <p class="q-text">${esc(q.text)}</p>
        <div class="q-options">${q.options.map((o) => `<button class="q-option" type="button" data-choice="${esc(o)}">${esc(o)}</button>`).join("")}</div>
        <p class="q-result" id="q-result" hidden></p>
        <button class="link-btn" type="button" data-action="reveal">Узнать ответ</button>
      </div>`;
    }
    return `<form class="quest" id="quest-form" autocomplete="off">
      <p class="q-text">${esc(q.text)}</p>
      <label class="sr" for="q-input">Ваш ответ</label>
      <div class="q-row"><input id="q-input" type="text" placeholder="Ваш ответ" enterkeyhint="done">
      <button class="btn small" type="submit">Ответить</button></div>
      <p class="q-result" id="q-result" hidden></p>
      <button class="link-btn" type="button" data-action="reveal">Узнать ответ</button>
    </form>`;
  }

  // ================== Экран: прохождение ==================
  const audio = new Audio();
  audio.preload = "metadata";
  const play = { tourId: null, index: -1, geoWatch: null, pos: null };

  const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const PLAY_ICON = svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>');
  const PAUSE_ICON = svg('<rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/>');
  const skipIcon = (back) => svg(`<path d="${back ? "M12 4.5a7.5 7.5 0 1 1-7.1 5.1M4.5 4.5v5h5" : "M12 4.5a7.5 7.5 0 1 0 7.1 5.1M19.5 4.5v5h-5"}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.2" text-anchor="middle" font-size="6.5" font-weight="700" fill="currentColor">15</text>`);
  const SKIP_BACK = skipIcon(true), SKIP_FWD = skipIcon(false);
  // Текст остановки: пустая строка между абзацами = новый абзац
  const paragraphs = (text) => String(text).split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");

  function renderPlay(t, i) {
    const s = t.stops[i], n = t.stops.length;
    const locked = s.question && !quest[qKey(t, i)];
    const isLast = i === n - 1;
    const nextLabel = isLast ? "Завершить" : "Дальше →";
    const nextTarget = isLast ? `#/done/${t.id}` : `#/play/${t.id}/${i + 2}`;
    const dots = t.stops.map((_, k) => `<span class="${k < i ? "past" : k === i ? "now" : ""}"></span>`).join("");
    return `${header("#/t/" + t.id, "К экскурсии")}
      <div class="play-top"><span>Остановка ${i + 1} из ${n}</span><span class="dots" aria-hidden="true">${dots}</span></div>
      <div class="photo">${s.photo ? `<img src="${esc(s.photo)}" alt="">` : `<span>Фото остановки</span>`}</div>
      <h1>${esc(s.title)}</h1>
      <div class="player" role="group" aria-label="Аудио">
        <p class="p-title">${esc(s.title)}</p>
        <input type="range" id="seek" min="0" max="100" step="0.1" value="0" aria-label="Перемотка">
        <div class="p-times"><span id="p-cur">0:00</span><span id="p-dur">0:00</span></div>
        <div class="p-controls">
          <button class="skip" data-skip="-15" aria-label="Назад на 15 секунд">${SKIP_BACK}</button>
          <button class="pp" id="pp" aria-label="Слушать">${PLAY_ICON}</button>
          <button class="skip" data-skip="15" aria-label="Вперёд на 15 секунд">${SKIP_FWD}</button>
        </div>
      </div>
      ${s.text ? `<div class="stop-text">${paragraphs(s.text)}</div>` : ""}
      ${questBlock(t, i)}
      <div class="where">
        <div class="route">${routeSvg(t.stops, i)}</div>
        <div class="where-row"><span id="geo-status">Нажмите, чтобы увидеть себя на схеме.</span>
          <button class="btn small secondary" data-action="locate">Где я?</button></div>
      </div>
      <div class="actions nav">
        <button class="btn secondary" ${i === 0 ? "disabled" : `data-go="#/play/${t.id}/${i}"`}>← Назад</button>
        <button class="btn" id="next" data-next="${nextTarget}" ${locked ? "disabled" : ""}>${nextLabel}</button>
      </div>
      <p class="notice" id="next-hint" ${locked ? "" : "hidden"}>Ответьте на вопрос или нажмите «Узнать ответ».</p>`;
  }

  async function setupPlay(t, i) {
    const s = t.stops[i];
    const sameStop = play.tourId === t.id && play.index === i;
    if (!sameStop) {
      audio.pause();
      audio.src = await localUrl(t, stopAudio(s));
      play.tourId = t.id;
      play.index = i;
    }
    const pp = document.getElementById("pp"), seek = document.getElementById("seek");
    const cur = document.getElementById("p-cur"), dur = document.getElementById("p-dur");
    let shownPaused = null;
    const paint = () => {
      if (!pp || !document.body.contains(pp)) return;
      if (shownPaused !== audio.paused) {
        shownPaused = audio.paused;
        pp.innerHTML = audio.paused ? PLAY_ICON : PAUSE_ICON;
        pp.setAttribute("aria-label", audio.paused ? "Слушать" : "Пауза");
      }
      const d = audio.duration || 0;
      seek.value = d ? (audio.currentTime / d) * 100 : 0;
      seek.style.setProperty("--p", seek.value + "%");
      cur.textContent = mmss(audio.currentTime);
      dur.textContent = mmss(d);
    };
    audio.ontimeupdate = paint; audio.onplay = paint; audio.onpause = paint; audio.onloadedmetadata = paint;
    audio.onended = paint;
    pp.onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
    seek.oninput = () => { if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration; };
    paint();

    // Экран блокировки и наушники
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: t.title, album: "АудиоМосква" });
        navigator.mediaSession.setActionHandler("seekbackward", () => { audio.currentTime -= 15; });
        navigator.mediaSession.setActionHandler("seekforward", () => { audio.currentTime += 15; });
      } catch (e) { /* не везде поддерживается */ }
    }
    if (play.pos) showMe(t, i);
  }

  function showMe(t, i) {
    const me = document.getElementById("me"), status = document.getElementById("geo-status");
    if (!me || !status || !play.pos) return;
    const pr = projection(t.stops);
    const [x, y] = pr.at(play.pos.lat, play.pos.lng);
    const inside = x > -10 && x < pr.W + 10 && y > -10 && y < pr.H + 10;
    me.setAttribute("cx", inside ? x.toFixed(1) : -50);
    me.setAttribute("cy", inside ? y.toFixed(1) : -50);
    const d = distanceM(play.pos, t.stops[i]);
    status.textContent = inside
      ? `До остановки №${i + 1} — ${distText(d)}`
      : `Вы далеко от маршрута: до остановки №${i + 1} — ${distText(d)}`;
  }
  function locate(t) {
    const status = document.getElementById("geo-status");
    if (!("geolocation" in navigator)) { status.textContent = "Этот браузер не умеет определять место."; return; }
    status.textContent = "Определяем, где вы…";
    if (play.geoWatch !== null) navigator.geolocation.clearWatch(play.geoWatch);
    play.geoWatch = navigator.geolocation.watchPosition(
      (p) => { play.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; showMe(t, play.index); },
      () => { status.textContent = "Не удалось определить место. Разрешите браузеру доступ к геопозиции."; },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
    );
  }
  function stopGeo() {
    if (play.geoWatch !== null) { navigator.geolocation.clearWatch(play.geoWatch); play.geoWatch = null; }
  }

  function renderDone(t) {
    return `${header("#/")}
      <div class="done-box"><h1>Экскурсия пройдена!</h1>
      <p class="lead">Спасибо, что гуляли с нами по маршруту «${esc(t.title)}».</p>
      <button class="btn" data-go="#/">К другим экскурсиям</button></div>`;
  }

  // ================== Маршрут для часов (GPX) ==================
  function gpxText(t) {
    const pts = t.stops.map((s) => `<trkpt lat="${s.lat}" lon="${s.lng}"></trkpt>`).join("");
    const wpts = t.stops.map((s, i) => `<wpt lat="${s.lat}" lon="${s.lng}"><name>${i + 1}. ${esc(s.title)}</name></wpt>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="АудиоМосква" xmlns="http://www.topografix.com/GPX/1/1">${wpts}<trk><name>${esc(t.title)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
  }
  function downloadGpx(t) {
    const url = URL.createObjectURL(new Blob([gpxText(t)], { type: "application/gpx+xml" }));
    const a = document.createElement("a");
    a.href = url; a.download = t.id + ".gpx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ================== Переходы между экранами ==================
  const currentRoute = () => (location.hash || "#/").replace(/^#\/?/, "").split("/");
  function render() {
    const [screen, id, num] = currentRoute();
    if (screen !== "play") { audio.pause(); stopGeo(); play.tourId = null; play.index = -1; }
    let html, after = null;
    if (screen === "c" && category(id)) {
      const c = category(id);
      html = renderList(c.title, c.subtitle, toursIn(c.id));
    } else if (screen === "all") {
      html = renderList("Все экскурсии", "", DATA.tours);
    } else if (screen === "my") {
      html = renderMy();
    } else if (screen === "t" && tour(id)) {
      html = renderTour(tour(id));
    } else if (screen === "play" && tour(id) && !hasAccess(id)) {
      location.replace("#/t/" + id); // без доступа прохождение не открываем
      return;
    } else if (screen === "code") {
      html = renderCode(id);
    } else if (screen === "restore") {
      html = renderRestore();
    } else if (screen === "play" && tour(id)) {
      const t = tour(id), i = Math.min(Math.max(parseInt(num, 10) || 1, 1), t.stops.length) - 1;
      html = renderPlay(t, i);
      after = () => setupPlay(t, i);
    } else if (screen === "done" && tour(id)) {
      html = renderDone(tour(id));
    } else {
      html = renderHome();
    }
    root.innerHTML = html;
    state.flash = null;
    if (after) after();
  }
  function go(target) {
    if (target.startsWith("#/c/") || target === "#/all" || target === "#/my") state.filter = "all";
    if (location.hash === target) { render(); window.scrollTo(0, 0); return; }
    if (location.hash === target) render(); else location.hash = target;
    window.scrollTo(0, 0);
  }

  root.addEventListener("click", async (e) => {
    const goEl = e.target.closest("[data-go]");
    if (goEl) { e.preventDefault(); go(goEl.getAttribute("data-go")); return; }

    const f = e.target.closest("[data-filter]");
    if (f) { state.filter = f.getAttribute("data-filter"); const y = window.scrollY; render(); window.scrollTo(0, y); return; }

    const nx = e.target.closest("[data-next]");
    if (nx && !nx.disabled) { go(nx.getAttribute("data-next")); return; }

    const sk = e.target.closest("[data-skip]");
    if (sk) { audio.currentTime = Math.max(0, audio.currentTime + Number(sk.getAttribute("data-skip"))); return; }

    const soon = e.target.closest("[data-soon]");
    if (soon) {
      const n = document.getElementById("soon");
      n.textContent = soon.getAttribute("data-soon") + " появится на шаге 5, когда подключим сервер. Пока попробуйте «У меня есть код».";
      n.hidden = false;
      return;
    }

    const ch = e.target.closest("[data-choice]");
    if (ch) {
      const t = tour(currentRoute()[1]), i = play.index;
      if (isRight(ch.getAttribute("data-choice"), t.stops[i].question)) {
        quest[qKey(t, i)] = "right";
        save("quest-progress", quest);
        const y = window.scrollY; render(); window.scrollTo(0, y);
      } else {
        ch.disabled = true;
        ch.classList.add("wrong");
        const r = document.getElementById("q-result");
        r.hidden = false; r.className = "q-result bad"; r.textContent = "Не совсем. Попробуйте ещё!";
      }
      return;
    }

    const act = e.target.closest("[data-action]");
    if (!act) return;
    const a = act.getAttribute("data-action");
    const [, routeId] = currentRoute();
    const t = tour(act.getAttribute("data-id") || routeId);

    if (a === "install" && install.prompt) {
      install.prompt.prompt();
      install.prompt = null;
      render();
    } else if (a === "download" && t) {
      offline.busy[t.id] = true;
      document.getElementById("dl-box").innerHTML = downloadBlock(t);
      try {
        await downloadTour(t, (done, all) => {
          const bar = document.getElementById("dl-bar"), txt = document.getElementById("dl-text");
          if (bar) bar.style.width = Math.round((done / all) * 100) + "%";
          if (txt) txt.textContent = `Скачано ${done} из ${all}`;
        });
      } catch (err) {
        delete offline.busy[t.id];
        document.getElementById("dl-box").innerHTML = downloadBlock(t) +
          `<p class="warn">Не получилось скачать: пропал интернет. Нажмите «Скачать» ещё раз — продолжим с того места, где остановились.</p>`;
        return;
      }
      delete offline.busy[t.id];
      if (currentRoute()[1] === t.id) render();
    } else if (a === "remove" && t) {
      await removeTour(t.id);
      render();
    } else if (a === "gpx" && t) {
      downloadGpx(t);
    } else if (a === "locate" && t) {
      locate(t);
    } else if (a === "reveal" && t) {
      quest[qKey(t, play.index)] = "shown";
      save("quest-progress", quest);
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  });

  root.addEventListener("submit", async (e) => {
    if (e.target.id === "code-form") {
      e.preventDefault();
      const input = document.getElementById("code-input"), err = document.getElementById("code-error");
      if (!input.value.trim()) { input.focus(); return; }
      const res = await checkCode(input.value);
      if (!res.ok) { err.textContent = CODE_ERRORS[res.error]; err.hidden = false; input.select(); return; }
      const a = activate(res.grant);
      if (a.until <= Date.now()) { err.textContent = `Срок доступа по этому коду закончился ${dateText(a.until)}.`; err.hidden = false; return; }
      const fromTour = currentRoute()[1];
      let target;
      if (a.tours === "all") {
        state.flash = `${a.type === "test" ? "Тестовый код" : "Абонемент"} активирован: все экскурсии открыты до ${dateText(a.until)}.`;
        target = fromTour && tour(fromTour) ? "#/t/" + fromTour : "#/all";
      } else {
        const id = a.tours.includes(fromTour) ? fromTour : a.tours[0];
        state.flash = `Готово! Экскурсия «${tour(id).title}» открыта до ${dateText(a.until)}.`;
        target = "#/t/" + id;
      }
      go(target);
      return;
    }
    if (e.target.id === "restore-form") {
      e.preventDefault();
      const email = document.getElementById("restore-email"), msg = document.getElementById("restore-msg");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { msg.textContent = "Проверьте почту: похоже, в адресе ошибка."; msg.hidden = false; return; }
      if (serverMode) {
        try {
          await fetch("api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.value.trim() }) });
          msg.textContent = "Если на эту почту были покупки, мы отправили письмо со всеми кодами. Проверьте и папку «Спам».";
        } catch (err) { msg.textContent = "Нет интернета. Попробуйте, когда появится связь."; }
      } else {
        msg.textContent = "Отправка писем заработает, когда подключим сервер. Тогда сюда придут все коды, купленные на эту почту.";
      }
      msg.hidden = false;
      return;
    }
    if (e.target.id !== "quest-form") return;
    e.preventDefault();
    const t = tour(currentRoute()[1]);
    const i = play.index;
    const input = document.getElementById("q-input"), result = document.getElementById("q-result");
    if (!input.value.trim()) { input.focus(); return; }
    if (isRight(input.value, t.stops[i].question)) {
      quest[qKey(t, i)] = "right";
      save("quest-progress", quest);
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    } else {
      result.hidden = false;
      result.className = "q-result bad";
      result.textContent = "Не совсем. Попробуйте ещё!";
      input.select();
    }
  });

  window.addEventListener("hashchange", render);

  // Помощник для работы без интернета (service worker). Работает только на настоящем сайте.
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* в просмотре недоступно */ });
  }

  // Каталог с сервера. Без интернета — последний сохранённый. Без сервера — тестовые данные.
  async function loadCatalog() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch("api/catalog", { cache: "no-store" });
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error("нет сервера");
      DATA = await r.json();
      serverMode = true;
      save("catalog-cache", DATA);
    } catch (e) {
      const cached = load("catalog-cache", null);
      if (cached) { DATA = cached; serverMode = true; }
    }
  }

  if (!/^https?:$/.test(location.protocol)) render(); // файл или просмотр — сразу
  loadCatalog().then(checkOffline).then(render);
})();
