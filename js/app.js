/* Parlo English — static app. Content comes from content/weeks.json and content/weeks/*.json.
   Progress is saved in this browser (localStorage). No server, no accounts. */
(function () {
  "use strict";

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  const STORE = "parlo-progress-v1";
  const defaults = () => ({
    xp: 0, days: [], cards: {}, lessonsDone: {}, quizBest: {}, speakDone: {}, answered: {},
    newToday: { date: "", count: 0 },
    settings: { accent: "en-GB", rate: 0.9, newPerDay: 10 }
  });
  let P = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved) P = Object.assign(defaults(), saved, { settings: Object.assign(defaults().settings, saved.settings || {}) });
  } catch (e) { /* storage blocked: progress lasts this visit only */ }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(P)); } catch (e) {} renderStats(); }

  function markActive() {
    const t = todayKey();
    if (!P.days.includes(t)) P.days.push(t);
  }
  function addXP(n) { P.xp += n; markActive(); save(); }
  function streak() {
    const set = new Set(P.days.map(dayNum));
    let d = dayNum();
    if (!set.has(d)) d -= 1;           // streak still alive if he studied yesterday
    let n = 0;
    while (set.has(d)) { n++; d--; }
    return n;
  }
  function renderStats() {
    $("#streak").textContent = "🔥 " + streak();
    $("#xp").textContent = P.xp + " XP";
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- speech: listen (text-to-speech) ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function pickVoice() {
    const want = P.settings.accent.toLowerCase();
    const en = voices.filter(v => v.lang && v.lang.toLowerCase().replace("_", "-").startsWith("en"));
    return en.find(v => v.lang.toLowerCase().replace("_", "-") === want && /natural|google|enhanced|premium/i.test(v.name))
      || en.find(v => v.lang.toLowerCase().replace("_", "-") === want) || en[0] || null;
  }
  function speak(text) {
    if (!synth) { toast("Listening isn't available in this browser"); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = P.settings.accent; u.rate = P.settings.rate;
    synth.speak(u);
  }
  const sayIcon = '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const sayBtn = (text, label = "Listen") => `<button class="say" data-say="${esc(text)}" aria-label="${esc(label)}: ${esc(text)}">${sayIcon}</button>`;
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-say]");
    if (b) { e.preventDefault(); e.stopPropagation(); speak(b.dataset.say); }
  });

  // ---------- speech: speaking check (speech recognition) ----------
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const words = s => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  function compare(target, heard) {
    const pool = words(heard);
    const out = words(target).map(w => {
      const i = pool.indexOf(w);
      if (i >= 0) { pool.splice(i, 1); return { w, ok: true }; }
      return { w, ok: false };
    });
    const pct = Math.round(out.filter(x => x.ok).length / Math.max(1, out.length) * 100);
    return { out, pct };
  }

  // ---------- content ----------
  let WEEKS = [];            // oldest first
  let LESSONS = [], CARDS = [], QUESTIONS = [];
  async function loadContent() {
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
  const INTERVAL = [0, 1, 3, 7, 14, 30];  // days, by box
  const label = d => d === 0 ? "Today" : d === 1 ? "1 day" : d < 30 ? d + " days" : "1 month";
  function newLeftToday() {
    if (P.newToday.date !== todayKey()) P.newToday = { date: todayKey(), count: 0 };
    return Math.max(0, P.settings.newPerDay - P.newToday.count);
  }
  function dueCards() { const t = dayNum(); return CARDS.filter(c => P.cards[c.id] && P.cards[c.id].due <= t); }
  function newCards() { return CARDS.filter(c => !P.cards[c.id]); }
  const learned = () => CARDS.filter(c => P.cards[c.id] && P.cards[c.id].box >= 1).length;

  // ---------- router ----------
  const routes = {};
  function go() {
    const [name, arg] = (location.hash.slice(1) || "home").split("/");
    const fn = routes[name] || routes.home;
    if (synth) synth.cancel();
    stopRec();
    $$("nav a").forEach(a => a.dataset.tab === tabFor(name) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    fn(arg ? decodeURIComponent(arg) : undefined);
    window.scrollTo(0, 0);
  }
  const tabFor = n => ({ lesson: "lessons", question: "speak", settings: "" }[n] ?? n);
  window.addEventListener("hashchange", go);

  // ---------- HOME ----------
  routes.home = () => {
    const w = latest();
    const wl = LESSONS.filter(l => l.week === w.week);
    const wc = CARDS.filter(c => c.week === w.week);
    const wlDone = wl.filter(l => P.lessonsDone[l.id]).length;
    const wcLearned = wc.filter(c => P.cards[c.id] && P.cards[c.id].box >= 1).length;
    const best = P.quizBest[w.week];
    const due = dueCards().length, fresh = Math.min(newCards().length, newLeftToday());
    const nextLesson = LESSONS.find(l => !P.lessonsDone[l.id]);
    const total = wl.length + wc.length + 1;
    const doneParts = wlDone + wcLearned + (best != null ? 1 : 0);
    view.innerHTML = `
      <div class="head"><span class="eyebrow">${esc(greeting())}</span><h1>Let's practise English</h1></div>
      <div class="statgrid">
        <div class="stat"><b>${streak()}</b><span>day streak</span></div>
        <div class="stat"><b>${learned()}</b><span>words learned</span></div>
        <div class="stat"><b>${P.xp}</b><span>XP</span></div>
      </div>
      <section class="card hero">
        <span class="eyebrow">New this week · Week ${w.week}</span>
        <h2>${esc(w.title)}</h2>
        <p>${esc(w.intro || "")}</p>
        <div class="progress" style="background:rgba(255,255,255,.25)"><i style="width:${Math.round(doneParts / total * 100)}%;background:var(--sun)"></i></div>
        <small>${wlDone}/${wl.length} lessons · ${wcLearned}/${wc.length} words · quiz ${best != null ? best + "/" + (w.quiz || []).length : "not done"}</small>
      </section>
      <div class="head"><span class="eyebrow">Today's plan</span></div>
      <div class="list">
        ${planItem("#cards", due + fresh ? String(due + fresh) : "✓",due + fresh ? `Review ${due + fresh} flashcard${due + fresh === 1 ? "" : "s"}` : "Flashcards done for today", due ? `${due} due, ${fresh} new` : fresh ? `${fresh} new words` : "Come back tomorrow for more", !(due + fresh))}
        ${nextLesson ? planItem("#lesson/" + nextLesson.id, nextLesson.level, nextLesson.title, `Week ${nextLesson.week} lesson · ${(nextLesson.phrases || []).length} phrases`, false) : planItem("#lessons", "✓", "All lessons complete", "New lessons arrive every week", true)}
        ${planItem("#quiz/" + w.week, "?", `Week ${w.week} quiz`, best != null ? `Best score ${best}/${(w.quiz || []).length}` : `${(w.quiz || []).length} questions`, best === (w.quiz || []).length)}
        ${planItem("#speak", "🎤", "Speaking practice", "Read aloud and answer questions", false)}
      </div>`;
  };
  function planItem(href, badge, title, sub, done) {
    return `<a class="card item" href="${href}"><span class="badge${done ? " done" : ""}">${esc(badge)}</span><span class="meta"><h2>${esc(title)}</h2><small>${esc(sub)}</small></span><span class="chev">›</span></a>`;
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  // ---------- LESSONS ----------
  routes.lessons = () => {
    const groups = WEEKS.slice().reverse().map(w => {
      const ls = LESSONS.filter(l => l.week === w.week);
      return `<div class="head"><span class="eyebrow">Week ${w.week} · ${esc(w.title)}</span></div>
        <div class="list">${ls.map(l => `
          <a class="card item" href="#lesson/${esc(l.id)}">
            <span class="badge${P.lessonsDone[l.id] ? " done" : ""}">${P.lessonsDone[l.id] ? "✓" : esc(l.level)}</span>
            <span class="meta"><h2>${esc(l.title)}</h2><small>Level ${esc(l.level)} · ${(l.phrases || []).length} phrases</small></span>
            <span class="chev">›</span></a>`).join("")}</div>`;
    }).join("");
    view.innerHTML = `<div class="head"><span class="eyebrow">Lessons</span><h1>Everyday English</h1><p class="sub">Tap the speaker to hear each phrase. Say it out loud after it.</p></div>${groups}`;
  };
  routes.lesson = id => {
    const l = LESSONS.find(x => x.id === id);
    if (!l) return routes.lessons();
    const done = !!P.lessonsDone[l.id];
    view.innerHTML = `
      <a class="btn ghost" href="#lessons" style="align-self:flex-start">‹ All lessons</a>
      <div class="head"><span class="eyebrow">Week ${l.week} · Level ${esc(l.level)}</span><h1>${esc(l.title)}</h1>${l.intro ? `<p class="sub">${esc(l.intro)}</p>` : ""}</div>
      <div class="card">${(l.phrases || []).map(p => `
        <div class="phrase">${sayBtn(p.en)}<div class="txt"><b>${esc(p.en)}</b>${p.note ? `<span>${esc(p.note)}</span>` : ""}${p.tr ? `<em>${esc(p.tr)}</em>` : ""}</div></div>`).join("")}
      </div>
      ${l.tip ? `<div class="tip"><b>Tip:</b> ${esc(l.tip)}</div>` : ""}
      ${l.dialogue ? `<div class="card"><span class="eyebrow">Example conversation</span>${l.dialogue.map(d => `
        <div class="phrase">${sayBtn(d.line)}<div class="txt"><b>${esc(d.who)}</b><span style="color:var(--ink)">${esc(d.line)}</span></div></div>`).join("")}</div>` : ""}
      <button class="btn block" id="done" ${done ? "disabled" : ""}>${done ? "Completed ✓" : "Mark as done · +20 XP"}</button>`;
    $("#done").onclick = () => {
      P.lessonsDone[l.id] = true; addXP(20); toast("Lesson complete · +20 XP");
      const next = LESSONS.find(x => !P.lessonsDone[x.id]);
      location.hash = next ? "#lesson/" + next.id : "#lessons";
    };
  };

  // ---------- FLASHCARDS ----------
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
      const all = CARDS.slice().sort((a, b) => b.week - a.week);
      view.innerHTML = `
        <div class="head"><span class="eyebrow">Flashcards</span><h1>All done for today</h1></div>
        <div class="card empty"><span class="big">🎉</span><h2>${session.total ? `You reviewed ${session.total} card${session.total === 1 ? "" : "s"}` : "No cards due right now"}</h2>
          <p class="sub">Words you know come back in a few days so you don't forget them. ${newCards().length ? `${newCards().length} new words are waiting for tomorrow.` : ""}</p>
          ${newCards().length ? `<button class="btn soft" id="more">Learn 5 more now</button>` : ""}</div>
        <div class="head"><span class="eyebrow">All words · ${learned()} of ${CARDS.length} learned</span></div>
        <div class="card">${all.map(c => `<div class="phrase">${sayBtn(c.word)}<div class="txt"><b>${esc(c.word)}</b><span>${esc(c.meaning)}</span>${c.tr ? `<em>${esc(c.tr)}</em>` : ""}</div></div>`).join("")}</div>`;
      const more = $("#more");
      if (more) more.onclick = () => {
        const extra = newCards().slice(0, 5);
        session.queue.push(...extra.map(c => c.id)); session.total += extra.length;
        P.newToday.count = Math.max(0, P.newToday.count - extra.length); // these don't use up tomorrow's allowance
        renderCard();
      };
      return;
    }
    const c = CARDS.find(x => x.id === session.queue[0]);
    const st = P.cards[c.id] || { box: 0 };
    const isNew = !P.cards[c.id];
    const good = Math.min(5, st.box + 1), easy = Math.min(5, st.box + 2);
    view.innerHTML = `
      <div class="head"><span class="eyebrow">Flashcards · ${isNew ? "New word" : "Review"}</span>
        <div class="row" style="justify-content:space-between"><span class="sub">${session.done} of ${session.total} done</span><span class="sub">Week ${c.week}</span></div>
        <div class="progress"><i style="width:${session.total ? session.done / session.total * 100 : 0}%"></i></div></div>
      <button class="flash" id="flash" aria-label="Flip card">
        <span class="flash-inner">
          <span class="face front"><span class="pos">${esc(c.type || "")}</span><span class="word">${esc(c.word)}</span><span class="hint">Do you know it? Tap to check</span></span>
          <span class="face back"><span class="def">${esc(c.meaning)}</span>${c.example ? `<span class="ex">“${esc(c.example)}”</span>` : ""}${c.tr ? `<span class="tr">${esc(c.tr)}</span>` : ""}</span>
        </span>
      </button>
      <div class="row" style="justify-content:center">${sayBtn(c.word, "Listen to the word")}${c.example ? sayBtn(c.example, "Listen to the example") : ""}</div>
      <div class="rate" id="rate" hidden>
        <button class="btn warn" data-r="again">Again<small>Soon</small></button>
        <button class="btn soft" data-r="good">Good<small>${label(INTERVAL[good])}</small></button>
        <button class="btn" data-r="easy">Easy<small>${label(INTERVAL[easy])}</small></button>
      </div>`;
    const flash = $("#flash");
    flash.onclick = () => { flash.classList.toggle("flipped"); $("#rate").hidden = false; };
    $$("#rate button").forEach(b => b.onclick = () => rate(c, b.dataset.r, isNew));
  }
  function rate(c, r, isNew) {
    if (isNew) { newLeftToday(); P.newToday.count++; }
    const st = P.cards[c.id] || { box: 0, due: 0 };
    session.queue.shift();
    if (r === "again") {
      st.box = 0; st.due = dayNum();
      session.queue.splice(Math.min(3, session.queue.length), 0, c.id); // see it again in a few cards
    } else {
      st.box = Math.min(5, st.box + (r === "easy" ? 2 : 1));
      st.due = dayNum() + INTERVAL[st.box];
      session.done++;
      P.xp += r === "easy" ? 3 : 2; markActive();
    }
    P.cards[c.id] = st; save(); renderCard();
  }

  // ---------- QUIZ ----------
  routes.quiz = arg => {
    const w = arg ? weekByNum(arg) : null;
    if (!w) {
      view.innerHTML = `<div class="head"><span class="eyebrow">Quiz</span><h1>Test yourself</h1><p class="sub">Each week has its own quiz. You can take it as many times as you like.</p></div>
        <div class="list">${WEEKS.slice().reverse().map(w => {
          const n = (w.quiz || []).length, b = P.quizBest[w.week];
          return planItem("#quiz/" + w.week, "W" + w.week, w.title, b != null ? `Best score ${b}/${n}` : `${n} questions`, b === n);
        }).join("")}</div>`;
      return;
    }
    const qs = w.quiz || [];
    let i = 0, score = 0;
    const render = () => {
      if (i >= qs.length) {
        const prev = P.quizBest[w.week];
        if (prev == null || score > prev) P.quizBest[w.week] = score;
        save();
        view.innerHTML = `<a class="btn ghost" href="#quiz" style="align-self:flex-start">‹ All quizzes</a>
          <div class="card empty"><span class="eyebrow">Week ${w.week} quiz</span><div class="score">${score}/${qs.length}</div>
          <p class="sub">${score === qs.length ? "Perfect score. Excellent!" : score >= qs.length * .7 ? "Good work. Look again at the ones you missed." : "Keep going. Read this week's lessons, then try again."}</p>
          <div class="row" style="justify-content:center"><button class="btn" id="again">Try again</button><a class="btn ghost" href="#lessons">Lessons</a></div></div>`;
        $("#again").onclick = () => { i = 0; score = 0; render(); };
        return;
      }
      const q = qs[i];
      view.innerHTML = `
        <a class="btn ghost" href="#quiz" style="align-self:flex-start">‹ All quizzes</a>
        <div class="head"><span class="eyebrow">Week ${w.week} · Question ${i + 1} of ${qs.length}</span><div class="progress"><i style="width:${i / qs.length * 100}%"></i></div></div>
        <div class="card"><h2>${esc(q.q)}</h2><div class="opts">${q.options.map((o, j) => `<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}</div>
        <p class="explain" id="ex" hidden></p><button class="btn" id="next" hidden>${i === qs.length - 1 ? "See score" : "Next question"}</button></div>`;
      $$(".opt").forEach(b => b.onclick = () => {
        const j = +b.dataset.j;
        $$(".opt").forEach((x, k) => { x.disabled = true; if (k === q.answer) x.classList.add("right"); });
        if (j === q.answer) { score++; P.xp += 5; markActive(); save(); } else b.classList.add("wrong");
        const ex = $("#ex"); ex.hidden = false; ex.textContent = (j === q.answer ? "Correct. " : "Not quite. ") + (q.explain || "");
        $("#next").hidden = false; $("#next").focus();
      });
      $("#next").onclick = () => { i++; render(); };
    };
    render();
  };

  // ---------- SPEAK ----------
  let rec = null;
  function stopRec() { if (rec) { try { rec.abort(); } catch (e) {} rec = null; } }
  let speakWeek = null, speakMode = "read", speakIdx = 0;
  routes.speak = () => {
    if (!speakWeek || !weekByNum(speakWeek)) speakWeek = latest().week;
    const w = weekByNum(speakWeek);
    const pills = WEEKS.slice().reverse().map(x => `<button class="pill" data-w="${x.week}" aria-pressed="${x.week === w.week}">Week ${x.week}</button>`).join("");
    view.innerHTML = `
      <div class="head"><span class="eyebrow">Speaking</span><h1>Say it out loud</h1></div>
      <div class="pills" role="group" aria-label="Week">${pills}</div>
      <div class="pills" role="group" aria-label="Practice type">
        <button class="pill" data-m="read" aria-pressed="${speakMode === "read"}">Read aloud</button>
        <button class="pill" data-m="answer" aria-pressed="${speakMode === "answer"}">Answer questions</button>
      </div>
      <div id="speak-body" class="list"></div>`;
    $$("[data-w]").forEach(b => b.onclick = () => { speakWeek = +b.dataset.w; speakIdx = 0; routes.speak(); });
    $$("[data-m]").forEach(b => b.onclick = () => { speakMode = b.dataset.m; speakIdx = 0; routes.speak(); });
    speakMode === "read" ? renderRead(w) : renderQuestions(w);
  };
  function renderRead(w) {
    const list = w.speak || [];
    const body = $("#speak-body");
    if (!list.length) { body.innerHTML = `<div class="card empty"><p class="sub">No sentences this week.</p></div>`; return; }
    speakIdx = Math.min(speakIdx, list.length - 1);
    const s = list[speakIdx];
    body.innerHTML = `
      <div class="card">
        <span class="eyebrow">Sentence ${speakIdx + 1} of ${list.length}${P.speakDone[s.id] ? " · ✓ done" : ""}</span>
        <p class="target">${esc(s.text)}</p>
        ${s.note ? `<p class="sub">${esc(s.note)}</p>` : ""}
        <div class="row">${sayBtn(s.text)}<span class="sub">1. Listen &nbsp; 2. Tap the mic and say it</span></div>
      </div>
      ${Rec ? `<button class="mic" id="mic" aria-label="Start speaking"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg></button>
        <div class="card" id="result" hidden><span class="eyebrow">What I heard</span><p class="heard" id="heard"></p><p id="verdict"></p></div>`
        : `<div class="tip">The speaking check works in Chrome on Android or on a computer. On this phone, listen, then repeat the sentence out loud 3 times.</div>`}
      <div class="row">
        <button class="btn ghost" id="prev" ${speakIdx === 0 ? "disabled" : ""}>‹ Back</button>
        <button class="btn" id="nexts" style="flex:1">${speakIdx === list.length - 1 ? "Finish" : "Next sentence ›"}</button>
      </div>`;
    $("#prev").onclick = () => { speakIdx--; renderRead(w); };
    $("#nexts").onclick = () => {
      if (!Rec && !P.speakDone[s.id]) { P.speakDone[s.id] = true; addXP(5); }
      if (speakIdx < list.length - 1) { speakIdx++; renderRead(w); } else { toast("Great practice!"); speakIdx = 0; renderRead(w); }
    };
    if (Rec) $("#mic").onclick = () => listen(s);
  }
  function listen(s) {
    const mic = $("#mic");
    if (rec) { stopRec(); mic.classList.remove("on"); return; }
    rec = new Rec(); rec.lang = P.settings.accent; rec.interimResults = false; rec.maxAlternatives = 3;
    mic.classList.add("on"); mic.setAttribute("aria-label", "Stop");
    rec.onresult = e => {
      const alts = Array.from(e.results[0]).map(a => a.transcript);
      const best = alts.map(a => compare(s.text, a)).sort((a, b) => b.pct - a.pct)[0];
      $("#result").hidden = false;
      $("#heard").innerHTML = best.out.map(x => `<span class="${x.ok ? "ok" : "miss"}">${esc(x.w)}</span>`).join(" ");
      let msg;
      if (best.pct >= 85) {
        msg = `<b>${best.pct}%</b>. Excellent, very clear!`;
        if (!P.speakDone[s.id]) { P.speakDone[s.id] = true; addXP(10); toast("+10 XP"); }
      } else if (best.pct >= 60) msg = `<b>${best.pct}%</b>. Good. Listen again and practise the underlined words.`;
      else msg = `<b>${best.pct}%</b>. Try again a little slower. Listen first, then copy the rhythm.`;
      $("#verdict").innerHTML = msg;
    };
    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Allow the microphone in your browser settings");
      else if (e.error === "no-speech") toast("I didn't hear anything. Try again");
    };
    rec.onend = () => { rec = null; const m = $("#mic"); if (m) { m.classList.remove("on"); m.setAttribute("aria-label", "Start speaking"); } };
    try { rec.start(); } catch (e) { rec = null; mic.classList.remove("on"); }
  }
  function renderQuestions(w) {
    const qs = QUESTIONS.filter(q => q.week === w.week);
    $("#speak-body").innerHTML = qs.length ? qs.map(q => planItem("#question/" + q.id, P.answered[q.id] ? "✓" : "Q", q.q, q.context || "Practice question", !!P.answered[q.id])).join("")
      : `<div class="card empty"><p class="sub">No questions this week.</p></div>`;
  }
  routes.question = id => {
    const q = QUESTIONS.find(x => x.id === id);
    if (!q) return routes.speak();
    const draftKey = "parlo-draft-" + q.id;
    let draft = ""; try { draft = localStorage.getItem(draftKey) || ""; } catch (e) {}
    view.innerHTML = `
      <a class="btn ghost" href="#speak" style="align-self:flex-start">‹ Speaking</a>
      <div class="head"><span class="eyebrow">Week ${q.week} · ${esc(q.context || "Practice question")}</span><h1>${esc(q.q)}</h1></div>
      <div class="row">${sayBtn(q.q, "Listen to the question")}<span class="sub">Listen, then answer out loud or write it down.</span></div>
      ${q.tips ? `<div class="card"><span class="eyebrow">How to answer</span><ul class="tips">${q.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      <div class="card"><label for="ans">Your answer</label>
        <textarea id="ans" placeholder="Write 2–4 sentences…">${esc(draft)}</textarea>
        ${Rec ? `<button class="btn soft" id="dict">🎤 Speak my answer</button>` : ""}
      </div>
      <details class="card"><summary>Show an example answer</summary>
        <p class="model">${esc(q.model)}</p>
        <div class="row">${sayBtn(q.model, "Listen to the example answer")}<span class="sub">Compare it with yours. Copy one good phrase.</span></div>
        ${q.useful ? `<span class="eyebrow">Useful phrases</span><div class="pills" style="flex-wrap:wrap">${q.useful.map(u => `<span class="pill">${esc(u)}</span>`).join("")}</div>` : ""}
      </details>
      <button class="btn block" id="qdone" ${P.answered[q.id] ? "disabled" : ""}>${P.answered[q.id] ? "Answered ✓" : "I've answered it · +10 XP"}</button>`;
    const ta = $("#ans");
    ta.oninput = () => { try { localStorage.setItem(draftKey, ta.value); } catch (e) {} };
    $("#qdone").onclick = () => { P.answered[q.id] = true; addXP(10); toast("+10 XP"); location.hash = "#speak"; };
    const d = $("#dict");
    if (d) d.onclick = () => {
      if (rec) { stopRec(); d.textContent = "🎤 Speak my answer"; return; }
      rec = new Rec(); rec.lang = P.settings.accent; rec.continuous = true; rec.interimResults = false;
      d.textContent = "■ Stop";
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
      <div class="head"><span class="eyebrow">Settings</span><h1>Your settings</h1></div>
      <div class="card">
        <label for="accent">Accent</label>
        <select id="accent"><option value="en-GB">British English</option><option value="en-US">American English</option></select>
        <label for="rate">Speaking speed: <span id="rateval">${s.rate}</span>×</label>
        <input type="range" id="rate" min="0.6" max="1.2" step="0.1" value="${s.rate}">
        <button class="btn soft" data-say="How are you today? I hope you're having a good day.">Test the voice</button>
      </div>
      <div class="card">
        <label for="newper">New flashcards per day</label>
        <select id="newper">${[5, 10, 15, 20].map(n => `<option value="${n}">${n}</option>`).join("")}</select>
      </div>
      <div class="card">
        <span class="eyebrow">Install the app</span>
        <p class="sub">On iPhone: tap Share, then <b>Add to Home Screen</b>. On Android: tap the ⋮ menu, then <b>Add to Home screen</b> or <b>Install app</b>. It then works without internet.</p>
      </div>
      <div class="card">
        <span class="eyebrow">Progress</span>
        <p class="sub">Your progress is saved on this phone only. ${WEEKS.length} weeks of content · last update: Week ${latest().week}.</p>
        <button class="btn warn" id="reset">Reset all progress</button>
        <div class="row" id="confirm" hidden><span>Delete all XP, streak and learned words?</span><button class="btn warn" id="yes">Yes, reset</button><button class="btn ghost" id="no">Cancel</button></div>
      </div>`;
    $("#accent").value = s.accent; $("#newper").value = s.newPerDay;
    $("#accent").onchange = e => { s.accent = e.target.value; save(); };
    $("#rate").oninput = e => { s.rate = +e.target.value; $("#rateval").textContent = s.rate; save(); };
    $("#newper").onchange = e => { s.newPerDay = +e.target.value; session = null; save(); };
    $("#reset").onclick = () => { $("#confirm").hidden = false; };
    $("#no").onclick = () => { $("#confirm").hidden = true; };
    $("#yes").onclick = () => { const keep = P.settings; P = defaults(); P.settings = keep; session = null; save(); toast("Progress reset"); location.hash = "#home"; };
  };

  // ---------- start ----------
  renderStats();
  loadContent().then(go).catch(() => {
    view.innerHTML = `<div class="card empty"><span class="big">📡</span><h2>Couldn't load the lessons</h2><p class="sub">Check your internet connection and reload the page.</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
