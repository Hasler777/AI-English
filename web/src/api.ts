export interface Today {
  toReview: number;
  newToday: number;
  newAvailable: number;
  newPerDay: number;
  reviewedToday: number;
  totalCards: number;
  streak: number;
  mistakesToday: number;
}

export interface Card {
  id: number;
  word: string;
  translation: string;
  example: string;
  example_ru: string;
  tags: string;
  state: number;
  due_at: string;
}

export type Grade = 1 | 2 | 3 | 4;

export type NextResponse =
  | { done: true; nextDueAt: string | null; today: Today }
  | {
      done: false;
      card: Card;
      isNew: boolean;
      previews: Record<Grade, string>;
      upcoming: { id: number; hasExample: boolean }[];
      today: Today;
    };

export interface ImportResult {
  added: number;
  skipped: string[];
  errors: { line: number; reason: string }[];
  total: number;
}

export interface MistakeCounts {
  dueToday: number;
  open: number;
  resolved: number;
}

export interface MistakeListItem {
  id: number;
  cardId: number;
  type: 'forgot' | 'grammar' | 'pronunciation';
  /** null, пока ошибку сегодня не отработали — чтобы список не подсказывал ответ */
  word: string | null;
  translation: string;
  streak: number;
  doneToday: boolean;
  timesFailed: number;
  createdAt: string;
}

export type MistakeNext =
  | { done: true; counts: MistakeCounts }
  | {
      done: false;
      counts: MistakeCounts;
      mistake: {
        id: number;
        cardId: number;
        type: string;
        prompt: string;
        hint: string;
        listenText: string;
        streak: number;
        letters: number;
        firstLetter: string;
      };
    };

export interface MistakeAnswer {
  verdict: 'correct' | 'typo' | 'wrong';
  answer: string;
  expected: string;
  translation: string;
  example: string;
  example_ru: string;
  cardId: number;
  streak: number;
  resolved: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  today: () => req<Today>('/api/today'),
  next: () => req<NextResponse>('/api/review/next'),
  answer: (cardId: number, rating: Grade) =>
    req<{ dueAt: string }>('/api/review', { method: 'POST', body: JSON.stringify({ cardId, rating }) }),
  import: (text: string) => req<ImportResult>('/api/import', { method: 'POST', body: JSON.stringify({ text }) }),
  addCard: (c: { word: string; translation: string; example: string; example_ru: string }) =>
    req<{ id: number }>('/api/cards', { method: 'POST', body: JSON.stringify(c) }),
  mistakes: () => req<{ counts: MistakeCounts; items: MistakeListItem[] }>('/api/mistakes'),
  mistakeNext: () => req<MistakeNext>('/api/mistakes/next'),
  mistakeAnswer: (id: number, answer: string) =>
    req<MistakeAnswer>(`/api/mistakes/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) }),
  setNewPerDay: (newPerDay: number) =>
    req<Today>('/api/settings', { method: 'PUT', body: JSON.stringify({ newPerDay }) }),
};
