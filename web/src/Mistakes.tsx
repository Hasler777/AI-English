import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type MistakeAnswer, type MistakeListItem, type MistakeNext, type MistakeCounts } from './api';
import { play, stop } from './audio';

const STREAK_TO_RESOLVE = 3;

export function Mistakes({ onExit }: { onExit: () => void }) {
  const [mode, setMode] = useState<'overview' | 'drill'>('overview');
  return mode === 'overview' ? (
    <Overview onExit={onExit} onStart={() => setMode('drill')} />
  ) : (
    <Drill onExit={() => setMode('overview')} />
  );
}

function Back({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <header className="top">
      <button className="link" onClick={onClick}>
        ← Назад
      </button>
      <h1>{title}</h1>
    </header>
  );
}

function Dots({ n }: { n: number }) {
  return (
    <span className="dots" aria-label={`${n} из ${STREAK_TO_RESOLVE}`}>
      {Array.from({ length: STREAK_TO_RESOLVE }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- overview

function Overview({ onExit, onStart }: { onExit: () => void; onStart: () => void }) {
  const [data, setData] = useState<{ counts: MistakeCounts; items: MistakeListItem[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.mistakes().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error)
    return (
      <>
        <Back onClick={onExit} title="Ошибки" />
        <p className="error">{error}</p>
      </>
    );
  if (!data)
    return (
      <>
        <Back onClick={onExit} title="Ошибки" />
        <p className="muted">Загрузка…</p>
      </>
    );

  const { counts, items } = data;
  return (
    <>
      <Back onClick={onExit} title="Ошибки" />
      <p className="muted small">
        Сюда попадает всё, что ты отметил «Забыл». Тренировка — вписать слово по переводу. Ошибка уходит после{' '}
        {STREAK_TO_RESOLVE} верных ответов в разные дни.
      </p>
      <section className="plan">
        <div className="stat">
          <b>{counts.dueToday}</b>
          <span>Сегодня</span>
        </div>
        <div className="stat">
          <b>{counts.open}</b>
          <span>Открыто</span>
        </div>
        <div className="stat">
          <b>{counts.resolved}</b>
          <span>Закрыто</span>
        </div>
      </section>
      <button className="primary big" disabled={counts.dueToday === 0} onClick={onStart}>
        {counts.dueToday ? 'Тренировать' : counts.open ? 'На сегодня всё' : 'Ошибок нет'}
      </button>
      {items.length > 0 && (
        <ul className="mistake-list">
          {items.map((m) => (
            <li key={m.id}>
              <div>
                <b>{m.translation || '—'}</b>
                <span className="muted"> — {m.word ?? '•••'}</span>
              </div>
              <div className="meta">
                {m.doneToday && <span className="ok small">сегодня ✓</span>}
                <Dots n={m.streak} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------- drill

function Drill({ onExit }: { onExit: () => void }) {
  const [next, setNext] = useState<MistakeNext | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<MistakeAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const n = await api.mistakeNext();
      setNext(n);
      setAnswer('');
      setResult(null);
      setError('');
      // нет ни перевода, ни примера — задание на слух
      if (!n.done && !n.mistake.prompt) play(n.mistake.cardId, 'word', n.mistake.listenText);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    return stop;
  }, [load]);

  useEffect(() => {
    if (next && !next.done && !result) inputRef.current?.focus();
  }, [next, result]);

  const submit = async (value: string) => {
    if (!next || next.done || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await api.mistakeAnswer(next.mistake.id, value);
      setResult(r);
      play(r.cardId, 'word', r.expected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const header = (
    <header className="top">
      <button className="link" onClick={onExit}>
        ← Назад
      </button>
      {next && <span className="muted small">Осталось сегодня: {next.counts.dueToday}</span>}
    </header>
  );

  if (error)
    return (
      <>
        {header}
        <p className="error">{error}</p>
        <button onClick={load}>Повторить попытку</button>
      </>
    );
  if (!next)
    return (
      <>
        {header}
        <p className="muted">Загрузка…</p>
      </>
    );
  if (next.done)
    return (
      <>
        {header}
        <section className="done">
          <h2>Ошибки на сегодня разобраны</h2>
          <p className="muted">
            Открыто: {next.counts.open}, закрыто всего: {next.counts.resolved}
          </p>
          <button className="primary" onClick={onExit}>
            К списку ошибок
          </button>
        </section>
      </>
    );

  const m = next.mistake;
  return (
    <>
      {header}
      <article className="card">
        <div className="word">
          {m.prompt ? (
            <h2 className="prompt">{m.prompt}</h2>
          ) : (
            <>
              <h2 className="prompt">Напиши, что слышишь</h2>
              <Speaker onClick={() => play(m.cardId, 'word', m.listenText)} />
            </>
          )}
        </div>
        {m.hint && <p className="muted center">{m.hint}</p>}
        <div className="center">
          <Dots n={result ? result.streak : m.streak} />
        </div>

        {!result ? (
          <form
            className="answer-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) submit(answer);
            }}
          >
            <input
              ref={inputRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={`${m.firstLetter}… (${m.letters} симв.)`}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              lang="en"
              aria-label="Ответ по-английски"
            />
            <div className="row">
              <button type="button" disabled={busy} onClick={() => submit('')}>
                Не помню
              </button>
              <button className="primary" disabled={busy || !answer.trim()}>
                Проверить
              </button>
            </div>
          </form>
        ) : (
          <Feedback result={result} onNext={load} />
        )}
      </article>
    </>
  );
}

function Speaker({ onClick }: { onClick: () => void }) {
  return (
    <button className="speaker" aria-label="Озвучить" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"
        />
      </svg>
    </button>
  );
}

/** Сколько мс после показа результата игнорировать «Дальше» — чтобы двойной Enter не проскакивал разбор. */
const FEEDBACK_GUARD_MS = 400;

function Feedback({ result: r, onNext }: { result: MistakeAnswer; onNext: () => void }) {
  const shownAt = useRef(Date.now());
  const next = () => {
    if (Date.now() - shownAt.current >= FEEDBACK_GUARD_MS) onNext();
  };
  const title =
    r.verdict === 'correct' ? 'Верно' : r.verdict === 'typo' ? 'Засчитано, но с опечаткой' : 'Неверно';
  return (
    <div className={`feedback ${r.verdict}`}>
      <p className="verdict">{title}</p>
      <p className="expected">
        {r.expected}
        <Speaker onClick={() => play(r.cardId, 'word', r.expected)} />
      </p>
      {r.verdict !== 'correct' && r.answer && (
        <p className="muted small">
          Ты написал: <s>{r.answer}</s>
        </p>
      )}
      {r.example && (
        <p className="small">
          {r.example}
          {r.example_ru && <span className="muted"> — {r.example_ru}</span>}
        </p>
      )}
      {r.resolved && <p className="ok">Ошибка закрыта: {STREAK_TO_RESOLVE} верных ответа в разные дни</p>}
      {r.verdict === 'wrong' && <p className="muted small">Серия сброшена. Это слово ещё раз появится в конце.</p>}
      <button className="primary" autoFocus onClick={next}>
        Дальше
      </button>
    </div>
  );
}
