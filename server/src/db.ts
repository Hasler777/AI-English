import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  example     TEXT NOT NULL DEFAULT '',
  example_ru  TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('import','manual','subtitles')),
  created_at  TEXT NOT NULL,
  -- текущее состояние FSRS: полный объект ts-fsrs Card в JSON + зеркала для индексов
  fsrs        TEXT NOT NULL,
  state       INTEGER NOT NULL DEFAULT 0,
  due_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cards_word_uq ON cards (lower(trim(word)));
CREATE INDEX IF NOT EXISTS cards_due ON cards (state, due_at);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id      INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  mode         TEXT NOT NULL DEFAULT 'recognize' CHECK (mode IN ('recognize','type','speak')),
  state_before INTEGER NOT NULL,
  due_at       TEXT NOT NULL,
  stability    REAL NOT NULL,
  difficulty   REAL NOT NULL,
  reviewed_at  TEXT NOT NULL,
  day          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_day ON reviews (day);
CREATE INDEX IF NOT EXISTS reviews_card ON reviews (card_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Раздел ошибок. Одна открытая ошибка на (карточка, тип); закрывается после 3 верных ответов в разные дни.
CREATE TABLE IF NOT EXISTS mistakes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id          INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('forgot','grammar','pronunciation')),
  user_answer      TEXT NOT NULL DEFAULT '',
  expected         TEXT NOT NULL DEFAULT '',
  explanation      TEXT NOT NULL DEFAULT '',
  correct_streak   INTEGER NOT NULL DEFAULT 0,
  last_correct_day TEXT,
  last_attempt_at  TEXT,
  times_failed     INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  resolved_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS mistakes_open_uq ON mistakes (card_id, type) WHERE resolved_at IS NULL;

-- Каждая попытка в тренировке ошибок (для статистики этапа 4)
CREATE TABLE IF NOT EXISTS mistake_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mistake_id  INTEGER NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'type' CHECK (mode IN ('type','speak')),
  answer      TEXT NOT NULL,
  correct     INTEGER NOT NULL CHECK (correct IN (0, 1)),
  at          TEXT NOT NULL,
  day         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mistake_attempts_day ON mistake_attempts (day);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
