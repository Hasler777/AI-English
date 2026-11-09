/**
 * Парсер списка слов: TSV/CSV, в т.ч. экспорт Anki «Notes in Plain Text».
 * Колонки: word, translation, [example], [example_ru], [tags].
 */
export interface WordRow {
  word: string;
  translation: string;
  example: string;
  example_ru: string;
  tags: string;
}

export interface ParseResult {
  rows: WordRow[];
  errors: { line: number; reason: string }[];
}

const HEADER_WORDS = new Set(['word', 'english', 'front', 'слово', 'english word']);
const HEADER_TRANSLATIONS = new Set(['translation', 'russian', 'back', 'перевод', 'meaning']);
const MAX_FIELD = 500;

/** Директивы заголовка Anki: #separator:tab, #html:true, #tags column:3, #guid column:1 … */
function readDirectives(text: string) {
  const special = new Map<string, number>(); // имя → номер колонки (с 1)
  let hasDirectives = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#')) break;
    const m = line.match(/^#([\w ]+?)\s*:\s*(.*)$/);
    if (!m) break;
    hasDirectives = true;
    const col = m[1].match(/^(\w+) column$/);
    if (col && /^\d+$/.test(m[2].trim())) special.set(col[1].toLowerCase(), Number(m[2].trim()));
  }
  return { special, hasDirectives };
}

function detectDelimiter(text: string): string {
  const m = text.match(/^#separator:(\w+)/im);
  if (m) {
    const v = m[1].toLowerCase();
    if (v === 'tab') return '\t';
    if (v === 'comma') return ',';
    if (v === 'semicolon') return ';';
    if (v === 'pipe') return '|';
    if (v === 'space') return ' ';
  }
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  if (first.includes('\t')) return '\t';
  if (first.includes(';') && !first.includes(',')) return ';';
  return ',';
}

/**
 * Поле в кавычках: начинается с ", "" внутри = ", закрывающая " стоит прямо перед разделителем/концом строки.
 * Перенос строки внутри — только в multiline-режиме (CSV, экспорт Anki). Если поле не закрылось по этим
 * правилам, возвращаем null — тогда кавычка читается как обычный символ, и портится только это поле.
 */
function readQuoted(text: string, start: number, delim: string, multiline: boolean) {
  let value = '';
  let newlines = 0;
  for (let j = start + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '"') {
      if (text[j + 1] === '"') {
        value += '"';
        j++;
        continue;
      }
      const after = text[j + 1];
      if (after === undefined || after === delim || after === '\n' || after === '\r') {
        return { value, end: j + 1, newlines };
      }
      return null; // кавычка посреди поля
    }
    if (ch === '\n') {
      if (!multiline) return null;
      newlines++;
    }
    value += ch;
  }
  return null; // кавычка не закрыта до конца файла
}

function splitRecords(text: string, delim: string, multiline: boolean) {
  const records: { fields: string[]; line: number }[] = [];
  const badQuoteLines: number[] = [];
  let fields: string[] = [];
  let line = 1;
  let recordLine = 1;
  let i = 0;

  for (;;) {
    let value: string | null = null;
    if (text[i] === '"') {
      const q = readQuoted(text, i, delim, multiline);
      if (q) {
        value = q.value;
        i = q.end;
        line += q.newlines;
      } else badQuoteLines.push(line);
    }
    if (value === null) {
      let j = i;
      while (j < text.length && text[j] !== delim && text[j] !== '\n') j++;
      value = text.slice(i, j).replace(/\r$/, '');
      i = j;
    }
    fields.push(value);

    if (i >= text.length) {
      records.push({ fields, line: recordLine });
      break;
    }
    if (text[i] === delim) {
      i++;
      continue;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    records.push({ fields, line: recordLine });
    fields = [];
    line++;
    recordLine = line;
    if (i >= text.length) break;
  }
  return { records, badQuoteLines };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function cleanField(s: string): string {
  return s
    .replace(/<br\s*\/?>|<\/?(div|p|li|tr|td|ul|ol|h\d)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k]) return ENTITIES[k];
      if (!k.startsWith('#')) return m;
      const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWordList(input: string): ParseResult {
  const text = input.replace(/^\uFEFF/, '');
  const delim = detectDelimiter(text);
  const { special, hasDirectives } = readDirectives(text);
  const rows: WordRow[] = [];
  const errors: ParseResult['errors'] = [];

  // CSV и экспорт Anki: поля в кавычках могут содержать переносы строк. «Голый» TSV (Excel и т.п.):
  // кавычки работают только в пределах строки, а одиночная кавычка в примере — просто символ.
  const multiline = delim !== '\t' || hasDirectives;
  const { records, badQuoteLines } = splitRecords(text, delim, multiline);
  if (multiline) {
    for (const line of badQuoteLines) {
      errors.push({ line, reason: 'кавычка не закрыта — прочитана как обычный текст, проверь строку' });
    }
  }

  const specialCols = new Set([...special.values()].map((n) => n - 1));
  const tagsCol = special.has('tags') ? special.get('tags')! - 1 : -1;

  for (const rec of records) {
    const raw = rec.fields;
    if (raw.length === 1 && raw[0].trim() === '') continue;
    if (raw.length === 1 && /^#[\w ]+:/.test(raw[0])) continue; // директивы Anki

    const f = raw.map(cleanField);
    // обычные колонки по порядку: word, translation, example, example_ru, tags (если tags не задан директивой)
    const plain = f.filter((_, i) => !specialCols.has(i));
    const [word = '', translation = '', example = '', example_ru = '', tagsPlain = ''] = plain;
    const tags = tagsCol >= 0 ? (f[tagsCol] ?? '') : tagsPlain;

    if (
      rows.length === 0 &&
      HEADER_WORDS.has(word.toLowerCase()) &&
      HEADER_TRANSLATIONS.has(translation.toLowerCase())
    )
      continue;
    if (!word) {
      errors.push({ line: rec.line, reason: 'пустое слово' });
      continue;
    }
    if (word.length > 200) {
      errors.push({ line: rec.line, reason: 'слишком длинное слово (>200 символов)' });
      continue;
    }
    const cut = (v: string) => v.slice(0, MAX_FIELD);
    rows.push({ word, translation: cut(translation), example: cut(example), example_ru: cut(example_ru), tags: cut(tags) });
  }
  return { rows, errors };
}
