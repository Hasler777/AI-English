/**
 * Проверка ответа, введённого с клавиатуры. Без LLM: нормализация + допуск одной опечатки в длинных словах.
 */

const ARTICLE_OR_TO = /^(to|a|an|the)\s+/;
/** Опечатку (1 правка) прощаем, только если и ответ, и правильная форма (без артикля/to) не короче этого. */
const TYPO_MIN_LEN = 5;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ') // пунктуацию — в пробел (кроме апострофа и дефиса)
    .replace(/\s+/g, ' ')
    .trim();
}

const core = (s: string) => s.replace(ARTICLE_OR_TO, '');

/** Слова, с которыми запятая — пунктуация фразы («no, thanks», «well, actually»), а не список форм. */
const PHRASE_WORDS = new Set([
  'no', 'yes', 'well', 'please', 'thanks', 'thank', 'oh', 'so', 'ok', 'okay', 'sure', 'sorry',
  'hi', 'hello', 'bye', 'actually', 'yeah', 'right', 'now', 'then', 'anyway', 'however',
]);

/** Пометки в скобках словарной записи: плейсхолдеры, части речи, стиль. Это не словоформы. */
const PAREN_LABELS = new Set([
  'sb', 'sth', 'smb', 'smth', 'someone', 'something', "one's", 'oneself',
  'n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'phr', 'noun', 'verb', 'adjective', 'adverb',
  'informal', 'formal', 'colloq', 'slang', 'uk', 'us', 'am', 'br', 'pl', 'sing', 'esp',
]);

/** «run, ran, run» — список словоформ: каждая часть ровно одно слово и не служебное слово фразы. */
function wordFormList(s: string): string[] | null {
  const parts = s.split(',').map(normalize);
  if (parts.length < 2) return null;
  const ok = parts.every((p) => p && !p.includes(' ') && !PHRASE_WORDS.has(p));
  return ok ? parts : null;
}

/**
 * Варианты правильного ответа для словарных записей:
 *   «run (ran, run)», «look after (smb)» — скобки необязательны; формы в скобках принимаются,
 *     если это список словоформ;
 *   «get on / get along», «a; b» — любая из частей;
 *   «run, ran» — любая часть, но только если это список словоформ; «excuse me, please» — только целиком;
 *   ведущие to/a/an/the — необязательны.
 */
export function acceptedForms(expected: string): string[] {
  const noParens = expected.replace(/\([^)]*\)/g, ' ');
  const parts: string[] = [expected, noParens];
  for (const alt of noParens.split(/[/;]/)) {
    parts.push(alt);
    parts.push(...(wordFormList(alt) ?? []));
  }
  // формы в скобках — только у однословной записи («go (went, gone)»), а не у фразовых глаголов
  // («look after (sb, sth)»), и без пометок вроде sth / adj / informal
  if (!core(normalize(noParens)).includes(' ')) {
    for (const m of expected.matchAll(/\(([^)]*)\)/g)) {
      const forms = wordFormList(m[1]) ?? [];
      if (forms.every((f) => f.length >= 2 && !PAREN_LABELS.has(f.replace(/\.$/, '')))) parts.push(...forms);
    }
  }

  const out = new Set<string>();
  for (const p of parts) {
    const n = normalize(p);
    if (!n) continue;
    out.add(n);
    out.add(core(n));
  }
  return [...out].filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export type Verdict = 'correct' | 'typo' | 'wrong';

/** typo = одна буква не та / лишняя / пропущена; засчитываем, но показываем правильное. */
export function checkAnswer(answer: string, expected: string): Verdict {
  const raw = normalize(answer);
  if (!raw) return 'wrong';
  const forms = acceptedForms(expected);
  if (forms.includes(raw) || forms.includes(core(raw))) return 'correct';
  const a = core(raw);
  for (const f of forms) {
    const fc = core(f);
    if (a.length >= TYPO_MIN_LEN && fc.length >= TYPO_MIN_LEN && levenshtein(a, fc) === 1) return 'typo';
  }
  return 'wrong';
}
