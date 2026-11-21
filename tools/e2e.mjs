/* Сквозная проверка в настоящем браузере: открывает страницы, нажимает кнопки,
   проходит и проигрывает уровни и смотрит, что всё ведёт себя как задумано.

   Нужны две библиотеки, которых нет в репозитории (они тяжёлые):
     npm i --no-save puppeteer-core @sparticuz/chromium
   Запуск:
     npm run test:e2e
   Свой Chrome вместо скачанного:  CHROME_PATH=/путь/к/chrome npm run test:e2e
   Только часть проверок:           npm run test:e2e -- записк

   Сайт поднимается в подпапке /flappykitty.online/ — как на GitHub Pages до подключения
   домена. Заодно проверяется, что все пути в проекте относительные. */

import { createServer } from './serve.mjs';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  console.error('Не найден puppeteer-core. Установи: npm i --no-save puppeteer-core @sparticuz/chromium');
  process.exit(2);
}

let executablePath = process.env.CHROME_PATH;
// Оба настоящих адреса сайта направляем на этот компьютер: так страница 404 проверяется
// ровно в тех условиях, в которых будет работать (подпапка на github.io и корень на домене).
let args = [
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  '--host-resolver-rules=MAP ruusa-shop.github.io 127.0.0.1, MAP flappykitty.online 127.0.0.1',
];
if (!executablePath) {
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    executablePath = await chromium.executablePath();
    args = [...chromium.args, ...args];
  } catch (e) {
    console.error('Не найден браузер. Установи @sparticuz/chromium или укажи CHROME_PATH.');
    process.exit(2);
  }
}

const BASE = '/flappykitty.online/';
const server = createServer({ base: BASE });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const rootServer = createServer({ base: '/' });
await new Promise((r) => rootServer.listen(0, '127.0.0.1', r));
const PAGES_URL = `http://ruusa-shop.github.io:${server.address().port}${BASE}`;
const DOMAIN_URL = `http://flappykitty.online:${rootServer.address().port}/`;
const browser = await puppeteer.launch({ executablePath, args, headless: true });

const only = process.argv[2];
const results = [];
const SAVE_KEY = 'flappykitty.save.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function equal(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`);
}

/** Открывает страницу с чистым (или заданным) сохранением и следит за ошибками. */
async function open(url, { w = 390, h = 844, save = null, touch = false, date = null, dialog = 'accept', allow404 = false, root = ORIGIN + BASE } = {}) {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !(allow404 && /404/.test(m.text()))) problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('ошибка скрипта: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && !(allow404 && r.url() === root + url)) problems.push(`${r.status()} ${r.url()}`);
  });
  page.on('dialog', (d) => (dialog === 'accept' ? d.accept() : d.dismiss()));
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
  await page.evaluateOnNewDocument(
    (key, saved, fixedDate) => {
      if (!sessionStorage.getItem('__e2e')) {
        sessionStorage.setItem('__e2e', '1');
        localStorage.clear();
        if (saved) localStorage.setItem(key, saved);
      }
      if (fixedDate) {
        const Real = Date;
        // eslint-disable-next-line no-global-assign
        Date = class extends Real {
          constructor(...a) {
            super(...(a.length ? a : [fixedDate]));
          }
          static now() {
            return new Real(fixedDate).getTime();
          }
        };
      }
    },
    SAVE_KEY,
    save ? JSON.stringify(save) : null,
    date
  );
  await page.goto(root + url, { waitUntil: 'networkidle0' });
  page.problems = problems;
  return page;
}

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SAVE_KEY);
const screen = (page) => page.evaluate(() => window.__fk.screen);
const waitScreen = (page, name) => page.waitForFunction((n) => window.__fk && window.__fk.screen === n, { timeout: 15000 }, name);
const visible = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s).textContent.trim(), sel);

