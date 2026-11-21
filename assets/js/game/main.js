/* Flappy Kitty · главный модуль: экраны, ввод, игровой цикл. */

import { CONFIG, setSignature, isBirthday } from '../config.js';
import { save } from '../storage.js';
import { LEVELS, SKINS, POWERUPS } from './levels.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Finale } from './finale.js';
import { Sound } from './audio.js';
import { THEMES } from './themes.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const STEP = 1 / 120;
const params = new URLSearchParams(location.search);
const DEV = params.has('dev'); // play.html?dev=1 — все уровни открыты (для проверки)
const FINAL = LEVELS.length;

const stage = $('#stage');
const canvas = $('#game');
const renderer = new Renderer(canvas);
const sound = new Sound();

const TIPS = {
  1: 'Тап, клик или пробел — взмах крыльев. У Мии три жизни на уровень.',
  2: 'Из кранов на потолке падают капли. Мия не любит мокнуть.',
  3: 'Свечи двигаются. Лопай шарики — в каждом два сердечка.',
  4: 'Красный «!» справа — оттуда летит огурец. Уходи с его линии.',
  5: 'Стрелки показывают, куда подует ветер. Дует вверх — маши реже, вниз — чаще.',
  6: 'Здесь всё сразу. Долети до большого сердца.',
};
const LOSE_LINES = [
  'Мия прилегла отдохнуть. Но она уже готова лететь снова.',
  'Девять жизней — это в сумме. На уровень выдают три.',
  'Мия делает вид, что так и было задумано.',
  'Это была разведка. Теперь всерьёз.',
];


let sim = null;
let screen = 'loading';
let mode = 'story';
let levelId = 1;
let acc = 0;
let last = 0;
let pendingTimer = null;
let afterNote = null;
let frozen = false;
let hitStop = 0; // короткая пауза на ударе: мир замирает, удар чувствуется весом
let musicStarted = false; // музыка включается с первым полётом и дальше играет везде, кроме паузы
let finale = null; // финальная сцена после шестого уровня
let finaleResult = null;
const images = {};
const memoryImgs = {};
const hud = {};
let saidThisRun = {}; // какие реплики Мия уже сказала в этом полёте

/** Реплика Мии из списка черновиков в config.js. Один раз за событие за полёт. */
function miaSay(key) {
  const list = CONFIG.miaLines && CONFIG.miaLines[key];
  if (!list || !list.length || saidThisRun[key]) return;
  saidThisRun[key] = true;
  renderer.say(list[Math.floor(Math.random() * list.length)]);
}

/* ---------- запуск ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не загрузилась картинка: ' + src));
    img.src = src;
  });
}

async function applySkin(id) {
  const skin = SKINS.find((s) => s.id === id) || SKINS[0];
  if (!images[skin.id]) images[skin.id] = await loadImage(skin.src);
  renderer.setSkin(skin, images[skin.id]);
}

async function boot() {
  // play.html?reset=1 — начать с чистого листа (удобно перед тем, как дарить)
  if (params.has('reset')) {
    if (window.confirm('Сбросить весь прогресс: уровни, сердечки, облики и записки?')) save.reset();
    params.delete('reset');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }
  fillNames();
  const d = save.data;
  sound.setSound(d.sound);
  sound.setMusic(d.music);
  try {
    await applySkin(d.skin);
  } catch (e) {
    await applySkin('super');
  }
  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  }
  bind();
  resize();
  attract();
  const jump = parseInt(params.get('level'), 10);
  if (params.has('finale') && (DEV || (save.data.levels[FINAL] && save.data.levels[FINAL].done))) {
    // прямой вход в финал — чтобы можно было проверить письмо без шести уровней
    levelId = FINAL;
    startFinale({ stars: 3, hearts: 0, earned: 0 });
  } else if (jump && (DEV || save.isLevelOpen(jump)) && LEVELS[jump - 1]) startLevel(jump);
  else go('menu');
  last = performance.now();
  requestAnimationFrame(frame);
}

function fillNames() {
  $$('[data-her-sweet]').forEach((e) => (e.textContent = CONFIG.her.sweet));
  $$('[data-her-dative]').forEach((e) => (e.textContent = CONFIG.her.dative));
  $$('[data-her]').forEach((e) => (e.textContent = CONFIG.her.name));
  $$('[data-cat]').forEach((e) => (e.textContent = CONFIG.cat.name));
  if (isBirthday()) $('#bday').hidden = false;
}

/* ---------- экраны ---------- */

/** Экраны, где холст не нужен: там спокойный фон из CSS, чтобы ничто не мешало читать. */
const CALM_SCREENS = new Set(['letter', 'memories', 'credits']);

function go(name) {
  screen = name;
  stage.dataset.screen = name;
  $$('.screen').forEach((s) => (s.hidden = s.dataset.name !== name));
  $('#hud').hidden = !(name === 'play' || name === 'pause');
  if (name !== 'play') $('#hint').hidden = true;
  if (name === 'menu') {
    clearTimeout(pendingTimer);
    bankHearts();
    attract();
    refreshMenu();
  }
  if (name === 'levels') renderLevels();
  if (name === 'wardrobe') renderSkins();
  if (name === 'memories') renderMemories();
  if (CALM_SCREENS.has(name)) {
    finale = null;
    sound.stopMusic();
  } else if (musicStarted) {
    if (name === 'pause') sound.stopMusic();
    else sound.startMusic();
  }
  // с клавиатуры удобно сразу попадать на главную кнопку экрана
  const scr = $(`.screen[data-name="${name}"]`);
  const focusable = scr && ($('.btn:not(.btn--ghost):not([hidden]):not([disabled])', scr) || $('.btn:not([hidden]):not([disabled])', scr));
  if (focusable && matchMedia('(hover: hover)').matches) focusable.focus({ preventScroll: true });
}

