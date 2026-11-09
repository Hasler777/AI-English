import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '../..');

// .env в корне репозитория (необязателен)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  root: ROOT,
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data'),
  webDist: path.join(ROOT, 'web', 'dist'),
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3001),
  openaiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
  ttsModel: process.env.TTS_MODEL ?? 'gpt-4o-mini-tts',
  ttsVoice: process.env.TTS_VOICE ?? 'alloy',
  /** Обязателен, если HOST не loopback (доступ с телефона): ?token=… при первом открытии, дальше cookie. */
  accessToken: process.env.ACCESS_TOKEN ?? '',
  /** Доп. имена хоста (через запятую), с которыми разрешены запросы — защита от DNS rebinding. */
  allowedHosts: (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
};

export function isLoopback(host: string) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}