/** Игра открыта на экране меню. */
async function game(opts = {}, query = '') {
  const page = await open('play.html' + query, opts);
  await waitScreen(page, opts.expect || 'menu');
  return page;
}

/** Проматывает текущий уровень: 'win' — автопилот долетает до финиша, 'lose' — Мия падает. */
function fastForward(page, how, { hits = 0 } = {}) {
  return page.evaluate(
    (how, hits) => {
      const sim = window.__fk.sim;
      const DT = 1 / 120;
      sim.flap();
      let i = 0;
      let hitsLeft = hits;
      while ((sim.status === 'playing' || sim.status === 'dying') && i < 120 * 400) {
        if (how === 'win') {
          if (hitsLeft > 0 && i === 240) {
            sim.inv = 0;
            sim.hit('test');
            hitsLeft--;
          }
          sim.inv = Math.max(sim.inv, 0.5); // автопилот неуязвим: проверяем экраны, а не баланс
          if (i % 15 === 0) {
            const wx = sim.dist + sim.miaX;
            const g = sim.gates.find((x) => x.x + x.w > wx - 20);
            if (sim.mia.y + sim.mia.vy * 0.07 > (g ? g.gapY + 22 : 330)) sim.flap();
          }
        }
        sim.step(DT);
        i++;
      }
      return { status: sim.status, hearts: sim.hearts, pathHearts: sim.pathHearts, stars: sim.stars(), passed: sim.passed, progress: sim.progress };
    },
    how,
    hits
  );
}

async function test(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const pages = [];
  const track = (p) => (pages.push(p), p);
  const t0 = Date.now();
  try {
    await fn(track);
    for (const p of pages) if (p.problems.length) throw new Error('ошибки на странице:\n      ' + p.problems.join('\n      '));
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.error(`✗ ${name}\n    ${e.message}`);
    // В GitHub Actions ошибка дублируется пометкой к проверке: её видно на странице pull request
    // и через API (check-runs/…/annotations), даже когда полный журнал недоступен.
    if (process.env.GITHUB_ACTIONS) {
      const esc = (t) => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.log(`::error title=${esc(name).replace(/[:,]/g, ' ')}::${esc(e.message.slice(0, 1500))}`);
    }
  } finally {
    for (const p of pages) await p.close().catch(() => {});
  }
}

/* ======================= страницы сайта ======================= */

const PAGES = ['index.html', 'mia.html', 'gallery.html', 'love.html', 'worlds.html', 'play.html'];

for (const [w, h, label] of [[360, 740, 'узкий телефон'], [390, 844, 'телефон'], [820, 1180, 'планшет'], [1280, 800, 'компьютер']]) {
  await test(`страницы открываются без ошибок и не вылезают за экран · ${label} ${w}px`, async (track) => {
    for (const url of PAGES) {
      const page = track(await open(url, { w, h, touch: w < 800 }));
      if (url !== 'play.html') {
        await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager')));
        await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 15000 });
      } else await waitScreen(page, 'menu');
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        broken: [...document.images].filter((i) => i.getAttribute('src') && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
        fonts: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
      }));
      assert(info.overflow <= 0, `${url}: страница шире экрана на ${info.overflow}px`);
      equal(info.broken, [], `${url}: не загрузились картинки`);
      equal(info.fonts, [], `${url}: не загрузились шрифты`);
    }
  });
}

await test('шапка: активный раздел отмечен, кошелёк виден только тем, кто уже играл', async (track) => {
  const fresh = track(await open('mia.html'));
  equal(await fresh.evaluate(() => document.querySelector('.nav [aria-current="page"]').getAttribute('href')), 'mia.html', 'активный пункт меню');
  assert(!(await visible(fresh, '[data-wallet-box]')), 'у нового гостя кошелёк должен быть скрыт');
  const played = track(await open('mia.html', { save: { hearts: 57, totalHearts: 80, plays: 3 } }));
  assert(await visible(played, '[data-wallet-box]'), 'кошелёк должен появиться');
  equal(await text(played, '[data-wallet]'), '57', 'число сердечек в шапке');
});

