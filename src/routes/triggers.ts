import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnModActionRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { reddit, redis } from '@devvit/web/server';
import { getLogEntries, saveLogEntry } from '../routes/api';

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

    const logPostId = await redis.get(`logPostId:${subredditName}`);
    if (logPostId) {
      const entries = await getLogEntries(subredditName);
      const updatedAt = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

      const friendlyAction = (action: string): string => {
        switch (action) {
          case 'removePost':
            return 'Post removed';
          case 'removeComment':
            return 'Comment removed';
          case 'banUser':
            return 'User banned';
          case 'approvePost':
            return 'Post approved';
          case 'approveComment':
            return 'Comment approved';
          default:
            return action;
        }
      };

      const actionEmoji = (action: string): string => {
        switch (action) {
          case 'removePost':
            return '📛';
          case 'removeComment':
            return '💬';
          case 'banUser':
            return '🔨';
          case 'approvePost':
          case 'approveComment':
            return '✅';
          default:
            return '📝';
        }
      };

      const lines = entries
        .slice(-30)
        .reverse()
        .map((entry) => {
          const date = entry.createdAt
            ? new Date(entry.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            : 'Unknown date';
          return `${actionEmoji(entry.action)} ${friendlyAction(
            entry.action
          )} · ${date}`;
        });

      const body = [
        '📋 RedLex Mod Action Log',
        `Last updated: ${updatedAt}`,
        ...lines,
        'This log is maintained automatically by RedLex.',
      ].join('\n');

      const post = await reddit.getPostById(logPostId);
      await post.edit({ text: body });
    }
  }

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});
