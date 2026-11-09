import { describe, expect, it } from 'vitest';
import { parseWordList } from './wordlist.js';

describe('parseWordList', () => {
  it('парсит TSV с директивами Anki и HTML', () => {
    const text = '#separator:tab\n#html:true\nhello\tпривет\t<b>Hello</b>, world!&nbsp;\tПривет, мир!\n';
    const { rows, errors } = parseWordList(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { word: 'hello', translation: 'привет', example: 'Hello, world!', example_ru: 'Привет, мир!', tags: '' },
    ]);
  });

  it('CSV с кавычками, запятыми и переносом строки внутри поля', () => {
    const text = 'word,translation,example\n"run, ran","бежать","He said ""run""\nfast"\n';
    const { rows } = parseWordList(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('run, ran');
    expect(rows[0].example).toBe('He said "run" fast');
  });

  it('BOM, CRLF, пустые строки и ошибка на пустом слове с номером строки', () => {
    const text = '﻿cat\tкот\r\n\r\n\tбез слова\r\ndog\tсобака\r\n';
    const { rows, errors } = parseWordList(text);
    expect(rows.map((r) => r.word)).toEqual(['cat', 'dog']);
    expect(errors).toEqual([{ line: 3, reason: 'пустое слово' }]);
  });

  it('140 строк импортируются без ошибок', () => {
    const text = Array.from({ length: 140 }, (_, i) => `word${i}\tслово${i}\tExample ${i}.`).join('\n');
    const { rows, errors } = parseWordList(text);
    expect(rows).toHaveLength(140);
    expect(errors).toHaveLength(0);
  });

  it('экспорт Anki с колонками tags/guid: колонки сопоставляются по директивам', () => {
    const text = '#separator:tab\n#html:true\n#guid column:1\n#tags column:4\nAbC123\trun\tбежать\tverbs b1\n';
    const { rows, errors } = parseWordList(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ word: 'run', translation: 'бежать', example: '', example_ru: '', tags: 'verbs b1' }]);
  });

  it('блочные теги дают пробел, битая сущность не роняет импорт', () => {
    const { rows } = parseWordList('run\tбежать<div>мчаться</div>\tbad &#99999999; ok\n');
    expect(rows[0].translation).toBe('бежать мчаться');
    expect(rows[0].example).toBe('bad &#99999999; ok');
  });

  it('в голом TSV кавычка — обычный символ', () => {
    const { rows, errors } = parseWordList('a\t"Hello\tx\nb\tбэ\nc\tцэ\n');
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.word)).toEqual(['a', 'b', 'c']);
    expect(rows[0].translation).toBe('"Hello');
  });

  it('незакрытая кавычка в CSV: строки не теряются, есть предупреждение с номером строки', () => {
    const { rows, errors } = parseWordList('a,"Hello\nb,бэ\nc,цэ\n');
    expect(rows.map((r) => r.word)).toEqual(['a', 'b', 'c']);
    expect(errors).toEqual([{ line: 1, reason: expect.stringContaining('кавычка не закрыта') }]);
  });

  it('битая кавычка портит только своё поле, остальные строки в кавычках целы', () => {
    const { rows, errors } = parseWordList('"run, ran",бежать\n"go, went",идти\nbad,"Hello\n');
    expect(rows.map((r) => [r.word, r.translation])).toEqual([
      ['run, ran', 'бежать'],
      ['go, went', 'идти'],
      ['bad', '"Hello'],
    ]);
    expect(errors).toEqual([{ line: 3, reason: expect.any(String) }]);
  });

  it('сбалансированные, но кривые кавычки не глотают строки молча', () => {
    const { rows, errors } = parseWordList('a,"Hello\nb,бэ\n"c, d",цэ\ne,е\n');
    expect(rows.map((r) => r.word)).toEqual(['a', 'b', 'c, d', 'e']);
    expect(errors.map((e) => e.line)).toEqual([1]);
  });

  it('TSV из Excel: поле в кавычках с "" раскрывается', () => {
    const { rows } = parseWordList('say\tсказать\t"He said ""hi"""\n');
    expect(rows[0].example).toBe('He said "hi"');
  });


  it('слово "word" в первой строке не считается заголовком, если вторая колонка — не заголовок', () => {
    const { rows } = parseWordList('word\tслово\nfront\tперед\n');
    expect(rows.map((r) => r.word)).toEqual(['word', 'front']);
  });
});