function refreshMenu() {
  const d = save.data;
  $$('[data-wallet]').forEach((e) => (e.textContent = d.hearts));
  const allDone = LEVELS.every((l) => d.levels[l.id] && d.levels[l.id].done);
  const next = save.nextLevel(LEVELS.length);
  const started = Object.keys(d.levels).length > 0;
  $('#btnPlayLabel').textContent = allDone ? 'Играть снова' : started ? `Уровень ${next}` : 'Играть';
  const endlessOpen = DEV || (d.levels[1] && d.levels[1].done);
  const be = $('#btnEndless');
  be.setAttribute('aria-disabled', endlessOpen ? 'false' : 'true');
  $('use', be).setAttribute('href', endlessOpen ? '#i-infinity' : '#i-lock');
  const best = $('#menuBest');
  best.hidden = !d.best;
  best.textContent = `Рекорд: ${d.best}`;
  // «Воспоминания» появляются, как только открыт хотя бы один снимок
  const memBtn = $('#btnMemories');
  const anyMemory = unlockedMemories().length > 0;
  memBtn.hidden = !anyMemory;
  if (anyMemory) $('.memories__count', memBtn).textContent = String(unlockedMemories().length);
  syncToggles();
}

/** Фоновая сцена для меню: Мия парит по центру, мир медленно плывёт. */
function attract() {
  const next = save.nextLevel(LEVELS.length);
  sim = new Sim({ mode: 'story', levelId: next, viewW: renderer.viewW, seed: 7 });
  sim.gates = [];
  sim.items = [];
  sim.finishX = null;
  sim.miaX = renderer.viewW / 2;
  sim.hoverY = 400;
  sim.attract = true;
  sim.attractT = 0;
  renderer.finishLabel = '';
  renderer.trail.length = 0;
  renderer.particles.length = 0;
  renderer.warm = 0;
  renderer.cam.zoom = 1;
  renderer.cam.zoomTo = 1;
  saidThisRun = {};
  sound.setTheme(sim.theme);
  sound.setMode('menu');
  sound.setProgress(0);
}

function renderLevels() {
  const d = save.data;
  const list = $('#levelList');
  list.innerHTML = '';
  for (const l of LEVELS) {
    const open = DEV || save.isLevelOpen(l.id);
    const st = (d.levels[l.id] && d.levels[l.id].stars) || 0;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'level';
    b.dataset.theme = l.theme;
    b.disabled = !open;
    b.setAttribute('aria-label', `Уровень ${l.id}. ${levelName(l)}. ${open ? `Звёзд: ${st} из 3` : 'Закрыт'}`);
    b.innerHTML = `
      <span class="level__art"><span>${l.id}</span>${open ? '' : '<svg class="icon" aria-hidden="true"><use href="#i-lock"/></svg>'}</span>
      <span class="level__body">
        <span class="level__name"></span>
        <span class="level__tag"></span>
        <span class="level__stars" aria-hidden="true">${[1, 2, 3].map((n) => `<svg class="icon${st >= n ? ' on' : ''}"><use href="#i-star"/></svg>`).join('')}</span>
      </span>`;
    $('.level__name', b).textContent = levelName(l);
    $('.level__tag', b).textContent = open ? l.tagline : `Пройди уровень ${l.id - 1}`;
    b.addEventListener('click', () => {
      sound.play('click');
      startLevel(l.id);
    });
    li.appendChild(b);
    list.appendChild(li);
  }
  $('#starTotal').textContent = `${save.totalStars()}/${LEVELS.length * 3}`;
}

function levelName(l) {
  return l.theme === 'love' ? `Дорога к ${CONFIG.her.dative}` : l.name;
}

function renderSkins() {
  const d = save.data;
  $$('[data-wallet]').forEach((e) => (e.textContent = d.hearts));
  const list = $('#skinList');
  list.innerHTML = '';
  for (const s of SKINS) {
    const owned = d.skins.includes(s.id);
    const on = d.skin === s.id;
    const li = document.createElement('li');
    li.className = 'skin' + (on ? ' is-on' : '') + (owned ? '' : ' is-locked');
    const img = document.createElement('img');
    img.src = s.src;
    img.alt = '';
    img.width = 88;
    img.height = 80;
    const name = document.createElement('span');
    name.className = 'skin__name';
    name.textContent = s.name;
    const hint = document.createElement('span');
    hint.className = 'skin__hint';
    hint.textContent = s.hint;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--small ' + (on ? 'btn--gold' : 'btn--ghost');
    if (on) {
      b.textContent = 'Надето';
      b.disabled = true;
    } else if (owned) {
      b.textContent = 'Надеть';
      b.addEventListener('click', async () => {
        save.set({ skin: s.id });
        await applySkin(s.id);
        sound.play('meow');
        renderSkins();
      });
    } else {
      b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-heart"/></svg>${s.price}`;
      b.setAttribute('aria-label', `Купить «${s.name}» за ${s.price} сердечек`);
      if (d.hearts < s.price) {
        b.disabled = true;
        hint.textContent = `Не хватает ${s.price - d.hearts}`;
      }
      b.addEventListener('click', async () => {
        if (!save.spendHearts(s.price)) return sound.play('nope');
        save.unlockSkin(s.id);
        save.set({ skin: s.id });
        await applySkin(s.id);
        sound.play('buy');
        renderSkins();
      });
    }
    li.append(img, name, hint, b);
    list.appendChild(li);
  }
}

