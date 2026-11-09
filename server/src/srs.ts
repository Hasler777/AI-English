import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';

// fuzz выключен: подписи на кнопках (previewDue) должны совпадать с тем, что реально сохранится
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9 }));

export const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

export function isGrade(n: unknown): n is Grade {
  return typeof n === 'number' && (GRADES as readonly number[]).includes(n);
}

export function emptyCard(now: Date): Card {
  return createEmptyCard(now);
}

export function serializeCard(c: Card): string {
  return JSON.stringify(c);
}

export function parseCard(json: string): Card {
  const o = JSON.parse(json);
  return {
    ...o,
    due: new Date(o.due),
    last_review: o.last_review ? new Date(o.last_review) : undefined,
  };
}

export function schedule(card: Card, grade: Grade, now: Date) {
  return scheduler.next(card, now, grade);
}

/** Когда карточка вернётся при каждой из 4 оценок — для подписей на кнопках. */
export function previewDue(card: Card, now: Date): Record<Grade, string> {
  const p = scheduler.repeat(card, now);
  return {
    [Rating.Again]: p[Rating.Again].card.due.toISOString(),
    [Rating.Hard]: p[Rating.Hard].card.due.toISOString(),
    [Rating.Good]: p[Rating.Good].card.due.toISOString(),
    [Rating.Easy]: p[Rating.Easy].card.due.toISOString(),
  } as Record<Grade, string>;
}
