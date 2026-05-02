import { Hono } from 'hono';
import { reddit, redis } from '@devvit/web/server';

export const api = new Hono();

export type Strike = {
  id: string;
  username: string;
  reason: string;
  rule: string;
  severity: 'warning' | 'minor' | 'major';
  modName: string;
  createdAt: string;
  postUrl?: string;
};

// Save a new strike
api.post('/strikes/add', async (c) => {
  const body = await c.req.json<Omit<Strike, 'id' | 'createdAt' | 'modName'>>();

  const mod = await reddit.getCurrentUser();
  const strike: Strike = {
    ...body,
    id: crypto.randomUUID(),
    modName: mod?.username ?? 'unknown',
    createdAt: new Date().toISOString(),
  };

  const key = `strikes:${body.username.toLowerCase()}`;
  const existing = await redis.get(key);
  const strikes: Strike[] = existing ? JSON.parse(existing) : [];
  strikes.push(strike);
  await redis.set(key, JSON.stringify(strikes));

  return c.json({ success: true, strike });
});

// Get all strikes for a user
api.get('/strikes/:username', async (c) => {
  const username = c.req.param('username').toLowerCase();
  const key = `strikes:${username}`;
  const existing = await redis.get(key);
  const strikes: Strike[] = existing ? JSON.parse(existing) : [];
  return c.json({ username, strikes });
});

// Delete a strike by id
api.delete('/strikes/:username/:id', async (c) => {
  const username = c.req.param('username').toLowerCase();
  const id = c.req.param('id');
  const key = `strikes:${username}`;
  const existing = await redis.get(key);
  const strikes: Strike[] = existing ? JSON.parse(existing) : [];
  const updated = strikes.filter((s) => s.id !== id);
  await redis.set(key, JSON.stringify(updated));
  return c.json({ success: true });
});