await test('альбом: фото открывается, листается стрелками и закрывается по Esc', async (track) => {
  const page = track(await open('gallery.html', { w: 1280, h: 800 }));
  const total = await page.evaluate(() => document.querySelectorAll('.photo').length);
  assert(total >= 10, 'в альбоме слишком мало фотографий');
  assert((await text(page, '.page-head .lead')).startsWith(String(total)), `в заголовке должно быть ${total} снимков`);
  await page.click('.photo:nth-of-type(1)');
  await page.waitForFunction(() => document.getElementById('lightbox').open);
  equal(await text(page, '#lbCount'), `1 / ${total}`, 'счётчик');
  await page.keyboard.press('ArrowRight');
  equal(await text(page, '#lbCount'), `2 / ${total}`, 'после стрелки вправо');
  await page.click('#lbPrev');
  await page.click('#lbPrev');
  equal(await text(page, '#lbCount'), `${total} / ${total}`, 'листание по кругу назад');
  await page.waitForFunction(() => document.getElementById('lbImg').naturalWidth > 0, { timeout: 15000 });
  assert((await text(page, '#lbCap')).length > 0, 'у фото должна быть подпись');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('lightbox').open);
  assert(await page.evaluate(() => document.activeElement.classList.contains('photo')), 'фокус должен вернуться на миниатюру');
});

await test('записки: закрыты до прохождения, открываются по одной', async (track) => {
  const fresh = track(await open('love.html'));
  equal(await fresh.evaluate(() => document.querySelectorAll('.note--locked').length), 6, 'у нового гостя заперто всё');
  equal(await text(fresh, '#noteCount'), 'Открыто 0 из 6', 'счётчик');
  equal(await fresh.evaluate(() => [...document.querySelectorAll('.note--locked a')].map((a) => a.getAttribute('href'))), ['play.html?level=1'], 'кнопка «Пройти уровень» только у первой');
  assert(!(await fresh.evaluate(() => document.body.textContent.includes('Люблю'))), 'текст письма не должен попадать на страницу раньше времени');

  const some = track(await open('love.html', { save: { notes: [1, 2], levels: { 1: { done: true, stars: 3 }, 2: { done: true, stars: 1 } }, plays: 2 } }));
  equal(await some.evaluate(() => document.querySelectorAll('.note:not(.note--locked)').length), 2, 'открыто две записки');
  equal(await text(some, '#noteCount'), 'Открыто 2 из 6', 'счётчик');
  equal((await stored(some)).seenNotes, [1, 2], 'открытые записки отмечаются прочитанными');

  const all = track(await open('love.html', { save: { notes: [1, 2, 3, 4, 5, 6], plays: 9 } }));
  equal(await all.evaluate(() => document.querySelectorAll('.note--locked').length), 0, 'после шести уровней открыто всё');
  equal(await text(all, '#noteCount'), 'Открыты все 6', 'счётчик');
  assert(await visible(all, '.note--final'), 'письмо показано');

  const peek = track(await open('love.html?peek=1'));
  equal(await peek.evaluate(() => document.querySelectorAll('.note--locked').length), 0, '?peek=1 показывает всё');
  equal(await stored(peek), null, '?peek=1 ничего не записывает в сохранение');
});

await test('несуществующий адрес показывает страницу 404, ссылки с неё ведут на сайт', async (track) => {
  for (const [root, label] of [[PAGES_URL, 'github.io'], [DOMAIN_URL, 'свой домен']]) {
    const page = track(await open('nope/deep/page.html', { allow404: true, root }));
    equal(await text(page, 'h1'), 'Мия сюда не залетала', `${label}: заголовок`);
    const info = await page.evaluate(() => ({
      home: document.querySelector('.lost a').href,
      img: document.querySelector('.lost img').naturalWidth,
      styled: getComputedStyle(document.querySelector('.lost__code')).fontFamily.includes('Pacifico'),
    }));
    equal(info.home, root + 'index.html', `${label}: ссылка «На главную»`);
    assert(info.img > 0, `${label}: картинка на странице 404 не загрузилась`);
    assert(info.styled, `${label}: стили на странице 404 не подключились`);
    equal(page.problems, [], `${label}: ошибки на странице`);
  }
});

