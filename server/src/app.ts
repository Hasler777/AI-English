import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import type { DB } from './db.js';
import { Service } from './service.js';
import { isGrade } from './srs.js';
import { synthesize, TtsUnavailable } from './tts.js';
import { cleanField, parseWordList } from './wordlist.js';

export interface AppOptions {
  webDist?: string;
  logger?: boolean;
  /** Если задан — все запросы требуют токен (query ?token= один раз, дальше cookie). */
  accessToken?: string;
  allowedHosts?: string[];
}

/** Имя хоста из заголовка Host без порта; IPv6 в скобках. */
function hostName(header: string | undefined): string {
  if (!header) return '';
  const h = header.toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const COOKIE = 'ae_token';

function safeDecode(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return '';
  }
}

export function buildApp(db: DB, opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const svc = new Service(db);
  svc.mistakes.backfillOnce();
  const allowed = new Set(['localhost', ...(opts.allowedHosts ?? []).map(hostName)]);

  app.addHook('onRequest', async (req, reply) => {
    // DNS rebinding: чужой домен, указывающий на 127.0.0.1, не пройдёт — разрешены только IP-адреса,
    // localhost и явно перечисленные имена.
    const host = hostName(req.headers.host);
    if (!allowed.has(host) && !net.isIP(host)) return reply.code(421).send({ error: 'host not allowed' });

    const token = opts.accessToken;
    if (!token) return;
    const cookie = /(?:^|;\s*)ae_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (cookie && safeEqual(safeDecode(cookie), token)) return;
    const q = (req.query as Record<string, unknown> | undefined)?.token;
    if (typeof q === 'string' && safeEqual(q, token)) {
      // Lax: cookie уходит и при переходе по ссылке из мессенджера; чужие POST всё равно не пройдут (JSON + preflight)
      reply.header('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
      if (req.method === 'GET') {
        // убираем токен из адресной строки и истории
        const url = new URL(req.url, 'http://x');
        url.searchParams.delete('token');
        return reply.redirect(url.pathname + url.search, 302);
      }
      return;
    }
    return reply.code(401).type('text/plain; charset=utf-8').send('Нужен токен: открой ссылку вида /?token=…');
  });

  const str = (v: unknown, max: number) => (typeof v === 'string' ? cleanField(v).slice(0, max) : '');

  app.get('/api/today', async () => svc.today());

  app.get('/api/review/next', async () => svc.next());

  app.post('/api/review', async (req, reply) => {
    const { cardId, rating } = (req.body ?? {}) as { cardId?: unknown; rating?: unknown };
    if (!Number.isInteger(cardId) || !isGrade(rating)) {
      return reply.code(400).send({ error: 'нужны cardId (целое) и rating (1–4)' });
    }
    const res = svc.answer(cardId as number, rating);
    if ('error' in res) {
      if (res.error === 'not_found') return reply.code(404).send({ error: 'карточка не найдена' });
      return reply.code(409).send({ error: 'лимит новых слов на сегодня исчерпан' });
    }
    return res;
  });

  app.post('/api/import', async (req, reply) => {
    const { text } = (req.body ?? {}) as { text?: unknown };
    if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: 'пустой файл' });
    const { rows, errors } = parseWordList(text);
    const { added, skipped } = svc.addCards(rows, 'import');
    return { added, skipped, errors, total: rows.length };
  });

  app.post('/api/cards', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = {
      word: str(b.word, 200),
      translation: str(b.translation, 500),
      example: str(b.example, 500),
      example_ru: str(b.example_ru, 500),
      tags: str(b.tags, 200),
    };
    if (!row.word) return reply.code(400).send({ error: 'слово обязательно' });
    const { added, ids } = svc.addCards([row], 'manual');
    if (!added) return reply.code(409).send({ error: 'такое слово уже есть' });
    return { id: ids[0] };
  });

  app.get('/api/mistakes', async () => ({ counts: svc.mistakes.counts(), items: svc.mistakes.list() }));

  app.get('/api/mistakes/next', async () => svc.mistakes.next());

  app.post('/api/mistakes/:id/answer', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { answer } = (req.body ?? {}) as { answer?: unknown };
    if (!Number.isInteger(id) || typeof answer !== 'string' || answer.length > 300) {
      return reply.code(400).send({ error: 'нужен answer (строка до 300 символов)' });
    }
    const res = svc.mistakes.answer(id, answer.trim());
    if ('error' in res && res.error) {
      const msg = { not_found: 'ошибка не найдена', resolved: 'ошибка уже закрыта', done_today: 'сегодня уже отвечено верно' };
      return reply.code(res.error === 'not_found' ? 404 : 409).send({ error: msg[res.error] });
    }
    return res;
  });

  app.put('/api/settings', async (req, reply) => {
    const { newPerDay } = (req.body ?? {}) as { newPerDay?: unknown };
    if (!Number.isInteger(newPerDay) || (newPerDay as number) < 0 || (newPerDay as number) > 500) {
      return reply.code(400).send({ error: 'newPerDay: целое 0–500' });
    }
    svc.setNewPerDay(newPerDay as number);
    return svc.today();
  });

  app.get('/api/tts/:cardId/:field', async (req, reply) => {
    const { cardId, field } = req.params as { cardId: string; field: string };
    if (field !== 'word' && field !== 'example') return reply.code(400).send({ error: 'field: word | example' });
    const card = svc.getCard(Number(cardId));
    if (!card) return reply.code(404).send({ error: 'карточка не найдена' });
    const text = card[field].trim();
    if (!text) return reply.code(404).send({ error: 'нет текста' });
    try {
      const buf = await synthesize(text);
      return reply.type('audio/mpeg').header('Cache-Control', 'no-store').send(buf); // URL не привязан к тексту; диск-кэш на сервере
    } catch (e) {
      if (e instanceof TtsUnavailable) {
        req.log.warn(e.message);
        return reply.code(503).send({ error: 'tts_unavailable', fallback: true });
      }
      throw e;
    }
  });

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
