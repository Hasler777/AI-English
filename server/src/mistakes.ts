import { checkAnswer, type Verdict } from './answer.js';
import type { DB } from './db.js';
import { addDays, localDay } from './time.js';

/** Сколько верных ответов в разные дни нужно, чтобы ошибка ушла из раздела. */
export const STREAK_TO_RESOLVE = 3;
/** При первом запуске этапа 2 «Забыл» за последние N дней переносятся в раздел ошибок. */
const BACKFILL_DAYS = 7;

interface MistakeRow {
  id: number;
  card_id: number;
  type: 'forgot' | 'grammar' | 'pronunciation';
  user_answer: string;
  correct_streak: number;
  last_correct_day: string | null;
  last_attempt_at: string | null;
  times_failed: number;
  created_at: string;
  resolved_at: string | null;
  word: string;
  translation: string;
  example: string;
  example_ru: string;
}

const SELECT_JOINED = `
  SELECT m.*, c.word, c.translation, c.example, c.example_ru
  FROM mistakes m JOIN cards c ON c.id = m.card_id`;

/** Открыта и сегодня ещё не отвечена верно. */
const DUE_WHERE = `m.resolved_at IS NULL AND (m.last_correct_day IS NULL OR m.last_correct_day != ?)`;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Пример с пропуском на месте слова — подсказка, если нет перевода. */
export function blankExample(example: string, word: string): string | null {
  const w = word.replace(/\([^)]*\)/g, ' ').replace(/^\s*(to|a|an|the)\s+/i, '').trim();
  if (!example || !w) return null;
  const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(w)}(?![\\p{L}])`, 'giu');
  return re.test(example) ? example.replace(re, '___') : null;
}

export class Mistakes {
  constructor(private db: DB) {}

  /** «Забыл» в повторении: открыть ошибку или, если уже открыта, сбросить серию. */
  recordForgot(cardId: number, word: string, now: Date) {
    const upd = this.db
      .prepare(
        `UPDATE mistakes SET correct_streak = 0, last_correct_day = NULL, times_failed = times_failed + 1
         WHERE card_id = ? AND type = 'forgot' AND resolved_at IS NULL`,
      )
      .run(cardId);
    if (upd.changes === 0) {
      this.db
        .prepare(`INSERT INTO mistakes (card_id, type, expected, created_at) VALUES (?, 'forgot', ?, ?)`)
        .run(cardId, word, now.toISOString());
    }
  }

  /** Один раз: «Забыл» за последние 7 дней, накопленные до появления раздела, становятся ошибками. */
  backfillOnce(now = new Date()) {
    const done = this.db.prepare(`SELECT 1 FROM settings WHERE key = 'mistakes_backfilled'`).get();
    if (done) return;
    this.db.transaction(() => {
      const since = addDays(localDay(now), -(BACKFILL_DAYS - 1));
      const rows = this.db
        .prepare(
          `SELECT r.card_id, c.word, min(r.reviewed_at) AS first_at, count(*) AS n
           FROM reviews r JOIN cards c ON c.id = r.card_id
           WHERE r.rating = 1 AND r.day >= ?
           GROUP BY r.card_id`,
        )
        .all(since) as { card_id: number; word: string; first_at: string; n: number }[];
      const ins = this.db.prepare(
        `INSERT INTO mistakes (card_id, type, expected, created_at, times_failed)
         VALUES (?, 'forgot', ?, ?, ?) ON CONFLICT DO NOTHING`,
      );
      for (const r of rows) ins.run(r.card_id, r.word, r.first_at, r.n);
      this.db.prepare(`INSERT INTO settings (key, value) VALUES ('mistakes_backfilled', ?)`).run(now.toISOString());
    })();
  }

  counts(now = new Date()) {
    const today = localDay(now);
    const get = (sql: string, ...a: unknown[]) => (this.db.prepare(sql).get(...a) as { c: number }).c;
    return {
      dueToday: get(`SELECT count(*) AS c FROM mistakes m WHERE ${DUE_WHERE}`, today),
      open: get(`SELECT count(*) AS c FROM mistakes WHERE resolved_at IS NULL`),
      resolved: get(`SELECT count(*) AS c FROM mistakes WHERE resolved_at IS NOT NULL`),
    };
  }

  list(now = new Date()) {
    const today = localDay(now);
    const rows = this.db
      .prepare(`${SELECT_JOINED} WHERE m.resolved_at IS NULL ORDER BY m.created_at DESC, m.id DESC`)
      .all() as MistakeRow[];
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      type: r.type,
      // слово не показываем, пока ошибку сегодня не отработали — иначе список подсказывает ответ
      word: r.last_correct_day === today ? r.word : null,
      translation: r.translation,
      streak: r.correct_streak,
      doneToday: r.last_correct_day === today,
      timesFailed: r.times_failed,
      createdAt: r.created_at,
    }));
  }

  /** Следующая ошибка: сначала не тронутые сегодня, только что проваленные — в конец. Ответ не отдаём. */
  next(now = new Date()) {
    const today = localDay(now);
    const r = this.db
      .prepare(
        `${SELECT_JOINED} WHERE ${DUE_WHERE}
         ORDER BY (m.last_attempt_at IS NOT NULL AND m.last_attempt_at >= ?), m.last_attempt_at, m.id LIMIT 1`,
      )
      .get(today, startOfDayIso(now)) as MistakeRow | undefined;
    const counts = this.counts(now);
    if (!r) return { done: true as const, counts };
    const blanked = blankExample(r.example, r.word);
    return {
      done: false as const,
      counts,
      mistake: {
        id: r.id,
        cardId: r.card_id,
        type: r.type,
        // что показываем: перевод; если его нет — пример с пропуском; иначе перевод примера;
        // если нет ничего — пустой prompt, клиент проигрывает слово («напиши, что слышишь»)
        prompt: r.translation || blanked || r.example_ru || '',
        // текст для голоса браузера, если TTS недоступен; только в режиме «на слух», где он и так звучит
        listenText: r.translation || blanked || r.example_ru ? '' : r.word,
        hint: r.translation ? (blanked ?? r.example_ru) : r.example_ru && blanked ? r.example_ru : '',
        streak: r.correct_streak,
        letters: r.word.trim().length,
        firstLetter: r.word.trim()[0] ?? '',
      },
    };
  }

  answer(id: number, answer: string, now = new Date()) {
    return this.db.transaction(() => {
      const r = this.db.prepare(`${SELECT_JOINED} WHERE m.id = ?`).get(id) as MistakeRow | undefined;
      if (!r) return { error: 'not_found' as const };
      if (r.resolved_at) return { error: 'resolved' as const };
      const today = localDay(now);
      if (r.last_correct_day === today) return { error: 'done_today' as const };

      const verdict: Verdict = checkAnswer(answer, r.word);
      const ok = verdict !== 'wrong';
      const streak = ok ? r.correct_streak + 1 : 0;
      const resolved = ok && streak >= STREAK_TO_RESOLVE;
      this.db
        .prepare(
          `UPDATE mistakes SET user_answer = ?, correct_streak = ?, last_correct_day = ?, last_attempt_at = ?,
             times_failed = times_failed + ?, resolved_at = ?
           WHERE id = ?`,
        )
        .run(
          answer,
          streak,
          ok ? today : null,
          now.toISOString(),
          ok ? 0 : 1,
          resolved ? now.toISOString() : null,
          id,
        );
      this.db
        .prepare(`INSERT INTO mistake_attempts (mistake_id, mode, answer, correct, at, day) VALUES (?, 'type', ?, ?, ?, ?)`)
        .run(id, answer, ok ? 1 : 0, now.toISOString(), today);
      return {
        verdict,
        answer,
        expected: r.word,
        translation: r.translation,
        example: r.example,
        example_ru: r.example_ru,
        cardId: r.card_id,
        streak,
        resolved,
      };
    })();
  }
}

function startOfDayIso(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s.toISOString();
}
