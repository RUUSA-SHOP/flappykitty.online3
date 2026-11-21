/* Дополнительный запуск кода игры в jsdom и растровом canvas, не заменяет браузер. */
import assert from 'node:assert/strict';
import { makeEnv } from './dom-env.mjs';
import { CONFIG } from '../assets/js/config.js';
const env = await makeEnv({ url: 'http://test.local/subfolder/play.html?dev=1' });
try {
  await env.run(200);
  assert.equal(env.screen(), 'menu');
  env.click('#btnPlay');
  assert.equal(env.screen(), 'play');
  assert.equal(env.sim().status, 'playing');
  await env.run(500);
  env.fk().showWin();
  assert.equal(env.screen(), 'win');
  env.fk().showNote();
  assert.equal(env.screen(), 'note');
  env.fk().startFinale({ stars: 3, earned: 15 });
  // Изменение размера сбрасывает преобразование холста, финал обязан его восстановить.
  env.canvas().width = env.canvas().width;
  env.tick(50);
  assert.ok(Math.abs(env.fk().renderer.ctx.getTransform().a - env.fk().renderer.k) < 0.00001);
  await env.run(12000, 50);
  assert.equal(env.screen(), 'letter');
  assert.equal(env.text('#letterTitle2'), CONFIG.finalLetter.title);
  assert.equal([...env.document.querySelectorAll('#letterText p')].map(p => p.textContent).join('\n\n'), CONFIG.finalLetter.text.trim());
  env.fk().showCredits();
  assert.equal(env.screen(), 'credits');
  env.click('#btnPostcard');
  assert.equal(env.hidden('#postcardLink'), false);
  env.click('#postcardClose');
  assert.equal(env.hidden('#postcardLink'), true);
  console.log('✓ Запуск меню, полёта, победы, записки, финала, письма и титров в jsdom + canvas.');
} finally { env.restore(); env.window.close(); }
process.exit(0);
