/*
  Админка. Экраны (адрес после #):
    #/login          — вход
    #/tours          — список экскурсий
    #/tour/<id>      — редактирование экскурсии (#/tour/new — новая)
    #/categories     — плитки на главной
    #/codes          — коды доступа
    #/import         — загрузить экскурсию файлом или из хранилища
  Если сервера нет (просмотр в Claude или файл), включается ДЕМО: изменения сохраняются только в этом браузере.
*/
(function () {
  "use strict";
  const root = document.getElementById("admin");
  const S = { demo: false, me: null, data: null, draft: null, flash: null, loginEmail: "", codes: null, codesQuery: "", batchOut: "" };

  // ================== Помощники ==================
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const route = () => (location.hash || "#/tours").replace(/^#\/?/, "").split("/");
  const go = (h) => { if (location.hash === h) render(); else location.hash = h; };
  const KIND = { walk: "Пешая", quest: "Квест", sport: "Спортивная" };
  const TYPE = { purchase: "Покупка", subscription: "Абонемент", promo: "Промокод", single: "Одноразовый", test: "Тестовый" };
  const ICONS = { walk: "Пешеход", kids: "Лупа (квест)", scooter: "Самокат", bike: "Велосипед", run: "Бегун", forest: "Ёлка" };
  const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }).replace(/\s?г\.$/, "") : "—");
  const slug = (s) => {
    const map = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
    return String(s).toLowerCase().split("").map((c) => (map[c] !== undefined ? map[c] : c)).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  };
  function flash(text, bad) { S.flash = { text, bad }; }

  // ================== Связь с сервером (или демо) ==================
  async function api(method, url, body, raw) {
    if (S.demo) return demoApi(method, url, body);
    const opts = { method, headers: {}, credentials: "same-origin" };
    if (raw) { opts.body = body; opts.headers["Content-Type"] = "application/octet-stream"; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
    const res = await fetch("../api" + url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* пусто */ }
    if (res.status === 401 && !url.startsWith("/admin/login")) { S.me = null; S.data = null; throw new Error("Нужно войти заново"); }
    if (!res.ok || data.ok === false) throw new Error(data.error || "Ошибка сервера");
    return data;
  }

  // ---------- Демо: те же ответы, что у сервера, но всё хранится в браузере ----------
  const DEMO_KEY = "admin-demo-v1";
  let demo = null;
  function demoLoad() {
    try { demo = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { demo = null; }
    if (!demo) {
      const C = window.CATALOG || { categories: [], tours: [] };
      demo = {
        categories: C.categories.map((c) => ({ ...c })),
        tours: C.tours.map((t) => ({ ...JSON.parse(JSON.stringify(t)), published: true })),
        codes: (window.TEST_CODES || []).filter((c) => !c.test).map((c) => ({
          label: c.code, type: c.type, tours: c.tours, months: c.months || 0, days: c.days || 0,
          email: "", note: "тестовый", devices: 0, first_used_at: 0, until: 0, max_uses: 0, valid_until: 0, created_at: Date.now()
        }))
      };
    }
  }
  function demoSave() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(demo)); } catch (e) { /* без сохранения */ } }
  function randomLabel(prefix) {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", part = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
    return (prefix ? prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) + "-" : "") + part() + "-" + part();
  }
  async function demoApi(method, url, body) {
    if (!demo) demoLoad();
    const [path, query] = url.split("?");
    const p = path.split("/").filter(Boolean); // ["admin", ...]
    const done = (extra) => { demoSave(); return { ok: true, ...extra }; };
    if (p[1] === "me") return { ok: true, email: "демо", deviceLimit: 2 };
    if (p[1] === "data") return { ok: true, categories: demo.categories, tours: demo.tours };
    if (p[1] === "categories") { demo.categories = body; return done(); }
    if (p[1] === "tours" && method === "PUT") {
      const t = checkTour({ ...body, id: p[2] });
      const i = demo.tours.findIndex((x) => x.id === t.id);
      if (i >= 0) demo.tours[i] = t; else demo.tours.push(t);
      return done({ tour: t });
    }
    if (p[1] === "tours" && method === "DELETE") { demo.tours = demo.tours.filter((x) => x.id !== p[2]); return done(); }
    if (p[1] === "upload") return { ok: true, url: URL.createObjectURL(body), demo: true };
    if (p[1] === "codes" && method === "GET") {
      const q = decodeURIComponent((query || "").replace(/^q=/, "")).toLowerCase();
      return { ok: true, codes: demo.codes.filter((c) => (c.label + c.email + c.note).toLowerCase().includes(q)) };
    }
    if (p[1] === "codes" && p[2] === "batch") {
      const labels = Array.from({ length: Math.min(Number(body.count) || 1, 500) }, () => randomLabel(body.prefix));
      labels.forEach((label) => demo.codes.unshift({ ...body, label, devices: 0, first_used_at: 0, until: 0, created_at: Date.now() }));
      return done({ labels });
    }
    if (p[1] === "codes" && method === "POST" && !p[2]) {
      const label = body.label || randomLabel();
      if (demo.codes.some((c) => c.label.toUpperCase() === label.toUpperCase())) throw new Error(`Код ${label} уже есть`);
      demo.codes.unshift({ ...body, label, max_uses: body.maxUses || 0, valid_until: body.validUntil || 0, devices: 0, first_used_at: 0, until: 0, created_at: Date.now() });
      return done({ label });
    }
    const code = demo.codes.find((c) => c.label === decodeURIComponent(p[2] || ""));
    if (p[1] === "codes" && p[3] === "extend" && code) { code.months = (code.months || 0) + Number(body.months || 1); return done(); }
    if (p[1] === "codes" && p[3] === "reset" && code) { code.devices = 0; return done(); }
    if (p[1] === "codes" && method === "DELETE") { demo.codes = demo.codes.filter((c) => c !== code); return done(); }
    if (p[1] === "import") {
      const exists = demo.tours.some((x) => x.id === body.id);
      return demoApi("PUT", "/admin/tours/" + body.id, { ...body, published: exists ? body.published : false });
    }
    if (p[1] === "repo") return { ok: true, files: [] };
    if (p[1] === "logout") return { ok: true };
    throw new Error("В демо это недоступно");
  }

  // Та же проверка экскурсии, что на сервере (чтобы ошибки было видно сразу)
  function checkTour(t) {
    if (!/^[a-z0-9-]{2,60}$/.test(String(t.id || ""))) throw new Error("Адрес экскурсии (id): только латинские буквы, цифры и дефис");
    if (!String(t.title || "").trim()) throw new Error("Нужно название экскурсии");
    if (!t.stops || !t.stops.length) throw new Error("Нужна хотя бы одна остановка");
    t.stops.forEach((s, i) => {
      if (!String(s.title || "").trim()) throw new Error(`У остановки №${i + 1} нет названия`);
      if (!isFinite(Number(s.lat)) || !isFinite(Number(s.lng)) || s.lat === "" || s.lng === "") throw new Error(`У остановки «${s.title}» не указаны координаты`);
      if (s.question && !s.question.answers.length) throw new Error(`У вопроса на остановке «${s.title}» нет правильных ответов`);
      if (s.question && s.question.options && !s.question.answers.some((a) => s.question.options.some((o) => o.trim().toLowerCase() === a.trim().toLowerCase())))
        throw new Error(`На остановке «${s.title}»: правильный ответ должен совпадать с одним из вариантов`);
    });
    return t;
  }

  // ================== Общие части ==================
  function top(active) {
    const link = (h, t) => `<a href="#/${h}" ${active === h ? 'aria-current="page"' : ""}>${t}</a>`;
    const f = S.flash ? `<p class="msg ${S.flash.bad ? "bad" : "ok"}">${esc(S.flash.text)}</p>` : "";
    S.flash = null;
    return `<header class="adm-top"><a class="brand" href="../#/">Аудио<b>Москва</b> · админка</a>
      <nav class="adm-nav">${link("tours", "Экскурсии")}${link("categories", "Плитки")}${link("codes", "Коды")}${link("import", "Импорт")}
      <a href="#/logout">Выйти</a></nav></header>
      ${S.demo ? `<p class="demo-banner">Демо-режим: сервера пока нет, изменения сохраняются только в этом браузере и туристы их не видят.</p>` : ""}${f}`;
  }
  async function loadData() { S.data = await api("GET", "/admin/data"); }

  // ================== Вход ==================
  function renderLogin() {
    const step2 = !!S.loginEmail;
    return `<div class="login"><h1>Вход в админку</h1>
      ${S.flash ? `<p class="msg ${S.flash.bad ? "bad" : "ok"}">${esc(S.flash.text)}</p>` : ""}
      ${step2 ? `<form class="form" id="login2"><p>Мы отправили 6-значный код на <b>${esc(S.loginEmail)}</b>.</p>
          <label class="field"><span>Код из письма</span><input id="l-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
          <button class="btn" type="submit">Войти</button>
          <button class="link-btn" type="button" data-act="login-back">Ввести почту заново</button></form>`
        : `<form class="form" id="login1">
          <label class="field"><span>Почта</span><input id="l-email" type="email" autocomplete="username"></label>
          <label class="field"><span>Пароль</span><input id="l-pass" type="password" autocomplete="current-password"></label>
          <button class="btn" type="submit">Дальше</button></form>`}</div>`;
  }

  // ================== Экскурсии ==================
  function renderTours() {
    const cats = Object.fromEntries(S.data.categories.map((c) => [c.id, c.title]));
    const rows = S.data.tours.map((t) => `<div class="item">
        <div class="item-main"><strong>${esc(t.title)}</strong>
        <small>${KIND[t.kind] || ""} · ${t.stops.length} ост. · ${(t.categories || []).map((c) => esc(cats[c] || c)).join(", ") || "без плитки"} · ${t.price} ₽</small></div>
        <span class="pill ${t.published ? "" : "off"}">${t.published ? "На сайте" : "Скрыта"}</span>
        <button class="btn small secondary" data-go="#/tour/${t.id}">Изменить</button></div>`).join("");
    return `${top("tours")}<div class="row-head"><h1>Экскурсии</h1>
      <button class="btn small" data-go="#/tour/new">+ Новая экскурсия</button></div>
      <div class="rows">${rows || '<p class="empty">Экскурсий пока нет.</p>'}</div>`;
  }

  function newTour() {
    return { id: "", title: "", note: "", published: false, categories: [], kind: "walk", minutes: 120, km: 3, start: "", finish: "",
      price: 590, accessMonths: 6, short: "", description: "", stops: [{ title: "", lat: "", lng: "" }], _new: true };
  }
  const coordsText = (s) => (s.lat !== "" && s.lat != null ? `${s.lat}, ${s.lng}` : "");
  function parseCoords(text) {
    const m = String(text).replace(/[()]/g, "").match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
    return m ? { lat: Number(m[1].replace(",", ".")), lng: Number(m[2].replace(",", ".")) } : null;
  }

  function fileBlock(i, kind, value) {
    const isAudio = kind === "audio";
    const preview = value ? (isAudio ? `<audio controls preload="none" src="${esc(src(value))}"></audio>` : `<img src="${esc(src(value))}" alt="">`) : "";
    return `<div class="field"><span>${isAudio ? "Аудио" : "Фото"}</span>
      <div class="file-row">${preview}
        <label class="small-btn">${value ? "Заменить" : "Загрузить"}<input type="file" hidden accept="${isAudio ? "audio/*,.mp3,.m4a" : "image/*"}" data-upload="${kind}" data-i="${i}"></label>
        ${value ? `<button class="small-btn" type="button" data-act="clear-file" data-kind="${kind}" data-i="${i}">Убрать</button>` : ""}
      </div><span class="file-name">${value ? esc(String(value).startsWith("blob:") ? "файл загружен (в демо не сохраняется)" : value) : isAudio ? "Пока играет тестовый звук" : "Без фото"}</span></div>`;
  }
  const src = (v) => (String(v).startsWith("blob:") || String(v).startsWith("data:") ? v : "../" + v);

  function stopCard(s, i, n) {
    const q = s.question;
    return `<div class="stop ${q ? "has-q" : ""}" data-stop="${i}">
      <div class="stop-head"><span class="num${q ? " q" : ""}">${i + 1}</span>
        <input aria-label="Название остановки" data-f="title" value="${esc(s.title)}" placeholder="Название остановки">
        <span class="stop-tools">
          <button class="icon-btn" type="button" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Выше">↑</button>
          <button class="icon-btn" type="button" data-act="down" ${i === n - 1 ? "disabled" : ""} aria-label="Ниже">↓</button>
          <button class="icon-btn" type="button" data-act="del-stop" aria-label="Удалить остановку">✕</button></span></div>
      <label class="field"><span>Координаты</span><input data-f="coords" value="${esc(coordsText(s))}" placeholder="55.7525, 37.6040">
        <small>В Яндекс Картах: нажмите на место правой кнопкой (на телефоне — долгим нажатием) и скопируйте цифры.</small></label>
      <div class="grid2">${fileBlock(i, "audio", s.audio)}${fileBlock(i, "photo", s.photo)}</div>
      <label class="field"><span>Текст под аудио (необязательно)</span><textarea data-f="text" placeholder="Пусто — будет только аудио. Пустая строка — новый абзац.">${esc(s.text || "")}</textarea></label>
      <div class="checks"><label><input type="checkbox" data-f="hasQ" ${q ? "checked" : ""}> Вопрос квеста на этой остановке</label></div>
      ${q ? `<div class="grid2">
        <label class="field"><span>Вопрос</span><textarea data-f="qText">${esc(q.text)}</textarea></label>
        <label class="field"><span>Варианты ответа — каждый с новой строки (необязательно)</span><textarea data-f="qOptions" placeholder="А&#10;Б&#10;В">${esc((q.options || []).join("\n"))}</textarea>
          <small>Пусто — турист вписывает ответ сам. Заполнено — выбирает кнопкой; правильные варианты укажите в соседнем поле.</small></label>
        <label class="field"><span>Правильные ответы — каждый с новой строки</span><textarea data-f="qAnswers" placeholder="колонна&#10;колонны">${esc(q.answers.join("\n"))}</textarea>
          <small>Большие и маленькие буквы, «ё» и знаки препинания не важны.</small></label>
        <label class="field"><span>Пояснение после ответа</span><textarea data-f="qExplain">${esc(q.explain || "")}</textarea></label></div>` : ""}
    </div>`;
  }

  function renderTourEdit() {
    const t = S.draft;
    const cats = S.data.categories.map((c) => `<label><input type="checkbox" data-cat="${c.id}" ${t.categories.includes(c.id) ? "checked" : ""}> ${esc(c.title)}</label>`).join("");
    const field = (f, label, type, extra) => `<label class="field"><span>${label}</span><input data-t="${f}" type="${type || "text"}" value="${esc(t[f])}" ${extra || ""}></label>`;
    return `${top("tours")}<div class="row-head"><h1>${t._new ? "Новая экскурсия" : esc(t.title)}</h1>
      ${t._new ? "" : `<a class="link-btn" href="../#/t/${esc(t.id)}" target="_blank" rel="noopener">Открыть на сайте</a>`}</div>
      <form class="form" id="tour-form" autocomplete="off">
        <div class="box form">
          <div class="checks"><label><input type="checkbox" data-t="published" ${t.published ? "checked" : ""}> Показывать на сайте</label></div>
          <div class="grid2">
            ${field("title", "Название")}
            ${field("note", "Пометка (необязательно)", "text", 'placeholder="Например, «Новинка»"')}
            <label class="field"><span>Адрес на сайте (латиницей)</span><input data-t="id" value="${esc(t.id)}" ${t._new ? "" : "readonly"} placeholder="neobychnye-smerti">
              <small>${t._new ? "Заполнится сам по названию. Потом поменять нельзя." : "Не меняется."}</small></label>
            <label class="field"><span>Вид</span><select data-t="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${t.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          </div>
          <div class="field"><span>В каких плитках показывать</span><div class="checks">${cats}</div></div>
          <div class="grid2">
            ${field("minutes", "Длительность, минут", "number", 'min="10" step="5"')}
            ${field("km", "Длина, км", "number", 'min="0" step="0.1"')}
            ${field("price", "Цена, ₽", "number", 'min="0" step="10"')}
            ${field("accessMonths", "Срок доступа, месяцев", "number", 'min="1" step="1"')}
            ${field("start", "Старт", "text", 'placeholder="м. Арбатская"')}
            ${field("finish", "Финиш", "text", 'placeholder="Пушкинская площадь"')}
          </div>
          <label class="field"><span>Коротко — для списка</span><input data-t="short" value="${esc(t.short)}"></label>
          <label class="field"><span>Описание — для страницы экскурсии</span><textarea data-t="description">${esc(t.description)}</textarea></label>
        </div>
        <div class="row-head"><h2>Остановки (${t.stops.length})</h2>
          <label class="small-btn">Взять точки из GPX<input type="file" hidden accept=".gpx,application/gpx+xml" id="gpx-in"></label></div>
        <div class="rows" id="stops">${t.stops.map((s, i) => stopCard(s, i, t.stops.length)).join("")}</div>
        <button class="btn secondary" type="button" data-act="add-stop">+ Добавить остановку</button>
        <div class="save-bar"><button class="btn" type="submit">Сохранить</button>
          <button class="btn secondary small" type="button" data-act="export">Скачать файлом</button>
          ${t._new ? "" : `<button class="btn danger small" type="button" data-act="del-tour">Удалить экскурсию</button>`}
          <span class="dl-note" id="save-note"></span></div>
      </form>`;
  }

  // Собираем черновик из полей формы
  function readForm() {
    const t = S.draft, form = document.getElementById("tour-form");
    if (!form) return t;
    form.querySelectorAll("[data-t]").forEach((el) => {
      const f = el.getAttribute("data-t");
      if (el.type === "checkbox") t[f] = el.checked;
      else if (el.type === "number") t[f] = el.value === "" ? "" : Number(el.value);
      else t[f] = el.value;
    });
    t.categories = Array.from(form.querySelectorAll("[data-cat]:checked")).map((el) => el.getAttribute("data-cat"));
    form.querySelectorAll("[data-stop]").forEach((card) => {
      const s = t.stops[Number(card.getAttribute("data-stop"))];
      const val = (f) => { const el = card.querySelector(`[data-f="${f}"]`); return el ? el.value : undefined; };
      s.title = val("title");
      const c = parseCoords(val("coords"));
      s.lat = c ? c.lat : ""; s.lng = c ? c.lng : "";
      s.text = val("text");
      if (!s.text) delete s.text;
      if (card.querySelector('[data-f="hasQ"]').checked) {
        s.question = s.question || { text: "", answers: [], explain: "" };
        if (val("qText") !== undefined) {
          s.question.text = val("qText");
          s.question.answers = val("qAnswers").split("\n").map((a) => a.trim()).filter(Boolean);
          s.question.explain = val("qExplain");
          const opts = val("qOptions").split("\n").map((o) => o.trim()).filter(Boolean);
          if (opts.length) s.question.options = opts; else delete s.question.options;
        }
      } else delete s.question;
    });
    return t;
  }
  const keepScroll = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };

  function tourForSave() {
    const t = JSON.parse(JSON.stringify(readForm()));
    delete t._new;
    t.stops.forEach((s) => { if (s.question && !s.question.text.trim()) delete s.question; });
    return t;
  }

  // ================== Плитки ==================
  function renderCategories() {
    const list = S.data.categories;
    const rows = list.map((c, i) => `<div class="item" data-cat-row="${i}">
      <div class="grid2" style="flex:1 1 100%">
        <label class="field"><span>Название</span><input data-c="title" value="${esc(c.title)}"></label>
        <label class="field"><span>Подпись</span><input data-c="subtitle" value="${esc(c.subtitle)}"></label>
        <label class="field"><span>Иконка</span><select data-c="icon">${Object.entries(ICONS).map(([k, v]) => `<option value="${k}" ${c.icon === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="field"><span>Адрес (латиницей)</span><input data-c="id" value="${esc(c.id)}"></label>
        <div class="field"><span>Фото на всю плитку (без фото — иконка)</span>
          <div class="file-row">${c.photo ? `<img src="${esc(src(c.photo))}" alt="">` : ""}
            <label class="small-btn">${c.photo ? "Заменить" : "Загрузить"}<input type="file" hidden accept="image/*" data-cat-photo="${i}"></label>
            ${c.photo ? `<button class="small-btn" type="button" data-act="cat-photo-clear">Убрать</button>` : ""}</div></div>
      </div>
      <span class="stop-tools"><button class="icon-btn" data-act="cat-up" ${i === 0 ? "disabled" : ""} aria-label="Выше">↑</button>
      <button class="icon-btn" data-act="cat-down" ${i === list.length - 1 ? "disabled" : ""} aria-label="Ниже">↓</button>
      <button class="icon-btn" data-act="cat-del" aria-label="Удалить">✕</button></span></div>`).join("");
    return `${top("categories")}<h1>Плитки на главной</h1>
      <p class="lead">Порядок здесь — порядок плиток на сайте. Если поменять адрес плитки, экскурсии нужно будет заново отметить галочками.</p>
      <div class="rows">${rows}</div>
      <div class="save-bar"><button class="btn secondary small" data-act="cat-add">+ Добавить плитку</button>
      <button class="btn" data-act="cat-save">Сохранить плитки</button></div>`;
  }
  function readCategories() {
    document.querySelectorAll("[data-cat-row]").forEach((row) => {
      const c = S.data.categories[Number(row.getAttribute("data-cat-row"))];
      row.querySelectorAll("[data-c]").forEach((el) => { c[el.getAttribute("data-c")] = el.value.trim(); });
    });
  }

  // ================== Коды ==================
  function tourOptions(multiAll) {
    return `${multiAll ? '<option value="all">Все экскурсии (абонемент)</option>' : ""}` +
      S.data.tours.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join("");
  }
  function codeStatus(c) {
    if (c.type === "promo") return `${c.devices} чел.${c.max_uses ? " из " + c.max_uses : ""}${c.valid_until ? " · до " + dateText(c.valid_until) : ""}`;
    if (!c.first_used_at) return "ещё не введён";
    return (c.until > Date.now() ? "открыт до " : "истёк ") + dateText(c.until) + ` · телефонов: ${c.devices}`;
  }
  function renderCodes() {
    const names = Object.fromEntries(S.data.tours.map((t) => [t.id, t.title]));
    const rows = (S.codes || []).map((c) => `<tr><td><code>${esc(c.label)}</code><br><small>${TYPE[c.type] || c.type}</small></td>
      <td>${c.tours === "all" ? "Все экскурсии" : c.tours.map((id) => esc(names[id] || id)).join(", ")}</td>
      <td>${esc(c.email || "")}${c.note ? `<br><small>${esc(c.note)}</small>` : ""}</td>
      <td>${codeStatus(c)}</td>
      <td><button class="small-btn" data-act="code-extend" data-code="${esc(c.label)}">+1 мес.</button>
        ${c.type === "promo" ? "" : `<button class="small-btn" data-act="code-reset" data-code="${esc(c.label)}">Сбросить телефоны</button>`}
        <button class="small-btn" data-act="code-del" data-code="${esc(c.label)}">Удалить</button></td></tr>`).join("");
    return `${top("codes")}<h1>Коды доступа</h1>
      <div class="grid2">
        <form class="box form" id="batch-form"><h2 style="margin:0">Одноразовые коды</h2>
          <p class="dl-note left">Для бесплатного доступа: каждый код срабатывает один раз. Раздайте их знакомым, гидам, блогерам.</p>
          <label class="field"><span>Экскурсия</span><select name="tour">${tourOptions(true)}</select></label>
          <div class="grid2"><label class="field"><span>Сколько кодов</span><input name="count" type="number" value="10" min="1" max="500"></label>
          <label class="field"><span>Срок, месяцев</span><input name="months" type="number" value="1" min="1"></label></div>
          <label class="field"><span>Начало кода (необязательно)</span><input name="prefix" placeholder="FREE"></label>
          <label class="field"><span>Пометка для себя</span><input name="note" placeholder="Для блогеров, октябрь"></label>
          <button class="btn small" type="submit">Создать</button>
          ${S.batchOut ? `<div class="codes-out" id="batch-out">${esc(S.batchOut)}</div><button class="small-btn" type="button" data-act="copy-batch">Скопировать</button>` : ""}
        </form>
        <form class="box form" id="one-form"><h2 style="margin:0">Промокод или код вручную</h2>
          <p class="dl-note left">Промокод — один код для многих (например, «ПРОБА»). Код покупателю — если продали экскурсию сами.</p>
          <label class="field"><span>Тип</span><select name="type"><option value="promo">Промокод для многих</option><option value="purchase">Код покупателю</option><option value="subscription">Абонемент</option></select></label>
          <label class="field"><span>Код (пусто — придумаем сами)</span><input name="label" placeholder="ПРОБА"></label>
          <label class="field"><span>Экскурсия</span><select name="tour">${tourOptions(true)}</select></label>
          <div class="grid2"><label class="field"><span>Срок, месяцев</span><input name="months" type="number" value="1" min="1"></label>
          <label class="field"><span>Промокод: сколько человек</span><input name="maxUses" type="number" value="50" min="0"><small>0 — без ограничения</small></label></div>
          <div class="grid2"><label class="field"><span>Промокод: действует до</span><input name="validUntil" type="date"></label>
          <label class="field"><span>Почта покупателя</span><input name="email" type="email"></label></div>
          <button class="btn small" type="submit">Создать</button>
        </form>
      </div>
      <h2>Все коды</h2>
      <form class="row-head" id="code-search"><label class="field" style="flex:1"><span>Поиск по коду, почте или пометке</span>
        <input name="q" value="${esc(S.codesQuery)}" placeholder="Например, @mail.ru"></label><button class="btn small secondary" type="submit">Найти</button></form>
      <div class="table-wrap"><table class="codes"><thead><tr><th>Код</th><th>Экскурсии</th><th>Почта, пометка</th><th>Состояние</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Кодов не найдено.</td></tr>'}</tbody></table></div>
      <p class="dl-note left">Заказы (кто, что и когда купил) появятся здесь вместе с оплатой.</p>`;
  }

  // ================== Импорт ==================
  let repoFiles = null;
  function renderImport() {
    const repo = S.demo ? `<p class="dl-note left">В демо-режиме список из хранилища недоступен.</p>`
      : repoFiles === null ? `<p class="dl-note left">Загружаем…</p>`
      : repoFiles.length ? `<div class="rows">${repoFiles.map((f) => `<div class="item"><div class="item-main"><strong>${esc(f.title || f.file)}</strong>
          <small>${f.error ? esc(f.error) : `${f.stops} ост. · файл ${esc(f.file)}`}</small></div>
          ${f.error ? "" : `<span class="pill ${f.status === "same" ? "off" : "warn"}">${{ new: "Новая", changed: "Есть изменения", same: "Уже загружена" }[f.status]}</span>
          ${f.status === "same" ? "" : `<button class="btn small" data-act="repo-import" data-file="${esc(f.file)}">Загрузить</button>`}`}</div>`).join("")}</div>`
      : `<p class="dl-note left">В хранилище пока нет подготовленных экскурсий.</p>`;
    return `${top("import")}<h1>Импорт экскурсий</h1>
      <h2>Подготовленные Claude (из хранилища)</h2>
      <p class="lead">Когда Claude готовит экскурсию по вашим текстам и аудио, она появляется здесь. Нажмите «Загрузить» — экскурсия добавится скрытой, проверьте её и включите «Показывать на сайте».</p>
      ${repo}
      <h2>Из файла</h2>
      <div class="box form"><label class="field"><span>Файл экскурсии (.json)</span><input type="file" accept=".json,application/json" id="import-file"></label>
        <p class="dl-note left">Такой файл получается кнопкой «Скачать файлом» на странице экскурсии. Новая экскурсия добавится скрытой.</p></div>`;
  }

  // ================== Отрисовка ==================
  async function render() {
    const [screen, id] = route();
    try {
      if (screen === "logout") { await api("POST", "/admin/logout"); S.me = null; S.data = null; go("#/login"); return; }
      if (!S.me) { root.innerHTML = renderLogin(); S.flash = null; return; }
      if (screen === "login") { go("#/tours"); return; }
      if (!S.data) await loadData();
      if (screen === "tour") {
        if (!S.draft || S.draft.id !== id || (id === "new" && !S.draft._new)) {
          const t = id === "new" ? newTour() : S.data.tours.find((x) => x.id === id);
          if (!t) { go("#/tours"); return; }
          S.draft = JSON.parse(JSON.stringify(t));
          if (id === "new") S.draft.id = "";
        }
        root.innerHTML = renderTourEdit();
      } else if (screen === "categories") {
        root.innerHTML = renderCategories();
      } else if (screen === "codes") {
        if (!S.codes) S.codes = (await api("GET", "/admin/codes?q=" + encodeURIComponent(S.codesQuery))).codes;
        root.innerHTML = renderCodes();
      } else if (screen === "import") {
        root.innerHTML = renderImport();
        if (!S.demo && repoFiles === null) {
          api("GET", "/admin/repo").then((r) => { repoFiles = r.files; if (route()[0] === "import") root.innerHTML = renderImport(); })
            .catch(() => { repoFiles = []; });
        }
      } else {
        S.draft = null;
        root.innerHTML = renderTours();
      }
    } catch (e) {
      root.innerHTML = `${top("")}<p class="msg bad">${esc(e.message)}</p>`;
    }
  }

  // ================== Нажатия ==================
  root.addEventListener("click", async (e) => {
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); go(g.getAttribute("data-go")); return; }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const act = a.getAttribute("data-act");
    const stopEl = a.closest("[data-stop]");
    const si = stopEl ? Number(stopEl.getAttribute("data-stop")) : Number(a.getAttribute("data-i"));
    try {
      if (act === "login-back") { S.loginEmail = ""; render(); }
      // --- остановки ---
      else if (["up", "down", "del-stop", "add-stop", "clear-file"].includes(act)) {
        readForm();
        const st = S.draft.stops;
        if (act === "up") [st[si - 1], st[si]] = [st[si], st[si - 1]];
        if (act === "down") [st[si + 1], st[si]] = [st[si], st[si + 1]];
        if (act === "del-stop") { if (st.length === 1) { flash("Должна остаться хотя бы одна остановка", true); } else st.splice(si, 1); }
        if (act === "add-stop") st.push({ title: "", lat: "", lng: "" });
        if (act === "clear-file") delete st[si][a.getAttribute("data-kind")];
        keepScroll(() => { root.innerHTML = renderTourEdit(); });
      } else if (act === "export") {
        const t = tourForSave();
        const url = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = (t.id || "ekskursiya") + ".json"; document.body.appendChild(link); link.click(); link.remove();
      } else if (act === "del-tour") {
        if (a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = "Точно удалить? Нажмите ещё раз"; return; }
        await api("DELETE", "/admin/tours/" + S.draft.id);
        await loadData(); flash("Экскурсия удалена"); go("#/tours");
      }
      // --- плитки ---
      else if (act.startsWith("cat-")) {
        readCategories();
        const list = S.data.categories, row = a.closest("[data-cat-row]"), ci = row ? Number(row.getAttribute("data-cat-row")) : -1;
        if (act === "cat-up") [list[ci - 1], list[ci]] = [list[ci], list[ci - 1]];
        if (act === "cat-down") [list[ci + 1], list[ci]] = [list[ci], list[ci + 1]];
        if (act === "cat-del") list.splice(ci, 1);
        if (act === "cat-photo-clear") delete list[ci].photo;
        if (act === "cat-add") list.push({ id: "new-" + (list.length + 1), title: "Новая плитка", subtitle: "", icon: "walk" });
        if (act === "cat-save") {
          list.forEach((c) => { if (!/^[a-z0-9-]{2,30}$/.test(c.id) || !c.title) throw new Error("У каждой плитки нужно название и адрес латиницей"); });
          await api("PUT", "/admin/categories", list); await loadData(); flash("Плитки сохранены");
        }
        keepScroll(() => { root.innerHTML = renderCategories(); });
      }
      // --- коды ---
      else if (act === "code-extend" || act === "code-reset" || act === "code-del") {
        const code = encodeURIComponent(a.getAttribute("data-code"));
        if (act === "code-del" && a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = "Точно?"; return; }
        if (act === "code-extend") await api("POST", `/admin/codes/${code}/extend`, { months: 1 });
        if (act === "code-reset") await api("POST", `/admin/codes/${code}/reset`, {});
        if (act === "code-del") await api("DELETE", `/admin/codes/${code}`);
        S.codes = null; flash({ "code-extend": "Срок продлён на месяц", "code-reset": "Телефоны сброшены: код можно ввести заново", "code-del": "Код удалён" }[act]);
        keepScroll(() => render());
      } else if (act === "copy-batch") {
        try { await navigator.clipboard.writeText(S.batchOut); a.textContent = "Скопировано"; }
        catch (err) { const r = document.createRange(); r.selectNodeContents(document.getElementById("batch-out")); getSelection().removeAllRanges(); getSelection().addRange(r); }
      }
      // --- импорт ---
      else if (act === "repo-import") {
        await api("POST", `/admin/repo/${encodeURIComponent(a.getAttribute("data-file"))}/import`, {});
        repoFiles = null; await loadData(); flash("Экскурсия загружена. Она скрыта — проверьте и включите «Показывать на сайте»."); render();
      }
    } catch (err) {
      flash(err.message, true);
      keepScroll(() => render());
    }
  });

  // Название новой экскурсии → адрес латиницей; галочка вопроса → показать поля
  root.addEventListener("input", (e) => {
    if (e.target.matches('[data-t="title"]') && S.draft && S.draft._new) {
      const idEl = root.querySelector('[data-t="id"]');
      if (idEl && (!idEl.dataset.touched)) idEl.value = slug(e.target.value);
    }
    if (e.target.matches('[data-t="id"]')) e.target.dataset.touched = "1";
  });
  root.addEventListener("change", async (e) => {
    const el = e.target;
    try {
      if (el.matches('[data-f="hasQ"]')) { readForm(); keepScroll(() => { root.innerHTML = renderTourEdit(); }); }
      else if (el.matches("[data-upload]") && el.files[0]) {
        const file = el.files[0], kind = el.getAttribute("data-upload"), i = Number(el.getAttribute("data-i"));
        readForm();
        const note = document.getElementById("save-note"); if (note) note.textContent = "Загружаем файл…";
        const r = S.demo ? await api("POST", "/admin/upload", file)
          : await api("POST", "/admin/upload?name=" + encodeURIComponent(file.name), file, true);
        S.draft.stops[i][kind] = r.url;
        keepScroll(() => { root.innerHTML = renderTourEdit(); });
      } else if (el.matches("[data-cat-photo]") && el.files[0]) {
        readCategories();
        const file = el.files[0], ci = Number(el.getAttribute("data-cat-photo"));
        const r = S.demo ? await api("POST", "/admin/upload", file)
          : await api("POST", "/admin/upload?name=" + encodeURIComponent(file.name), file, true);
        S.data.categories[ci].photo = r.url;
        flash("Фото загружено. Не забудьте «Сохранить плитки».");
        keepScroll(() => { root.innerHTML = renderCategories(); });
      } else if (el.id === "gpx-in" && el.files[0]) {
        readForm();
        const doc = new DOMParser().parseFromString(await el.files[0].text(), "application/xml");
        let pts = Array.from(doc.getElementsByTagName("wpt"));
        if (!pts.length) throw new Error("В файле GPX нет точек остановок (wpt)");
        pts = pts.map((p) => ({ lat: Number(p.getAttribute("lat")), lng: Number(p.getAttribute("lon")),
          title: ((p.getElementsByTagName("name")[0] || {}).textContent || "").replace(/^\d+\.\s*/, "") }));
        const st = S.draft.stops, onlyEmpty = st.length === 1 && !st[0].title;
        if (onlyEmpty) S.draft.stops = pts;
        else pts.forEach((p, i) => { if (st[i]) { st[i].lat = p.lat; st[i].lng = p.lng; } else st.push(p); });
        flash(`Из GPX взято точек: ${pts.length}`);
        keepScroll(() => { root.innerHTML = renderTourEdit(); });
      } else if (el.id === "import-file" && el.files[0]) {
        const t = JSON.parse(await el.files[0].text());
        await api("POST", "/admin/import", t);
        await loadData(); flash(`Экскурсия «${t.title}» загружена. Она скрыта — проверьте и включите «Показывать на сайте».`); go("#/tour/" + t.id);
      }
    } catch (err) { flash(err.message, true); keepScroll(() => render()); }
  });

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.id === "login1") {
        const email = f.querySelector("#l-email").value.trim();
        await api("POST", "/admin/login", { email, password: f.querySelector("#l-pass").value });
        S.loginEmail = email; render();
      } else if (f.id === "login2") {
        await api("POST", "/admin/login/code", { email: S.loginEmail, code: f.querySelector("#l-code").value });
        S.me = await api("GET", "/admin/me"); S.loginEmail = ""; go("#/tours");
      } else if (f.id === "tour-form") {
        const t = tourForSave();
        checkTour(t);
        const isNew = !!S.draft._new;
        if (isNew && S.data.tours.some((x) => x.id === t.id)) throw new Error("Экскурсия с таким адресом уже есть — поменяйте адрес");
        const r = await api("PUT", "/admin/tours/" + t.id, t);
        await loadData();
        S.draft = JSON.parse(JSON.stringify(r.tour));
        flash(isNew ? "Экскурсия создана" : "Сохранено");
        if (isNew) go("#/tour/" + t.id); else keepScroll(() => render());
      } else if (f.id === "batch-form") {
        const d = Object.fromEntries(new FormData(f));
        const r = await api("POST", "/admin/codes/batch", { count: d.count, prefix: d.prefix, type: "single", tours: d.tour === "all" ? "all" : [d.tour], months: d.months, note: d.note });
        S.batchOut = r.labels.join("\n"); S.codes = null; flash(`Создано кодов: ${r.labels.length}`); render();
      } else if (f.id === "one-form") {
        const d = Object.fromEntries(new FormData(f));
        const r = await api("POST", "/admin/codes", { label: d.label.trim(), type: d.type, tours: d.tour === "all" ? "all" : [d.tour], months: d.months,
          email: d.email, maxUses: d.type === "promo" ? d.maxUses : 0, validUntil: d.validUntil ? new Date(d.validUntil + "T23:59:59").getTime() : 0 });
        S.codes = null; flash(`Код создан: ${r.label}`); render();
      } else if (f.id === "code-search") {
        S.codesQuery = new FormData(f).get("q"); S.codes = null; render();
      }
    } catch (err) {
      flash(err.message, true);
      if (f.id === "login1" || f.id === "login2") render(); else keepScroll(() => render());
    }
  });

  window.addEventListener("hashchange", render);

  // Есть ли сервер? Если нет — демо-режим
  (async () => {
    try {
      const r = await fetch("../api/admin/me", { credentials: "same-origin" });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("нет сервера");
      if (r.ok) S.me = await r.json();
    } catch (e) {
      S.demo = true; S.me = { email: "демо" };
    }
    render();
  })();
})();