/* ---------- воспоминания: настоящие снимки из альбома ---------- */

/** Снимки, которые уже открылись: у каждого в config.js указан уровень. */
function unlockedMemories() {
  const list = CONFIG.memories || [];
  const d = save.data;
  return list.filter((m) => DEV || (d.levels[m.level] && d.levels[m.level].done));
}

async function memoryImage(id) {
  if (memoryImgs[id]) return memoryImgs[id];
  try {
    memoryImgs[id] = await loadImage(`assets/img/gallery/${id}-thumb.webp`);
  } catch (e) {
    memoryImgs[id] = null;
  }
  return memoryImgs[id];
}

function renderMemories(autoPlay = false) {
  const list = unlockedMemories();
  const box = $('#memoryList');
  box.innerHTML = '';
  $('#memoryEmpty').hidden = list.length > 0;
  $('#memoryHint').hidden = list.length < 2;
  $('#btnMemoriesNext').hidden = list.length === 0;
  list.forEach((m, i) => {
    const fig = document.createElement('figure');
    fig.className = 'polaroid';
    fig.style.setProperty('--i', String(i));
    if (autoPlay) fig.style.animationDelay = `${0.15 + i * 0.55}s`;
    const img = document.createElement('img');
    img.alt = m.caption || '';
    img.loading = 'lazy';
    img.width = 640;
    img.height = 853;
    img.src = `assets/img/gallery/${m.id}-thumb.webp`;
    const cap = document.createElement('figcaption');
    cap.textContent = m.caption || '';
    fig.append(img, cap);
    box.appendChild(fig);
    // подставляем настоящие пропорции, когда картинка загрузится
    memoryImage(m.id).then((im) => {
      if (im && im.naturalWidth) {
        img.width = im.naturalWidth;
        img.height = im.naturalHeight;
      }
    });
  });
  $('#memoryCount').textContent = `${list.length} из ${(CONFIG.memories || []).length}`;
}

/* ---------- старт игры ---------- */

/** Кладёт в кошелёк сердечки, собранные в текущем полёте и ещё не учтённые.
    Вызывается при любом выходе из полёта — победа, проигрыш, «Заново», «В меню», закрытие вкладки, —
    поэтому собранное не пропадает, и ничего не засчитывается дважды. */
function bankHearts() {
  if (!sim || sim.attract) return;
  const fresh = sim.hearts - (sim.banked || 0);
  if (fresh > 0) save.addHearts(fresh);
  sim.banked = sim.hearts;
}

function startLevel(id) {
  clearTimeout(pendingTimer);
  bankHearts();
  mode = 'story';
  levelId = id;
  const l = LEVELS[id - 1];
  sim = new Sim({ mode: 'story', levelId: id, viewW: renderer.viewW, seed: (Date.now() % 1e9) + id });
  renderer.particles.length = 0;
  renderer.trail.length = 0;
  renderer.momentFx = null;
  renderer.warm = 0;
  renderer.cam.zoom = 1;
  renderer.cam.zoomTo = 1;
  renderer.finishLabel = id === LEVELS.length ? CONFIG.her.name : '';
  saidThisRun = {};
  sound.setTheme(l.theme);
  sound.setMode('play');
  sound.setProgress(0);
  $('#introEyebrow').textContent = `Уровень ${id} из ${LEVELS.length} · ${l.gates} ворот`;
  $('#introName').textContent = levelName(l);
  $('#introStory').textContent = l.story;
  $('#introTip').textContent = TIPS[id] || '';
  resetHud();
  go('intro');
}

function startEndless() {
  clearTimeout(pendingTimer);
  bankHearts();
  mode = 'endless';
  sim = new Sim({ mode: 'endless', viewW: renderer.viewW, seed: Date.now() % 1e9 });
  renderer.particles.length = 0;
  renderer.trail.length = 0;
  renderer.momentFx = null;
  renderer.warm = 0;
  renderer.finishLabel = '';
  saidThisRun = {};
  sound.setTheme(sim.theme);
  sound.setMode('play');
  sound.setProgress(0);
  resetHud();
  beginPlay();
}

function beginPlay() {
  save.set({ plays: save.data.plays + 1 });
  sound.unlock();
  musicStarted = true;
  go('play');
  $('#hint').hidden = false;
}

function restart() {
  if (mode === 'endless') startEndless();
  else {
    startLevel(levelId);
    beginPlay();
  }
}

/* ---------- HUD ---------- */

