import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { blankExample } from './mistakes.js';
import { Service } from './service.js';

function setup() {
  const svc = new Service(openDb(':memory:'));
  svc.addCards(
    [
      { word: 'borrow', translation: 'занимать', example: 'Can I borrow your pen?', example_ru: 'Можно ручку?', tags: '' },
      { word: 'delay', translation: 'задержка', example: '', example_ru: '', tags: '' },
    ],
    'import',
    new Date('2026-11-01T08:00:00'),
  );
  return svc;
}

const at = (s: string) => new Date(s);

describe('Mistakes', () => {
  it('«Забыл» создаёт одну открытую ошибку; повторное «Забыл» сбрасывает серию, а не дублирует', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    svc.answer(1, Rating.Again, at('2026-11-08T10:05:00'));
    const list = svc.mistakes.list(at('2026-11-08T11:00:00'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ word: null, translation: 'занимать', streak: 0, timesFailed: 2 });
    expect(svc.today(at('2026-11-08T11:00:00')).mistakesToday).toBe(1);
  });

  it('закрывается после 3 верных ответов в разные дни; второй верный в тот же день не засчитывается', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    const id = svc.mistakes.list()[0].id;

    expect(svc.mistakes.answer(id, 'borrow', at('2026-11-08T12:00:00'))).toMatchObject({ verdict: 'correct', streak: 1 });
    expect(svc.mistakes.next(at('2026-11-08T12:01:00')).done).toBe(true); // на сегодня с ней всё
    expect(svc.mistakes.answer(id, 'borrow', at('2026-11-08T13:00:00'))).toEqual({ error: 'done_today' });

    expect(svc.mistakes.answer(id, 'borow', at('2026-11-09T12:00:00'))).toMatchObject({ verdict: 'typo', streak: 2 });
    const last = svc.mistakes.answer(id, 'to borrow', at('2026-11-10T12:00:00'));
    expect(last).toMatchObject({ streak: 3, resolved: true });
    expect(svc.mistakes.counts(at('2026-11-10T12:00:00'))).toEqual({ dueToday: 0, open: 0, resolved: 1 });

    // забыл снова после закрытия — новая открытая ошибка
    svc.answer(1, Rating.Again, at('2026-11-20T10:00:00'));
    expect(svc.mistakes.counts(at('2026-11-20T10:00:00'))).toMatchObject({ open: 1, resolved: 1 });
  });

  it('неверный ответ обнуляет серию и отправляет ошибку в конец сегодняшней очереди', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    svc.answer(2, Rating.Again, at('2026-11-08T10:01:00'));
    const first = svc.mistakes.next(at('2026-11-08T11:00:00'));
    if (first.done) throw new Error('ожидалась ошибка');
    expect(first.mistake.cardId).toBe(1);
    expect(svc.mistakes.answer(first.mistake.id, 'lend', at('2026-11-08T11:00:00'))).toMatchObject({
      verdict: 'wrong',
      streak: 0,
      expected: 'borrow',
    });
    const second = svc.mistakes.next(at('2026-11-08T11:01:00'));
    if (second.done) throw new Error('ожидалась ошибка');
    expect(second.mistake.cardId).toBe(2);
  });

  it('«Забыл» в повторении после верного ответа сегодня возвращает ошибку в очередь', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    const id = svc.mistakes.list()[0].id;
    svc.mistakes.answer(id, 'borrow', at('2026-11-08T11:00:00'));
    svc.answer(1, Rating.Again, at('2026-11-08T12:00:00'));
    expect(svc.mistakes.counts(at('2026-11-08T12:00:00')).dueToday).toBe(1);
  });

  it('next() не раскрывает ответ, подсказка — пример с пропуском', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    const n = svc.mistakes.next(at('2026-11-08T11:00:00'));
    if (n.done) throw new Error('ожидалась ошибка');
    expect(n.mistake.prompt).toBe('занимать');
    expect(n.mistake.hint).toBe('Can I ___ your pen?');
    expect(JSON.stringify(n.mistake)).not.toContain('borrow');
  });

  it('backfill: «Забыл» за последние 7 дней до появления раздела переносятся один раз', () => {
    const db = openDb(':memory:');
    const svc = new Service(db);
    svc.addCards([{ word: 'old', translation: 'старый', example: '', example_ru: '', tags: '' }], 'import', at('2026-10-01T08:00:00'));
    svc.addCards([{ word: 'fresh', translation: 'свежий', example: '', example_ru: '', tags: '' }], 'import', at('2026-10-01T08:00:00'));
    svc.answer(1, Rating.Again, at('2026-10-20T10:00:00'));
    svc.answer(2, Rating.Again, at('2026-11-05T10:00:00'));
    db.exec('DELETE FROM mistakes'); // как будто раздела ещё не было
    svc.mistakes.backfillOnce(at('2026-11-08T10:00:00'));
    svc.mistakes.backfillOnce(at('2026-11-08T10:00:00'));
    expect(svc.mistakes.list(at('2026-11-08T10:00:00')).map((m) => m.translation)).toEqual(['свежий']);
  });

  it('список показывает слово только после верного ответа сегодня', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    const id = svc.mistakes.list(at('2026-11-08T10:00:00'))[0].id;
    svc.mistakes.answer(id, 'borrow', at('2026-11-08T11:00:00'));
    expect(svc.mistakes.list(at('2026-11-08T11:00:00'))[0].word).toBe('borrow');
    expect(svc.mistakes.list(at('2026-11-09T09:00:00'))[0].word).toBeNull();
  });

  it('карточка без перевода и примеров — задание на слух', () => {
    const svc = new Service(openDb(':memory:'));
    svc.addCards([{ word: 'luggage', translation: '', example: '', example_ru: '', tags: '' }], 'import');
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    const n = svc.mistakes.next(at('2026-11-08T11:00:00'));
    if (n.done) throw new Error('ожидалась ошибка');
    expect(n.mistake).toMatchObject({ prompt: '', listenText: 'luggage' });
  });

  it('«Хорошо» в повторении не трогает ошибку, а 409 по лимиту новых не создаёт её', () => {
    const svc = setup();
    svc.answer(1, Rating.Again, at('2026-11-08T10:00:00'));
    svc.answer(1, Rating.Good, at('2026-11-08T10:20:00'));
    expect(svc.mistakes.counts(at('2026-11-08T10:30:00')).open).toBe(1);
    svc.setNewPerDay(1);
    expect(svc.answer(2, Rating.Again, at('2026-11-08T10:40:00'))).toEqual({ error: 'new_limit' });
    expect(svc.mistakes.counts(at('2026-11-08T10:40:00')).open).toBe(1);
  });

  it('blankExample: целое слово, без учёта регистра, не внутри другого слова', () => {
    expect(blankExample('Can I borrow it?', 'to borrow')).toBe('Can I ___ it?');
    expect(blankExample('Borrow it. I borrowed it.', 'borrow')).toBe('___ it. I borrowed it.');
    expect(blankExample('No match here', 'borrow')).toBeNull();
  });
});
