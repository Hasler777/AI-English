import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class TtsUnavailable extends Error {}

const AUDIO_DIR = () => path.join(config.dataDir, 'audio');
const inflight = new Map<string, Promise<Buffer>>();

const INSTRUCTIONS =
  'Speak with a clear, neutral General American accent at a slightly slower than normal pace, for an English learner.';

/** mp3 для текста; кэшируется на диске по хэшу (модель+голос+текст), повторно за озвучку не платим. */
export async function synthesize(text: string): Promise<Buffer> {
  const hash = crypto
    .createHash('sha1')
    .update(`${config.ttsModel}|${config.ttsVoice}|${text}`)
    .digest('hex');
  const file = path.join(AUDIO_DIR(), `${hash}.mp3`);
  if (fs.existsSync(file)) return fs.promises.readFile(file);
  if (!config.openaiKey) throw new TtsUnavailable('OPENAI_API_KEY не задан');

  const pending = inflight.get(hash);
  if (pending) return pending;

  const job = (async () => {
    let res: Response;
    try {
      res = await fetch(`${config.openaiBaseUrl}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ttsModel,
        voice: config.ttsVoice,
        input: text,
        instructions: INSTRUCTIONS,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new TtsUnavailable(`TTS: сеть недоступна (${(e as Error).message})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new TtsUnavailable(`TTS ${res.status}: ${body.slice(0, 200)}`);
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      throw new TtsUnavailable(`TTS: обрыв при загрузке (${(e as Error).message})`);
    }
    await fs.promises.mkdir(AUDIO_DIR(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, file);
    return buf;
  })();
  inflight.set(hash, job);
  try {
    return await job;
  } finally {
    inflight.delete(hash);
  }
}