function resetHud() {
  Object.keys(hud).forEach((k) => delete hud[k]);
  const lives = $('#hudLives');
  lives.innerHTML = '';
  lives.hidden = sim.maxLives <= 1;
  for (let i = 0; i < sim.maxLives; i++) lives.insertAdjacentHTML('beforeend', '<svg class="icon" aria-hidden="true"><use href="#i-heart"/></svg>');
  $('#hudTrack').hidden = mode !== 'story';
  $('#hudScore').hidden = mode !== 'endless';
  $('#hudPowers').innerHTML = '';
  $('#hudCombo').hidden = true;
  updateHud();
}

function updateHud() {
  if (!sim) return;
  if (hud.lives !== sim.lives) {
    hud.lives = sim.lives;
    $$('#hudLives .icon').forEach((el, i) => el.classList.toggle('off', i >= sim.lives));
  }
  if (hud.hearts !== sim.hearts) {
    hud.hearts = sim.hearts;
    $('#hudHearts').textContent = sim.hearts;
    const chip = $('.hud__hearts');
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }
  if (hud.combo !== sim.combo) {
    hud.combo = sim.combo;
    const c = $('#hudCombo');
    if (sim.combo >= 3) {
      c.hidden = false;
      c.textContent = `×${sim.combo}`;
      c.classList.remove('bump');
      void c.offsetWidth;
      c.classList.add('bump');
    } else c.hidden = true;
  }
  if (mode === 'story') {
    const p = Math.round(sim.progress * 100);
    if (hud.p !== p) {
      hud.p = p;
      $('#hudBar').style.width = p + '%';
    }
  } else if (hud.score !== sim.passed) {
    hud.score = sim.passed;
    $('#hudScore').textContent = sim.passed;
  }
  // бонусы
  const key = (sim.shield ? 's' : '') + (sim.magnet > 0 ? 'm' : '') + (sim.catnip > 0 ? 'c' : '');
  const box = $('#hudPowers');
  if (hud.pk !== key) {
    hud.pk = key;
    box.innerHTML = '';
    if (sim.shield) box.insertAdjacentHTML('beforeend', `<span class="power" style="--c:${POWERUPS.shield.color}">Пузырь<i style="width:100%"></i></span>`);
    if (sim.magnet > 0) box.insertAdjacentHTML('beforeend', `<span class="power" data-k="magnet" style="--c:${POWERUPS.magnet.color}">Магнит<i></i></span>`);
    if (sim.catnip > 0) box.insertAdjacentHTML('beforeend', `<span class="power" data-k="catnip" style="--c:${POWERUPS.catnip.color}">Мята<i></i></span>`);
  }
  for (const k of ['magnet', 'catnip']) {
    if (sim[k] > 0) {
      const el = $(`.power[data-k="${k}"] i`, box);
      if (el) el.style.width = Math.round((sim[k] / POWERUPS[k].time) * 100) + '%';
    }
  }
}

function toast(text) {
  const t = $('#toast');
  t.hidden = true;
  void t.offsetWidth;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1900);
}

/* ---------- события симуляции ---------- */

function onEvent(ev) {
  switch (ev.type) {
    case 'start':
      $('#hint').hidden = true;
      miaSay('start');
      break;
    case 'flap':
      sound.play('flap');
      break;
    case 'heart':
      sound.play('heart');
      if (ev.combo === 5) miaSay('combo');
      break;
    case 'fish':
      sound.play('fish');
      miaSay('firstFish');
      break;
    case 'pop':
      sound.play('pop');
      break;
    case 'power':
      sound.play('power');
      miaSay(ev.kind === 'shield' ? 'firstBubble' : ev.kind);
      break;
    case 'powerEnd':
      sound.play('powerEnd');
      break;
    case 'shieldBreak':
      sound.play('shield');
      buzz(30);
      break;
    case 'gate':
      sound.play('gate');
      break;
    case 'nearMiss':
      sound.play('nearMiss');
      break;
    case 'lastGate':
      sound.play('lastGate');
      miaSay('lastGate');
      break;
    case 'moment':
      sound.play('moment');
      if (ev.kind === 'fireworks') sound.play('firework');
      toast(CONFIG.momentLines?.[ev.kind] || '');
      break;
    case 'warn':
      sound.play('warn');
      break;
    case 'wind':
      sound.play('wind');
      break;
    case 'hit':
      sound.play('hit');
      hitStop = renderer.reduceMotion ? 0 : 0.09; // короткая пауза — удар ощущается весом
      miaSay('hit');
      buzz(ev.lives > 0 ? 60 : [80, 40, 120]);
      break;
    case 'theme':
      sound.setTheme(ev.theme);
      toast(ev.theme === 'love' ? `Дорога к ${CONFIG.her.dative}` : THEMES[ev.theme].name);
      break;
    case 'win':
      sound.play('win');
      if (mode === 'story' && levelId === FINAL) {
        pendingTimer = setTimeout(() => finishFinalLevel(), 900);
      } else {
        pendingTimer = setTimeout(showWin, 1500);
      }
      break;
    case 'lose':
      sound.play('lose');
      pendingTimer = setTimeout(mode === 'endless' ? showOver : showLose, 350);
      break;
  }
}

function buzz(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      /* не страшно */
    }
  }
}

/* ---------- итоги ---------- */

