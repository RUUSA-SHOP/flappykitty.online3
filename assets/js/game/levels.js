/* Уровни сюжетного режима и облики Мии.
   Чтобы добавить уровень — допиши объект в LEVELS и тему в themes.js. */

export const WORLD = {
  H: 720, // высота игрового мира в условных пикселях
  GROUND: 660, // линия пола
  GRAVITY: 1300,
  FLAP: -390,
  MAX_FALL: 560,
  RADIUS: 20, // радиус «хитбокса» Мии — честный и чуть меньше картинки
  GATE_W: 78,
};

export const LEVELS = [
  {
    id: 1,
    theme: 'living',
    name: 'Гостиная',
    tagline: 'Первый полёт',
    story: 'Мия обнаружила, что умеет летать. Когтеточки в шоке.',
    gates: 10,
    speed: 165,
    gap: 218,
    spacing: 315,
    move: 0,
    hazards: [],
    powerups: ['shield'],
    // «момент уровня»: короткая сцена у самого финиша, на прохождение не влияет
    moment: { kind: 'plush', at: 0.8 },
  },
  {
    id: 2,
    theme: 'kitchen',
    name: 'Кухня',
    tagline: 'Операция «Кран»',
    story: 'Вода из-под крана — лучшая вода. Но капли лучше облетать.',
    gates: 13,
    speed: 175,
    gap: 208,
    spacing: 310,
    move: 0,
    hazards: ['drop'],
    powerups: ['shield', 'magnet'],
    moment: { kind: 'faucet', at: 0.8 },
  },
  {
    id: 3,
    theme: 'party',
    name: 'День рождения',
    tagline: 'Торт, свечи, шарики',
    story: 'Свечи качаются, шарики лопаются — и из них сыплются сердечки.',
    gates: 15,
    speed: 185,
    gap: 204,
    spacing: 305,
    move: 34,
    hazards: ['balloon'],
    powerups: ['magnet', 'catnip'],
    moment: { kind: 'candles', at: 0.8 },
  },
  {
    id: 4,
    theme: 'night',
    name: 'Ночной город',
    tagline: 'Ночной дозор',
    story: 'Город спит, Мия дежурит. Осторожно: в небе замечены огурцы.',
    gates: 17,
    speed: 198,
    gap: 198,
    spacing: 300,
    move: 0,
    hazards: ['cucumber'],
    powerups: ['shield', 'magnet', 'catnip'],
    moment: { kind: 'fireworks', at: 0.8 },
  },
  {
    id: 5,
    theme: 'winter',
    name: 'Зимняя сказка',
    tagline: 'Против ветра',
    story: 'Льдинки, снег и порывы ветра. Следи за стрелками.',
    gates: 19,
    speed: 205,
    gap: 200,
    spacing: 305,
    move: 44,
    hazards: ['wind'],
    powerups: ['shield', 'magnet', 'catnip'],
    moment: { kind: 'aurora', at: 0.8 },
  },
  {
    id: 6,
    theme: 'love',
    name: 'Дорога к Насте',
    tagline: 'Финал',
    story: 'Последний перелёт. Там, в конце, ждёт самое главное сердце.',
    gates: 24,
    speed: 212,
    gap: 196,
    spacing: 300,
    move: 40,
    hazards: ['balloon', 'cucumber'],
    powerups: ['shield', 'magnet', 'catnip'],
    moment: { kind: 'bloom', at: 0.86 },
  },
];

/** Параметры бесконечного режима: сложность растёт с каждыми воротами. */
export function endlessParams(passed) {
  const k = Math.min(1, passed / 45);
  const themes = ['living', 'kitchen', 'party', 'night', 'winter', 'love'];
  return {
    theme: themes[Math.floor(passed / 10) % themes.length],
    speed: 172 + 70 * k,
    gap: 205 - 50 * k,
    spacing: 305 - 25 * k,
    move: passed > 12 ? Math.min(50, (passed - 12) * 2.5) : 0,
    hazards: passed > 30 ? ['cucumber', 'balloon'] : passed > 8 ? ['balloon'] : [],
    powerups: ['shield', 'magnet', 'catnip'],
  };
}

/** Облики. w — ширина спрайта в мире, ax/ay — точка «центра головы» (0..1). */
export const SKINS = [
  { id: 'super', name: 'Супер-Мия', hint: 'Дождевик, лапы вперёд', price: 0, src: 'assets/img/skins/super.webp', w: 124, ax: 0.6, ay: 0.36, wings: [0.36, 0.5] },
  { id: 'hood', name: 'Капюшон', hint: 'Смотрю только вперёд', price: 40, src: 'assets/img/skins/hood.webp', w: 82, ax: 0.5, ay: 0.5, wings: [0.2, 0.62] },
  { id: 'eyes', name: 'Глазки', hint: 'Запрещённый приём', price: 80, src: 'assets/img/skins/eyes.webp', w: 80, ax: 0.5, ay: 0.52, wings: [0.14, 0.6] },
  { id: 'frog', name: 'Лягушка', hint: 'Ква', price: 120, src: 'assets/img/skins/frog.webp', w: 76, ax: 0.5, ay: 0.6, wings: [0.14, 0.7] },
  { id: 'face', name: 'Просто Мия', hint: 'Без фильтров', price: 160, src: 'assets/img/skins/face.webp', w: 84, ax: 0.5, ay: 0.5, wings: [0.1, 0.55] },
  { id: 'wink', name: 'Хитрюга', hint: 'Я всё вижу', price: 220, src: 'assets/img/skins/wink.webp', w: 80, ax: 0.5, ay: 0.5, wings: [0.1, 0.55] },
];

export const POWERUPS = {
  shield: { name: 'Пузырь', desc: 'спасает от одного удара', color: '#8FD3F4' },
  magnet: { name: 'Магнит', desc: 'сердечки летят сами', color: '#7FB7E6', time: 7 },
  catnip: { name: 'Кошачья мята', desc: 'Мия неуязвима', color: '#8FD17F', time: 5 },
};
