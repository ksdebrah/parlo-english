/* Parlo English — a static, beginner-friendly English app.
   Content: content/weeks.json + content/weeks/*.json. Progress: saved in this browser. */
(function () {
  "use strict";

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const view = $("#view");

  function todayKey(d = new Date()) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function dayNum(key = todayKey()) {
    const [y, m, d] = key.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }

  // ---------- progress (saved on this device) ----------
  const STORE = "parlo-progress-v2";
  const defaults = () => ({
    name: "", welcomed: false, xp: 0, days: [], cards: {}, lessonsDone: {}, quizBest: {},
    speakDone: {}, answered: {}, gameBest: {}, today: { date: "", done: {} },
    quizLast: {}, history: {}, spellMiss: {}, lastSent: "",
    newToday: { date: "", count: 0 },
    settings: { accent: "en-GB", rate: 0.8, newPerDay: 8 }
  });
  let P = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved) P = Object.assign(defaults(), saved, { settings: Object.assign(defaults().settings, saved.settings || {}) });
  } catch (e) { /* storage blocked: progress lasts this visit only */ }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(P)); } catch (e) {} renderStats(); queueSend(); }

  function doneToday(key) {
    if (P.today.date !== todayKey()) P.today = { date: todayKey(), done: {} };
    if (key) {
      P.today.done[key] = true;
      P.history[todayKey()] = Object.keys(P.today.done);
      const keys = Object.keys(P.history).sort();
      while (keys.length > 60) delete P.history[keys.shift()];
    }
    return P.today.done;
  }
  function addXP(n, key) {
    P.xp += n;
    const t = todayKey();
    if (!P.days.includes(t)) P.days.push(t);
    if (key) doneToday(key);
    save();
  }
  function streak() {
    const set = new Set(P.days.map(dayNum));
    let d = dayNum();
    if (!set.has(d)) d -= 1;
    let n = 0;
    while (set.has(d)) { n++; d--; }
    return n;
  }
  function renderStats() {
    $("#streak").textContent = "🔥 " + streak();
    $("#xp").textContent = "⭐ " + P.xp;
  }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2000);
  }

  // ---------- confetti ----------
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = document.createElement("canvas"); c.className = "confetti";
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
    document.body.appendChild(c);
    const ctx = c.getContext("2d"), s = devicePixelRatio;
    const cols = ["#3D5AFE", "#14C46B", "#FFC83D", "#FF5A5F", "#8B5CF6", "#FF8A2B", "#FF4FA0"];
    const bits = Array.from({ length: 110 }, () => ({
      x: c.width / 2, y: c.height * .45, vx: (Math.random() - .5) * 16 * s, vy: (-Math.random() * 14 - 4) * s,
      r: (Math.random() * 6 + 4) * s, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, c.width, c.height);
      bits.forEach(b => { b.x += b.vx; b.y += b.vy; b.vy += .45 * s; b.a += .2; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore(); });
      if (++f < 110) requestAnimationFrame(tick); else c.remove();
    })();
  }

  // ---------- listening (text-to-speech) ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function pickVoice() {
    const norm = l => (l || "").toLowerCase().replace("_", "-");
    const want = P.settings.accent.toLowerCase();
    const en = voices.filter(v => norm(v.lang).startsWith("en"));
    return en.find(v => norm(v.lang) === want && /natural|google|enhanced|premium|siri/i.test(v.name))
      || en.find(v => norm(v.lang) === want) || en[0] || null;
  }
  function speak(text, rate) {
    if (!synth) { toast("Sound isn't available in this browser"); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = P.settings.accent; u.rate = rate || P.settings.rate;
    synth.speak(u);
  }
  const sayBtn = (text, big) => `<button class="say${big ? " big" : ""}" data-say="${esc(text)}" aria-label="Listen: ${esc(text)}">🔊</button>`;
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-say]");
    if (b) { e.preventDefault(); e.stopPropagation(); speak(b.dataset.say); }
  });

  // ---------- speaking check (speech recognition) ----------
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const words = s => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  function compare(target, heard) {
    const pool = words(heard);
    const out = words(target).map(w => {
      const i = pool.indexOf(w);
      if (i >= 0) { pool.splice(i, 1); return { w, ok: true }; }
      return { w, ok: false };
    });
    return { out, pct: Math.round(out.filter(x => x.ok).length / Math.max(1, out.length) * 100) };
  }
  let rec = null;
  function stopRec() { if (rec) { try { rec.abort(); } catch (e) {} rec = null; } }

  // ---------- content ----------
  let WEEKS = [], LESSONS = [], CARDS = [], QUESTIONS = [], CONFIG = {};

  // ---------- progress report (sent to a Google Form so King can see how it's going) ----------
  function report() {
    const days = P.days.slice().sort().slice(-30);
    const cards = {};
    Object.keys(P.cards).forEach(id => { const c = P.cards[id]; cards[id] = [c.box, c.lapses || 0]; });
    return {
      v: 1, name: P.name, sent: new Date().toISOString(), latestWeek: WEEKS.length ? latest().week : null,
      streak: streak(), xp: P.xp, days, history: P.history, learned: learned(), totalCards: CARDS.length,
      cards, lessonsDone: Object.keys(P.lessonsDone), quizBest: P.quizBest, quizLast: P.quizLast,
      games: P.gameBest, spellMiss: P.spellMiss, speakDone: Object.keys(P.speakDone), answered: Object.keys(P.answered),
      settings: { newPerDay: P.settings.newPerDay, rate: P.settings.rate, accent: P.settings.accent },
      hasMic: !!Rec
    };
  }
  let sendTimer = null;
  function queueSend() { clearTimeout(sendTimer); sendTimer = setTimeout(sendProgress, 60000); }
  function sendProgress(force) {
    clearTimeout(sendTimer);
    const f = CONFIG.progressForm;
    if (!f || !f.url || !f.field || !P.welcomed || !navigator.onLine) return Promise.resolve(false);
    const r = report(), body = JSON.stringify(r);
    const sig = JSON.stringify(Object.assign({}, r, { sent: "" }));
    // skip if nothing changed, unless forced or the last send was over 6 hours ago
    if (!force && sig === P.lastSent && Date.now() - (P.lastSentAt || 0) < 6 * 3600 * 1000) return Promise.resolve(false);
    try {
      return fetch(f.url, { method: "POST", mode: "no-cors", keepalive: true, body: new URLSearchParams({ [f.field]: body }) })
        .then(() => { P.lastSent = sig; P.lastSentAt = Date.now(); try { localStorage.setItem(STORE, JSON.stringify(P)); } catch (e) {} return true; })
        .catch(() => false);
    } catch (e) { return Promise.resolve(false); }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sendProgress(); });
  async function loadContent() {
    CONFIG = await fetch("content/config.json", { cache: "no-cache" }).then(r => r.json()).catch(() => ({}));
    const idx = await fetch("content/weeks.json", { cache: "no-cache" }).then(r => r.json());
    const packs = await Promise.all(idx.weeks.map(f =>
      fetch("content/weeks/" + f, { cache: "no-cache" }).then(r => r.json()).catch(() => null)));
    WEEKS = packs.filter(Boolean).sort((a, b) => a.week - b.week);
    WEEKS.forEach(w => {
      (w.lessons || []).forEach(l => LESSONS.push(Object.assign({ week: w.week }, l)));
      (w.cards || []).forEach(c => CARDS.push(Object.assign({ week: w.week }, c)));
      (w.questions || []).forEach(q => QUESTIONS.push(Object.assign({ week: w.week }, q)));
    });
  }
  const latest = () => WEEKS[WEEKS.length - 1];
  const weekByNum = n => WEEKS.find(w => String(w.week) === String(n));

  // ---------- spaced repetition ----------
  const INTERVAL = [0, 1, 3, 7, 14, 30];
  const label = d => d === 0 ? "today" : d === 1 ? "tomorrow" : d < 30 ? "in " + d + " days" : "in a month";
  function newLeftToday() {
    if (P.newToday.date !== todayKey()) P.newToday = { date: todayKey(), count: 0 };
    return Math.max(0, P.settings.newPerDay - P.newToday.count);
  }
  const dueCards = () => { const t = dayNum(); return CARDS.filter(c => P.cards[c.id] && P.cards[c.id].due <= t); };
  const newCards = () => CARDS.filter(c => !P.cards[c.id]);
  const learned = () => CARDS.filter(c => P.cards[c.id] && P.cards[c.id].box >= 1).length;

  // ---------- router ----------
  const routes = {};
  const tabFor = n => ({ lesson: "learn", quiz: "learn", review: "learn", spelling: "learn", game: "play", question: "speak" }[n] || n);
  function go() {
    if (!WEEKS.length) return;
    let [name, arg] = (location.hash.slice(1) || "home").split("/");
    if (!P.welcomed && name !== "welcome") { name = "welcome"; }
    const fn = routes[name] || routes.home;
    if (synth) synth.cancel();
    stopRec();
    $("#tabs").hidden = name === "welcome";
    $$("nav a").forEach(a => a.dataset.tab === tabFor(name) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    fn(arg ? decodeURIComponent(arg) : undefined);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", go);

  // ---------- WELCOME ----------
  routes.welcome = () => {
    view.innerHTML = `
      <section class="card welcome center">
        <div class="mascot">👋</div>
        <h1>Welcome to Parlo!</h1>
        <p class="sub">Learn English a little every day.</p>
        <div style="width:100%;text-align:left;display:flex;flex-direction:column;gap:8px">
          <label for="nm">What's your name?</label>
          <input type="text" id="nm" autocomplete="given-name" placeholder="Your name" maxlength="24" value="${esc(P.name)}">
        </div>
        <div class="how" style="width:100%;text-align:left">
          <div><span style="background:var(--orange-l)">📖</span>Learn new words and phrases</div>
          <div><span style="background:var(--blue-l)">🔊</span>Tap 🔊 to listen, then say it</div>
          <div><span style="background:var(--purple-l)">🎮</span>Play games and win stars ⭐</div>
        </div>
        <button class="btn green block" id="go">Let's start!</button>
      </section>`;
    $("#go").onclick = () => {
      P.name = $("#nm").value.trim(); P.welcomed = true; save();
      speak(P.name ? "Hello " + P.name + "! Let's learn English." : "Hello! Let's learn English.");
      location.hash = "#home"; if (location.hash === "#home") go();
    };
  };

  // ---------- HOME ----------
  function stepItem(n, href, emoji, c, l, title, sub, done) {
    return `<a class="card item" href="${href}"><span class="stepnum">${n}</span>
      <span class="bubble${done ? " done" : ""}" style="--c:${c};--l:${l}">${done ? "✓" : emoji}</span>
      <span class="meta"><h2>${esc(title)}</h2><small>${esc(sub)}</small></span><span class="chev">›</span></a>`;
  }
  routes.home = () => {
    const w = latest(), td = doneToday();
    const wl = LESSONS.filter(l => l.week === w.week), wc = CARDS.filter(c => c.week === w.week);
    const wlDone = wl.filter(l => P.lessonsDone[l.id]).length;
    const wcLearned = wc.filter(c => P.cards[c.id] && P.cards[c.id].box >= 1).length;
    const best = P.quizBest[w.week];
    const pct = Math.round((wlDone + wcLearned + (best != null ? 1 : 0)) / (wl.length + wc.length + 1) * 100);
    const due = dueCards().length, fresh = Math.min(newCards().length, newLeftToday());
    const nextLesson = LESSONS.find(l => !P.lessonsDone[l.id]);
    const h = new Date().getHours();
    const hi = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    view.innerHTML = `
      <div class="hello"><span class="wave">👋</span><div><p class="sub">${hi}</p><h1>Hi${P.name ? ", " + esc(P.name) : ""}!</h1></div></div>
      ${installBanner()}
      <a class="card hero" href="#learn" style="text-decoration:none">
        <span class="big-emoji">${esc(w.emoji || "📘")}</span>
        <span class="label">This week · Week ${w.week}</span>
        <h2>${esc(w.title)}</h2>
        <p>${esc(w.intro || "")}</p>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <small>${pct}% done · ${wlDone}/${wl.length} lessons · ${wcLearned}/${wc.length} words</small>
      </a>
      <a class="card gamecard" href="#play" style="--c:var(--purple);--d:var(--purple-d);padding:14px"><span class="gi" style="width:56px;height:56px;font-size:2rem">🎮</span><span class="meta"><h2>Play a game</h2><small>Listen & Tap · Match Pairs · Spell It</small></span><span class="chev" style="color:#fff">›</span></a>
      <div class="head"><span class="label">Today's 5 steps</span></div>
      <div class="steps">
        ${nextLesson
          ? stepItem(1, "#lesson/" + nextLesson.id, nextLesson.emoji || "📖", "var(--orange)", "var(--orange-l)", "Learn: " + nextLesson.title, `Week ${nextLesson.week} · ${(nextLesson.phrases || []).length} phrases`, td.lesson)
          : stepItem(1, "#learn", "📖", "var(--orange)", "var(--orange-l)", "All lessons done!", "New lessons come every week", true)}
        ${stepItem(2, "#cards", "🃏", "var(--green)", "var(--green-l)", due + fresh ? `Words: ${due + fresh} cards` : "Words: all done", due ? `${due} to review, ${fresh} new` : fresh ? `${fresh} new words` : "Come back tomorrow", !(due + fresh) || td.cards)}
        ${stepItem(3, "#spelling", "✏️", "var(--green)", "var(--green-l)", "Spelling test", "Listen and write the word", td.game)}
        ${best == null
          ? stepItem(4, "#quiz/" + w.week, "❓", "var(--blue)", "var(--blue-l)", `Week ${w.week} quiz`, `${(w.quiz || []).length} easy questions`, td.quiz)
          : stepItem(4, "#review", "🧠", "var(--blue)", "var(--blue-l)", "My words quiz", "Questions on words you learned", td.quiz)}
        ${stepItem(5, "#speak", "🎤", "var(--pink)", "var(--pink-l)", "Speak", "Say sentences out loud", td.speak)}
      </div>
      <div class="grid2">
        <div class="card center"><span style="font-size:2rem">🔥</span><b style="font-family:var(--display);font-size:1.6rem;line-height:1">${streak()}</b><small class="sub">days in a row</small></div>
        <div class="card center"><span style="font-size:2rem">🧠</span><b style="font-family:var(--display);font-size:1.6rem;line-height:1">${learned()}</b><small class="sub">words learned</small></div>
      </div>`;
    bindInstall();
  };

  // ---------- install on the home screen ----------
  let installEvt = null;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const inAppBrowser = /FBAN|FBAV|Instagram|Snapchat|TikTok|Line\/|WhatsApp|; wv\)/.test(ua);
  const iosNotSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); installEvt = e;
    const b = $("#install-banner"); if (b) { b.outerHTML = installBanner(); bindInstall(); }
  });
  window.addEventListener("appinstalled", () => {
    installEvt = null; P.installed = true; save(); closeSheet();
    confetti(); toast("Parlo is on your home screen! 🎉");
    const b = $("#install-banner"); if (b) b.remove();
  });
  function installBanner() {
    if (isInstalled() || P.installed) return "";
    if (P.installLater && Date.now() < P.installLater) return "";
    return `<section class="card install" id="install-banner">
        <div class="row" style="flex-wrap:nowrap;gap:12px"><span class="inst-ic">📲</span>
          <div><h2>Put Parlo on your phone</h2><p>Open it with one tap, like an app. It works without internet too.</p></div></div>
        <div class="grid2"><button class="btn white small" id="inst-later">Not now</button><button class="btn small" id="inst-go">${installEvt ? "Install" : "Show me how"}</button></div>
      </section>`;
  }
  function bindInstall() {
    const go2 = $("#inst-go"), later = $("#inst-later");
    if (go2) go2.onclick = doInstall;
    if (later) later.onclick = () => { P.installLater = Date.now() + 3 * 864e5; save(); $("#install-banner").remove(); };
  }
  function doInstall() {
    if (installEvt) {
      installEvt.prompt();
      installEvt.userChoice.then(c => { if (c.outcome !== "accepted") toast("No problem. You can install it later in ⚙️ Settings"); installEvt = null; });
      return;
    }
    showInstallHelp();
  }
  function closeSheet() { const s = $("#sheet"); if (s) s.remove(); }
  function showInstallHelp() {
    let title = "Add Parlo to your home screen", steps;
    if (isIOS && inAppBrowser) steps = [
      ["🧭", "Open this page in <b>Safari</b>.", "Tap <b>⋯</b> or the compass, then <b>Open in Safari</b>."],
      ["⬆️", "Tap the <b>Share</b> button.", "The square with an arrow pointing up."],
      ["➕", "Tap <b>Add to Home Screen</b>.", "Scroll down a little if you can't see it."],
      ["✅", "Tap <b>Add</b>.", "Parlo is now on your home screen!"]];
    else if (isIOS) steps = [
      ["⬆️", "Tap the <b>Share</b> button.", iosNotSafari ? "In Chrome it's at the top right, next to the address." : "At the bottom of the screen: a square with an arrow pointing up."],
      ["➕", "Tap <b>Add to Home Screen</b>.", "Scroll down a little if you can't see it."],
      ["✅", "Tap <b>Add</b>.", "Parlo is now on your home screen!"]];
    else if (isAndroid) steps = [
      ["⋮", "Tap the <b>⋮</b> menu.", "Top right of the screen."],
      ["🌐", "If you see <b>Open in Chrome</b>, tap it first.", "This happens when you open the link from WhatsApp. Then tap ⋮ again."],
      ["📲", "Tap <b>Install app</b> or <b>Add to Home screen</b>.", ""],
      ["✅", "Tap <b>Install</b>.", "Parlo is now on your home screen!"]];
    else { title = "Install Parlo on this computer"; steps = [
      ["⊕", "Click the <b>install icon</b> in the address bar.", "Or open the browser menu and choose <b>Install Parlo</b>."],
      ["✅", "Click <b>Install</b>.", ""]]; }
    closeSheet();
    const s = document.createElement("div"); s.id = "sheet"; s.className = "sheet";
    s.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-t">
        <h2 id="sheet-t">${title}</h2>
        <ol class="isteps">${steps.map(([ic, a, b]) => `<li><span class="ic">${ic}</span><div><span class="t">${a}</span>${b ? `<small>${b}</small>` : ""}</div></li>`).join("")}</ol>
        <div class="grid2"><button class="btn white" id="sheet-x">Close</button><button class="btn green" id="sheet-done">I did it ✓</button></div>
      </div>`;
    document.body.appendChild(s);
    s.onclick = e => { if (e.target === s) closeSheet(); };
    $("#sheet-x").onclick = closeSheet;
    $("#sheet-done").onclick = () => { P.installed = true; save(); closeSheet(); confetti(); toast("Great! Open Parlo from your home screen 🎉"); const b = $("#install-banner"); if (b) b.remove(); };
  }

  // ---------- LEARN ----------
  routes.learn = () => {
    const n = studied().length;
    view.innerHTML = `<div class="head"><h1>Learn 📖</h1><p class="sub">Tap a lesson. Listen 🔊 and repeat.</p></div>
      <div class="head"><span class="label">Test what you learned</span></div>
      <div class="grid2">
        <a class="card center item" href="#review" style="flex-direction:column;gap:6px"><span class="bubble" style="--c:var(--blue);--l:var(--blue-l)">🧠</span><h2>My words quiz</h2><small>${n} words · best ${P.gameBest.review ?? "–"}</small></a>
        <a class="card center item" href="#spelling" style="flex-direction:column;gap:6px"><span class="bubble" style="--c:var(--green);--l:var(--green-l)">✏️</span><h2>Spelling test</h2><small>Listen & write · best ${P.gameBest.spelling ?? "–"}</small></a>
      </div>` +
      WEEKS.slice().reverse().map(w => {
        const ls = LESSONS.filter(l => l.week === w.week), n = (w.quiz || []).length, b = P.quizBest[w.week];
        return `<div class="head"><span class="label">Week ${w.week} · ${esc(w.title)}</span></div>
          <div class="list">${ls.map(l => `
            <a class="card item" href="#lesson/${esc(l.id)}">
              <span class="bubble${P.lessonsDone[l.id] ? " done" : ""}" style="--c:var(--orange);--l:var(--orange-l)">${P.lessonsDone[l.id] ? "✓" : esc(l.emoji || "📖")}</span>
              <span class="meta"><h2>${esc(l.title)}</h2><small>${(l.phrases || []).length} phrases · Level ${esc(l.level)}</small></span><span class="chev">›</span></a>`).join("")}
            <a class="card item" href="#quiz/${w.week}">
              <span class="bubble${b === n ? " done" : ""}" style="--c:var(--blue);--l:var(--blue-l)">${b === n ? "✓" : "❓"}</span>
              <span class="meta"><h2>Week ${w.week} quiz</h2><small>${b != null ? `Best score: ${b}/${n}` : `${n} questions`}</small></span><span class="chev">›</span></a>
          </div>`;
      }).join("");
  };
  routes.lesson = id => {
    const l = LESSONS.find(x => x.id === id);
    if (!l) return routes.learn();
    const done = !!P.lessonsDone[l.id];
    view.innerHTML = `
      <a class="btn white small back" href="#learn">‹ Back</a>
      <div class="lessonhead"><span class="bubble">${esc(l.emoji || "📖")}</span><div class="head"><span class="label">Week ${l.week} · Level ${esc(l.level)}</span><h1>${esc(l.title)}</h1></div></div>
      ${l.intro ? `<p class="sub">${esc(l.intro)}</p>` : ""}
      <div class="card">${(l.phrases || []).map(p => `
        <div class="phrase">${sayBtn(p.en)}<div class="txt"><b>${esc(p.en)}</b>${p.note ? `<span>${esc(p.note)}</span>` : ""}${p.tr ? `<em>${esc(p.tr)}</em>` : ""}</div></div>`).join("")}
      </div>
      ${l.tip ? `<div class="tip">💡 ${esc(l.tip)}</div>` : ""}
      ${l.dialogue ? `<div class="card"><div class="row" style="justify-content:space-between"><span class="label">Conversation</span>
          <button class="btn small" id="playall">▶ Play all</button></div>${l.dialogue.map(d => `
        <div class="phrase">${sayBtn(d.line)}<div class="txt"><span class="who">${esc(d.who)}</span><b>${esc(d.line)}</b></div></div>`).join("")}</div>` : ""}
      <button class="btn green block" id="done" ${done ? "disabled" : ""}>${done ? "Done ✓" : "I finished! +20 ⭐"}</button>`;
    const pa = $("#playall");
    if (pa && synth) pa.onclick = () => {
      synth.cancel();
      l.dialogue.forEach(d => { const u = new SpeechSynthesisUtterance(d.line); const v = pickVoice(); if (v) u.voice = v; u.lang = P.settings.accent; u.rate = P.settings.rate; synth.speak(u); });
    };
    $("#done").onclick = () => {
      P.lessonsDone[l.id] = true; addXP(20, "lesson"); confetti(); toast("Great job! +20 ⭐");
      setTimeout(() => (location.hash = "#home"), 900);
    };
  };

  // ---------- QUIZ ----------
  routes.quiz = arg => {
    const w = weekByNum(arg) || latest();
    const qs = w.quiz || [];
    let i = 0, score = 0, wrongQ = [];
    const render = () => {
      if (i >= qs.length) {
        P.quizLast[w.week] = { date: todayKey(), score, of: qs.length, wrong: wrongQ };
        const prev = P.quizBest[w.week];
        if (prev == null || score > prev) P.quizBest[w.week] = score;
        addXP(0, "quiz");
        const stars = score === qs.length ? 3 : score >= qs.length * .6 ? 2 : 1;
        if (stars === 3) confetti();
        view.innerHTML = `<a class="btn white small back" href="#learn">‹ Back</a>
          <div class="card center"><span class="label">Week ${w.week} quiz</span>
            <div class="stars">${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}</div>
            <div class="score">${score}/${qs.length}</div>
            <p class="sub">${stars === 3 ? "Perfect! Amazing!" : stars === 2 ? "Good work! Try again for 3 stars." : "Keep going! Do the lessons, then try again."}</p>
            <button class="btn block" id="again">Try again</button><a class="btn white block" href="#home">Home</a></div>`;
        $("#again").onclick = () => { i = 0; score = 0; wrongQ = []; render(); };
        return;
      }
      const q = qs[i];
      const pics = q.options.every(o => /^\p{Extended_Pictographic}/u.test(o) && o.length <= 8);
      view.innerHTML = `
        <div class="counter"><a class="btn white small" href="#learn">✕</a><div class="progress" style="flex:1"><i style="width:${i / qs.length * 100}%"></i></div><b>${i + 1}/${qs.length}</b></div>
        <div class="card">
          <h2>${esc(q.q)}</h2>
          ${q.say ? `<div class="row" style="justify-content:center">${sayBtn(q.say, true)}</div>` : ""}
          <div class="opts${pics ? " pics" : ""}">${q.options.map((o, j) => `<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}</div>
          <div class="feedback" id="fb" hidden></div>
          <button class="btn green block" id="next" hidden>${i === qs.length - 1 ? "See my score" : "Next ›"}</button>
        </div>`;
      if (q.say) setTimeout(() => speak(q.say), 250);
      $$(".opt").forEach(b => b.onclick = () => {
        const j = +b.dataset.j, ok = j === q.answer;
        $$(".opt").forEach((x, k) => { x.disabled = true; if (k === q.answer) x.classList.add("right"); });
        if (ok) { score++; addXP(5); } else { b.classList.add("wrong"); wrongQ.push(i); }
        const fb = $("#fb"); fb.hidden = false; fb.className = "feedback " + (ok ? "good" : "bad");
        fb.textContent = (ok ? "✅ Correct! " : "❌ Not quite. ") + (q.explain || "");
        $("#next").hidden = false;
      });
      $("#next").onclick = () => { i++; render(); };
    };
    render();
  };

  // ---------- WORDS (flashcards) ----------
  let session = null;
  routes.cards = () => {
    if (!session || session.date !== todayKey()) startSession();
    renderCard();
  };
  function startSession() {
    const due = dueCards().sort((a, b) => P.cards[a.id].due - P.cards[b.id].due);
    const fresh = newCards().slice(0, newLeftToday());
    session = { date: todayKey(), queue: [...due, ...fresh].map(c => c.id), total: due.length + fresh.length, done: 0 };
  }
  function renderCard() {
    if (!session.queue.length) {
      if (session.total) { addXP(0, "cards"); }
      const all = CARDS.slice().sort((a, b) => b.week - a.week);
      view.innerHTML = `
        <div class="card center"><span style="font-size:4rem">🎉</span>
          <h1>${session.total ? "All done!" : "No cards right now"}</h1>
          <p class="sub">${session.total ? `You practised ${session.total} word${session.total === 1 ? "" : "s"} today.` : "Great! Come back tomorrow."} Words come back later so you don't forget them.</p>
          ${newCards().length ? `<button class="btn green block" id="more">Learn 5 more words</button>` : ""}
          <a class="btn purple block" href="#play">Play a game 🎮</a>
        </div>
        <div class="head"><span class="label">All words · ${learned()} of ${CARDS.length} learned</span></div>
        <div class="card">${all.map(c => `<div class="phrase">${sayBtn(c.word)}<span style="font-size:2rem">${esc(c.emoji || "")}</span><div class="txt"><b>${esc(c.word)}</b><span>${esc(c.meaning)}</span>${c.tr ? `<em>${esc(c.tr)}</em>` : ""}</div></div>`).join("")}</div>`;
      const more = $("#more");
      if (more) more.onclick = () => {
        const extra = newCards().slice(0, 5);
        session.queue.push(...extra.map(c => c.id)); session.total += extra.length;
        P.newToday.count = Math.max(0, P.newToday.count - extra.length);
        renderCard();
      };
      return;
    }
    const c = CARDS.find(x => x.id === session.queue[0]);
    const isNew = !P.cards[c.id];
    const st = P.cards[c.id] || { box: 0 };
    view.innerHTML = `
      <div class="counter"><span class="label">${isNew ? "✨ New word" : "🔁 Review"}</span><b>${session.done}/${session.total}</b></div>
      <div class="progress"><i style="width:${session.total ? session.done / session.total * 100 : 0}%"></i></div>
      <button class="flash" id="flash" aria-label="Turn the card">
        <span class="flash-inner">
          <span class="face front"><span class="pic">${esc(c.emoji || "📝")}</span><span class="word">${esc(c.word)}</span><span class="hint">👆 Tap to see the meaning</span></span>
          <span class="face back"><span class="word" style="font-size:1.8rem">${esc(c.word)}</span><span class="def">${esc(c.meaning)}</span>${c.example ? `<span class="ex">“${esc(c.example)}”</span>` : ""}${c.tr ? `<span class="tr">${esc(c.tr)}</span>` : ""}</span>
        </span>
      </button>
      <div class="row" style="justify-content:center">${sayBtn(c.word)}${c.example ? `<button class="btn white small" data-say="${esc(c.example)}">🔊 Example</button>` : ""}</div>
      <div class="grid2" id="rate" hidden>
        <button class="btn red" data-r="again">😕 Not yet</button>
        <button class="btn green" data-r="good">😀 I know it</button>
      </div>
      <p class="sub center" id="next-when" hidden style="text-align:center">“I know it” = see it again ${label(INTERVAL[Math.min(5, st.box + 1)])}</p>`;
    setTimeout(() => speak(c.word), 200);
    const flash = $("#flash");
    flash.onclick = () => { flash.classList.toggle("flipped"); $("#rate").hidden = false; $("#next-when").hidden = false; };
    $$("#rate button").forEach(b => b.onclick = () => rate(c, b.dataset.r, isNew));
  }
  function rate(c, r, isNew) {
    if (isNew) { newLeftToday(); P.newToday.count++; }
    const st = P.cards[c.id] || { box: 0, due: 0 };
    session.queue.shift();
    if (r === "again") {
      st.box = 0; st.due = dayNum(); st.lapses = (st.lapses || 0) + 1;
      session.queue.splice(Math.min(3, session.queue.length), 0, c.id);
    } else {
      st.box = Math.min(5, st.box + 1);
      st.due = dayNum() + INTERVAL[st.box];
      session.done++;
      P.xp += 2;
    }
    P.cards[c.id] = st;
    addXP(0);
    renderCard();
  }

  // ---------- PLAY (games) ----------
  function pool(min) {
    const withPic = CARDS.filter(c => c.emoji);
    const seen = withPic.filter(c => P.cards[c.id]);
    return seen.length >= min ? seen : withPic;
  }
  const GAMES = [
    { id: "listen", emoji: "👂", name: "Listen & Tap", desc: "Hear a word. Tap the right picture.", c: "var(--purple)", d: "var(--purple-d)" },
    { id: "match", emoji: "🧩", name: "Match Pairs", desc: "Match each picture with its word.", c: "var(--orange)", d: "var(--orange-d)" },
    { id: "spell", emoji: "🔤", name: "Spell It", desc: "Tap the letters to spell the word.", c: "var(--green)", d: "var(--green-d)" }
  ];
  routes.play = () => {
    view.innerHTML = `<div class="head"><h1>Play 🎮</h1><p class="sub">Games use the words you are learning.</p></div>
      <div class="list">${GAMES.map(g => `
        <a class="card gamecard" href="#game/${g.id}" style="--c:${g.c};--d:${g.d}">
          <span class="gi">${g.emoji}</span>
          <span class="meta"><h2>${g.name}</h2><small>${g.desc}</small><br><small>🏆 Best: ${P.gameBest[g.id] ?? "–"}</small></span>
          <span class="chev" style="color:#fff">›</span></a>`).join("")}</div>`;
  };
  routes.game = id => {
    const g = GAMES.find(x => x.id === id);
    if (!g) return routes.play();
    view.innerHTML = `
      <a class="btn white small back" href="#play">‹ Games</a>
      <div class="card center"><span style="font-size:4.5rem;line-height:1">${g.emoji}</span><h1>${g.name}</h1><p class="sub">${g.desc}</p>
        <p class="sub">🏆 Best score: ${P.gameBest[g.id] ?? "–"}</p>
        <button class="btn block" id="start" style="--b:${g.c};--d:${g.d}">▶ Start</button></div>`;
    $("#start").onclick = () => ({ listen: gameListen, match: gameMatch, spell: gameSpell }[id])(g);
  };
  function gameEnd(g, score, max, xp) {
    const prev = P.gameBest[g.id];
    const record = prev == null || score > prev;
    if (record) P.gameBest[g.id] = score;
    addXP(xp, "game");
    const stars = score >= max * .9 ? 3 : score >= max * .6 ? 2 : 1;
    if (stars === 3 || record) confetti();
    view.innerHTML = `
      <div class="card center"><span style="font-size:3.5rem">${g.emoji}</span><h1>${record && prev != null ? "New record! 🏆" : "Well done!"}</h1>
        <div class="stars">${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}</div>
        <div class="score">${score}</div><p class="sub">points · +${xp} ⭐</p>
        <button class="btn block" id="again" style="--b:${g.c};--d:${g.d}">Play again</button>
        <a class="btn white block" href="#play">Other games</a></div>`;
    $("#again").onclick = () => ({ listen: gameListen, match: gameMatch, spell: gameSpell }[g.id])(g);
  }
  const gameTop = (g, a, b) => `<div class="gametop"><a class="btn white small" href="#play">✕</a><b>${a}</b><b>${b}</b></div>`;

  // Game 1: Listen & Tap
  function gameListen(g) {
    const p = pool(8), rounds = Math.min(10, p.length);
    const targets = shuffle(p).slice(0, rounds);
    let r = 0, score = 0, combo = 0;
    const next = () => {
      if (r >= rounds) return gameEnd(g, score, rounds * 10, Math.round(score / 5));
      const t = targets[r];
      const opts = shuffle([t, ...shuffle(p.filter(c => c.id !== t.id && c.emoji !== t.emoji)).slice(0, 3)]);
      view.innerHTML = `${gameTop(g, `Round ${r + 1}/${rounds}`, `${score} pts${combo > 1 ? " 🔥x" + combo : ""}`)}
        <div class="progress"><i style="width:${r / rounds * 100}%;background:var(--purple)"></i></div>
        <div class="card center"><h2>Which one do you hear?</h2>${sayBtn(t.word, true)}<p class="sub" id="ans">&nbsp;</p></div>
        <div class="tiles">${opts.map(o => `<button class="tile" data-id="${o.id}" aria-label="${esc(o.word)}">${esc(o.emoji)}</button>`).join("")}</div>`;
      setTimeout(() => speak(t.word), 250);
      let locked = false;
      $$(".tile").forEach(b => b.onclick = async () => {
        if (locked) return; locked = true;
        const ok = b.dataset.id === t.id;
        $(`.tile[data-id="${t.id}"]`).classList.add("right");
        $("#ans").innerHTML = `<b style="font-size:1.4rem;color:var(--ink)">${esc(t.word)}</b>`;
        if (ok) { combo++; score += 10 + (combo > 2 ? 5 : 0); speak(t.word); await sleep(900); }
        else { combo = 0; b.classList.add("wrong"); speak(t.word); await sleep(1500); }
        r++; next();
      });
    };
    next();
  }

  // Game 2: Match Pairs
  function gameMatch(g) {
    const set = shuffle(pool(6)).slice(0, 6);
    const tiles = shuffle([...set.map(c => ({ id: c.id, kind: "pic", text: c.emoji })), ...set.map(c => ({ id: c.id, kind: "word", text: c.word }))]);
    let sel = null, found = 0, misses = 0;
    const start = Date.now();
    view.innerHTML = `${gameTop(g, "Find the pairs", `<span id="mm">0 mistakes</span>`)}
      <p class="sub">Tap a picture, then tap its word.</p>
      <div class="memory">${tiles.map((t, i) => `<button class="mem${t.kind === "pic" ? " pic" : ""}" data-i="${i}">${esc(t.text)}</button>`).join("")}</div>`;
    $$(".mem").forEach(b => b.onclick = async () => {
      const t = tiles[+b.dataset.i];
      if (t.kind === "word") speak(t.text);
      if (!sel) { sel = b; b.classList.add("sel"); return; }
      if (sel === b) { b.classList.remove("sel"); sel = null; return; }
      const s = tiles[+sel.dataset.i], a = sel; sel = null;
      if (s.id === t.id && s.kind !== t.kind) {
        a.classList.remove("sel"); a.classList.add("ok"); b.classList.add("ok");
        speak(CARDS.find(c => c.id === t.id).word);
        if (++found === set.length) {
          await sleep(700);
          const secs = Math.round((Date.now() - start) / 1000);
          gameEnd(g, Math.max(10, 100 - misses * 10 - Math.max(0, secs - 30)), 100, 15);
        }
      } else {
        misses++; $("#mm").textContent = misses + " mistake" + (misses === 1 ? "" : "s");
        a.classList.remove("sel"); a.classList.add("no"); b.classList.add("no");
        await sleep(450); a.classList.remove("no"); b.classList.remove("no");
      }
    });
  }

  // Game 3: Spell It
  function gameSpell(g) {
    const p = pool(6).filter(c => /^[a-z]{3,8}$/i.test(c.word));
    const list = shuffle(p).slice(0, Math.min(6, p.length));
    let r = 0, score = 0;
    const next = () => {
      if (r >= list.length) return gameEnd(g, score, list.length * 10, Math.round(score / 4));
      const c = list[r], target = c.word.toLowerCase().split("");
      let pos = 0, mistakes = 0;
      view.innerHTML = `${gameTop(g, `Word ${r + 1}/${list.length}`, `${score} pts`)}
        <div class="progress"><i style="width:${r / list.length * 100}%"></i></div>
        <div class="card center"><div class="bigpic">${esc(c.emoji)}</div>
          <div class="row" style="justify-content:center">${sayBtn(c.word)}<button class="btn white small" id="hint">💡 Help</button></div>
          <div class="slots">${target.map(() => `<span class="slot"></span>`).join("")}</div></div>
        <div class="letters">${shuffle(target).map((l, i) => `<button class="letter" data-l="${l}" data-i="${i}">${l}</button>`).join("")}</div>`;
      setTimeout(() => speak(c.word), 250);
      const place = btn => {
        btn.disabled = true;
        const s = $$(".slot")[pos]; s.textContent = target[pos]; s.classList.add("filled"); pos++;
        if (pos === target.length) {
          score += Math.max(4, 10 - mistakes * 2);
          speak(c.word);
          setTimeout(() => { r++; next(); }, 1000);
        }
      };
      $$(".letter").forEach(b => b.onclick = () => {
        if (pos >= target.length) return;
        if (b.dataset.l === target[pos]) place(b);
        else { mistakes++; b.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], 300); }
      });
      $("#hint").onclick = () => {
        const b = $$(".letter").find(x => !x.disabled && x.dataset.l === target[pos]);
        if (b) { mistakes++; place(b); }
      };
    };
    next();
  }

  // ---------- MY WORDS QUIZ (built from words he has studied) ----------
  function studied() {
    const seen = CARDS.filter(c => P.cards[c.id] && c.emoji);
    if (seen.length >= 4) return seen;
    return CARDS.filter(c => c.emoji && c.week === latest().week);
  }
  routes.review = () => {
    const words = studied();
    const all = CARDS.filter(c => c.emoji);
    const picks = shuffle(words).slice(0, Math.min(10, words.length));
    const distract = (t, n) => shuffle(all.filter(c => c.id !== t.id && c.emoji !== t.emoji && c.word !== t.word)).slice(0, n);
    const qs = picks.map((t, i) => {
      const others = distract(t, 2), type = i % 4;
      if (type === 0) { const o = shuffle([t, ...others]); return { q: "What is this?", big: t.emoji, options: o.map(c => c.word), answer: o.indexOf(t), word: t }; }
      if (type === 1) { const o = shuffle([t, ...others]); return { q: "Listen. Tap the picture.", say: t.word, options: o.map(c => c.emoji), answer: o.indexOf(t), word: t }; }
      if (type === 2) { const o = shuffle([t, ...others]); return { q: `“${t.meaning}”`, sub: "Which word is it?", options: o.map(c => c.word), answer: o.indexOf(t), word: t }; }
      // spelling choice: one right spelling, two wrong ones
      const wrong = misspell(t.word);
      const o = shuffle([t.word, ...wrong]);
      return { q: "Which spelling is right?", big: t.emoji, say: t.word, options: o, answer: o.indexOf(t.word), word: t };
    });
    let i = 0, score = 0;
    const missed = [];
    const render = () => {
      if (i >= qs.length) {
        addXP(score * 2, "quiz");
        P.gameBest.review = Math.max(P.gameBest.review || 0, score);
        // words he got wrong come back in today's flashcards
        missed.forEach(c => { P.cards[c.id] = { box: 0, due: dayNum(), lapses: ((P.cards[c.id] || {}).lapses || 0) + 1 }; }); session = null; save();
        const stars = score === qs.length ? 3 : score >= qs.length * .6 ? 2 : 1;
        if (stars === 3) confetti();
        view.innerHTML = `<div class="card center"><span class="label">My words quiz</span>
          <div class="stars">${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}</div><div class="score">${score}/${qs.length}</div>
          ${missed.length ? `<p class="sub">Practise these again:</p><div class="row" style="justify-content:center">${missed.map(c => `<button class="pill" data-say="${esc(c.word)}">${esc(c.emoji)} ${esc(c.word)}</button>`).join("")}</div><p class="sub">They are back in your Words cards today.</p>` : `<p class="sub">Perfect! You know all your words!</p>`}
          <button class="btn block" id="again">New quiz</button><a class="btn white block" href="#learn">Back</a></div>`;
        $("#again").onclick = routes.review;
        return;
      }
      const q = qs[i];
      const pics = q.options.every(o => /^\p{Extended_Pictographic}/u.test(o));
      view.innerHTML = `
        <div class="counter"><a class="btn white small" href="#learn">✕</a><div class="progress" style="flex:1"><i style="width:${i / qs.length * 100}%"></i></div><b>${i + 1}/${qs.length}</b></div>
        <div class="card">
          <h2>${esc(q.q)}</h2>${q.sub ? `<p class="sub">${esc(q.sub)}</p>` : ""}
          ${q.big ? `<div class="bigpic">${esc(q.big)}</div>` : ""}
          ${q.say ? `<div class="row" style="justify-content:center">${sayBtn(q.say, !q.big)}</div>` : ""}
          <div class="opts${pics ? " pics" : ""}">${q.options.map((o, j) => `<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}</div>
          <div class="feedback" id="fb" hidden></div>
          <button class="btn green block" id="next" hidden>${i === qs.length - 1 ? "See my score" : "Next ›"}</button>
        </div>`;
      if (q.say && !q.big) setTimeout(() => speak(q.say), 250);
      $$(".opt").forEach(b => b.onclick = () => {
        const ok = +b.dataset.j === q.answer;
        $$(".opt").forEach((x, k) => { x.disabled = true; if (k === q.answer) x.classList.add("right"); });
        if (ok) score++; else { b.classList.add("wrong"); missed.push(q.word); }
        speak(q.word.word);
        const fb = $("#fb"); fb.hidden = false; fb.className = "feedback " + (ok ? "good" : "bad");
        fb.textContent = (ok ? "✅ Correct! " : "❌ It's: ") + `${q.word.emoji} ${q.word.word}`;
        $("#next").hidden = false;
      });
      $("#next").onclick = () => { i++; render(); };
    };
    if (!qs.length) { view.innerHTML = `<div class="card center"><p class="sub">Learn some words first!</p><a class="btn" href="#cards">Go to Words</a></div>`; return; }
    render();
  };
  function misspell(w) {
    const out = new Set(), v = "aeiou";
    const muts = [
      s => s.length > 3 ? s.slice(0, 1) + s.slice(2, 3) + s.slice(1, 2) + s.slice(3) : s + "e",       // swap letters 2/3
      s => s.replace(/([aeiou])/, m => v[(v.indexOf(m) + 1) % 5]),                                   // change a vowel
      s => s.replace(/(.)\1/, "$1") !== s ? s.replace(/(.)\1/, "$1") : s.replace(/([bcdfglmnprst])/, "$1$1"), // double / undouble
      s => s.endsWith("e") ? s.slice(0, -1) : s + "e",
      s => s.replace(/k/, "c").replace(/ph/, "f") !== s ? s.replace(/k/, "c").replace(/ph/, "f") : s.slice(0, -1) + s.slice(-1) + s.slice(-1)
    ];
    for (const m of shuffle(muts)) { const x = m(w); if (x !== w) out.add(x); if (out.size === 2) break; }
    while (out.size < 2) out.add(w + "s".repeat(out.size + 1));
    return [...out];
  }

  // ---------- SPELLING TEST (type the word) ----------
  routes.spelling = () => {
    const words = studied().filter(c => /^[a-z ]{2,12}$/i.test(c.word));
    const list = shuffle(words).slice(0, Math.min(8, words.length));
    let i = 0, score = 0;
    const wrong = [];
    const render = () => {
      if (i >= list.length) {
        P.gameBest.spelling = Math.max(P.gameBest.spelling || 0, score);
        addXP(score * 2, "game");
        wrong.forEach(c => { P.cards[c.id] = { box: 0, due: dayNum(), lapses: ((P.cards[c.id] || {}).lapses || 0) + 1 }; P.spellMiss[c.id] = (P.spellMiss[c.id] || 0) + 1; }); session = null; save();
        const stars = score === list.length ? 3 : score >= list.length * .6 ? 2 : 1;
        if (stars === 3) confetti();
        view.innerHTML = `<div class="card center"><span style="font-size:3rem">✏️</span><h1>Spelling test</h1>
          <div class="stars">${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}</div><div class="score">${score}/${list.length}</div>
          ${wrong.length ? `<p class="sub">Practise these words:</p><div class="row" style="justify-content:center">${wrong.map(c => `<button class="pill" data-say="${esc(c.word)}">${esc(c.emoji)} ${esc(c.word)}</button>`).join("")}</div>` : `<p class="sub">Every word right! Amazing!</p>`}
          <button class="btn green block" id="again">New test</button><a class="btn white block" href="#learn">Back</a></div>`;
        $("#again").onclick = routes.spelling;
        return;
      }
      const c = list[i];
      let tries = 0;
      view.innerHTML = `
        <div class="counter"><a class="btn white small" href="#learn">✕</a><div class="progress" style="flex:1"><i style="width:${i / list.length * 100}%"></i></div><b>${i + 1}/${list.length}</b></div>
        <div class="card center">
          <h2>Listen and write the word</h2>
          <div class="bigpic">${esc(c.emoji)}</div>
          <div class="row" style="justify-content:center">${sayBtn(c.word, true)}<button class="btn white small" id="slow">🐢 Slow</button></div>
          <p class="sub" id="hintline">${c.word.length} letters</p>
          <form id="sf" style="width:100%;display:flex;flex-direction:column;gap:10px">
            <input type="text" id="sp" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type here" aria-label="Spell the word" style="text-align:center">
            <div class="grid2"><button type="button" class="btn white" id="hint">💡 Help</button><button class="btn green">Check</button></div>
          </form>
          <div class="feedback" id="fb" hidden></div>
          <button class="btn block" id="next" hidden>${i === list.length - 1 ? "See my score" : "Next ›"}</button>
        </div>`;
      setTimeout(() => speak(c.word), 250);
      $("#slow").onclick = () => speak(c.word, 0.5);
      let shown = 0;
      $("#hint").onclick = () => { shown = Math.min(c.word.length - 1, shown + 1); $("#hintline").textContent = c.word.slice(0, shown) + " _".repeat(c.word.length - shown); tries++; };
      const inp = $("#sp"); inp.focus();
      $("#sf").onsubmit = e => {
        e.preventDefault();
        const a = inp.value.trim().toLowerCase();
        if (!a) return;
        const fb = $("#fb"); fb.hidden = false;
        if (a === c.word.toLowerCase()) {
          if (tries === 0) score++;
          fb.className = "feedback good"; fb.textContent = tries === 0 ? "✅ Perfect spelling!" : "✅ Right! Well done.";
          speak(c.word); finish();
        } else if (tries === 0) {
          tries++; fb.className = "feedback bad"; fb.textContent = "Not quite. Listen again and try once more.";
          speak(c.word, 0.6); inp.select();
        } else {
          wrong.push(c);
          fb.className = "feedback bad";
          fb.innerHTML = `The right spelling is: <b style="font-size:1.3rem;letter-spacing:2px">${esc(c.word)}</b>`;
          speak(c.word); finish();
        }
      };
      function finish() { inp.disabled = true; $$("#sf button").forEach(b => (b.disabled = true)); $("#next").hidden = false; $("#next").focus(); }
      $("#next").onclick = () => { i++; render(); };
    };
    if (!list.length) { view.innerHTML = `<div class="card center"><p class="sub">Learn some words first!</p><a class="btn" href="#cards">Go to Words</a></div>`; return; }
    render();
  };

  // ---------- SPEAK ----------
  let speakWeek = null, speakMode = "read", speakIdx = 0;
  routes.speak = () => {
    if (!speakWeek || !weekByNum(speakWeek)) speakWeek = latest().week;
    const w = weekByNum(speakWeek);
    view.innerHTML = `
      <div class="head"><h1>Speak 🎤</h1><p class="sub">Listen first. Then say it out loud.</p></div>
      <div class="pills" role="group" aria-label="Week">${WEEKS.slice().reverse().map(x => `<button class="pill" data-w="${x.week}" aria-pressed="${x.week === w.week}">Week ${x.week}</button>`).join("")}</div>
      <div class="grid2">
        <button class="btn ${speakMode === "read" ? "" : "white"}" data-m="read">🗣️ Repeat</button>
        <button class="btn ${speakMode === "answer" ? "" : "white"}" data-m="answer">💬 Answer</button>
      </div>
      <div id="speak-body" class="list"></div>`;
    $$("[data-w]").forEach(b => b.onclick = () => { speakWeek = +b.dataset.w; speakIdx = 0; routes.speak(); });
    $$("[data-m]").forEach(b => b.onclick = () => { speakMode = b.dataset.m; speakIdx = 0; routes.speak(); });
    speakMode === "read" ? renderRead(w) : renderQuestions(w);
  };
  function renderRead(w) {
    const list = w.speak || [], body = $("#speak-body");
    if (!list.length) { body.innerHTML = `<div class="card center"><p class="sub">No sentences this week.</p></div>`; return; }
    speakIdx = Math.min(speakIdx, list.length - 1);
    const s = list[speakIdx];
    body.innerHTML = `
      <div class="counter"><span class="label">Sentence ${speakIdx + 1} of ${list.length}</span>${P.speakDone[s.id] ? "<b>✅</b>" : ""}</div>
      <div class="card center">
        <p class="target">${esc(s.text)}</p>
        ${s.note ? `<p class="sub">${esc(s.note)}</p>` : ""}
        <div class="row" style="justify-content:center">${sayBtn(s.text, true)}<button class="btn white small" data-slow="1">🐢 Slow</button></div>
      </div>
      ${Rec ? `<p class="sub" style="text-align:center">Now tap the mic and say it:</p>
        <button class="mic" id="mic" aria-label="Start speaking">🎤</button>
        <div class="card" id="result" hidden><span class="label">I heard</span><p class="heard" id="heard"></p><div class="feedback" id="verdict"></div></div>`
      : `<div class="tip">🗣️ Listen, then say it out loud 3 times. (The speaking check works in Chrome on Android.)</div>`}
      <div class="row">
        <button class="btn white" id="prev" ${speakIdx === 0 ? "disabled" : ""}>‹</button>
        <button class="btn green" id="nexts" style="flex:1">${speakIdx === list.length - 1 ? "Finish ✓" : "Next ›"}</button>
      </div>`;
    $("[data-slow]").onclick = () => speak(s.text, 0.6);
    $("#prev").onclick = () => { speakIdx--; renderRead(w); };
    $("#nexts").onclick = () => {
      if (!Rec && !P.speakDone[s.id]) { P.speakDone[s.id] = true; addXP(5, "speak"); }
      if (speakIdx < list.length - 1) { speakIdx++; renderRead(w); }
      else { addXP(0, "speak"); confetti(); toast("Great speaking! 🎉"); speakIdx = 0; renderRead(w); }
    };
    if (Rec) $("#mic").onclick = () => listen(s);
  }
  function listen(s) {
    const mic = $("#mic");
    if (rec) { stopRec(); mic.classList.remove("on"); return; }
    if (synth) synth.cancel();
    rec = new Rec(); rec.lang = P.settings.accent; rec.interimResults = false; rec.maxAlternatives = 3;
    mic.classList.add("on"); mic.textContent = "⏹";
    rec.onresult = e => {
      const alts = Array.from(e.results[0]).map(a => a.transcript);
      const best = alts.map(a => compare(s.text, a)).sort((a, b) => b.pct - a.pct)[0];
      $("#result").hidden = false;
      $("#heard").innerHTML = best.out.map(x => `<span class="${x.ok ? "ok" : "miss"}">${esc(x.w)}</span>`).join(" ");
      const v = $("#verdict");
      if (best.pct >= 80) {
        v.className = "feedback good"; v.textContent = `🎉 ${best.pct}%! Excellent!`;
        if (!P.speakDone[s.id]) { P.speakDone[s.id] = true; addXP(10, "speak"); confetti(); }
      } else if (best.pct >= 50) { v.className = "feedback good"; v.textContent = `👍 ${best.pct}%. Good! Listen again and practise the red words.`; }
      else { v.className = "feedback bad"; v.textContent = `${best.pct}%. Try again. Tap 🐢 to hear it slowly.`; }
    };
    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Please allow the microphone");
      else if (e.error === "no-speech") toast("I didn't hear you. Try again!");
    };
    rec.onend = () => { rec = null; const m = $("#mic"); if (m) { m.classList.remove("on"); m.textContent = "🎤"; } };
    try { rec.start(); } catch (e) { rec = null; mic.classList.remove("on"); mic.textContent = "🎤"; }
  }
  function renderQuestions(w) {
    const qs = QUESTIONS.filter(q => q.week === w.week);
    $("#speak-body").innerHTML = qs.length ? qs.map(q => `
      <a class="card item" href="#question/${esc(q.id)}"><span class="bubble${P.answered[q.id] ? " done" : ""}" style="--c:var(--pink);--l:var(--pink-l)">${P.answered[q.id] ? "✓" : "💬"}</span>
      <span class="meta"><h2>${esc(q.q)}</h2><small>${esc(q.context || "")}</small></span><span class="chev">›</span></a>`).join("")
      : `<div class="card center"><p class="sub">No questions this week.</p></div>`;
  }
  routes.question = id => {
    const q = QUESTIONS.find(x => x.id === id);
    if (!q) return routes.speak();
    const draftKey = "parlo-draft-" + q.id;
    let draft = ""; try { draft = localStorage.getItem(draftKey) || ""; } catch (e) {}
    view.innerHTML = `
      <a class="btn white small back" href="#speak">‹ Back</a>
      <div class="card center"><span class="label">${esc(q.context || "Question")}</span><h1>${esc(q.q)}</h1>${sayBtn(q.q, true)}</div>
      ${q.tips ? `<div class="tip">💡 ${q.tips.map(esc).join(" ")}</div>` : ""}
      ${q.useful ? `<div class="card"><span class="label">Useful words</span><div class="row">${q.useful.map(u => `<button class="pill" data-say="${esc(u)}">🔊 ${esc(u)}</button>`).join("")}</div></div>` : ""}
      <div class="card"><label for="ans">Your answer (say it or write it)</label>
        <textarea id="ans" placeholder="Write here…">${esc(draft)}</textarea>
        ${Rec ? `<button class="btn white" id="dict">🎤 Speak my answer</button>` : ""}
      </div>
      <details class="card"><summary>👀 See an example answer</summary>
        <p class="model">${esc(q.model)}</p>
        <div class="row">${sayBtn(q.model)}<span class="sub">Listen and repeat.</span></div>
      </details>
      <button class="btn green block" id="qdone" ${P.answered[q.id] ? "disabled" : ""}>${P.answered[q.id] ? "Done ✓" : "I answered it! +10 ⭐"}</button>`;
    const ta = $("#ans");
    ta.oninput = () => { try { localStorage.setItem(draftKey, ta.value); } catch (e) {} };
    $("#qdone").onclick = () => { P.answered[q.id] = true; addXP(10, "speak"); confetti(); toast("+10 ⭐"); setTimeout(() => (location.hash = "#speak"), 800); };
    const d = $("#dict");
    if (d) d.onclick = () => {
      if (rec) { stopRec(); d.textContent = "🎤 Speak my answer"; return; }
      rec = new Rec(); rec.lang = P.settings.accent; rec.continuous = true; rec.interimResults = false;
      d.textContent = "⏹ Stop";
      rec.onresult = e => {
        for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) ta.value = (ta.value ? ta.value.trim() + " " : "") + e.results[k][0].transcript.trim();
        ta.oninput();
      };
      rec.onend = () => { rec = null; d.textContent = "🎤 Speak my answer"; };
      try { rec.start(); } catch (e) { rec = null; }
    };
  };

  // ---------- SETTINGS ----------
  routes.settings = () => {
    const s = P.settings;
    view.innerHTML = `
      <div class="head"><h1>Settings ⚙️</h1></div>
      <div class="card"><label for="nm">Your name</label><input type="text" id="nm" maxlength="24" value="${esc(P.name)}"></div>
      <div class="card">
        <label for="accent">Voice</label>
        <select id="accent"><option value="en-GB">🇬🇧 British English</option><option value="en-US">🇺🇸 American English</option></select>
        <label for="rate">Speed: <span id="rateval">${s.rate}</span>×</label>
        <input type="range" id="rate" min="0.5" max="1.1" step="0.1" value="${s.rate}">
        <button class="btn white" data-say="Hello! How are you today?">🔊 Test the voice</button>
      </div>
      <div class="card"><label for="newper">New words each day</label>
        <select id="newper">${[5, 8, 10, 15].map(n => `<option value="${n}">${n}</option>`).join("")}</select></div>
      <div class="card"><span class="label">Put Parlo on your phone</span>
        ${isInstalled() ? `<p>✅ Parlo is installed on this phone.</p>` : `<p class="sub">Open it with one tap, like an app. It works without internet too.</p>
        <button class="btn" id="inst-settings">📲 ${installEvt ? "Install Parlo" : "Show me how to install"}</button>`}</div>
      <div class="card"><span class="label">My progress</span>
        <p class="sub">Saved on this phone. ${WEEKS.length} weeks of lessons.${CONFIG.progressForm && CONFIG.progressForm.url ? ` Your progress is also sent to ${esc(CONFIG.sharedWith || "your teacher")} so he can plan your next lessons.` : ""}</p>
        ${CONFIG.progressForm && CONFIG.progressForm.url ? `<button class="btn white" id="sendnow">📤 Send my progress now</button>
        <p class="sub" id="sentinfo">${P.lastSentAt ? "Last sent: " + new Date(P.lastSentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not sent yet"}</p>` : ""}
        <button class="btn red" id="reset">Start again from zero</button>
        <div id="confirm" hidden class="list"><b>Delete all stars, streak and words?</b><div class="grid2"><button class="btn red" id="yes">Yes, delete</button><button class="btn white" id="no">No</button></div></div></div>`;
    $("#accent").value = s.accent; $("#newper").value = s.newPerDay;
    $("#nm").onchange = e => { P.name = e.target.value.trim(); save(); toast("Saved"); };
    $("#accent").onchange = e => { s.accent = e.target.value; save(); };
    $("#rate").oninput = e => { s.rate = +e.target.value; $("#rateval").textContent = s.rate; save(); };
    $("#newper").onchange = e => { s.newPerDay = +e.target.value; session = null; save(); };
    const is = $("#inst-settings");
    if (is) is.onclick = doInstall;
    const sn = $("#sendnow");
    if (sn) sn.onclick = () => {
      if (!navigator.onLine) { toast("No internet. Try again later"); return; }
      sn.disabled = true;
      sendProgress(true).then(ok => {
        sn.disabled = false;
        if (ok) { toast("Progress sent ✓"); $("#sentinfo").textContent = "Last sent: " + new Date(P.lastSentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); }
        else toast("Couldn't send. Try again later");
      });
    };
    $("#reset").onclick = () => { $("#confirm").hidden = false; };
    $("#no").onclick = () => { $("#confirm").hidden = true; };
    $("#yes").onclick = () => { const keep = { settings: P.settings, name: P.name }; P = Object.assign(defaults(), keep, { welcomed: true }); session = null; save(); toast("Progress deleted"); location.hash = "#home"; };
  };

  // ---------- start ----------
  renderStats();
  loadContent().then(() => { go(); setTimeout(sendProgress, 5000); }).catch(() => {
    view.innerHTML = `<div class="card center"><span style="font-size:3rem">📡</span><h2>Can't load the lessons</h2><p class="sub">Check your internet, then try again.</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // When a new version of the app is installed, reload once so it shows straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
  }
})();