function showWin() {
  const stars = sim.stars();
  const l = LEVELS[levelId - 1];
  const bonus = stars * 5;
  const earned = sim.hearts + bonus;
  save.completeLevel(levelId, stars, sim.pathHearts);
  bankHearts();
  save.addHearts(bonus);

  $('#winEyebrow').textContent = `Уровень ${levelId} · ${levelName(l)}`;
  const icons = $$('#winStars .icon');
  icons.forEach((el) => el.classList.remove('on'));
  // порядок появления: левая, правая, центральная
  [0, 2, 1].slice(0, stars).forEach((idx, i) => {
    setTimeout(() => {
      if (screen !== 'win') return;
      icons[idx].classList.add('on');
      sound.play('star');
    }, 250 + i * 320);
  });
  const ratio = sim.heartsTotal ? Math.round((sim.pathHearts / sim.heartsTotal) * 100) : 100;
  const goals = [
    [true, 'Долетела до финиша'],
    [ratio >= 70, `Собрала ${ratio}% сердечек (нужно 70%)`],
    [sim.lostLives === 0, sim.lostLives === 0 ? 'Не потеряла ни одной жизни' : `Потеряно жизней: ${sim.lostLives}`],
  ];
  $('#winGoals').innerHTML = goals.map(([ok, text]) => `<li class="${ok ? 'done' : ''}"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>${text}</li>`).join('');
  $('#winHearts').textContent = `+${earned}`;
  $('#winStars').setAttribute('aria-label', `Звёзд: ${stars} из 3`);

  // Первое прохождение ведёт к записке. Если она уже прочитана — можно сразу лететь дальше.
  const isFinal = levelId === LEVELS.length;
  const hasNote = isFinal ? !!CONFIG.finalLetter : CONFIG.notes.some((n) => n.level === levelId);
  const seen = save.data.seenNotes.includes(levelId);
  const btnNote = $('#btnNote');
  const btnNext = $('#btnWinNext');
  btnNote.hidden = !hasNote;
  btnNote.className = seen ? 'btn btn--ghost btn--small' : 'btn';
  $('#btnNoteLabel').textContent = seen ? (isFinal ? 'Перечитать письмо' : 'Перечитать записку') : isFinal ? 'Открыть письмо' : 'Открыть записку';
  btnNext.hidden = hasNote && !seen;
  btnNext.textContent = isFinal ? 'В меню' : `Дальше · уровень ${levelId + 1}`;
  $('#btnWinRetry').hidden = stars >= 3;
  // открытка — чтобы отправить результат в мессенджер
  $('#btnWinCard').hidden = false;
  preparePostcard(stars, earned);
  go('win');
}

function showNote() {
  const isFinal = levelId === LEVELS.length;
  const note = isFinal ? CONFIG.finalLetter : CONFIG.notes.find((n) => n.level === levelId);
  if (!note) return nextAfterWin();
  if (isFinal) return showLetter();
  $('#noteNo').textContent = `Записка № ${levelId} из ${LEVELS.length - 1}`;
  $('#noteTitle').textContent = note.title;
  const box = $('#noteText');
  box.innerHTML = '';
  note.text.split(/\n\s*\n/).forEach((par) => {
    const p = document.createElement('p');
    p.textContent = par.trim();
    box.appendChild(p);
  });
  setSignature($('#noteSign'), `— ${note.from || CONFIG.cat.name}`);
  $('#btnNoteNext').textContent = `Дальше · уровень ${levelId + 1}`;
  save.markNoteSeen(levelId);
  sound.play('paper');
  afterNote = nextAfterWin;
  go('note');
  $('#letter').scrollIntoView({ block: 'start' });
}

function nextAfterWin() {
  if (levelId < LEVELS.length) startLevel(levelId + 1);
  else go('menu');
}

function showLose() {
  const l = LEVELS[levelId - 1];
  bankHearts();
  $('#loseEyebrow').textContent = `Уровень ${levelId} · ${levelName(l)}`;
  $('#loseText').textContent = LOSE_LINES[Math.floor(Math.random() * LOSE_LINES.length)];
  const p = Math.round(sim.progress * 100);
  $('#loseBar').style.width = '0%';
  $('#loseProgress').textContent = `Пройдено ${p}%`;
  $('#loseHearts').textContent = `+${sim.hearts}`;
  go('lose');
  requestAnimationFrame(() => ($('#loseBar').style.width = p + '%'));
}

function showOver() {
  const d = save.data;
  const isNew = sim.passed > d.best;
  if (isNew) save.set({ best: sim.passed });
  bankHearts();
  $('#overScore').textContent = sim.passed;
  $('#overBest').textContent = save.data.best;
  $('#overNew').hidden = !isNew || sim.passed === 0;
  $('#overHearts').textContent = `+${sim.hearts}`;
  go('over');
}

/* ---------- финал: сцена, письмо, воспоминания, титры ---------- */

/** Шестой уровень пройден: вместо экрана победы — маленькое кино. */
function finishFinalLevel() {
  if (screen !== 'play') return;
  const stars = sim.stars();
  const bonus = stars * 5;
  const earned = sim.hearts + bonus;
  save.completeLevel(FINAL, stars, sim.pathHearts);
  bankHearts();
  save.addHearts(bonus);
  startFinale({ stars, hearts: sim.hearts, earned, bestCombo: sim.bestCombo, nearMisses: sim.nearMisses });
}

