/* Среда для запуска игры вне браузера.
   В песочнице нет системного Chromium (не хватает libnspr4), поэтому игра
   запускается в jsdom, а холст рисует настоящий растровый canvas
   (@napi-rs/canvas). Это не эмуляция браузера: раскладка CSS и Web Audio
   здесь не проверяются. Зато честно выполняются main.js, sim.js, render.js,
   themes.js, finale.js и audio.js — теми же путями, что и в браузере.

   Использование: const env = await makeEnv({ url: '.../play.html?dev=1' }) */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createCanvas, Image as NImage, GlobalFonts } from '@napi-rs/canvas';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  for (const [family, file] of [
    ['Nunito', 'assets/fonts/nunito-cyrillic-wght-normal.woff2'],
    ['Caveat', 'assets/fonts/caveat-cyrillic-wght-normal.woff2'],
    ['Pacifico', 'assets/fonts/pacifico-cyrillic-400-normal.woff2'],
  ]) {
    const p = path.join(ROOT, file);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, family);
  }
  fontsReady = true;
}

/** Класс, заменяющий браузерный Image: читает файл с диска.
    Наследуется от настоящего Image из @napi-rs/canvas, чтобы drawImage его принимал. */
function makeImageClass() {
  return class Image extends NImage {
    constructor() {
      super();
      this._src = '';
      this.onload = null;
      this.onerror = null;
    }
    set src(v) {
      this._src = String(v);
      const file = path.isAbsolute(this._src) ? this._src : path.join(ROOT, this._src.replace(/^\.\//, ''));
      fs.promises
        .readFile(file)
        .then((buf) => {
          super_src.call(this, buf);
          if (this.onload) this.onload();
        })
        .catch(() => {
          if (this.onerror) this.onerror(new Error('нет файла ' + v));
        });
    }
    get src() {
      return this._src;
    }
    get naturalWidth() {
      return this.width;
    }
    get naturalHeight() {
      return this.height;
    }
  };
}

const super_src = Object.getOwnPropertyDescriptor(NImage.prototype, 'src').set;

/** Заглушка Web Audio: ничего не звучит, но весь код звуков честно выполняется. */
function makeAudioStub() {
  const calls = [];
  const param = (v = 0) => ({
    value: v,
    setValueAtTime(x) { calls.push(['setValueAtTime', x]); return this; },
    linearRampToValueAtTime(x) { calls.push(['lin', x]); return this; },
    exponentialRampToValueAtTime(x) { calls.push(['exp', x]); return this; },
  });
  const node = (extra = {}) => ({
    connect(x) { return x; },
    disconnect() {},
    start() { calls.push(['start']); },
    stop() { calls.push(['stop']); },
    ...extra,
  });
  class AudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 44100;
      this.destination = node();
      this._t = 0;
    }
    get currentTime() {
      return this._t;
    }
    advance(dt) {
      this._t += dt;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
    createGain() {
      return node({ gain: param(1) });
    }
    createOscillator() {
      return node({ type: 'sine', frequency: param(440) });
    }
    createBiquadFilter() {
      return node({ type: 'lowpass', frequency: param(1000), Q: param(1) });
    }
    createBuffer(ch, len) {
      const data = new Float32Array(len);
      return { getChannelData: () => data, length: len };
    }
    createBufferSource() {
      return node({ buffer: null });
    }
  }
  return { AudioContext, calls };
}

export async function makeEnv({
  url = 'http://test.local/play.html',
  width = 390,
  height = 844,
  dpr = 2,
  reduceMotion = false,
  storage = null,
} = {}) {
  registerFonts();
  const html = fs.readFileSync(path.join(ROOT, 'play.html'), 'utf8');
  const dom = new JSDOM(html, { url, pretendToBeVisual: false, runScripts: 'outside-only' });
  const window = dom.window;

  /* ----- холст: настоящий растровый canvas вместо заглушки jsdom ----- */
  const backing = new WeakMap();
  const back = (el) => {
    if (!backing.has(el)) backing.set(el, createCanvas(el.getAttribute('width') ? +el.getAttribute('width') : 300, el.getAttribute('height') ? +el.getAttribute('height') : 150));
    return backing.get(el);
  };
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'width', {
    get() { return back(this).width; },
    set(v) { back(this).width = v | 0; },
    configurable: true,
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'height', {
    get() { return back(this).height; },
    set(v) { back(this).height = v | 0; },
    configurable: true,
  });
  window.HTMLCanvasElement.prototype.getContext = function (type) {
    return back(this).getContext(type || '2d');
  };
  // drawImage должен принимать и наш <canvas> из jsdom — разворачиваем его в растровый
  const ctxProto = Object.getPrototypeOf(createCanvas(2, 2).getContext('2d'));
  if (!ctxProto.__fkPatched) {
    const origDraw = ctxProto.drawImage;
    ctxProto.drawImage = function (img, ...rest) {
      if (img && backing.has(img)) img = backing.get(img);
      return origDraw.call(this, img, ...rest);
    };
    ctxProto.__fkPatched = true;
  }
  window.HTMLCanvasElement.prototype.toDataURL = function (type) {
    return back(this).toDataURL(type || 'image/png');
  };
  window.HTMLCanvasElement.prototype.toBuffer = function (type) {
    return back(this).toBuffer(type || 'image/png');
  };

  /* ----- раскладка: jsdom ничего не измеряет, подставляем размер окна ----- */
  const rectFor = (el) => {
    if (el === window.document.documentElement || el === window.document.body || el.id === 'stage' || el.id === 'game') {
      return { left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 };
    }
    // элементы интерфейса «висят» в углу экрана, как в CSS
    if (el.classList && el.classList.contains('hud__hearts')) return { left: width - 130, top: 14, width: 116, height: 34, right: width - 14, bottom: 48, x: width - 130, y: 14 };
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
  window.Element.prototype.getBoundingClientRect = function () {
    return rectFor(this);
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return rectFor(this).width; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return rectFor(this).height; }, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return rectFor(this).width; }, configurable: true });
  window.Element.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.focus = function () {};

  /* ----- окружение ----- */
  const audio = makeAudioStub();
  window.matchMedia = (q) => ({
    matches: /prefers-reduced-motion:\s*reduce/.test(q) ? reduceMotion : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.Image = makeImageClass();
  window.AudioContext = audio.AudioContext;
  window.devicePixelRatio = dpr;
  window.visualViewport = { width, height, addEventListener() {}, removeEventListener() {} };
  window.navigator.vibrate = () => true;

  /* ----- управляемые часы и кадры ----- */
  let now = 0;
  let rafQueue = [];
  let rafId = 1;
  window.requestAnimationFrame = (cb) => {
    rafQueue.push({ id: rafId, cb });
    return rafId++;
  };
  window.cancelAnimationFrame = (id) => {
    rafQueue = rafQueue.filter((r) => r.id !== id);
  };
  const perf = { now: () => now, timeOrigin: 0 };

  /* ----- переносим нужное в глобальную область Node, чтобы модули его увидели ----- */
  const g = globalThis;
  const prev = {};
  const expose = {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, matchMedia: window.matchMedia,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    performance: perf, Image: window.Image, AudioContext: window.AudioContext,
    HTMLCanvasElement: window.HTMLCanvasElement, HTMLElement: window.HTMLElement, Element: window.Element,
    Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent, PointerEvent: window.PointerEvent || window.MouseEvent,
    getComputedStyle: window.getComputedStyle, devicePixelRatio: dpr, visualViewport: window.visualViewport,
    URLSearchParams: window.URLSearchParams, URL: window.URL,
  };
  for (const [k, v] of Object.entries(expose)) {
    prev[k] = Object.getOwnPropertyDescriptor(g, k);
    Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
  }
  if (storage) for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);

  /* ----- подключаем игру ----- */
  const mod = await import(`../assets/js/game/main.js?t=${Date.now()}`);

  const env = {
    window,
    document: window.document,
    mod,
    audioCalls: audio.calls,
    audioCtx: () => (window.__fk && window.__fk.sound ? window.__fk.sound.ctx : null),
    get now() {
      return now;
    },
    /** Прокрутить время и выполнить накопившиеся кадры. */
    tick(ms = 16.7) {
      now += ms;
      const q = rafQueue;
      rafQueue = [];
      for (const r of q) r.cb(now);
      const ac = audio.ctx || null;
      return q.length;
    },
    /** Прокрутить n кадров по dt миллисекунд. */
    async run(ms, stepMs = 16.7) {
      const n = Math.ceil(ms / stepMs);
      for (let i = 0; i < n; i++) {
        this.tick(stepMs);
        const ac = this.audioCtx();
        if (ac && ac.advance) ac.advance(stepMs / 1000);
        if (i % 25 === 0) await new Promise((r) => setImmediate(r));
      }
    },
    screen() {
      return window.__fk ? window.__fk.screen : null;
    },
    sim() {
      return window.__fk ? window.__fk.sim : null;
    },
    fk() {
      return window.__fk;
    },
    text(sel) {
      const el = window.document.querySelector(sel);
      return el ? el.textContent.trim() : null;
    },
    hidden(sel) {
      const el = window.document.querySelector(sel);
      return el ? el.hidden : null;
    },
    canvas(sel = '#game') {
      return window.document.querySelector(sel);
    },
    /** Сохранить кадр холста в файл. */
    async shot(file, sel = '#game') {
      const c = this.canvas(sel);
      fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, file), c.toBuffer('image/png'));
      return file;
    },
    /** Нажатие по экрану. */
    tap(x = width / 2, y = height / 2) {
      const ev = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
      window.document.getElementById('stage').dispatchEvent(ev);
    },
    click(sel) {
      const el = window.document.querySelector(sel);
      if (!el) throw new Error('нет элемента ' + sel);
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    },
    key(code) {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true }));
    },
    restore() {
      for (const [k, d] of Object.entries(prev)) {
        if (d) Object.defineProperty(g, k, d);
        else delete g[k];
      }
    },
  };

  // ждём, пока boot() закончит грузить картинку облика
  for (let i = 0; i < 200 && !(window.__fk && window.__fk.renderer && window.__fk.renderer.sticker); i++) {
    await new Promise((r) => setImmediate(r));
  }
  return env;
}

