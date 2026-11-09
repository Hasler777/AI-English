import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { openDb } from './db.js';

describe('app', () => {
  it('отклоняет чужой Host (DNS rebinding), пускает localhost и IP', async () => {
    const app = buildApp(openDb(':memory:'));
    const get = (host: string) => app.inject({ method: 'GET', url: '/api/today', headers: { host } });
    expect((await get('evil.example.com')).statusCode).toBe(421);
    expect((await get('localhost:5173')).statusCode).toBe(200);
    expect((await get('192.168.1.5:3001')).statusCode).toBe(200);
    expect((await get('[::1]:3001')).statusCode).toBe(200);
  });

  it('с ACCESS_TOKEN: без токена 401, ?token= ставит cookie, дальше по cookie', async () => {
    const app = buildApp(openDb(':memory:'), { accessToken: 's3cret' });
    const headers = { host: '192.168.1.5:3001' };
    expect((await app.inject({ url: '/api/today', headers })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/today?token=nope', headers })).statusCode).toBe(401);
    const ok = await app.inject({ url: '/api/today?token=s3cret&x=1', headers });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe('/api/today?x=1');
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ url: '/api/today', headers: { ...headers, cookie } })).statusCode).toBe(200);
    // битая cookie — 401, а не 500
    expect((await app.inject({ url: '/api/today', headers: { ...headers, cookie: 'ae_token=%E0' } })).statusCode).toBe(401);
  });

  it('ALLOWED_HOSTS с портом тоже срабатывает', async () => {
    const app = buildApp(openDb(':memory:'), { allowedHosts: ['mybox.local:3001'] });
    expect((await app.inject({ url: '/api/today', headers: { host: 'mybox.local:3001' } })).statusCode).toBe(200);
  });

  it('валидация ответа: 400 на плохой rating, 404 на несуществующую карточку', async () => {
    const app = buildApp(openDb(':memory:'));
    const post = (body: object) =>
      app.inject({ method: 'POST', url: '/api/review', headers: { host: 'localhost' }, payload: body });
    expect((await post({ cardId: 1, rating: 7 })).statusCode).toBe(400);
    expect((await post({ cardId: 999, rating: 3 })).statusCode).toBe(404);
  });
});
