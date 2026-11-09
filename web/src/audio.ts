/**
 * Озвучка: mp3 с сервера (OpenAI TTS, кэш), при недоступности — голос браузера en-US.
 * Аудио следующей карточки заранее подгружается, чтобы играло без паузы.
 */
type Field = 'word' | 'example';
type Entry = Promise<string | null>; // object URL или null = нужен fallback

const cache = new Map<string, Entry>();
const MAX = 40;
let current: HTMLAudioElement | null = null;
let generation = 0; // последний вызов play() побеждает — старое аудио не играет поверх новой карточки

function load(cardId: number, field: Field): Entry {
  const key = `${cardId}:${field}`;
  let e = cache.get(key);
  if (!e) {
    const p: Entry = fetch(`/api/tts/${cardId}/${field}`)
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    e = p;
    cache.set(key, p);
    // неудачу не кэшируем: сеть вернётся — следующая попытка снова пойдёт на сервер
    p.then((u) => {
      if (u === null && cache.get(key) === p) cache.delete(key);
    });
    if (cache.size > MAX) {
      const [oldKey, old] = cache.entries().next().value!;
      cache.delete(oldKey);
      old.then((u) => u && URL.revokeObjectURL(u));
    }
  }
  return e;
}

export function prefetch(cardId: number, hasExample: boolean) {
  load(cardId, 'word');
  if (hasExample) load(cardId, 'example');
}

function speakFallback(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-US');
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

export function stop() {
  generation++;
  current?.pause();
  current = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export async function play(cardId: number, field: Field, text: string) {
  stop();
  const my = generation;
  const url = await load(cardId, field);
  if (my !== generation) return;
  if (!url) return speakFallback(text);
  current = new Audio(url);
  await current.play().catch(() => {
    // автоплей заблокирован браузером — тихо пропускаем, кнопка 🔊 остаётся
  });
}
