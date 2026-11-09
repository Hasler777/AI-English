import { describe, expect, it } from 'vitest';
import { checkAnswer } from './answer.js';

describe('checkAnswer', () => {
  it.each([
    ['Borrow', 'borrow', 'correct'],
    ['  boarding   pass ', 'boarding pass', 'correct'],
    ['borrow', 'to borrow', 'correct'],
    ['to borrow', 'borrow', 'correct'],
    ['an apple', 'apple', 'correct'],
    ['I’m fine', "I'm fine.", 'correct'],
    ['ran', 'run / ran', 'correct'],
    ['run, ran', 'run, ran', 'correct'],
    ['luggege', 'luggage', 'typo'],
    ['receit', 'receipt', 'typo'],
    ['cat', 'car', 'wrong'], // короткие слова — без допуска на опечатку
    ['delays', 'delay', 'typo'],
    ['already', 'yesterday', 'wrong'],
    ['', 'apple', 'wrong'],
    ['!!!', 'apple', 'wrong'],
    ['the car', 'the cat', 'wrong'], // артикль не делает короткое слово «длинным»
    ['to rux', 'to run', 'wrong'],
    ['were', 'where', 'wrong'], // ответ короче 5 — без допуска
    ['run', 'run, ran', 'correct'],
    ['run', 'run (ran, run)', 'correct'],
    ['look after', 'look after (smb)', 'correct'],
    ['look after smb', 'look after (smb)', 'correct'],
    ['get along', 'get on / get along', 'correct'],
    ['ran', 'run (ran, run)', 'correct'],
    ['ran', 'run, ran, run', 'correct'],
    ['thanks', 'no, thanks', 'wrong'], // фраза: кусок не засчитывается
    ['no thanks', 'no, thanks', 'correct'],
    ['please', 'excuse me, please', 'wrong'],
    ['i do', 'yes, I do', 'wrong'],
    ['well', 'well, actually', 'wrong'],
    ['sth', 'look after (sb, sth)', 'wrong'], // пометки в скобках — не ответ
    ['adj', 'cool (adj, informal)', 'wrong'],
    ['n', 'run (n, v)', 'wrong'],
    ['went', 'go (went, gone)', 'correct'],
    ['look after', 'look after (sb, sth)', 'correct'],
  ])('%s vs %s → %s', (answer, expected, verdict) => {
    expect(checkAnswer(answer, expected)).toBe(verdict);
  });
});