function startFinale(result) {
  finaleResult = result;
  finale = new Finale(renderer.ctx, renderer, {
    herName: CONFIG.her.name,
    catName: CONFIG.cat.name,
    title: (CONFIG.finalLetter && CONFIG.finalLetter.title) || 'Для тебя',
  });
  renderer.particles.length = 0;
  renderer.trail.length = 0;
  renderer.momentFx = null;
  renderer.shake = 0;
  renderer.flash = 0;
  sound.setMode('finale');
  sound.setProgress(1);
  sound.play('finale');
  $('#finaleSkip').hidden = renderer.reduceMotion;
  go('finale');
}

/** Письмо появляется постепенно и читается спокойно: ни одного эффекта поверх текста. */
function showLetter() {
  const letter = CONFIG.finalLetter;
  if (!letter) return go('credits');
  $('#letterTitle2').textContent = letter.title;
  const box = $('#letterText');
  box.innerHTML = '';
  const pars = letter.text.split(/\n\s*\n/);
  pars.forEach((par, i) => {
    const p = document.createElement('p');
    p.textContent = par.trim();
    p.style.setProperty('--i', String(i));
    box.appendChild(p);
  });
  // кнопка появляется только после того, как текст дописан
  const delay = renderer.reduceMotion ? 0 : 500 + pars.length * 900;
  const actions = $('#letterActions');
  actions.hidden = true;
  clearTimeout(showLetter.timer);
  showLetter.timer = setTimeout(() => {
    if (screen === 'letter') actions.hidden = false;
  }, delay);
  setSignature($('#letterSign2'), CONFIG.from);
  save.markNoteSeen(FINAL);
  sound.play('letter');
  go('letter');
  $('#letterCard').scrollTop = 0;
}

function showCredits() {
  const r = finaleResult || {};
  const list = $('#creditsList');
  list.innerHTML = '';
  const lines = (CONFIG.credits || []).concat([`Для ${CONFIG.her.name} — с любовью`]);
  lines.forEach((line, i) => {
    const li = document.createElement('li');
    li.textContent = line;
    li.style.setProperty('--i', String(i));
    list.appendChild(li);
  });
  $('#creditsStars').textContent = r.stars ? `★`.repeat(r.stars) : '';
  $('#creditsReward').textContent = r.earned ? `В кошельке стало на ${r.earned} сердечек больше` : '';
  $('#btnPostcard').hidden = false;
  preparePostcard(r.stars || 0, r.earned || 0);
  go('credits');
}

