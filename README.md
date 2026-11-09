# AI English

Personal English trainer: spaced-repetition flashcards (FSRS), a mistakes section and speaking practice checked by speech recognition + LLM.

**Status:** stage 1 of 5. Flashcards, import from Anki, daily new-word limit and TTS are done.

## Stack

- **server/**: Node 22 + TypeScript, Fastify, SQLite (better-sqlite3), [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- **web/**: React + Vite, installable PWA
- **TTS**: OpenAI `gpt-4o-mini-tts`, cached on disk per text, so each card is paid for once. Without a key the browser voice (en-US) is used.

## Run

```bash
npm install
cp .env.example .env   # set OPENAI_API_KEY (optional)
npm run dev            # API on :3001, UI on http://localhost:5173
```

Production (one process serves both API and UI):

```bash
npm run build
npm start              # http://127.0.0.1:3001
```

To open it from a phone on the same Wi-Fi, set `HOST=0.0.0.0` and `ACCESS_TOKEN=<random>` in `.env`, then open `http://<laptop-ip>:3001/?token=<random>` once; after that a cookie is used. The server refuses to start on a non-loopback host without a token. Requests with an unknown `Host` header are rejected (DNS-rebinding protection); add domain names to `ALLOWED_HOSTS`. Installing as a PWA and using the microphone (stage 3) need HTTPS, which comes with deployment in stage 5.

```bash
npm test               # parser and scheduler tests
```

## Import format

The same TSV/CSV as Anki: `word<TAB>translation<TAB>example<TAB>example translation<TAB>tags`. Only the first column is required. An Anki "Notes in Plain Text" export works as is (`#separator`/`#html` directives and HTML in fields are handled). Words already in the deck are skipped (case-insensitive).

## Data

SQLite at `data/english.db`, TTS cache in `data/audio/`. Tables:

- `cards`: word, translation, example, example_ru, tags, source, plus the current FSRS state (`fsrs` JSON, mirrored into `state`/`due_at` for indexing)
- `reviews`: log of every answer: rating 1–4, mode, state before, resulting due/stability/difficulty, local day
- `settings`: `new_per_day` (default 20)

## Roadmap

1. ~~Skeleton and flashcards~~
2. Mistakes section
3. Speak aloud: microphone → STT → LLM check with a short explanation in Russian
4. Daily stats and "copy report"
5. Polish, demo video, deploy
