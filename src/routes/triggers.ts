import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnModActionRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { saveLogEntry } from '../routes/api';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>(
    {
      status: 'success',
    },
    200
  );
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();
  const rawAction = input.action ?? '';

  const mappedAction: string =
    rawAction === 'removelink'
      ? 'removePost'
      : rawAction === 'removecomment'
        ? 'removeComment'
        : rawAction === 'banuser'
          ? 'banUser'
          : rawAction === 'approvelink'
            ? 'approvePost'
            : rawAction === 'approvecomment'
              ? 'approveComment'
              : rawAction;

  const subredditName = input.subreddit?.name;
  if (subredditName) {
    await saveLogEntry(subredditName, {
      id: crypto.randomUUID(),
      action: mappedAction,
      createdAt: new Date().toISOString(),
    });
  }

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});
