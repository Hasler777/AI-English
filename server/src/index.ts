import path from 'node:path';
import { buildApp } from './app.js';
import { config, isLoopback } from './config.js';

if (!isLoopback(config.host) && !config.accessToken) {
  console.error(`HOST=${config.host} открывает сервер в сеть: задай ACCESS_TOKEN в .env (например: openssl rand -hex 16)`);
  process.exit(1);
}
import { openDb } from './db.js';

const db = openDb(path.join(config.dataDir, 'english.db'));
const app = buildApp(db, {
  webDist: config.webDist,
  logger: true,
  accessToken: config.accessToken,
  allowedHosts: config.allowedHosts,
});

await app.listen({ host: config.host, port: config.port });
if (!config.openaiKey) app.log.warn('OPENAI_API_KEY не задан — озвучка через голос браузера');
