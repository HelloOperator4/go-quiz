'use strict';
/* Go Quiz v1.1 — deliberately framework-free: no accounts, analytics, or server. */
const STORAGE_HISTORY = 'goquiz-history-v1';
const STORAGE_SESSION = 'goquiz-session-v1';
const STORAGE_SEEN = 'goquiz-seen-v11';
const QUIZ_LENGTH = 10;
const app = document.getElementById('app');
const nav = document.getElementById('bottom-nav');
const LETTERS = ['A', 'B', 'C', 'D'];
let bank = { topics: [], questions: [] };
let byId = new Map();
let history = safeRead(STORAGE_HISTORY, []);
let session = safeRead(STORAGE_SESSION, null);
let seen = safeRead(STORAGE_SEEN, {});
let selectedTopic = null;
let route = 'home';
let lastResult = null;
let toastTimer;

function safeRead(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { if (location.protocol === 'https:' || location.protocol === 'http:') showToast('Не удалось сохранить прогресс. Проверь свободное место и настройки браузера.'); }
}
function safeRemove(key) { try { localStorage.removeItem(key); } catch {} }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length-1; i>0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}
function setRoute(next) {
  route = next;
  nav.classList.toggle('is-hidden', next === 'quiz');
  nav.querySelectorAll('.nav-btn').forEach(button => {
    const active = button.dataset.route === next;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function getTopic(id) { return bank.topics.find(topic => topic.id === id); }
function topicName(id) { return getTopic(id)?.name ?? 'Все темы'; }
function subtopicName(topic, subtopic) {
  return getTopic(topic)?.subtopics?.find(s => s.id === subtopic)?.name ?? topicName(topic);
}
function scopeName(topic, subtopic) {
  return subtopic ? subtopicName(topic, subtopic) : topicName(topic);
}
function scopeKey(topic, subtopic) {
  return subtopic ? `sub:${topic}:${subtopic}` : topic === 'all' ? 'all' : `topic:${topic}`;
}
function getPool(topic, subtopic) {
  return bank.questions.filter(q => (topic === 'all' || q.topic === topic) && (!subtopic || q.subtopic === subtopic));
}
function pickQuestions(topic, subtopic) {
  const pool = getPool(topic, subtopic);
  if (pool.length < QUIZ_LENGTH) return null;
  const scope = scopeKey(topic, subtopic);
  // A per-scope cycle: exhaust unseen questions before reusing any.
  const valid = new Set(pool.map(q => q.id));
  const used = Array.isArray(seen[scope]) ? seen[scope].filter(id => valid.has(id)) : [];
  const unseen = pool.filter(q => !used.includes(q.id));
  const selected = [];
  const globalUsed = new Set(Array.isArray(seen.__global) ? seen.__global : []);
  const priorityOrder = items => [
    ...shuffle(items.filter(q => !globalUsed.has(q.id))),
    ...shuffle(items.filter(q => globalUsed.has(q.id)))
  ];
  const randomFill = (items, n) => {
    const available = items.filter(q => !selected.includes(q));
    const theory = priorityOrder(available.filter(q => q.kind === 'theory'));
    const code = priorityOrder(available.filter(q => q.kind === 'code'));
    const wantTheory = Math.min(Math.ceil(n/2), theory.length);
    const wantCode = Math.min(n - wantTheory, code.length);
    const initial = [...theory.slice(0,wantTheory), ...code.slice(0,wantCode)];
    const leftovers = shuffle(available.filter(q => !initial.includes(q))).slice(0, n - initial.length);
    selected.push(...shuffle([...initial, ...leftovers]));
  };
  randomFill(unseen, Math.min(unseen.length, QUIZ_LENGTH));
  // Only after the unused supply is insufficient, include earlier questions.
  if (selected.length < QUIZ_LENGTH) randomFill(pool.filter(q => used.includes(q.id)), QUIZ_LENGTH-selected.length);
  const picked = shuffle(selected);
  // Once all questions in the scope are used, start a new cycle; include only
  // the questions selected from this run in the new cycle.
  const selectedIds = picked.map(q => q.id);
  seen[scope] = unseen.length < QUIZ_LENGTH ? selectedIds : [...used, ...selectedIds];
  seen.__global = [...new Set([...(Array.isArray(seen.__global) ? seen.__global : []), ...selectedIds])].slice(-bank.questions.length);
  safeWrite(STORAGE_SEEN, seen);
  return picked;
}

function validateBank(payload) {
  if (!payload || !Array.isArray(payload.topics) || !Array.isArray(payload.questions)) throw new Error('Некорректный формат базы');
  const topics = new Set(payload.topics.map(t => t.id));
  const subs = new Map(payload.topics.map(t => [t.id, new Set((t.subtopics || []).map(s => s.id))]));
  const ids = new Set();
  for (const q of payload.questions) {
    if (!q.id || ids.has(q.id) || !topics.has(q.topic) || !subs.get(q.topic).has(q.subtopic) || !q.question ||
        !['theory','code'].includes(q.kind) || !Array.isArray(q.options) || q.options.length !== 4 ||
        !q.options.every(x => typeof x === 'string' && x.trim()) ||
        !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3 ||
        !q.explanation || (q.kind === 'code' && !q.code)) throw new Error('Ошибка вопроса: ' + q.id);
    ids.add(q.id);
  }
  for (const t of payload.topics) {
    if (payload.questions.filter(q => q.topic === t.id).length < 10) throw new Error('Мало вопросов в теме: ' + t.id);
    for (const sub of t.subtopics || []) {
      if (payload.questions.filter(q => q.topic === t.id && q.subtopic === sub.id).length < 10) throw new Error('Мало вопросов в подтеме: ' + sub.id);
    }
  }
  return payload;
}
function validateSession(value) {
  return value && Array.isArray(value.ids) && value.ids.length === 10 &&
    value.ids.every(id => byId.has(id)) &&
    Array.isArray(value.optionOrder) && value.optionOrder.length === 10 &&
    value.optionOrder.every(order => Array.isArray(order) && order.length === 4 && new Set(order).size === 4 && order.every(n => Number.isInteger(n) && n>=0 && n<=3)) &&
    Array.isArray(value.choices) && value.choices.length === 10 &&
    value.choices.every(x => x === null || (Number.isInteger(x) && x >= 0 && x <= 3)) &&
    Number.isInteger(value.index) && value.index >= 0 && value.index < 10;
}
function render() {
  if (route === 'home') app.innerHTML = renderHome();
  else if (route === 'topics') app.innerHTML = renderSubtopics();
  else if (route === 'quiz') app.innerHTML = renderQuiz();
  else if (route === 'result') app.innerHTML = renderResult();
  else if (route === 'stats') app.innerHTML = renderStats();
  else if (route === 'about') app.innerHTML = renderAbout();
}
function renderHome() {
  const last = history[0];
  const resume = session ? `<div class="resume"><div><strong>Незаконченный тест</strong><small>${esc(scopeName(session.topic,session.subtopic))} · вопрос ${session.index+1} из 10</small></div><button class="btn btn-primary" data-action="resume">Продолжить →</button></div>` : '';
  return `${resume}
    <section class="hero">
      <div class="eyebrow">Практика Go каждый день</div>
      <h1>Проверь, насколько хорошо ты знаешь Go</h1>
      <p>10 вопросов по изученным темам. Сразу узнавай правильный ответ и разбирай ошибки.</p>
      <div class="hero-bottom"><button class="btn btn-hero" data-action="start" data-topic="all">⚡ Случайный тест →</button><span class="hero-num">${bank.questions.length} вопросов в базе</span></div>
    </section>
    <div class="section-title"><h2>Темы для практики</h2><span>${bank.topics.length} разделов</span></div>
    <div class="topics">${bank.topics.map(t => {
      const total = bank.questions.filter(q=>q.topic === t.id).length;
      return `<button class="topic-card" data-action="topic" data-topic="${esc(t.id)}" aria-label="Выбрать тему: ${esc(t.name)}"><span class="topic-icon" aria-hidden="true">${esc(t.icon)}</span><span class="topic-title">${esc(t.name)}</span><span class="topic-count">${total} вопросов · 3 подтемы</span><span class="topic-arrow" aria-hidden="true">→</span></button>`;
    }).join('')}</div>
    ${last ? `<p class="foot-note">Последний результат: ${last.correct}/10 · ${esc(scopeName(last.topic,last.subtopic))} · ${formatDate(last.at)}</p>` : '<p class="foot-note">Без регистрации · Работает офлайн после первой загрузки</p>'}`;
}
function renderSubtopics() {
  const t = getTopic(selectedTopic);
  if (!t) return '<div class="empty">Тема не найдена.</div>';
  const count = getPool(t.id, null).length;
  return `<div class="quiz-top"><button class="back-btn" data-action="home">← Все темы</button><span class="muted">${count} вопросов</span></div>
    <div class="eyebrow">Тематическая практика</div>
    <h1 class="question-title">${esc(t.name)}</h1>
    <p class="muted subtopic-intro">В каждом тесте 10 вопросов. Проходи целый раздел или тренируй конкретную подтему.</p>
    <div class="scope-main"><button class="btn btn-primary btn-full" data-action="start" data-topic="${esc(t.id)}">Тест по всему разделу · ${count} вопросов →</button></div>
    <div class="section-title"><h2>Подтемы</h2><span>${t.subtopics.length}</span></div>
    <div class="subtopics">${t.subtopics.map(sub => {
      const n = getPool(t.id, sub.id).length;
      return `<button class="subtopic-card" data-action="start" data-topic="${esc(t.id)}" data-subtopic="${esc(sub.id)}"><span class="subtopic-title">${esc(sub.name)}</span><span class="subtopic-count">${n} вопросов</span><span class="topic-arrow">→</span></button>`;
    }).join('')}</div>
    <p class="foot-note">Внутри раздела новые вопросы показываются раньше уже использованных. В узкой подтеме из 10 вопросов при повторном тесте вопросы повторятся.</p>`;
}
function renderQuiz() {
  if (!validateSession(session)) { route = 'home'; nav.classList.remove('is-hidden'); return renderHome(); }
  const q = byId.get(session.ids[session.index]);
  const selected = session.choices[session.index];
  const answered = selected !== null;
  const correct = answered && selected === q.answer;
  const progress = session.ids.map((id,i) => {
    const choice = session.choices[i];
    const state = choice === null ? (i < session.index ? 'done' : '') : (choice === byId.get(id).answer ? 'good' : 'bad');
    return `<span class="progress-part ${state}" aria-hidden="true"></span>`;
  }).join('');
  return `<div class="quiz-top"><button class="back-btn" data-action="home">← К темам</button><span class="muted">Вопрос <b>${session.index+1}</b> из 10</span></div>
  <div class="progress" role="progressbar" aria-label="Прогресс теста" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${session.index+(answered?1:0)}">${progress}</div>
  <div class="question-meta"><span class="pill">${esc(subtopicName(q.topic,q.subtopic))}</span><span class="pill">${q.kind === 'code' ? 'Анализ кода' : 'Теория'}</span></div>
  <h1 class="question-title">${esc(q.question)}</h1>
  ${q.code ? `<pre><code>${esc(q.code)}</code></pre><p class="code-caption">Импорты и служебные обёртки опущены.</p>` : ''}
  <div class="answers">${session.optionOrder[session.index].map((i,displayIndex) => {
    const option = q.options[i];
    const state = answered ? (i === q.answer ? 'is-right' : i === selected ? 'is-wrong' : '') : '';
    const marker = answered && i === q.answer ? '<span class="check">✓</span>' : answered && i === selected ? '<span class="check">✕</span>' : '';
    return `<button class="answer ${state}" type="button" data-action="answer" data-choice="${i}" ${answered?'disabled':''} aria-label="Вариант ${LETTERS[displayIndex]}: ${esc(option)}"><span class="letter">${LETTERS[displayIndex]}</span><span>${esc(option)}</span>${marker}</button>`;
  }).join('')}</div>
  ${answered ? `<div class="feedback ${correct?'':'wrong'}" role="status"><strong>${correct ? '✓ Верно!' : '✕ Ошибка!'}</strong><p>${esc(q.explanation)}</p></div>
  <div class="quiz-controls"><button class="btn btn-primary" data-action="next">${session.index === 9 ? 'Завершить тест →' : 'Следующий вопрос →'}</button></div>` : `<p class="foot-note">Выбери один вариант ответа. Изменить выбор после проверки нельзя.</p>`}`;
}
function beginTest(topic, subtopic=null) {
  const pool = getPool(topic, subtopic);
  if (pool.length < QUIZ_LENGTH) return showToast('В этой теме пока недостаточно вопросов.');
  if (session && !window.confirm('Начать новый тест? Прогресс незаконченного теста будет потерян.')) return;
  const picked = pickQuestions(topic, subtopic);
  session = { topic, subtopic, ids: picked.map(q => q.id), optionOrder: picked.map(() => shuffle([0,1,2,3])), choices: Array(QUIZ_LENGTH).fill(null), index: 0, startedAt: new Date().toISOString() };
  safeWrite(STORAGE_SESSION, session);
  setRoute('quiz');
}
function answer(choice) {
  if (!session || session.choices[session.index] !== null || !Number.isInteger(choice) || choice<0 || choice>3) return;
  session.choices[session.index] = choice;
  safeWrite(STORAGE_SESSION, session);
  render();
}
function nextQuestion() {
  if (!session || session.choices[session.index] === null) return;
  if (session.index === 9) return finishTest();
  session.index++;
  safeWrite(STORAGE_SESSION, session);
  render();
  window.scrollTo({top:0, behavior:'auto'});
}
function finishTest() {
  const answers = session.ids.map((id,i) => ({id, selected:session.choices[i]}));
  const correct = answers.filter(a => a.selected === byId.get(a.id).answer).length;
  lastResult = { at:new Date().toISOString(), topic:session.topic, subtopic:session.subtopic || null, correct, answers };
  history = [lastResult, ...history].slice(0,100);
  safeWrite(STORAGE_HISTORY, history);
  session = null;
  safeRemove(STORAGE_SESSION);
  setRoute('result');
}
function reviewCard(a, i) {
  const q = byId.get(a.id);
  if (!q) return '';
  const good = a.selected === q.answer;
  return `<article class="review-item"><div class="question-meta"><span class="pill">Вопрос ${i+1}</span><span class="pill">${esc(subtopicName(q.topic,q.subtopic))}</span></div>
  <div class="review-q">${esc(q.question)}</div>${q.code?`<pre class="review-code"><code>${esc(q.code)}</code></pre>`:''}
  <div class="review-answer">${good?'✓ Верно':'✕ Твой ответ: '+esc(q.options[a.selected] ?? '—')}</div>
  <div class="review-answer review-right">Правильно: ${esc(q.options[q.answer])}</div><p>${esc(q.explanation)}</p></article>`;
}
function renderResult() {
  const r = lastResult ?? history[0];
  if (!r) return '<div class="empty"><h2>Пока нет результатов</h2><p>Пройди первый тест, чтобы увидеть результат.</p></div>';
  const errors = r.answers.filter(a => byId.has(a.id) && a.selected !== byId.get(a.id).answer);
  const headline = r.correct === 10 ? 'Отличный результат!' : r.correct >= 7 ? 'Хорошая работа!' : 'Есть что повторить';
  return `<section class="result-hero"><div class="eyebrow">Тест завершён</div><div class="score-circle"><strong>${r.correct}/10</strong><small>${r.correct*10}% верных</small></div><h1>${headline}</h1><p>${esc(scopeName(r.topic,r.subtopic))} · ${formatDate(r.at)}</p><div class="result-actions"><button class="btn btn-primary" data-action="start" data-topic="${esc(r.topic)}" ${r.subtopic ? `data-subtopic="${esc(r.subtopic)}"` : ''}>Новый тест ↗</button><button class="btn btn-outline" data-action="home">К темам</button></div></section>
  <div class="section-title"><h2>${errors.length ? 'Разбор ошибок' : 'Все ответы верные'}</h2><span>${errors.length} ошибок</span></div>
  ${errors.length ? `<div class="stack">${r.answers.map((a,i)=>({a,i})).filter(({a}) => byId.has(a.id) && a.selected !== byId.get(a.id).answer).map(({a,i})=>reviewCard(a,i)).join('')}</div>` : '<div class="note">Ты ответил правильно на все вопросы! Попробуй другой набор из этой же темы или случайный тест.</div>'}`;
}
function formatDate(str) {
  const dt = new Date(str);
  return Number.isNaN(dt.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(dt);
}
function renderStats() {
  if (!history.length) return `<div class="empty card"><div style="font-size:44px">▤</div><h2>История пока пуста</h2><p>После первого завершённого теста здесь появятся результаты и статистика по темам.</p><button class="btn btn-primary" data-action="home">Выбрать тему</button></div>`;
  const total = history.length;
  const attempts = history.flatMap(item => item.answers.filter(a => byId.has(a.id)));
  const successes = attempts.filter(a => a.selected === byId.get(a.id).answer).length;
  const pct = attempts.length ? Math.round(successes/attempts.length*100) : 0;
  return `<div class="eyebrow">Твоя практика</div><h1 class="question-title">Прогресс обучения</h1>
  <div class="stat-grid"><div class="stat"><strong>${total}</strong><span>Тестов</span></div><div class="stat"><strong>${pct}%</strong><span>Верных ответов</span></div><div class="stat"><strong>${successes}</strong><span>Всего верных</span></div></div>
  <div class="section-title"><h2>По темам</h2></div><div class="card">${bank.topics.map(t=>{
    const selected = attempts.filter(a=>byId.get(a.id)?.topic===t.id);
    if (!selected.length) return '';
    const good = selected.filter(a=>a.selected===byId.get(a.id).answer).length;
    const percent = Math.round(good/selected.length*100);
    return `<div class="topic-progress"><div class="topic-progress-header"><strong>${esc(t.name)}</strong><span>${percent}% · ${selected.length} отв.</span></div><div class="bar"><div style="width:${percent}%"></div></div></div>`;
  }).join('') || '<p class="muted">Пока нет данных</p>'}</div>
  <div class="section-title"><h2>История тестов</h2><span>${Math.min(10,history.length)} последних</span></div>
  <div class="card">${history.slice(0,10).map((h,i)=>`<div class="history-row"><div><b>${esc(scopeName(h.topic,h.subtopic))}</b><small>${formatDate(h.at)}</small></div><strong>${h.correct}/10</strong></div>`).join('')}</div>
  <div style="margin-top:22px"><button class="btn btn-outline btn-full" data-action="clear">Очистить историю результатов</button></div>
  <p class="foot-note">Результаты хранятся только в этом браузере на данном устройстве.</p>`;
}
function renderAbout() {
  return `<div class="eyebrow">Go Quiz 1.1</div><h1 class="question-title">Тренажёр, который растёт вместе с тобой</h1>
  <div class="card stack"><div><h2 class="subheading">Как пользоваться</h2><p class="muted">Выбери раздел, подтему или случайный тест. Ответь на 10 вопросов: после каждого ответа появится объяснение, а после завершения — разбор ошибок.</p></div>
  <div><h2 class="subheading">Как установить на iPhone</h2><ol class="about-list"><li>Открой опубликованный адрес Go Quiz в <b>Safari</b>.</li><li>Нажми «Поделиться» (квадрат со стрелкой).</li><li>Выбери «На экран Домой» / «Добавить на экран Домой».</li><li>Если предлагается «Открывать как веб-приложение», оставь эту опцию включённой.</li><li>Нажми «Добавить». Иконка появится на главном экране.</li></ol></div>
  <div><h2 class="subheading">Офлайн-режим</h2><p class="muted">После первой загрузки по HTTPS приложение сохраняет интерфейс и вопросы для использования без подключения к интернету. Для получения новых вопросов периодически открывай приложение с интернетом.</p></div>
  <div><h2 class="subheading">Конфиденциальность</h2><p class="muted">Нет аккаунта, сервера, рекламы и аналитики. История хранится в памяти браузера на устройстве. Очистка данных Safari или удаление приложения может удалить прогресс.</p></div>
  <div class="note"><strong>Учебная база:</strong> материалы курса Go до задачи 270 включительно. Новые темы будут добавляться после их прохождения.</div></div>`;
}
function handleAction(action, target) {
  if (action === 'home') setRoute('home');
  else if (action === 'topic') { selectedTopic = target.dataset.topic; setRoute('topics'); }
  else if (action === 'start') beginTest(target.dataset.topic || 'all', target.dataset.subtopic || null);
  else if (action === 'resume') setRoute('quiz');
  else if (action === 'answer') answer(Number(target.dataset.choice));
  else if (action === 'next') nextQuestion();
  else if (action === 'clear') {
    if (window.confirm('Удалить всю историю тестов с этого устройства? Это действие нельзя отменить.')) {
      history = []; lastResult = null; safeRemove(STORAGE_HISTORY); setRoute('stats'); showToast('История очищена');
    }
  }
}
app.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target && !target.disabled) handleAction(target.dataset.action,target);
});
nav.addEventListener('click',event => {
  const target = event.target.closest('[data-route]');
  if (target) setRoute(target.dataset.route);
});
const homeLink = document.getElementById('brand-home');
homeLink.addEventListener('click',()=>setRoute('home'));
homeLink.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setRoute('home');}});

async function boot() {
  try {
    const res = await fetch('./data/questions.json');
    if (!res.ok) throw new Error('HTTP '+res.status);
    bank = validateBank(await res.json());
    byId = new Map(bank.questions.map(q => [q.id,q]));
    if (!validateSession(session)) { session = null; safeRemove(STORAGE_SESSION); }
    if (!Array.isArray(history)) { history = []; safeRemove(STORAGE_HISTORY); }
    if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {};
    if (!Array.isArray(seen.__global)) {
      seen.__global = [...new Set(history.flatMap(h => (h.answers || []).map(a => a.id)).filter(id => byId.has(id)))].slice(-bank.questions.length);
      safeWrite(STORAGE_SEEN, seen);
    }
    history = history.filter(h=>h && typeof h.correct === 'number' && Array.isArray(h.answers));
    setRoute('home');
  } catch(e) {
    app.innerHTML = `<div class="empty card"><h2>Не удалось загрузить вопросы</h2><p>Если ты открыл index.html прямо из папки, открой проект через локальный веб-сервер или GitHub Pages. Проверь подключение к интернету при первом запуске.</p><p class="muted">${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Повторить</button></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {/* Offline install unavailable in this browser */});
  }
}
boot();