/* ======================= игра ======================= */

await test('первый запуск: меню → полёт одним касанием', async (track) => {
  const page = track(await game());
  equal(await text(page, '#btnPlayLabel'), 'Играть', 'надпись на главной кнопке');
  equal(await page.evaluate(() => document.getElementById('btnEndless').getAttribute('aria-disabled')), 'true', 'бесконечный режим закрыт');
  await page.click('#btnPlay');
  await waitScreen(page, 'play');
  assert(await visible(page, '#hud'), 'счётчики видны');
  equal(await page.evaluate(() => document.querySelectorAll('#hudLives .icon').length), 3, 'три жизни');
  equal(await page.evaluate(() => window.__fk.sim.status), 'playing', 'первый взмах после нажатия');
  equal((await stored(page)).plays, 1, 'запуск засчитан');
});

await test('управление: касание, пробел, пауза по Esc и кнопкой', async (track) => {
  const page = track(await game({ touch: true }));
  await page.tap('#btnPlay');
  await waitScreen(page, 'play');
  await page.touchscreen.tap(195, 500);
  await page.waitForFunction(() => window.__fk.sim.status === 'playing');
  const vy = await page.evaluate(() => {
    window.__fk.sim.mia.vy = 300;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    return window.__fk.sim.mia.vy;
  });
  assert(vy < 0, 'пробел должен давать взмах');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'pause');
  const t1 = await page.evaluate(() => window.__fk.sim.t);
  await sleep(400);
  equal(await page.evaluate(() => window.__fk.sim.t), t1, 'на паузе время стоит');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'play');
  await page.tap('#btnPause');
  await waitScreen(page, 'pause');
  await page.tap('#btnRestart');
  await waitScreen(page, 'play');
  equal(await page.evaluate(() => window.__fk.sim.status), 'ready', '«Заново» начинает уровень сначала');
});

