import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { Service } from './service.js';

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ word: `w${i}`, translation: `т${i}`, example: '', example_ru: '', tags: '' }));

function setup(n = 30) {
  const svc = new Service(openDb(':memory:'));
  svc.addCards(rows(n), 'import', new Date('2026-11-08T08:00:00'));
  return svc;
}

describe('Service', () => {
  it('дубликаты по слову без учёта регистра пропускаются', () => {
    const svc = setup(2);
    const r = svc.addCards([{ ...rows(1)[0], word: ' W0 ' }], 'manual');
    expect(r).toMatchObject({ added: 0, skipped: [' W0 '] });
  });

  it('выдаёт не больше N новых за день', () => {
    const svc = setup(30);
    svc.setNewPerDay(5);
    const now = new Date('2026-11-08T10:00:00');
    let shownNew = 0;
    for (let i = 0; i < 50; i++) {
      const n = svc.next(now);
      if (n.done) break;
      if (n.isNew) shownNew++;
      svc.answer(n.card.id, Rating.Easy, now); // Easy сразу в Review на дни вперёд
    }
    expect(shownNew).toBe(5);
    expect(svc.today(now).newToday).toBe(0);
    // на следующий день лимит снова доступен
    expect(svc.today(new Date('2026-11-09T10:00:00')).newToday).toBe(5);
  });

  it('«Забыл» возвращает карточку в тот же день, «Хорошо» на выученной растит интервал', () => {
    const svc = setup(1);
    let now = new Date('2026-11-08T10:00:00');
    const first = svc.next(now);
    if (first.done) throw new Error('ожидалась карточка');
    const id = first.card.id;

    const again = svc.answer(id, Rating.Again, now)!;
    expect(new Date(again.dueAt).toDateString()).toBe(now.toDateString());
    // карточка возвращается в очередь (обучение наперёд, когда больше нечего)
    const back = svc.next(now);
    expect(back.done).toBe(false);
    if (!back.done) expect(back.card.id).toBe(id);

    // доводим до Review и смотрим, что интервалы растут
    let prevGap = 0;
    let due = again.dueAt;
    for (let i = 0; i < 6; i++) {
      now = new Date(due);
      const r = svc.answer(id, Rating.Good, now)!;
      due = r.dueAt;
      if (r.state === State.Review) {
        const gap = new Date(due).getTime() - now.getTime();
        expect(gap).toBeGreaterThanOrEqual(prevGap);
        prevGap = gap;
      }
    }
    expect(prevGap).toBeGreaterThan(24 * 3600 * 1000);
  });

  it('серия дней: пропуск сегодняшнего дня не обнуляет, пропуск вчера — обнуляет', () => {
    const svc = setup(3);
    for (const d of ['2026-11-06T12:00:00', '2026-11-07T12:00:00']) {
      const n = svc.next(new Date(d));
      if (!n.done) svc.answer(n.card.id, Rating.Good, new Date(d));
    }
    expect(svc.streak(new Date('2026-11-08T09:00:00'))).toBe(2);
    expect(svc.streak(new Date('2026-11-09T09:00:00'))).toBe(0);
  });

  it('счётчик «Повторить» совпадает с очередью: Review-карточка вечером видна утром', () => {
    const svc = setup(1);
    const id = (svc.next(new Date('2026-11-07T21:00:00')) as { card: { id: number } }).card.id;
    // доводим до Review с интервалом ≥ 1 дня
    let r = svc.answer(id, Rating.Easy, new Date('2026-11-07T21:00:00'));
    if ('error' in r) throw new Error(r.error);
    const due = new Date(r.dueAt);
    // утро того дня, на который назначено повторение, раньше точного времени
    const morning = new Date(due);
    morning.setHours(0, 30, 0, 0);
    if (morning >= due) return; // повтор назначен на полночь — проверять нечего
    expect(svc.today(morning).toReview).toBe(1);
    const n = svc.next(morning);
    expect(n.done).toBe(false);
  });

  it('answer() не даёт обойти лимит новых, next() отдаёт список следующих карточек', () => {
    const svc = setup(5);
    svc.setNewPerDay(1);
    const now = new Date('2026-11-08T10:00:00');
    const n = svc.next(now);
    if (n.done) throw new Error('ожидалась карточка');
    expect(n.upcoming).toEqual([]); // лимит 1 — следующих новых нет
    svc.answer(n.card.id, Rating.Easy, now);
    expect(svc.answer(n.card.id + 1, Rating.Good, now)).toEqual({ error: 'new_limit' });
    svc.setNewPerDay(10);
    const m = svc.next(now);
    if (m.done) throw new Error('ожидалась карточка');
    expect(m.upcoming.map((u) => u.id)).toEqual([m.card.id + 1, m.card.id + 2, m.card.id + 3]);
  });
});
