import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Grade, type ImportResult, type NextResponse, type Today } from './api';
import { play, prefetch, stop } from './audio';
import { Mistakes } from './Mistakes';

type Screen = 'home' | 'review' | 'import' | 'add' | 'mistakes';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  return (
    <main className="app">
      {screen === 'home' && <Home go={setScreen} />}
      {screen === 'review' && <Review onExit={() => setScreen('home')} onMistakes={() => setScreen('mistakes')} />}
      {screen === 'mistakes' && <Mistakes onExit={() => setScreen('home')} />}
      {screen === 'import' && <Import onExit={() => setScreen('home')} />}
      {screen === 'add' && <AddWord onExit={() => setScreen('home')} />}
    </main>
  );
}

// ---------------------------------------------------------------- Home

function Home({ go }: { go: (s: Screen) => void }) {
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.today().then(setToday, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">Сервер недоступен: {error}</p>;
  if (!today) return <p className="muted">Загрузка…</p>;

  const nothing = today.toReview + today.newToday === 0;

  return (
    <>
      <header className="top">
        <h1>AI English</h1>
        <span className="streak" title="Серия дней">
          {today.streak} {plural(today.streak, 'день', 'дня', 'дней')} подряд
        </span>
      </header>

      <section className="plan">
        <Stat n={today.toReview} label="Повторить" />
        <Stat n={today.newToday} label="Новых" />
        <Stat n={today.mistakesToday} label="Ошибок" />
        <Stat n={today.reviewedToday} label="Сделано" />
      </section>

      <button className="primary big" disabled={nothing} onClick={() => go('review')}>
        {nothing ? (today.totalCards ? 'На сегодня всё' : 'Сначала импортируй слова') : 'Начать'}
      </button>

      <button onClick={() => go('mistakes')}>
        Ошибки{today.mistakesToday > 0 && ` · ${today.mistakesToday} на сегодня`}
      </button>

      <div className="row">
        <button onClick={() => go('import')}>Импорт</button>
        <button onClick={() => go('add')}>Добавить слово</button>
      </div>

      <NewPerDay value={today.newPerDay} onSaved={setToday} />

      <p className="muted small">
        Всего карточек: {today.totalCards}, ещё не начатых: {today.newAvailable}
      </p>
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function NewPerDay({ value, onSaved }: { value: number; onSaved: (t: Today) => void }) {
  const [v, setV] = useState(String(value));
  const [err, setErr] = useState('');
  const dirty = v !== String(value);
  const save = () => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 500) return setErr('0–500');
    setErr('');
    api.setNewPerDay(n).then(onSaved, (e: Error) => setErr(e.message));
  };
  return (
    <label className="setting">
      Новых слов в день
      <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} />
      {dirty && <button onClick={save}>Сохранить</button>}
      {err && <span className="error">{err}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- Review

const GRADES: { g: Grade; label: string; key: string; cls: string }[] = [
  { g: 1, label: 'Забыл', key: '1', cls: 'again' },
  { g: 2, label: 'Трудно', key: '2', cls: 'hard' },
  { g: 3, label: 'Хорошо', key: '3', cls: 'good' },
  { g: 4, label: 'Легко', key: '4', cls: 'easy' },
];

function Review({ onExit, onMistakes }: { onExit: () => void; onMistakes: () => void }) {
  const [data, setData] = useState<NextResponse | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const loadNext = useCallback(async () => {
    try {
      const n = await api.next();
      setData(n);
      setRevealed(false);
      setError('');
      if (!n.done) {
        play(n.card.id, 'word', n.card.word);
        prefetch(n.card.id, !!n.card.example);
        for (const u of n.upcoming) prefetch(u.id, u.hasExample);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadNext();
    return stop;
  }, [loadNext]);

  const answer = useCallback(
    async (g: Grade) => {
      if (!data || data.done || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      stop();
      try {
        await api.answer(data.card.id, g);
        await loadNext();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [data, loadNext],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!data || data.done) return;
      if (!revealed && (e.code === 'Space' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const gr = GRADES.find((x) => x.key === e.key);
        if (gr) answer(gr.g);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, revealed, answer]);

  const top = (
    <header className="top">
      <button className="link" onClick={onExit}>
        ← Назад
      </button>
      {data && (
        <span className="muted small">
          Повторить {data.today.toReview} · Новых {data.today.newToday}
        </span>
      )}
    </header>
  );

  if (error)
    return (
      <>
        {top}
        <p className="error">{error}</p>
        <button onClick={loadNext}>Повторить попытку</button>
      </>
    );
  if (!data) return <>{top}<p className="muted">Загрузка…</p></>;

  if (data.done)
    return (
      <>
        {top}
        <section className="done">
          <h2>На сегодня всё</h2>
          <p>Сделано повторений: {data.today.reviewedToday}</p>
          {data.nextDueAt && <p className="muted">Следующее повторение: {formatWhen(data.nextDueAt)}</p>}
          {data.today.mistakesToday > 0 ? (
            <>
              <button className="primary" onClick={onMistakes}>
                Дальше: ошибки ({data.today.mistakesToday})
              </button>
              <button onClick={onExit}>На главную</button>
            </>
          ) : (
            <button className="primary" onClick={onExit}>
              На главную
            </button>
          )}
        </section>
      </>
    );

  const { card, isNew, previews } = data;

  return (
    <>
      {top}
      <article className="card">
        {isNew && <span className="badge">Новое</span>}
        <div className="word">
          <h2>{card.word}</h2>
          <Speaker onClick={() => play(card.id, 'word', card.word)} />
        </div>

        {revealed ? (
          <div className="back">
            <p className="translation">{card.translation || '—'}</p>
            {card.example && (
              <div className="example">
                <p>
                  {card.example} <Speaker onClick={() => play(card.id, 'example', card.example)} />
                </p>
                {card.example_ru && <p className="muted">{card.example_ru}</p>}
              </div>
            )}
            {isNew && <p className="hint">Произнеси слово и пример вслух</p>}
          </div>
        ) : (
          <button
            className="primary big reveal"
            onClick={() => {
              setRevealed(true);
              if (card.example && isNew) play(card.id, 'example', card.example);
            }}
          >
            Показать ответ
          </button>
        )}
      </article>

      {revealed && (
        <div className="grades">
          {GRADES.map(({ g, label, cls }) => (
            <button key={g} className={cls} disabled={busy} onClick={() => answer(g)}>
              <span>{label}</span>
              <small>{formatInterval(previews[g])}</small>
            </button>
          ))}
        </div>
      )}
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

// ---------------------------------------------------------------- Import

function Import({ onExit }: { onExit: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    setResult(null);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await api.import(text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="top">
        <button className="link" onClick={onExit}>
          ← Назад
        </button>
        <h1>Импорт</h1>
      </header>
      <p className="muted small">
        TSV или CSV, как для Anki: <code>слово · перевод · пример · перевод примера</code>. Последние две колонки
        необязательны. Подходит экспорт Anki «Notes in Plain Text».
      </p>
      <input type="file" accept=".txt,.tsv,.csv,text/plain,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
      <textarea
        rows={8}
        placeholder={'hello\tпривет\tHello, how are you?\tПривет, как дела?'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
      />
      <button className="primary" disabled={!text.trim() || busy} onClick={submit}>
        {busy ? 'Импортирую…' : 'Импортировать'}
      </button>
      {error && <p className="error">{error}</p>}
      {result && (
        <section className="result">
          <p>
            <b>Добавлено: {result.added}</b> из {result.total}
          </p>
          {result.skipped.length > 0 && (
            <p className="muted small">
              Уже были ({result.skipped.length}): {result.skipped.slice(0, 20).join(', ')}
              {result.skipped.length > 20 && '…'}
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="error small">
              {result.errors.slice(0, 20).map((e) => (
                <li key={e.line}>
                  Строка {e.line}: {e.reason}
                </li>
              ))}
            </ul>
          )}
          <button onClick={onExit}>На главную</button>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Add word

function AddWord({ onExit }: { onExit: () => void }) {
  const empty = { word: '', translation: '', example: '', example_ru: '' };
  const [f, setF] = useState(empty);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const field = (k: keyof typeof empty, label: string) => (
    <label className="field">
      {label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addCard(f);
      setMsg({ ok: true, text: `«${f.word.trim()}» добавлено` });
      setF(empty);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      <header className="top">
        <button className="link" onClick={onExit}>
          ← Назад
        </button>
        <h1>Новое слово</h1>
      </header>
      <form onSubmit={submit} className="form">
        {field('word', 'Слово или фраза (EN)')}
        {field('translation', 'Перевод')}
        {field('example', 'Пример (EN)')}
        {field('example_ru', 'Перевод примера')}
        <button className="primary" disabled={!f.word.trim()}>
          Добавить
        </button>
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      </form>
    </>
  );
}

// ---------------------------------------------------------------- helpers

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function formatInterval(iso: string) {
  const min = (new Date(iso).getTime() - Date.now()) / 60000;
  if (min < 1) return '<1 мин';
  if (min < 60) return `${Math.round(min)} мин`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} ч`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} дн`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)} мес`;
  return `${(d / 365).toFixed(1)} г`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d <= now) return 'сейчас';
  if (sameDay) return `сегодня в ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ` в ${time}`;
}