await test('сворачивание вкладки ставит игру на паузу', async (track) => {
  const page = track(await game());
  await page.click('#btnPlay');
  await waitScreen(page, 'play');
  await page.mouse.click(195, 500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  equal(await screen(page), 'pause', 'экран после сворачивания');
});

await test('победа: звёзды, сердечки в кошелёк, записка, следующий уровень', async (track) => {
  const page = track(await game());
  await page.click('#btnPlay');
  await waitScreen(page, 'play');
  const run = await fastForward(page, 'win');
  equal(run.status, 'won', 'автопилот должен долететь');
  equal(run.stars, 3, 'без потерь и с сердечками — три звезды');
  assert(run.progress > 0.999, 'на финише полоска должна быть полной');
  await waitScreen(page, 'win');
  const d = await stored(page);
  equal(d.levels[1], { done: true, stars: 3, hearts: run.pathHearts }, 'результат уровня');
  equal(d.hearts, run.hearts + 15, 'в кошельке собранное плюс 5 за каждую звезду');
  equal(d.notes, [1], 'записка открыта');
  equal(await text(page, '#winHearts'), `+${run.hearts + 15}`, 'награда на экране');
  assert(await visible(page, '#btnNote'), 'кнопка записки');
  assert(!(await visible(page, '#btnWinNext')), 'до записки «Дальше» не показываем');
  assert(!(await visible(page, '#btnWinRetry')), 'при трёх звёздах «Ещё раз на три звезды» не нужно');
  await sleep(1300);
  equal(await page.evaluate(() => document.querySelectorAll('#winStars .on').length), 3, 'загорелось звёзд');

  await page.click('#btnNote');
  await waitScreen(page, 'note');
  equal(await text(page, '#noteTitle'), 'Я умею летать', 'заголовок записки');
  assert((await text(page, '#noteText')).length > 40, 'текст записки пустой');
  equal((await stored(page)).seenNotes, [1], 'записка прочитана');
  await page.click('#btnNoteNext');
  await waitScreen(page, 'intro');
  equal(await text(page, '#introName'), 'Кухня', 'после записки — второй уровень');

  // меню после первого уровня
  await page.click('.screen[data-name="intro"] [data-go="menu"]');
  await waitScreen(page, 'menu');
  equal(await text(page, '#btnPlayLabel'), 'Уровень 2', 'главная кнопка ведёт дальше');
  equal(await page.evaluate(() => document.getElementById('btnEndless').getAttribute('aria-disabled')), 'false', 'бесконечный режим открылся');
  equal(await text(page, '.screen[data-name="menu"] [data-wallet]'), String(d.hearts), 'кошелёк в меню');
});

await test('повторная победа: записку можно пропустить; потеря жизни — две звезды', async (track) => {
  const page = track(await game({ save: { levels: { 1: { done: true, stars: 3, hearts: 30 } }, notes: [1], seenNotes: [1], hearts: 10, totalHearts: 10, plays: 1 } }));
  await page.click('#btnLevels');
  await waitScreen(page, 'levels');
  equal(await page.evaluate(() => [...document.querySelectorAll('#levelList .level')].map((b) => b.disabled)), [false, false, true, true, true, true], 'какие уровни открыты');
  equal(await text(page, '#starTotal'), '3/18', 'счётчик звёзд');
  await page.click('#levelList li:nth-child(1) .level');
  await waitScreen(page, 'intro');
  await page.click('#btnGo');
  const run = await fastForward(page, 'win', { hits: 1 });
  equal(run.stars, 2, 'одна потерянная жизнь — две звезды');
  await waitScreen(page, 'win');
  assert(await visible(page, '#btnWinNext'), 'записка уже прочитана — нужна кнопка «Дальше»');
  assert(await visible(page, '#btnWinRetry'), 'не три звезды — предлагаем попробовать ещё раз');
  equal(await text(page, '#btnWinNext'), 'Дальше · уровень 2', 'надпись на кнопке');
  equal((await stored(page)).levels[1].stars, 3, 'лучший результат не затёрся');
  await page.click('#btnWinNext');
  await waitScreen(page, 'intro');
  equal(await text(page, '#introName'), 'Кухня', 'переход на следующий уровень');
});

await test('проигрыш: сердечки остаются, «Ещё раз» запускает уровень заново', async (track) => {
  const page = track(await game({ save: { hearts: 5, totalHearts: 5, plays: 1 } }));
  await page.click('#btnPlay');
  await page.evaluate(() => (window.__fk.sim.hearts = 4));
  const run = await fastForward(page, 'lose');
  equal(run.status, 'lost', 'без взмахов уровень проигран');
  await waitScreen(page, 'lose');
  equal((await stored(page)).hearts, 9, 'собранные сердечки зачислены');
  equal((await stored(page)).levels, {}, 'уровень не засчитан');
  equal(await text(page, '#loseHearts'), '+4', 'награда на экране');
  assert(/^Пройдено \d+%$/.test(await text(page, '#loseProgress')), 'нет строки «Пройдено N%»');
  await page.click('#btnRetry');
  await waitScreen(page, 'play');
  equal(await page.evaluate(() => [window.__fk.sim.status, window.__fk.sim.lives, window.__fk.sim.hearts]), ['ready', 3, 0], 'новая попытка');
});

await test('выход через паузу: собранные сердечки не пропадают и не удваиваются', async (track) => {
  const page = track(await game({ save: { hearts: 5, totalHearts: 5, plays: 1 } }));
  await page.click('#btnPlay');
  await page.evaluate(() => (window.__fk.sim.hearts = 3));
  await page.keyboard.press('Escape');
  await waitScreen(page, 'pause');
  await page.click('.screen[data-name="pause"] [data-go="menu"]');
  await waitScreen(page, 'menu');
  equal((await stored(page)).hearts, 8, '«В меню» из паузы сохраняет собранное');
  equal(await text(page, '.screen[data-name="menu"] [data-wallet]'), '8', 'кошелёк в меню');

  await page.click('#btnPlay');
  await page.evaluate(() => (window.__fk.sim.hearts = 2));
  await page.keyboard.press('Escape');
  await waitScreen(page, 'pause');
  await page.click('#btnRestart');
  await waitScreen(page, 'play');
  equal((await stored(page)).hearts, 10, '«Заново» из паузы сохраняет собранное');
  equal(await page.evaluate(() => window.__fk.sim.hearts), 0, 'новая попытка начинается с нуля');

  // сворачивание вкладки посреди полёта, потом проигрыш: каждое сердечко засчитано один раз
  await page.evaluate(() => (window.__fk.sim.hearts = 1));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  equal((await stored(page)).hearts, 11, 'закрытие вкладки сохраняет собранное');
  await page.evaluate(() => (window.__fk.sim.hearts = 4));
  await fastForward(page, 'lose');
  await waitScreen(page, 'lose');
  equal((await stored(page)).hearts, 14, 'после проигрыша добавлено только новое');
  equal(await text(page, '#loseHearts'), '+4', 'на экране — всё, что собрано за попытку');
});

await test('финал: сцена, письмо, воспоминания и титры', async (track) => {
  const levels = {};
  for (let i = 1; i <= 5; i++) levels[i] = { done: true, stars: 2, hearts: 20 };
  const page = track(await game({ save: { levels, notes: [1, 2, 3, 4, 5], seenNotes: [1, 2, 3, 4, 5], plays: 9 } }));
  await page.click('#btnPlay');
  equal((await fastForward(page, 'win')).status, 'won', 'финальный уровень пройден');
  await waitScreen(page, 'finale');
  await waitScreen(page, 'letter');
  const { CONFIG } = await import('../assets/js/config.js');
  equal(await page.evaluate(() => [...document.querySelectorAll('#letterText p')].map(p => p.textContent).join('\n\n')), CONFIG.finalLetter.text.trim(), 'текст письма');
  await page.waitForFunction(() => !document.getElementById('letterActions').hidden, { timeout: 20000 });
  await page.click('#btnLetterNext');
  await waitScreen(page, 'memories');
  equal(await page.evaluate(() => document.querySelectorAll('#memoryList .polaroid').length), 8, 'фотографии открыты');
  await page.click('#btnMemoriesNext');
  await waitScreen(page, 'credits');
  await page.click('#btnPostcard');
  assert(await visible(page, '#postcardLink'), 'открытка видна');
  await page.click('#postcardClose');
  assert(!(await visible(page, '#postcardLink')), 'открытка закрывается');
  await page.click('#btnCreditsMenu');
  await waitScreen(page, 'menu');
  equal((await stored(page)).notes, [1, 2, 3, 4, 5, 6], 'все записки открыты');
});

await test('бесконечный режим: одна жизнь, счёт, рекорд', async (track) => {
  const page = track(await game({ save: { levels: { 1: { done: true, stars: 1, hearts: 5 } }, notes: [1], best: 3, plays: 2 } }));
  equal(await text(page, '#menuBest'), 'Рекорд: 3', 'рекорд в меню');
  await page.click('#btnEndless');
  await waitScreen(page, 'play');
  assert(!(await visible(page, '#hudLives')), 'в бесконечном режиме счётчик жизней не нужен');
  assert(await visible(page, '#hudScore'), 'счёт должен быть виден');
  assert(await visible(page, '#btnPause'), 'кнопка паузы на месте');
  const paused = await page.evaluate(() => document.getElementById('btnPause').getBoundingClientRect().right);
  assert(paused > 330, 'кнопка паузы должна остаться у правого края');
  const run = await page.evaluate(() => {
    const sim = window.__fk.sim;
    sim.flap();
    let i = 0;
    while (sim.status === 'playing' && i < 120 * 120) {
      sim.inv = sim.passed < 5 ? 0.5 : 0;
      if (i % 15 === 0 && sim.passed < 5) {
        const wx = sim.dist + sim.miaX;
        const g = sim.gates.find((x) => x.x + x.w > wx - 20);
        if (sim.mia.y + sim.mia.vy * 0.07 > (g ? g.gapY + 22 : 330)) sim.flap();
      }
      sim.step(1 / 120);
      i++;
    }
    while (sim.status === 'dying') sim.step(1 / 120);
    return { passed: sim.passed, hearts: sim.hearts, status: sim.status };
  });
  equal(run.status, 'lost', 'после пяти ворот Мия падает');
  assert(run.passed >= 5, 'пройдено ворот');
  await waitScreen(page, 'over');
  equal(await text(page, '#overScore'), String(run.passed), 'счёт на экране');
  assert(await visible(page, '#overNew'), 'должна быть плашка нового рекорда');
  equal((await stored(page)).best, run.passed, 'рекорд сохранён');
  equal((await stored(page)).hearts, run.hearts, 'сердечки зачислены');
});

await test('гардероб: покупка, переодевание, нехватка сердечек', async (track) => {
  const page = track(await game({ save: { hearts: 100, totalHearts: 100, plays: 5 } }));
  await page.click('#btnWardrobe');
  await waitScreen(page, 'wardrobe');
  equal(await page.evaluate(() => document.querySelectorAll('#skinList .skin').length), 6, 'обликов в гардеробе');
  const state = () => page.evaluate(() => [...document.querySelectorAll('#skinList .skin')].map((li) => `${li.querySelector('.btn').textContent.trim()}${li.querySelector('.btn').disabled ? '*' : ''}`));
  equal(await state(), ['Надето*', '40', '80', '120*', '160*', '220*'], 'кнопки при 100 сердечках');
  await page.click('#skinList .skin:nth-child(2) .btn');
  await page.waitForFunction(() => document.querySelector('#skinList .skin:nth-child(2) .btn').textContent.trim() === 'Надето');
  let d = await stored(page);
  equal([d.hearts, d.skin, d.skins], [60, 'hood', ['super', 'hood']], 'после покупки');
  equal(await page.evaluate(() => window.__fk.renderer.skin.id), 'hood', 'облик сразу надет в игре');
  equal(await state(), ['Надеть', 'Надето*', '80*', '120*', '160*', '220*'], 'кнопки после покупки');
  equal(await text(page, '.screen[data-name="wardrobe"] [data-wallet]'), '60', 'кошелёк в гардеробе');
  await page.click('#skinList .skin:nth-child(1) .btn');
  await page.waitForFunction(() => document.querySelector('#skinList .skin:nth-child(1) .btn').textContent.trim() === 'Надето');
  d = await stored(page);
  equal([d.hearts, d.skin], [60, 'super'], 'переодевание бесплатное');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitScreen(page, 'menu');
  equal((await stored(page)).skins, ['super', 'hood'], 'покупка пережила перезагрузку');
});

await test('звук: кнопка в меню выключает всё, настройка запоминается', async (track) => {
  const page = track(await game());
  equal(await page.evaluate(() => document.getElementById('btnMute').getAttribute('aria-pressed')), 'false', 'по умолчанию звук включён');
  await page.click('#btnMute');
  let d = await stored(page);
  equal([d.sound, d.music], [false, false], 'после нажатия');
  equal(await page.evaluate(() => document.getElementById('btnMute').getAttribute('aria-label')), 'Включить звук', 'подпись кнопки');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitScreen(page, 'menu');
  equal(await page.evaluate(() => document.getElementById('btnMute').getAttribute('aria-pressed')), 'true', 'после перезагрузки звук всё ещё выключен');
  await page.click('#btnPlay');
  await page.mouse.click(195, 500);
  await page.keyboard.press('KeyP');
  await waitScreen(page, 'pause');
  equal(await page.evaluate(() => [document.getElementById('tglSound').getAttribute('aria-pressed'), document.getElementById('tglMusic').getAttribute('aria-pressed')]), ['false', 'false'], 'переключатели на паузе');
  await page.click('#tglMusic');
  d = await stored(page);
  equal([d.sound, d.music], [false, true], 'музыку можно включить отдельно');
});

await test('адреса: ?level=N, ?dev=1, ?reset=1', async (track) => {
  const locked = track(await game({}, '?level=4'));
  equal(await screen(locked), 'menu', 'закрытый уровень по ссылке не открывается');

  const open2 = track(await game({ save: { levels: { 1: { done: true, stars: 1, hearts: 3 } }, notes: [1], plays: 1 }, expect: 'intro' }, '?level=2'));
  equal(await text(open2, '#introName'), 'Кухня', 'открытый уровень по ссылке');

  const dev = track(await game({ expect: 'intro' }, '?dev=1&level=5'));
  equal(await text(dev, '#introName'), 'Зимняя сказка', '?dev=1 открывает любой уровень');

  const reset = track(await game({ save: { hearts: 77, totalHearts: 77, levels: { 1: { done: true, stars: 3, hearts: 9 } }, notes: [1], plays: 4 } }, '?reset=1'));
  const d = await stored(reset);
  equal([d.hearts, d.levels, d.notes], [0, {}, []], 'после сброса');
  assert(!(await reset.evaluate(() => location.search.includes('reset'))), '?reset=1 должен исчезнуть из адреса, чтобы не сработать повторно');

  const keep = track(await game({ dialog: 'dismiss', save: { hearts: 77, totalHearts: 77, plays: 4 } }, '?reset=1'));
  equal((await stored(keep)).hearts, 77, 'отказ в диалоге ничего не стирает');
});

await test('день рождения: в нужный день меню поздравляет', async (track) => {
  const { month, day, enabled, sweet } = await (async () => {
    const { CONFIG } = await import('../assets/js/config.js');
    return { ...CONFIG.birthday, sweet: CONFIG.her.sweet };
  })();
  if (!enabled) return;
  const iso = `2027-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`;
  const page = track(await game({ date: iso }));
  assert(await visible(page, '#bday'), 'поздравление должно быть видно');
  assert((await text(page, '#bday')).includes(sweet), 'в поздравлении должно быть имя');
});

await test('игра помещается на маленьком и на лежачем экране', async (track) => {
  for (const [w, h] of [[320, 568], [844, 390], [667, 375]]) {
    const page = track(await game({ w, h, touch: true, save: { levels: { 1: { done: true, stars: 2, hearts: 9 } }, notes: [1], best: 12, plays: 3 } }));
    const off = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.screen[data-name="menu"] .btn, .screen[data-name="menu"] .iconbtn, .logo')) {
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) out.push(`${el.id || el.className} ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      return out;
    });
    equal(off, [], `меню ${w}×${h}: элементы за краем экрана`);
    await page.tap('#btnPlay');
    await waitScreen(page, 'play');
    assert(await visible(page, '#btnPause'), `полёт ${w}×${h}: кнопка паузы не видна`);
  }
});

/* ======================= итог ======================= */

await browser.close();
server.close();
rootServer.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n✗ Сквозная проверка: не прошло ${bad.length} из ${results.length}.` : `\n✓ Сквозная проверка: ${results.length} из ${results.length}.`);
process.exit(bad.length ? 1 : 0);
