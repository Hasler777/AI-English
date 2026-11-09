import type { Grade } from 'ts-fsrs';
import { Rating, State } from 'ts-fsrs';
import type { DB } from './db.js';
import { Mistakes } from './mistakes.js';
import { emptyCard, parseCard, previewDue, schedule, serializeCard } from './srs.js';
import { addDays, endOfLocalDay, localDay } from './time.js';
import type { WordRow } from './wordlist.js';

export const DEFAULT_NEW_PER_DAY = 20;
/** Карточки на шагах обучения, которые созреют в ближайшие N минут, показываем заранее, когда больше нечего. */
const LEARN_AHEAD_MS = 20 * 60 * 1000;

export interface CardRow {
  id: number;
  word: string;
  translation: string;
  example: string;
  example_ru: string;
  tags: string;
  source: string;
  created_at: string;
  fsrs: string;
  state: number;
  due_at: string;
}

export type PublicCard = Omit<CardRow, 'fsrs'>;

function toPublic({ fsrs: _f, ...rest }: CardRow): PublicCard {
  return rest;
}

export class Service {
  readonly mistakes: Mistakes;

  constructor(private db: DB) {
    this.mistakes = new Mistakes(db);
  }

  // ---------- settings ----------
  getNewPerDay(): number {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key = 'new_per_day'`).get() as
      | { value: string }
      | undefined;
    const n = r ? Number(r.value) : DEFAULT_NEW_PER_DAY;
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_NEW_PER_DAY;
  }

  setNewPerDay(n: number) {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('new_per_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(String(n));
  }

  // ---------- cards ----------
  /** Добавляет карточки; дубликаты по слову (без учёта регистра) пропускаются. */
  addCards(rows: WordRow[], source: 'import' | 'manual', now = new Date()) {
    const insert = this.db.prepare(
      `INSERT INTO cards (word, translation, example, example_ru, tags, source, created_at, fsrs, state, due_at)
       VALUES (@word, @translation, @example, @example_ru, @tags, @source, @created_at, @fsrs, 0, @due_at)
       ON CONFLICT DO NOTHING`,
    );
    const fsrs = serializeCard(emptyCard(now));
    const created_at = now.toISOString();
    const skipped: string[] = [];
    let added = 0;
    const ids: number[] = [];
    this.db.transaction(() => {
      for (const r of rows) {
        const res = insert.run({ ...r, source, created_at, fsrs, due_at: created_at });
        if (res.changes === 1) {
          added++;
          ids.push(Number(res.lastInsertRowid));
        } else skipped.push(r.word);
      }
    })();
    return { added, skipped, ids };
  }

  getCard(id: number): CardRow | undefined {
    return this.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id) as CardRow | undefined;
  }

  // ---------- daily counters ----------
  private newIntroducedOn(day: string): number {
    return (
      this.db.prepare(`SELECT count(*) AS c FROM reviews WHERE day = ? AND state_before = ?`).get(day, State.New) as {
        c: number;
      }
    ).c;
  }

  private newRemaining(now: Date): number {
    return Math.max(0, this.getNewPerDay() - this.newIntroducedOn(localDay(now)));
  }

  streak(now = new Date()): number {
    const days = new Set(
      (this.db.prepare(`SELECT DISTINCT day FROM reviews ORDER BY day DESC LIMIT 1000`).all() as { day: string }[]).map(
        (r) => r.day,
      ),
    );
    let day = localDay(now);
    if (!days.has(day)) day = addDays(day, -1); // сегодня ещё не занимался — серия не сгорела
    let n = 0;
    while (days.has(day)) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  today(now = new Date()) {
    const eod = endOfLocalDay(now).toISOString();
    const toReview = (
      this.db.prepare(`SELECT count(*) AS c FROM cards WHERE state != ? AND due_at <= ?`).get(State.New, eod) as {
        c: number;
      }
    ).c;
    const newAvailable = (
      this.db.prepare(`SELECT count(*) AS c FROM cards WHERE state = ?`).get(State.New) as { c: number }
    ).c;
    const totalCards = (this.db.prepare(`SELECT count(*) AS c FROM cards`).get() as { c: number }).c;
    const reviewedToday = (
      this.db.prepare(`SELECT count(*) AS c FROM reviews WHERE day = ?`).get(localDay(now)) as { c: number }
    ).c;
    return {
      toReview,
      newToday: Math.min(newAvailable, this.newRemaining(now)),
      newAvailable,
      newPerDay: this.getNewPerDay(),
      reviewedToday,
      totalCards,
      streak: this.streak(now),
      mistakesToday: this.mistakes.counts(now).dueToday,
    };
  }

  // ---------- review queue ----------
  /**
   * Очередь в порядке показа:
   * 1) созревшие: Learning/Relearning — по точному времени, Review — до конца локального дня (как в Anki,
   *    чтобы счётчик «Повторить» на главной совпадал с очередью);
   * 2) новые — в пределах дневного лимита;
   * 3) Learning/Relearning, которые созреют в ближайшие 20 минут (когда больше нечего).
   */
  private queue(now: Date, limit: number): CardRow[] {
    const nowIso = now.toISOString();
    const eod = endOfLocalDay(now).toISOString();
    const out = this.db
      .prepare(
        `SELECT * FROM cards
         WHERE (state IN (?, ?) AND due_at <= ?) OR (state = ? AND due_at <= ?)
         ORDER BY due_at, id LIMIT ?`,
      )
      .all(State.Learning, State.Relearning, nowIso, State.Review, eod, limit) as CardRow[];
    const newLeft = Math.min(this.newRemaining(now), limit - out.length);
    if (newLeft > 0) {
      out.push(
        ...(this.db.prepare(`SELECT * FROM cards WHERE state = ? ORDER BY id LIMIT ?`).all(State.New, newLeft) as CardRow[]),
      );
    }
    if (out.length < limit) {
      const ahead = new Date(now.getTime() + LEARN_AHEAD_MS).toISOString();
      const seen = new Set(out.map((r) => r.id));
      const more = this.db
        .prepare(`SELECT * FROM cards WHERE state IN (?, ?) AND due_at <= ? ORDER BY due_at, id LIMIT ?`)
        .all(State.Learning, State.Relearning, ahead, limit) as CardRow[];
      for (const r of more) if (!seen.has(r.id) && out.length < limit) out.push(r);
    }
    return out;
  }

  /** Следующая карточка + несколько за ней (только для подгрузки аудио заранее). */
  next(now = new Date()) {
    const [row, ...rest] = this.queue(now, 4);
    if (!row) {
      const nextDue = this.db
        .prepare(`SELECT min(due_at) AS d FROM cards WHERE state != ?`)
        .get(State.New) as { d: string | null };
      return { done: true as const, nextDueAt: nextDue.d, today: this.today(now) };
    }
    return {
      done: false as const,
      card: toPublic(row),
      isNew: row.state === State.New,
      previews: previewDue(parseCard(row.fsrs), now),
      upcoming: rest.map((r) => ({ id: r.id, hasExample: !!r.example.trim() })),
      today: this.today(now),
    };
  }

  answer(cardId: number, grade: Grade, now = new Date()) {
    return this.db.transaction(() => {
      const row = this.getCard(cardId);
      if (!row) return { error: 'not_found' as const };
      if (row.state === State.New && this.newRemaining(now) === 0) return { error: 'new_limit' as const };
      const before = parseCard(row.fsrs);
      const { card } = schedule(before, grade, now);
      const dueIso = card.due.toISOString();
      this.db
        .prepare(`UPDATE cards SET fsrs = ?, state = ?, due_at = ? WHERE id = ?`)
        .run(serializeCard(card), card.state, dueIso, cardId);
      this.db
        .prepare(
          `INSERT INTO reviews (card_id, rating, mode, state_before, due_at, stability, difficulty, reviewed_at, day)
           VALUES (?, ?, 'recognize', ?, ?, ?, ?, ?, ?)`,
        )
        .run(cardId, grade, row.state, dueIso, card.stability, card.difficulty, now.toISOString(), localDay(now));
      if (grade === Rating.Again) this.mistakes.recordForgot(cardId, row.word, now);
      return { dueAt: dueIso, state: card.state };
    })();
  }
}