/** Собирает картинку-открытку на холсте: без сервера, её можно отправить в мессенджер. */
function preparePostcard(stars, earned) {
  const link = $('#postcardLink');
  const btn = $('#btnPostcard');
  link.hidden = true;
  btn.disabled = false;
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1350);
  g.addColorStop(0, '#5D4E9E');
  g.addColorStop(0.45, '#EE86A2');
  g.addColorStop(1, '#FFE3B8');
  x.fillStyle = g;
  x.fillRect(0, 0, 1080, 1350);
  // сердечки-фон
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(255,255,255,${0.08 + (i % 5) * 0.05})`;
    heartAt(x, (i * 271) % 1080, (i * 197) % 1350, 12 + (i % 7) * 6);
  }
  // Мия
  if (renderer.sticker) {
    const st = renderer.sticker;
    const w = 520;
    const h = w * st.ratio;
    x.drawImage(st.canvas, 540 - w / 2, 430 - h / 2, w, h);
  }
  // звёзды
  x.textAlign = 'center';
  x.fillStyle = '#FFE08A';
  x.font = '900 96px Nunito, sans-serif';
  x.fillText('★'.repeat(Math.max(1, stars || 0)), 540, 830);
  // подписи
  x.fillStyle = '#FFFFFF';
  x.font = '400 88px Pacifico, Nunito, cursive';
  x.fillText('Flappy Kitty', 540, 990);
  x.font = '800 54px Nunito, sans-serif';
  const l = LEVELS[levelId - 1];
  x.fillText(l ? `Уровень ${levelId} · ${levelName(l)}` : 'Мия долетела', 540, 1080);
  x.font = '400 56px Caveat, Nunito, cursive';
  x.fillText(`Для ${CONFIG.her.name} · ${new Date().toLocaleDateString('ru-RU')}`, 540, 1180);
  if (earned) {
    x.font = '800 44px Nunito, sans-serif';
    x.fillText(`Сердечек: ${earned}`, 540, 1260);
  }
  const url = c.toDataURL('image/png');
  link.href = url;
  link.download = `flappy-kitty-${levelId}.png`;
  // картинку создаём здесь, а не в разметке: адрес появляется только после сборки
  link.textContent = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Открытка: Мия, звёзды и дата';
  link.appendChild(img);
  link.hidden = true;
  btn.disabled = false;
}

function heartAt(x, cx, cy, s) {
  x.beginPath();
  x.moveTo(cx, cy + s * 0.9);
  x.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.75, cy - s * 1.15, cx, cy - s * 0.4);
  x.bezierCurveTo(cx + s * 0.75, cy - s * 1.15, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
  x.closePath();
  x.fill();
}

/* ---------- пауза ---------- */

function pause() {
  if (screen !== 'play' || !sim || sim.status === 'won' || sim.status === 'lost' || sim.status === 'dying') return;
  syncToggles();
  go('pause');
}
function resume() {
  if (screen !== 'pause') return;
  sound.unlock();
  go('play');
  $('#hint').hidden = sim.status !== 'ready';
  last = performance.now();
}
function syncToggles() {
  const d = save.data;
  $('#tglSound').setAttribute('aria-pressed', String(d.sound));
  $('#tglMusic').setAttribute('aria-pressed', String(d.music));
  // кнопка в меню выключает и включает всё сразу
  const anyOn = d.sound || d.music;
  const mute = $('#btnMute');
  mute.setAttribute('aria-pressed', String(!anyOn));
  mute.setAttribute('aria-label', anyOn ? 'Выключить звук' : 'Включить звук');
  $('use', mute).setAttribute('href', anyOn ? '#i-sound' : '#i-mute');
}

/* ---------- ввод ---------- */

function flap() {
  if (screen !== 'play' || !sim) return;
  sound.unlock();
  sim.flap();
}

/** Тап по Мии в меню: она отзывается. */
function petMia(cssX, cssY) {
  if (!sim || !sim.attract) return false;
  const p = renderer.toWorld(cssX, cssY);
  const dx = p.x - sim.miaX;
  const dy = p.y - sim.mia.y;
  if (dx * dx + dy * dy > 110 * 110) return false;
  sim.mia.vy = -260;
  sim.pulsePet = 1;
  renderer.pulse = 0.8;
  renderer.burst(sim.miaX, sim.mia.y, 8, ['#FF5C7A', '#FFB3C6', '#FFFFFF'], 170, 'heart');
  sound.play(Math.random() < 0.4 ? 'purr' : 'meow');
  const lines = (CONFIG.miaLines && CONFIG.miaLines.idle) || [];
  if (lines.length) renderer.say(lines[Math.floor(Math.random() * lines.length)], 1.6);
  return true;
}

function bind() {
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  // iOS прячет и показывает адресную строку — холст должен за этим успевать
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resize, 60));

  stage.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (e.target.closest('button, a')) return;
    const rect = canvas.getBoundingClientRect();
    if (screen === 'menu') {
      petMia(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    if (screen === 'finale') {
      // тап ускоряет сцену, но не обрывает её на середине кадра
      if (finale) finale.t = Math.max(finale.t, finale.dur[finale.stage] - 0.35);
      return;
    }
    if (screen === 'intro') {
      // от открытия ссылки до первого взмаха — одно касание
      sound.play('click');
      beginPlay();
      return;
    }
    if (screen !== 'play') return;
    e.preventDefault();
    flap();
  });
  // не даём странице прокручиваться и масштабироваться во время игры
  stage.addEventListener('touchmove', (e) => { if (screen === 'play' || screen === 'finale') e.preventDefault(); }, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  // iOS: щипок двумя пальцами не должен увеличивать игру
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  // Браузеры включают звук только из «настоящего» жеста (отпускание пальца, клик, клавиша).
  // После сворачивания вкладки звук засыпает — будим его при первом же касании.
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const flapKey = e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
    if (screen === 'play') {
      if (flapKey) {
        e.preventDefault();
        flap();
      } else if (e.code === 'Escape' || e.code === 'KeyP') pause();
    } else if (screen === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) resume();
    else if (screen === 'intro' && flapKey && !e.target.closest('button, a')) {
      e.preventDefault();
      sound.play('click');
      beginPlay();
    }
  });

  // вкладку закрыли посреди полёта — собранные сердечки всё равно остаются
  window.addEventListener('pagehide', bankHearts);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (screen === 'play') pause();
      bankHearts();
      sound.stopMusic();
      sound.sleep();
    } else {
      sound.wake();
      if (musicStarted && screen !== 'pause' && !CALM_SCREENS.has(screen)) sound.startMusic();
      last = performance.now();
    }
  });

  $$('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      sound.play('click');
      go(b.dataset.go);
    })
  );
  $('#btnPlay').addEventListener('click', () => {
    sound.unlock();
    sound.play('click');
    const allDone = LEVELS.every((l) => save.data.levels[l.id] && save.data.levels[l.id].done);
    if (allDone) go('levels');
    else {
      startLevel(save.nextLevel(LEVELS.length));
      beginPlay();
      flap();
    }
  });
  $('#btnLevels').addEventListener('click', () => { sound.unlock(); sound.play('click'); go('levels'); });
  $('#btnWardrobe').addEventListener('click', () => { sound.unlock(); sound.play('click'); go('wardrobe'); });
  $('#btnMemories').addEventListener('click', () => { sound.unlock(); sound.play('click'); renderMemories(true); go('memories'); });
  $('#btnEndless').addEventListener('click', () => {
    sound.unlock();
    if ($('#btnEndless').getAttribute('aria-disabled') === 'true') {
      sound.play('nope');
      return toast('Сначала уровень 1');
    }
    sound.play('click');
    startEndless();
  });
  $('#btnGo').addEventListener('click', () => { sound.unlock(); sound.play('click'); beginPlay(); });
  $('#btnPause').addEventListener('click', pause);
  $('#btnResume').addEventListener('click', () => { sound.play('click'); resume(); });
  $('#btnRestart').addEventListener('click', () => { sound.play('click'); restart(); });
  $('#btnRetry').addEventListener('click', () => { sound.play('click'); restart(); });
  $('#btnWinRetry').addEventListener('click', () => { sound.play('click'); restart(); });
  $('#btnAgain').addEventListener('click', () => { sound.play('click'); restart(); });
  $('#btnNote').addEventListener('click', showNote);
  $('#btnWinNext').addEventListener('click', () => { sound.play('click'); nextAfterWin(); });
  $('#btnWinCard').addEventListener('click', () => {
    sound.play('click');
    const link = $('#postcardLink');
    if (!link.href) return;
    link.hidden = false;
    $('#postcardHint').hidden = false;
  });
  $('#btnPostcard').addEventListener('click', () => {
    sound.play('click');
    const link = $('#postcardLink');
    if (!link.href) return;
    link.hidden = false;
    $('#postcardHint').hidden = false;
  });
  $('#btnMute').addEventListener('click', () => {
    const on = !(save.data.sound || save.data.music);
    save.set({ sound: on, music: on });
    sound.setSound(on);
    sound.setMusic(on);
    if (on && musicStarted) sound.startMusic();
    syncToggles();
    sound.play('click');
  });
  $('#btnNoteNext').addEventListener('click', () => { sound.play('click'); (afterNote || nextAfterWin)(); });
  $('#btnLetterNext').addEventListener('click', () => { sound.play('click'); sound.play('memory'); renderMemories(true); go('memories'); });
  $('#btnMemoriesNext').addEventListener('click', () => { sound.play('click'); showCredits(); });
  $('#btnMemoriesMenu').addEventListener('click', () => { sound.play('click'); go('menu'); });
  $('#btnCreditsLetter').addEventListener('click', () => { sound.play('click'); showLetter(); });
  $('#btnCreditsMenu').addEventListener('click', () => { sound.play('click'); go('menu'); });
  $('#tglSound').addEventListener('click', () => {
    const on = !save.data.sound;
    save.set({ sound: on });
    sound.setSound(on);
    syncToggles();
    sound.play('click');
  });
  $('#tglMusic').addEventListener('click', () => {
    const on = !save.data.music;
    save.set({ music: on });
    sound.setMusic(on);
    syncToggles();
    sound.play('click');
  });
}

function resize() {
  const w = renderer.resize();
  // куда летят собранные сердечки: центр счётчика в углу экрана
  const chip = $('.hud__hearts');
  if (chip && chip.getBoundingClientRect) {
    const r = chip.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    if (r.width) renderer.hudTarget = renderer.toWorld(r.left - c.left + r.width / 2, r.top - c.top + r.height / 2);
  }
  if (!sim) return;
  if (sim.attract) {
    sim.viewW = w;
    sim.miaX = w / 2;
  } else if (sim.status === 'ready') {
    // до старта можно безболезненно пересоздать уровень под новый размер
    const keep = { mode: sim.mode, levelId: sim.level ? sim.level.id : 1 };
    sim = new Sim({ ...keep, viewW: w, seed: Date.now() % 1e9 });
  } else sim.viewW = w;
}

/* ---------- цикл ---------- */

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (frozen) return;
  if (dt > 0.1) dt = 0.1; // вкладка была в фоне — не «прыгаем»

  // на «спокойных» экранах холст не трогаем: там фон из CSS и ничего не движется
  if (CALM_SCREENS.has(screen)) return;

  if (screen === 'finale') {
    if (finale) {
      if (finale.done) showLetter();
      else finale.draw(Math.min(dt, 0.05));
    }
    return;
  }

  if (!sim) return;

  const running = screen !== 'pause';
  if (running) {
    // короткая пауза на ударе: мир замирает на долю секунды
    if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);
    else {
      acc += dt;
      while (acc >= STEP) {
        sim.step(STEP);
        acc -= STEP;
        if (sim.events.length) {
          for (const ev of sim.events) {
            renderer.handle(ev, sim);
            onEvent(ev);
          }
          sim.events.length = 0;
        }
      }
    }
    if (screen === 'play') {
      updateHud();
      sound.setProgress(sim.progress);
      if (mode === 'story') renderer.warm = Math.max(renderer.warm, Math.max(0, (sim.progress - 0.9) / 0.1) * 0.5);
    }
    // Мия в меню живёт своей жизнью: покачивается и время от времени взмахивает
    if (sim.attract) {
      sim.attractT = (sim.attractT || 0) + dt;
      const a = sim.attractT;
      sim.mia.y = sim.hoverY + Math.sin(a * 1.4) * 34 + Math.sin(a * 3.7) * 8;
      if (sim.pulsePet) sim.pulsePet = Math.max(0, sim.pulsePet - dt * 2);
      if (Math.sin(a * 1.4) > 0.985 && renderer.wingT > 0.6) renderer.wingT = 0;
    }
  }
  renderer.draw(sim, running ? dt : 0);
}

// крючки для отладки и автотестов
window.__fk = {
  get sim() { return sim; },
  get screen() { return screen; },
  go, startLevel, startEndless, beginPlay, showWin, showNote, showLetter, showCredits, startFinale, save, renderer, sound,
  freeze(v = true) { frozen = v; },
};

boot().catch((e) => {
  console.error(e);
  const p = $('.loading');
  if (p) p.textContent = 'Не получилось загрузить игру. Обнови страницу.';
});
