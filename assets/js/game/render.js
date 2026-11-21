/* Flappy Kitty · отрисовка. Читает состояние Sim и рисует кадр.
   Здесь же — вся «сочность»: сжатие и растяжение Мии, камера, след,
   искры при пролёте вплотную, сердечки, улетающие в счётчик, облачко
   с репликой и короткие сцены-«моменты» в конце каждого уровня. */

import { WORLD, POWERUPS } from './levels.js';
import { THEMES, hash, heartPath, rr } from './themes.js';

const G = WORLD.GROUND;
const TAU = Math.PI * 2;
const FONT = 'Nunito, system-ui, sans-serif';
const BALLOON_COLORS = ['#F58CA5', '#F4C97B', '#9CC7E8', '#C9A7E8'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.time = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.wingT = 1;
    this.wingSpeed = 1;
    this.trailT = 0;
    this.trail = [];
    this.viewW = 400;
    this.viewH = 720;
    this.k = 1;
    this.dpr = 1;
    this.scale = 1;
    this.offY = 0;
    this.skin = null;
    this.sticker = null;
    this.finishLabel = '';
    this.hudTarget = null; // куда летят собранные сердечки (в координатах мира)
    this.reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // камера
    this.cam = { zoom: 1, zoomTo: 1, dx: 0, dy: 0, dxTo: 0, dyTo: 0 };

    // Мия: сжатие/растяжение и «отдача» от взмаха и приземления
    this.pulse = 0; // + — вытянулась вверх, − — сплющилась
    this.landPulse = 0;
    this.prevY = 330;
    this.prevVy = 0;

    // облачко с репликой
    this.bubble = { text: '', t: 99, max: 2.4 };

    // короткий «момент» в конце уровня
    this.momentFx = null;
    this.momentText = '';
    this.warm = 0; // насколько мир «потеплел» к финалу (0..1)
  }

  /** Подгоняет холст под размер контейнера. Возвращает ширину мира в условных пикселях. */
  resize() {
    const cssW = this.canvas.clientWidth || 400;
    const cssH = this.canvas.clientHeight || 720;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(cssH / WORLD.H, cssW / 380);
    this.viewW = cssW / scale;
    this.viewH = cssH / scale;
    this.scale = scale;
    this.dpr = dpr;
    this.k = scale * dpr;
    // на высоких экранах мир сдвигается вниз: сверху остаётся место под счётчики
    this.offY = Math.max(0, Math.min(60, (this.viewH - WORLD.H) * 0.55));
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return this.viewW;
  }

  /** Экранная точка (в CSS-пикселях относительно холста) → координаты мира. */
  toWorld(cssX, cssY) {
    return { x: cssX / this.scale, y: cssY / this.scale - this.offY };
  }

  setSkin(skin, img) {
    this.skin = skin;
    this.sticker = makeSticker(img, skin.w);
  }

  /* ---------- реакция на события ---------- */

  /** Мия говорит короткую реплику. */
  say(text, dur = 2.2) {
    if (!text) return;
    this.bubble.text = text;
    this.bubble.t = 0;
    this.bubble.max = dur;
  }

  /** Запускает сцену-«момент» в конце уровня. */
  moment(kind, text) {
    this.momentFx = { kind, t: 0, dur: kind === 'bloom' ? 5 : 4, seeds: Array.from({ length: 24 }, (_, i) => hash(i + kind.length * 13)) };
    this.momentText = text || '';
  }

  handle(ev, sim) {
    const sx = (ev.x != null ? ev.x : sim.dist + sim.miaX) - sim.dist;
    const sy = ev.y != null ? ev.y : sim.mia.y;
    const mx = sim.miaX;
    const my = sim.mia.y;
    switch (ev.type) {
      case 'flap':
        this.wingT = 0;
        this.pulse = Math.max(this.pulse, 0.55);
        this.puff(mx - 26, my + 14, 3, 'rgba(255,255,255,.85)', 70);
        break;
      case 'heart':
        this.burst(sx, sy, 6, ['#FF5C7A', '#FFB3C6', '#FFFFFF'], 160, 'spark');
        this.flyHeart(sx, sy);
        break;
      case 'fish':
        this.burst(sx, sy, 12, ['#FFC94A', '#FFE9A6', '#FFFFFF'], 240, 'spark');
        this.ring(sx, sy, '#FFC94A');
        this.text(sx, sy - 20, '+5', '#FFC94A');
        for (let i = 0; i < 5; i++) this.flyHeart(sx + (i - 2) * 8, sy);
        break;
      case 'pop':
        this.burst(sx, sy, 18, ['#F58CA5', '#F4C97B', '#9CC7E8', '#FFFFFF', '#9CC79A'], 300, 'confetti');
        this.shake = Math.max(this.shake, 4);
        if (ev.hue !== 9) { this.text(sx, sy - 24, '+2', '#FF5C7A'); this.flyHeart(sx, sy); this.flyHeart(sx + 10, sy + 6); }
        break;
      case 'power':
        this.ring(sx, sy, POWERUPS[ev.kind].color);
        this.ring(sx, sy, '#FFFFFF');
        this.burst(sx, sy, 10, [POWERUPS[ev.kind].color, '#FFFFFF'], 190, 'spark');
        this.text(mx, my - 58, POWERUPS[ev.kind].name + '!', POWERUPS[ev.kind].color);
        break;
      case 'shieldBreak':
        this.ring(mx, my, '#8FD3F4');
        this.burst(mx, my, 14, ['#BFE9FF', '#FFFFFF'], 280, 'spark');
        this.text(mx, my - 58, 'Пузырь лопнул', '#8FD3F4');
        this.shake = 8;
        this.zoomPunch(1.05);
        break;
      case 'nearMiss':
        this.burst(sx, sy, 7, ['#FFFFFF', '#FFE9A6'], 170, 'spark');
        this.text(sx, sy + (ev.above ? 26 : -26), 'Вжух!', '#FFFFFF', 18);
        this.zoomPunch(1.025);
        break;
      case 'hit':
        this.shake = 14;
        this.flash = 0.38;
        this.flashColor = '255,92,122';
        this.landPulse = -0.6;
        this.zoomPunch(1.09);
        this.burst(mx, my, 14, ['#E8C08A', '#D9A066', '#FFF3E0'], 280, 'puff');
        this.ring(mx, my, 'rgba(255,92,122,.9)');
        this.text(mx, my - 58, ev.lives > 0 ? 'Ой!' : 'Кусь!', '#FF5C7A');
        break;
      case 'splash':
        this.burst(sx, G - 4, 5, ['#8FD3F4', '#D6F0FF'], 140, 'spark');
        break;
      case 'theme':
        this.flash = 0.6;
        this.flashColor = '255,255,255';
        break;
      case 'moment':
        this.moment(ev.kind, ev.text);
        break;
      case 'win':
        this.flash = 0.5;
        this.flashColor = '255,255,255';
        this.zoomPunch(1.06);
        for (let i = 0; i < 46; i++) {
          this.particles.push({
            kind: 'heart', x: this.viewW * Math.random(), y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160,
            g: 30, life: 0, max: 3.5 + Math.random() * 2, size: 7 + Math.random() * 9, color: ['#FF5C7A', '#FFB3C6', '#FFFFFF', '#FFC94A'][i % 4], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 4,
          });
        }
        this.burst(mx, my, 22, ['#FF5C7A', '#FFB3C6', '#FFFFFF'], 340, 'heart');
        break;
    }
  }

  /* ---------- частицы ---------- */

  burst(x, y, n, colors, speed, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.particles.push({
        kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: kind === 'spark' ? 300 : 420, life: 0, max: 0.45 + Math.random() * 0.45,
        size: kind === 'puff' ? 5 + Math.random() * 6 : kind === 'heart' ? 6 + Math.random() * 6 : 3 + Math.random() * 3.5,
        color: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      });
    }
  }
  puff(x, y, n, color, speed) {
    for (let i = 0; i < n; i++)
      this.particles.push({ kind: 'puff', x, y, vx: -speed - Math.random() * 40, vy: 30 + Math.random() * 50, g: 0, life: 0, max: 0.4, size: 4 + Math.random() * 3, color, rot: 0, vr: 0 });
  }
  ring(x, y, color) {
    this.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, g: 0, life: 0, max: 0.5, size: 20, color, rot: 0, vr: 0 });
  }
  text(x, y, text, color, size = 22) {
    this.particles.push({ kind: 'text', x: Math.max(60, Math.min(this.viewW - 60, x)), y, vx: 0, vy: -46, g: 0, life: 0, max: 0.95, size, color, text, rot: 0, vr: 0 });
  }
  /** Сердечко улетает в счётчик в углу экрана. */
  flyHeart(x, y) {
    if (!this.hudTarget) return;
    this.particles.push({
      kind: 'fly', x, y, vx: 0, vy: 0, g: 0, life: 0, max: 0.52, size: 9, color: '#FF5C7A', rot: 0, vr: 0,
      tx: this.hudTarget.x, ty: this.hudTarget.y, sx: x, sy: y,
    });
  }
  zoomPunch(z) {
    if (this.reduceMotion) return;
    this.cam.zoomTo = Math.max(this.cam.zoomTo, z);
  }

  /* ---------- кадр ---------- */

  draw(sim, dt) {
    const ctx = this.ctx;
    const W = this.viewW;
    const VH = this.viewH;
    const t = (this.time += dt);
    const theme = THEMES[sim.theme] || THEMES.living;
    const playing = sim.status === 'playing';
    const cam = this.cam;

    // камера: мягко возвращается в покой
    const ease = 1 - Math.pow(0.0009, dt);
    cam.zoom += (cam.zoomTo - cam.zoom) * ease;
    cam.zoomTo += (1 - cam.zoomTo) * (1 - Math.pow(0.02, dt));
    cam.dx += (cam.dxTo - cam.dx) * ease;
    cam.dy += (cam.dyTo - cam.dy) * ease;
    cam.dxTo *= Math.pow(0.02, dt);
    cam.dyTo *= Math.pow(0.02, dt);

    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    ctx.save();
    const shakeOn = this.shake > 0.2 && !this.reduceMotion;
    const z = cam.zoom * (shakeOn ? 1.04 : 1);
    if (z !== 1 || shakeOn || cam.dx || cam.dy) {
      ctx.translate(W / 2, VH / 2);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -VH / 2);
      if (shakeOn) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      else ctx.translate(cam.dx, cam.dy);
    }
    this.shake *= Math.pow(0.002, dt);
    ctx.translate(0, this.offY);

    theme.sky(ctx, W, VH, t);
    theme.far(ctx, W, sim.scroll, t);
    this.ambient(theme.ambient, W, sim.scroll, t);
    if (this.momentFx) this.drawMoment(ctx, W, VH, t, dt, sim);

    const wx = (x) => x - sim.dist;

    // финиш
    if (sim.finishX != null) {
      const fx = wx(sim.finishX);
      if (fx < W + 200) this.finish(fx, t);
    }

    // ворота
    for (const g of sim.gates) {
      const x = wx(g.x);
      if (x > W + 20 || x + g.w < -20) continue;
      const th = THEMES[g.theme] || theme;
      const top = g.gapY - g.gap / 2;
      const bot = g.gapY + g.gap / 2;
      th.column(ctx, x, -130, g.w, top + 130, 'bottom', g.idx + 0.5, t);
      th.column(ctx, x, bot, g.w, G - bot + 30, 'top', g.idx, t);
    }

    // краны на потолке
    for (const e of sim.emitters) {
      const x = wx(e.x);
      if (x < -40 || x > W + 40) continue;
      this.tap(x);
    }

    // предметы
    for (const it of sim.items) {
      if (it.taken) continue;
      const x = wx(it.x);
      if (x < -40 || x > W + 40) continue;
      const bob = Math.sin(t * 4 + it.x * 0.02) * 3.5;
      if (it.type === 'heart') this.heart(x, it.y + bob, 12 + Math.sin(t * 6 + it.x * 0.05) * 1.2);
      else if (it.type === 'fish') this.fish(x, it.y + bob, t);
      else this.powerup(x, it.y + bob, it.type, t);
    }

    // опасности
    for (const h of sim.hazards) {
      const x = wx(h.x);
      if (x < -60 || x > W + 60) continue;
      if (h.type === 'drop') this.drop(x, h.y);
      else if (h.type === 'balloon') this.balloon(x, h.y, h.hue, t);
      else if (h.type === 'cucumber') this.cucumber(x, h.y, t);
    }

    // след-лента
    if (playing && !this.reduceMotion) {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = sim.catnip > 0 ? 0.02 : 0.028;
        this.trail.push({ x: sim.dist + sim.miaX - 22, y: sim.mia.y + 6, catnip: sim.catnip > 0, inv: sim.inv > 0 });
      }
    }
    this.drawTrail(ctx, sim, dt, theme);

    this.mia(sim, t, dt);
    this.bubbleDraw(ctx, sim, dt);
    this.drawParticles(dt, sim, playing);

    theme.ground(ctx, W, VH, sim.scroll);

    // предупреждения
    for (const w of sim.warnings) this.warning(W, w.y, t);
    if (sim.wind.state !== 'idle') this.wind(sim, W, t);

    // мир «теплеет» к финалу
    if (this.warm > 0.002) {
      ctx.fillStyle = `rgba(255,196,214,${this.warm * 0.3})`;
      ctx.fillRect(-40, -200, W + 80, VH + 300);
    }

    ctx.restore();

    // вспышки на весь экран отключаются вместе с остальной анимацией («уменьшить движение»)
    if (this.reduceMotion) this.flash = 0;
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash})`;
      ctx.fillRect(0, 0, W, VH);
      this.flash *= Math.pow(0.004, dt);
    }

    // импульсы Мии затухают
    this.pulse *= Math.pow(0.0007, dt);
    this.landPulse *= Math.pow(0.0004, dt);
    if (this.momentFx) {
      this.momentFx.t += dt;
      if (this.momentFx.t > this.momentFx.dur) this.momentFx = null;
    }
  }

  /* ---------- след ---------- */

  drawTrail(ctx, sim, dt, theme) {
    const tr = this.trail;
    for (let i = tr.length - 1; i >= 0; i--) {
      tr[i].x -= sim.speed * dt;
      if (tr[i].x - sim.dist < -80) tr.splice(i, 1);
    }
    if (tr.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1];
      const b = tr[i];
      const f = i / tr.length;
      const x0 = a.x - sim.dist;
      const x1 = b.x - sim.dist;
      if (x1 < -60) continue;
      ctx.globalAlpha = f * 0.5;
      ctx.lineWidth = 2 + f * (b.catnip ? 16 : 9);
      ctx.strokeStyle = b.catnip ? `hsl(${(this.time * 260 + i * 26) % 360} 90% 72%)` : b.inv ? 'rgba(255,225,235,.9)' : theme.dark ? 'rgba(255,238,205,.95)' : 'rgba(255,255,255,.95)';
      ctx.beginPath();
      ctx.moveTo(x0, a.y);
      ctx.lineTo(x1, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- «момент» уровня ---------- */

  drawMoment(ctx, W, VH, t, dt, sim) {
    const fx = this.momentFx;
    const p = fx.t / fx.dur;
    if (p > 1) return;
    const fade = p < 0.12 ? p / 0.12 : p > 0.78 ? (1 - p) / 0.22 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(fade, 0, 1);
    switch (fx.kind) {
      case 'fireworks': {
        for (let i = 0; i < 6; i++) {
          const s = fx.seeds[i];
          const period = 1.1 + s * 0.5;
          const ph = (fx.t + s * 2) % period;
          const cx = (s * 1.7 % 1) * W;
          const cy = 90 + fx.seeds[i + 6] * 200;
          if (ph < 0.45) {
            const f = ph / 0.45;
            ctx.strokeStyle = 'rgba(255,240,200,.9)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(cx, G - 20);
            ctx.lineTo(cx + Math.sin(f * 3) * 6, G - 20 - (G - 20 - cy) * f);
            ctx.stroke();
          } else {
            const f = (ph - 0.45) / (period - 0.45);
            const R = 20 + f * 130;
            const col = ['#FF8FB0', '#FFE08A', '#9CC7E8', '#C9A7E8'][i % 4];
            for (let k = 0; k < 14; k++) {
              const a = (k / 14) * TAU + s * 3;
              const rr2 = R * (0.75 + 0.25 * Math.sin(k * 2.1));
              ctx.fillStyle = col;
              ctx.globalAlpha = clamp(fade * (1 - f), 0, 1);
              ctx.beginPath();
              ctx.arc(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2 * 0.95 + f * 26, 3.4 * (1 - f) + 1, 0, TAU);
              ctx.fill();
            }
            ctx.globalAlpha = clamp(fade, 0, 1);
          }
        }
        break;
      }
      case 'aurora': {
        for (let band = 0; band < 3; band++) {
          ctx.beginPath();
          const base = 60 + band * 62;
          for (let x = -20; x <= W + 20; x += 16) {
            const y = base + Math.sin(x * 0.012 + t * 0.7 + band * 1.7) * 34 + Math.sin(x * 0.03 + t * 1.3) * 12;
            if (x === -20) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const grd = ctx.createLinearGradient(0, base - 40, 0, base + 150);
          const hue = ['#7CF3C4', '#8FD3F4', '#D9A7F5'][band];
          grd.addColorStop(0, 'rgba(255,255,255,0)');
          grd.addColorStop(0.35, hexA(hue, 0.5));
          grd.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = grd;
          ctx.lineWidth = 78;
          ctx.stroke();
        }
        break;
      }
      case 'faucet': {
        const cx = W * 0.5;
        ctx.fillStyle = 'rgba(160,220,255,.55)';
        const wob = Math.sin(t * 9) * 6;
        ctx.beginPath();
        ctx.moveTo(cx - 16, -100);
        ctx.quadraticCurveTo(cx + wob, 240, cx - 40, G);
        ctx.lineTo(cx + 40, G);
        ctx.quadraticCurveTo(cx - wob, 240, cx + 16, -100);
        ctx.fill();
        for (let i = 0; i < 18; i++) {
          const s = fx.seeds[i];
          const y = ((fx.t * 520 * (0.7 + s * 0.6) + s * 700) % (G + 60)) - 30;
          ctx.fillStyle = 'rgba(215,240,255,.9)';
          ctx.beginPath();
          ctx.arc(cx + Math.sin(i * 2.3 + t) * 34, y, 2.5 + s * 2.5, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        for (let i = 0; i < 10; i++) {
          const s = fx.seeds[i + 10];
          const a = Math.PI + (i / 10) * Math.PI;
          const r = 30 + Math.sin(t * 6 + i) * 8 + s * 20;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * r, G - 6 + Math.sin(a) * r * 0.5, 4, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'candles': {
        const n = 7;
        for (let i = 0; i < n; i++) {
          const x = ((i + 0.5) / n) * W;
          const gone = fx.t > 0.5 + i * 0.22;
          ctx.fillStyle = '#FFFDFB';
          rr(ctx, x - 7, G - 90, 14, 90, 4);
          ctx.fill();
          ctx.strokeStyle = '#C96A84';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (!gone) {
            const fl = 1 + Math.sin(t * 12 + i) * 0.1;
            ctx.fillStyle = 'rgba(255,196,60,.3)';
            ctx.beginPath();
            ctx.arc(x, G - 106, 17 * fl, 0, TAU);
            ctx.fill();
            ctx.fillStyle = '#FFB830';
            ctx.beginPath();
            ctx.moveTo(x, G - 90 - 28 * fl);
            ctx.quadraticCurveTo(x + 9, G - 104, x, G - 92);
            ctx.quadraticCurveTo(x - 9, G - 104, x, G - 90 - 28 * fl);
            ctx.fill();
          } else {
            ctx.strokeStyle = 'rgba(180,170,175,.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, G - 92);
            ctx.quadraticCurveTo(x + 8, G - 112, x + 2, G - 132);
            ctx.stroke();
          }
        }
        break;
      }
      case 'plush': {
        for (let i = 0; i < 5; i++) {
          const s = fx.seeds[i];
          const x = ((i + 0.5) / 5) * W;
          const jump = Math.abs(Math.sin(fx.t * 4 + s * 4)) * 46;
          ctx.save();
          ctx.translate(x, G - 26 - jump);
          ctx.rotate(Math.sin(fx.t * 4 + s * 4) * 0.25);
          ctx.fillStyle = ['#F4E8DA', '#CDB09A', '#8E6FA6'][i % 3];
          ctx.beginPath();
          ctx.ellipse(0, 0, 20, 22, 0, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(-11, -20, 7, 0, TAU);
          ctx.arc(11, -20, 7, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#3A1D2E';
          ctx.beginPath();
          ctx.arc(-6, -3, 2, 0, TAU);
          ctx.arc(6, -3, 2, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'bloom': {
        // лепестки и лучи, сходящиеся к финишу
        const fxp = sim.finishX != null ? sim.finishX - sim.dist : W;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + t * 0.35;
          const r = 120 + Math.sin(t * 1.4 + i) * 40 + fx.t * 26;
          ctx.strokeStyle = `rgba(255,255,255,${0.16 + 0.1 * Math.sin(t * 2 + i)})`;
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.moveTo(fxp + Math.cos(a) * r, 320 + Math.sin(a) * r * 0.8);
          ctx.lineTo(fxp + Math.cos(a) * (r + 90), 320 + Math.sin(a) * (r + 90) * 0.8);
          ctx.stroke();
        }
        for (let i = 0; i < 26; i++) {
          const s = fx.seeds[i];
          const y = ((s * 800 + fx.t * (60 + s * 90)) % (G + 40)) - 20;
          const x = ((s * 3.7 + fx.t * 0.06) % 1) * W;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(t * 1.5 + i);
          ctx.fillStyle = i % 3 === 0 ? '#FFB3C6' : '#FFFDF6';
          ctx.beginPath();
          ctx.ellipse(0, 0, 7, 4, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
    }
    ctx.restore();
  }

  ambient(kind, W, scroll, t) {
    const ctx = this.ctx;
    const n = kind === 'snow' ? 46 : 26;
    for (let i = 0; i < n; i++) {
      const a = hash(i + 1);
      const b = hash(i + 77);
      const c = hash(i + 150);
      const span = W + 60;
      let x, y;
      const mod = (v, m) => ((v % m) + m) % m;
      switch (kind) {
        case 'dust':
          x = mod(a * span - scroll * 0.3 - t * 6, span) - 30;
          y = mod(b * G - t * (4 + c * 8), G);
          ctx.fillStyle = `rgba(255,255,255,${0.35 + c * 0.4})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.5 + c * 2, 0, TAU);
          ctx.fill();
          break;
        case 'steam':
          x = mod(a * span - scroll * 0.35, span) - 30 + Math.sin(t + i) * 10;
          y = mod(b * G - t * (14 + c * 18), G);
          ctx.fillStyle = `rgba(255,255,255,${0.16 + c * 0.2})`;
          ctx.beginPath();
          ctx.arc(x, y, 8 + c * 14, 0, TAU);
          ctx.fill();
          break;
        case 'confetti': {
          x = mod(a * span - scroll * 0.4 + Math.sin(t * 2 + i) * 14, span) - 30;
          y = mod(b * G + t * (26 + c * 40), G);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(t * (1 + c * 3) + i);
          ctx.fillStyle = ['#F58CA5', '#F4C97B', '#9CC79A', '#FFFFFF', '#C9A7E8'][i % 5];
          ctx.globalAlpha = 0.75;
          ctx.fillRect(-4, -2, 8, 4 * Math.abs(Math.cos(t * 3 + i)) + 1);
          ctx.restore();
          break;
        }
        case 'fireflies': {
          x = mod(a * span - scroll * 0.3 + Math.sin(t * 0.7 + i) * 26, span) - 30;
          y = 300 + b * 320 + Math.cos(t * 0.9 + i * 2) * 18;
          const al = 0.35 + 0.5 * Math.abs(Math.sin(t * 1.5 + i));
          ctx.fillStyle = `rgba(255,224,130,${al * 0.25})`;
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, TAU);
          ctx.fill();
          ctx.fillStyle = `rgba(255,236,170,${al})`;
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, TAU);
          ctx.fill();
          break;
        }
        case 'snow':
          x = mod(a * span - scroll * (0.3 + c * 0.3) + Math.sin(t * 1.2 + i) * 16, span) - 30;
          y = mod(b * G + t * (40 + c * 60), G);
          ctx.fillStyle = `rgba(255,255,255,${0.6 + c * 0.4})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.6 + c * 2.8, 0, TAU);
          ctx.fill();
          break;
        case 'hearts':
          x = mod(a * span - scroll * 0.35 + Math.sin(t + i) * 12, span) - 30;
          y = mod(b * G - t * (16 + c * 22), G);
          ctx.fillStyle = `rgba(255,255,255,${0.28 + c * 0.3})`;
          heartPath(ctx, x, y, 5 + c * 6);
          ctx.fill();
          break;
      }
    }
  }

  finish(x, t) {
    const ctx = this.ctx;
    const pulse = 1 + Math.sin(t * 3) * 0.06;
    const beam = ctx.createLinearGradient(x - 70, 0, x + 70, 0);
    beam.addColorStop(0, 'rgba(255,255,255,0)');
    beam.addColorStop(0.5, 'rgba(255,255,255,.5)');
    beam.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(x - 70, 0, 140, G);
    ctx.save();
    ctx.translate(x, 320);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = 'rgba(255,92,122,.7)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#FF5C7A';
    heartPath(ctx, 0, 0, 62);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    ctx.ellipse(-34, -28, 10, 18, 0.6, 0, TAU);
    ctx.fill();
    if (this.finishLabel) {
      ctx.font = `900 22px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(this.finishLabel, 0, -4);
    }
    ctx.restore();
    for (let i = 0; i < 6; i++) {
      const a = t * 1.2 + (i * TAU) / 6;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      star(ctx, x + Math.cos(a) * 112, 320 + Math.sin(a) * 96, 5 + Math.sin(t * 5 + i) * 2);
    }
  }

  tap(x) {
    const ctx = this.ctx;
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#B5ADA2';
    ctx.lineWidth = 2;
    rr(ctx, x - 8, -100, 16, 116, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#D9B36A';
    ctx.strokeStyle = '#8A6420';
    rr(ctx, x - 10, 14, 20, 12, 4);
    ctx.fill();
    ctx.stroke();
  }

  heart(x, y, s) {
    const ctx = this.ctx;
    ctx.fillStyle = '#FF5C7A';
    ctx.strokeStyle = '#A8324F';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    heartPath(ctx, x, y, s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.5, y - s * 0.4, s * 0.2, s * 0.3, 0.6, 0, TAU);
    ctx.fill();
  }

  fish(x, y, t) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 5 + x) * 0.15);
    ctx.fillStyle = 'rgba(255,220,120,.3)';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFC94A';
    ctx.strokeStyle = '#B9801A';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-24, -10);
    ctx.lineTo(-24, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 10, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5B3A12';
    ctx.beginPath();
    ctx.arc(8, -2, 2.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    ctx.ellipse(-2, -5, 6, 2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  powerup(x, y, kind, t) {
    const ctx = this.ctx;
    const color = POWERUPS[kind].color;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.arc(0, 0, 27, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    const g = ctx.createRadialGradient(-6, -8, 2, 0, 0, 21);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (kind === 'shield') {
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(-4, -5, 2.5, 4.5, 0.6, 0, TAU);
      ctx.fill();
    } else if (kind === 'magnet') {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#E8475F';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, -1, 8, Math.PI, TAU);
      ctx.moveTo(-8, -1);
      ctx.lineTo(-8, 6);
      ctx.moveTo(8, -1);
      ctx.lineTo(8, 6);
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(-8, 6);
      ctx.lineTo(-8, 11);
      ctx.moveTo(8, 6);
      ctx.lineTo(8, 11);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#3E8E41';
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.bezierCurveTo(-14, 4, -12, -10, 0, -13);
      ctx.bezierCurveTo(12, -10, 14, 4, 0, 12);
      ctx.fill();
      ctx.strokeStyle = '#D9F5D0';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(0, -9);
      ctx.moveTo(0, 3);
      ctx.lineTo(-6, -2);
      ctx.moveTo(0, -1);
      ctx.lineTo(6, -6);
      ctx.stroke();
    }
    ctx.restore();
  }

  drop(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#6EC1F0';
    ctx.strokeStyle = '#2F86C2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 17);
    ctx.bezierCurveTo(x + 4, y - 8, x + 10, y - 3, x + 10, y + 3);
    ctx.arc(x, y + 3, 10, 0, Math.PI);
    ctx.bezierCurveTo(x - 10, y - 3, x - 4, y - 8, x, y - 17);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath();
    ctx.ellipse(x - 4, y + 2, 2, 4, 0.4, 0, TAU);
    ctx.fill();
  }

  balloon(x, y, hue, t) {
    const ctx = this.ctx;
    const color = BALLOON_COLORS[hue % 4];
    ctx.strokeStyle = 'rgba(90,50,70,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 25);
    ctx.quadraticCurveTo(x + 7 * Math.sin(t * 2 + x), y + 46, x, y + 64);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(90,40,60,.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 21, 25, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 30);
    ctx.lineTo(x, y + 24);
    ctx.lineTo(x + 4, y + 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    heartPath(ctx, x, y + 1, 7.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath();
    ctx.ellipse(x - 9, y - 12, 3, 6, 0.6, 0, TAU);
    ctx.fill();
  }

  cucumber(x, y, t) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    // шлейф скорости
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(30, i * 9);
      ctx.lineTo(52 + 8 * Math.sin(t * 20 + i), i * 9);
      ctx.stroke();
    }
    ctx.rotate(Math.sin(t * 6 + y) * 0.12);
    ctx.fillStyle = '#6FB24F';
    ctx.strokeStyle = '#2F6B2A';
    ctx.lineWidth = 2.5;
    rr(ctx, -27, -12, 54, 24, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4E9440';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-4 + i * 8, i % 2 ? 6 : -6, 1.8, 0, TAU);
      ctx.fill();
    }
    // хмурая мордочка
    ctx.fillStyle = '#1F3F1C';
    ctx.beginPath();
    ctx.arc(-17, -1, 2.3, 0, TAU);
    ctx.arc(-9, -1, 2.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1F3F1C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-21, -7);
    ctx.lineTo(-15, -5);
    ctx.moveTo(-5, -7);
    ctx.lineTo(-11, -5);
    ctx.moveTo(-16, 6);
    ctx.quadraticCurveTo(-13, 3.5, -10, 6);
    ctx.stroke();
    ctx.restore();
  }

  warning(W, y, t) {
    const ctx = this.ctx;
    const a = 0.55 + 0.45 * Math.sin(t * 22);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#FF5C7A';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W - 30, y, 18, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', W - 30, y + 1);
    ctx.restore();
  }

  wind(sim, W, t) {
    const ctx = this.ctx;
    const dir = sim.wind.dir;
    const mx = sim.miaX;
    const my = sim.mia.y;
    if (sim.wind.state === 'warn') {
      const a = 0.5 + 0.5 * Math.sin(t * 18);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 2; i++) {
        const y = my + dir * (62 + i * 18);
        ctx.beginPath();
        ctx.moveTo(mx - 16, y - dir * 12);
        ctx.lineTo(mx, y);
        ctx.lineTo(mx + 16, y - dir * 12);
        ctx.stroke();
      }
      ctx.strokeStyle = '#3F87B5';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 2; i++) {
        const y = my + dir * (62 + i * 18);
        ctx.beginPath();
        ctx.moveTo(mx - 16, y - dir * 12);
        ctx.lineTo(mx, y);
        ctx.lineTo(mx + 16, y - dir * 12);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 22; i++) {
        const x = hash(i + 3) * W;
        const len = 40 + hash(i + 9) * 70;
        const yy = ((((hash(i + 30) * G + dir * t * 620) % G) + G) % G);
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x - 6, yy - dir * len);
        ctx.stroke();
      }
    }
  }

  /* ---------- Мия ---------- */

  mia(sim, t, dt) {
    const ctx = this.ctx;
    const sk = this.skin;
    if (!sk || !this.sticker) return;
    const m = sim.mia;
    this.wingT = Math.min(1, this.wingT + dt / 0.3);
    const blink = sim.inv > 0 && sim.status === 'playing' && Math.floor(t * 14) % 2 === 0;
    const st = this.sticker;
    const w = sk.w * (sim.catnip > 0 ? 1.12 : 1);
    const h = w * st.ratio;
    const padW = w * st.pad;

    // сжатие и растяжение: от скорости, от взмаха и от удара о пол
    const vyStretch = clamp(-m.vy / 2400, -0.15, 0.19);
    const sy = 1 + vyStretch + this.pulse * 0.22 + this.landPulse * 0.3;
    const sx = 1 - (sy - 1) * 0.62 + this.landPulse * 0.12;

    ctx.save();
    ctx.translate(sim.miaX, m.y);
    const rot = sim.status === 'dying' || sim.status === 'lost' ? m.rot : m.rot * 0.5;
    ctx.rotate(rot);
    if (blink) ctx.globalAlpha = 0.45;

    if (sim.catnip > 0) {
      const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 70);
      g.addColorStop(0, 'rgba(180,255,150,.55)');
      g.addColorStop(1, 'rgba(180,255,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 70, 0, TAU);
      ctx.fill();
    }

    ctx.save();
    ctx.scale(sx, sy);

    // крылья: два слоя, фаза зависит от того, вверх Мия идёт или вниз
    const flap = Math.sin(Math.PI * this.wingT);
    const rise = clamp(-m.vy / 500, -0.5, 0.7);
    const idle = Math.sin(t * 7) * 0.1;
    const wxp = (sk.wings[0] - sk.ax) * w;
    const wyp = (sk.wings[1] - sk.ay) * h;
    const ws = Math.max(34, w * 0.4);
    // размытие в движении: три «призрака» крыла
    const ghosts = this.reduceMotion || flap < 0.35 ? 1 : 3;
    for (let gi = 0; gi < ghosts; gi++) {
      const f = ghosts === 1 ? 1 : (gi + 1) / ghosts;
      ctx.globalAlpha = (blink ? 0.45 : 1) * (gi === ghosts - 1 ? 1 : 0.16);
      wing(ctx, wxp - 6, wyp - 4, ws * 0.9, 0.5 + idle - (flap * f) * 1.15 - rise * 0.22, '#F3E4E8');
      wing(ctx, wxp, wyp, ws, 0.25 + idle - (flap * f) * 1.25 - rise * 0.3, '#FFFFFF');
    }
    ctx.globalAlpha = blink ? 0.45 : 1;

    ctx.drawImage(st.canvas, -sk.ax * w - padW, -sk.ay * h - padW, w + padW * 2, h + padW * 2);
    ctx.restore();

    if (sim.shield) {
      ctx.globalAlpha = 1;
      const r = 48 + Math.sin(t * 5) * 1.5;
      ctx.fillStyle = 'rgba(160,220,255,.22)';
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.45, -r * 0.5, 5, 11, 0.7, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- облачко с репликой ---------- */

  bubbleDraw(ctx, sim, dt) {
    const b = this.bubble;
    b.t += dt;
    if (!b.text || b.t > b.max) return;
    const f = b.t / b.max;
    const alpha = f < 0.12 ? f / 0.12 : f > 0.75 ? (1 - f) / 0.25 : 1;
    const sk = this.skin;
    const w = sk ? sk.w : 100;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = `800 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(b.text).width;
    const bw = tw + 30;
    const bh = 38;
    let bx = sim.miaX;
    const by = sim.mia.y - w * 0.45 - bh - 12;
    bx = clamp(bx, bw / 2 + 8, this.viewW - bw / 2 - 8);
    // хвостик
    ctx.fillStyle = '#FFFDF9';
    ctx.strokeStyle = '#3A1D2E';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx - 8, by + bh / 2 - 2);
    ctx.lineTo(sim.miaX + 6, sim.mia.y - w * 0.42);
    ctx.lineTo(bx + 10, by + bh / 2 - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    rr(ctx, bx - bw / 2, by - bh / 2, bw, bh, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3A1D2E';
    ctx.fillText(b.text, bx, by + 1);
    ctx.restore();
  }

  drawParticles(dt, sim, playing) {
    const ctx = this.ctx;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        ps.splice(i, 1);
        continue;
      }
      const f = p.life / p.max;
      if (p.kind === 'fly' && this.hudTarget) {
        // сердечко по дуге улетает в счётчик
        const e = f * f * (3 - 2 * f);
        const cx = (p.sx + p.tx) / 2;
        const cy = Math.min(p.sy, p.ty) - 90;
        const x = (1 - e) * (1 - e) * p.sx + 2 * (1 - e) * e * cx + e * e * p.tx;
        const y = (1 - e) * (1 - e) * p.sy + 2 * (1 - e) * e * cy + e * e * p.ty;
        ctx.globalAlpha = 1 - f * f * 0.4;
        ctx.fillStyle = p.color;
        heartPath(ctx, x, y, p.size * (1 - f * 0.35));
        ctx.fill();
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.globalAlpha = p.kind === 'text' ? Math.min(1, (1 - f) * 2.2) : 1 - f * f;
      switch (p.kind) {
        case 'dot':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - f * 0.6), 0, TAU);
          ctx.fill();
          break;
        case 'spark':
          ctx.fillStyle = p.color;
          star(ctx, p.x, p.y, p.size * (1 - f * 0.4), p.rot);
          break;
        case 'puff':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + f), 0, TAU);
          ctx.fill();
          break;
        case 'confetti':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          ctx.restore();
          break;
        case 'heart':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(p.rot) * 0.5);
          ctx.fillStyle = p.color;
          heartPath(ctx, 0, 0, p.size);
          ctx.fill();
          ctx.restore();
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5 * (1 - f);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size + f * 60, 0, TAU);
          ctx.stroke();
          break;
        case 'text':
          ctx.font = `900 ${p.size}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 5;
          ctx.strokeStyle = 'rgba(58,29,46,.85)';
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
          ctx.fillStyle = 'rgba(255,255,255,.35)';
          ctx.fillText(p.text, p.x, p.y);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** '#RRGGBB' + прозрачность → 'rgba(…)'. Нужно для градиентов северного сияния. */
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function star(ctx, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(0, 0, s, 0);
  ctx.quadraticCurveTo(0, 0, 0, s);
  ctx.quadraticCurveTo(0, 0, -s, 0);
  ctx.quadraticCurveTo(0, 0, 0, -s);
  ctx.fill();
  ctx.restore();
}

function wing(ctx, x, y, s, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-s * 0.15, -s * 0.8, -s * 0.9, -s * 0.95, -s * 1.2, -s * 0.55);
  ctx.quadraticCurveTo(-s * 0.9, -s * 0.52, -s * 1.0, -s * 0.24);
  ctx.quadraticCurveTo(-s * 0.7, -s * 0.26, -s * 0.74, 0.02 * s);
  ctx.quadraticCurveTo(-s * 0.46, -s * 0.04, -s * 0.42, s * 0.2);
  ctx.quadraticCurveTo(-s * 0.16, s * 0.12, 0, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#D98AA0';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/** Делает из фото-вырезки «наклейку» с белой обводкой — так Мию хорошо видно на любом фоне. */
export function makeSticker(img, worldW) {
  const px = Math.ceil(worldW * 3);
  const ratio = img.naturalHeight / img.naturalWidth;
  const h = Math.ceil(px * ratio);
  const pad = Math.ceil(px * 0.04);
  const c = document.createElement('canvas');
  c.width = px + pad * 2;
  c.height = h + pad * 2;
  const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    x.drawImage(img, pad + Math.cos(a) * pad * 0.85, pad + Math.sin(a) * pad * 0.85, px, h);
  }
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#FFFFFF';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  x.drawImage(img, pad, pad, px, h);
  return { canvas: c, ratio, pad: pad / px };
}
