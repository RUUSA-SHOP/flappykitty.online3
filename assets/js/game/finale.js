/* Flappy Kitty · финальная сцена.
   Конец шестого уровня превращается в маленькое кино:
   мир теплеет, Мия долетает до самого главного сердца, сердце
   раскрывается, появляется конверт — и только потом письмо.
   Сцена рисуется на том же холсте, что и игра, поэтому не требует
   ни картинок, ни загрузки. */

import { THEMES, heartPath, rr } from './themes.js';

const TAU = Math.PI * 2;
const FONT = 'Nunito, system-ui, sans-serif';
const HAND = 'Caveat, Nunito, cursive';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;

export class Finale {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{viewW:number, viewH:number, skin:object, sticker:object, reduceMotion:boolean}} r — состояние рендерера
   * @param {object} opts { herName, catName, onLetter }
   */
  constructor(ctx, r, opts) {
    this.ctx = ctx;
    this.r = r;
    this.opts = opts;
    this.t = 0;
    this.stage = 0; // 0 — полёт к сердцу, 1 — сердце раскрывается, 2 — конверт
    this.dur = r.reduceMotion ? [2.2, 1.4, 2.2] : [4.6, 2.4, 3.4];
    this.hearts = Array.from({ length: 34 }, (_, i) => ({
      x: (i * 97) % 1000,
      y: (i * 211) % 720,
      s: 5 + ((i * 37) % 11),
      sp: 18 + ((i * 53) % 40),
      ph: i * 1.7,
    }));
    this.done = false;
    this.wash = 0;
  }

  get progress() {
    let acc = 0;
    for (let i = 0; i < this.stage; i++) acc += this.dur[i];
    return acc + Math.min(this.t, this.dur[this.stage]);
  }

  update(dt) {
    this.t += dt;
    if (this.t >= this.dur[this.stage]) {
      this.t = 0;
      this.stage++;
      if (this.stage > 2) {
        this.done = true;
        this.stage = 2;
      }
    }
    const target = this.stage === 0 ? 0.65 : 1;
    this.r.warm = lerp(this.r.warm, target, 1 - Math.pow(0.25, dt));
  }

  draw(dt) {
    this.update(dt);
    const ctx = this.ctx;
    const W = this.r.viewW;
    const H = this.r.viewH;
    const t = this.t;
    const d = this.dur[this.stage];
    const p = clamp(t / d, 0, 1);

    ctx.save();
    this.sky(ctx, W, H);
    this.rays(ctx, W, H);
    this.floatingHearts(ctx, W, H, dt);

    if (this.stage === 0) {
      // Мия летит к сердцу, сердце ждёт впереди
      const hx = W * lerp(0.78, 0.5, easeIn(p));
      const hy = H * 0.44;
      this.heart(ctx, hx, hy, lerp(46, 78, easeOut(p)), 1 + Math.sin(this.progress * 2.4) * 0.05);
      const mx = W * lerp(0.16, 0.5, easeIn(p));
      const my = hy + Math.sin(this.progress * 2.1) * 26 - 6;
      this.mia(ctx, mx, my, -0.12 + Math.sin(this.progress * 2.1) * 0.12, 1);
    } else if (this.stage === 1) {
      // сердце раскрывается: лучи, вспышка, оно уходит вверх
      const grow = 78 + easeOut(p) * 120;
      const fade = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
      ctx.globalAlpha = clamp(fade, 0, 1);
      this.heart(ctx, W * 0.5, H * 0.44 - easeOut(p) * 30, grow, 1);
      ctx.globalAlpha = 1;
      this.mia(ctx, W * 0.5 + lerp(0, 90, easeOut(p)), H * 0.44 + lerp(0, 70, easeOut(p)), lerp(-0.1, 0.25, p), 1 - p * 0.25);
      this.wash = p > 0.8 ? (p - 0.8) / 0.2 : 0;
    } else {
      // конверт: появляется, открывается, письмо выглядывает
      this.envelope(ctx, W, H, p);
    }
    ctx.restore();

    // белая «волна» между сценами — мягкая, без резкого мигания
    if (this.wash > 0.01 || (this.stage === 2 && p < 0.12)) {
      const a = this.stage === 2 ? (0.12 - p) / 0.12 : this.wash;
      ctx.fillStyle = `rgba(255,252,248,${clamp(a, 0, 1) * 0.92})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  sky(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4E3D8F');
    g.addColorStop(0.32, '#A463A6');
    g.addColorStop(0.62, '#F08FA6');
    g.addColorStop(0.86, '#FFC6A2');
    g.addColorStop(1, '#FFE7C2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // тёплое сияние в центре
    const r = ctx.createRadialGradient(W * 0.5, H * 0.44, 20, W * 0.5, H * 0.44, Math.max(W, H) * 0.75);
    r.addColorStop(0, 'rgba(255,244,214,.5)');
    r.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);
  }

  rays(ctx, W, H) {
    if (this.r.reduceMotion) return;
    ctx.save();
    ctx.translate(W * 0.5, H * 0.44);
    ctx.rotate(this.progress * 0.06);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(TAU / 12);
      ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.03 * Math.sin(this.progress * 1.4 + i)})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.max(W, H), -26);
      ctx.lineTo(Math.max(W, H), 26);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  floatingHearts(ctx, W, H, dt) {
    for (const h of this.hearts) {
      h.y -= h.sp * dt * 0.35;
      if (h.y < -30) {
        h.y = H + 30;
        h.x = Math.random() * W;
      }
      const x = (h.x / 1000) * W + Math.sin(this.progress * 0.8 + h.ph) * 16;
      ctx.fillStyle = `rgba(255,255,255,${0.16 + (h.s / 16) * 0.22})`;
      heartPath(ctx, x, h.y, h.s);
      ctx.fill();
    }
  }

  heart(ctx, x, y, s, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(255,92,122,.65)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#FF5C7A';
    heartPath(ctx, 0, 0, s);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(4, s * 0.07);
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.52, -s * 0.42, s * 0.15, s * 0.28, 0.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  mia(ctx, x, y, rot, alpha = 1) {
    const r = this.r;
    if (!r.skin || !r.sticker) return;
    const sk = r.skin;
    const st = r.sticker;
    const w = sk.w * 1.1;
    const h = w * st.ratio;
    const padW = w * st.pad;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(x, y);
    ctx.rotate(rot);
    const flap = Math.sin(this.progress * 9);
    const ws = Math.max(34, w * 0.4);
    const wxp = (sk.wings[0] - sk.ax) * w;
    const wyp = (sk.wings[1] - sk.ay) * h;
    wingShape(ctx, wxp - 6, wyp - 4, ws * 0.9, 0.4 - flap * 1.0, '#F3E4E8');
    wingShape(ctx, wxp, wyp, ws, 0.15 - flap * 1.1, '#FFFFFF');
    ctx.drawImage(st.canvas, -sk.ax * w - padW, -sk.ay * h - padW, w + padW * 2, h + padW * 2);
    ctx.restore();
  }

  /** Конверт: появляется снизу, клапан открывается, письмо выглядывает. */
  envelope(ctx, W, H, p) {
    const rise = easeOut(clamp(p / 0.45, 0, 1));
    const open = clamp((p - 0.42) / 0.34, 0, 1);
    const peek = clamp((p - 0.66) / 0.34, 0, 1);
    const cw = Math.min(W * 0.72, 340);
    const ch = cw * 0.68;
    const cx = W / 2;
    const cy = H * lerp(0.92, 0.52, rise);

    // письмо выглядывает из конверта
    if (peek > 0) {
      const lw = cw * 0.86;
      const lh = ch * 1.25;
      const ly = cy - ch * 0.1 - easeOut(peek) * lh * 0.72;
      ctx.save();
      ctx.translate(cx, ly);
      ctx.rotate(Math.sin(this.progress * 0.8) * 0.008);
      ctx.fillStyle = '#FFFDF9';
      ctx.strokeStyle = '#3A1D2E';
      ctx.lineWidth = 3;
      rr(ctx, -lw / 2, -lh / 2, lw, lh, 12);
      ctx.fill();
      ctx.stroke();
      // «строки» письма — намёк на текст, сам текст появится на экране письма
      ctx.fillStyle = 'rgba(110,74,92,.45)';
      for (let i = 0; i < 6; i++) {
        const wdt = lw * (i === 0 ? 0.5 : 0.72 + ((i * 37) % 20) / 100);
        ctx.fillRect(-lw / 2 + 22, -lh / 2 + 30 + i * 22, wdt - 44, 5);
      }
      ctx.fillStyle = '#D6456A';
      ctx.font = `400 ${Math.round(lw * 0.13)}px ${HAND}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.opts.title || 'Для тебя', 0, -lh / 2 + 16);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(this.progress * 0.7) * 0.012);
    // тень
    ctx.fillStyle = 'rgba(58,29,46,.22)';
    rr(ctx, -cw / 2 + 6, -ch / 2 + 10, cw, ch, 14);
    ctx.fill();
    // корпус
    ctx.fillStyle = '#FFF7EE';
    ctx.strokeStyle = '#3A1D2E';
    ctx.lineWidth = 3.5;
    rr(ctx, -cw / 2, -ch / 2, cw, ch, 14);
    ctx.fill();
    ctx.stroke();
    // боковые сгибы
    ctx.strokeStyle = 'rgba(58,29,46,.28)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-cw / 2, -ch / 2);
    ctx.lineTo(0, ch * 0.12);
    ctx.lineTo(cw / 2, -ch / 2);
    ctx.stroke();
    // клапан
    ctx.save();
    ctx.translate(0, -ch / 2);
    ctx.scale(1, Math.max(0.02, Math.cos(open * Math.PI * 0.5)));
    ctx.fillStyle = open > 0.5 ? '#F6E7D8' : '#FFF1E2';
    ctx.strokeStyle = '#3A1D2E';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-cw / 2, 0);
    ctx.lineTo(0, ch * 0.62);
    ctx.lineTo(cw / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // сургучное сердечко
    if (open < 0.55) {
      const a = 1 - open / 0.55;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = '#D6456A';
      ctx.strokeStyle = '#8E2340';
      ctx.lineWidth = 2.5;
      heartPath(ctx, 0, ch * 0.16, 20);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // имя адресата
    ctx.fillStyle = 'rgba(58,29,46,.8)';
    ctx.font = `400 ${Math.round(cw * 0.1)}px ${HAND}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.opts.herName || '', 0, ch * 0.3);
    ctx.restore();

    // подсказка, когда всё открылось
    if (peek > 0.85) {
      const a = (peek - 0.85) / 0.15;
      ctx.globalAlpha = clamp(a * (0.65 + 0.35 * Math.sin(this.progress * 2.6)), 0, 1);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 17px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Нажми, чтобы прочитать', W / 2, Math.min(H - 26, cy + ch * 0.85));
      ctx.globalAlpha = 1;
    }
  }
}

function wingShape(ctx, x, y, s, angle, color) {
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

export { THEMES };
