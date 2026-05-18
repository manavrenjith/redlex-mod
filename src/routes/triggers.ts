import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnModActionRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import type { T3 } from '@devvit/shared-types/tid.js';
import { reddit, redis } from '@devvit/web/server';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import {
  buildDigestContent,
  getCelebratedMilestones,
  getLogEntries,
  getMilestoneSettings,
  postWeeklyDigest,
  saveCelebratedMilestone,
  saveLogEntry,
} from '../routes/api';

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

      const post = await reddit.getPostById(logPostId as T3);
      await post.edit({ text: body });
    }
  }

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  const subredditName = input.subreddit?.name;

  if (!subredditName) {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const settings = await getMilestoneSettings(subredditName);
  if (!settings.enabled) {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const sub = await reddit.getSubredditByName(subredditName);
  const count = sub.numberOfSubscribers;

  const celebrated = await getCelebratedMilestones(subredditName);
  const celebratedCounts = new Set(
    celebrated
      .filter((milestone) => milestone.type === 'subscribers')
      .map((milestone) => milestone.count)
  );

  const eligibleMilestones = settings.subscriberMilestones
    .filter((milestone) => milestone <= count && !celebratedCounts.has(milestone))
    .sort((a, b) => b - a);

  const milestoneCount = eligibleMilestones[0];
  if (milestoneCount !== undefined) {
    const formattedCount = milestoneCount.toLocaleString();
    const title = settings.postTitle.replace('{count}', formattedCount);
    const body = settings.postBody.replace('{count}', formattedCount);

    await reddit.submitPost({
      subredditName,
      title,
      text: body,
    });

    await saveCelebratedMilestone(subredditName, {
      id: crypto.randomUUID(),
      type: 'subscribers',
      count: milestoneCount,
      celebratedAt: new Date().toISOString(),
    });
  }

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

triggers.post('/scheduler/weekly-digest', async (c) => {
  try {
    const input = await c.req.json<TaskRequest & { subreddit?: { name?: string } }>();
    const subredditName = input.subreddit?.name ?? '';

    if (!subredditName) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const raw = await redis.get(`digestSettings:${subredditName}`);
    const settings = raw ? JSON.parse(raw) : { enabled: false, useAI: false };
    if (!settings.enabled) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const useAI = settings.useAI ?? false;
    const apiKey = (await redis.get(`digestApiKey:${subredditName}`)) ?? undefined;

    const { posts } = await buildDigestContent(subredditName);
    await postWeeklyDigest(
      subredditName,
      posts,
      settings.postTitle ?? '📰 Weekly Community Digest',
      useAI,
      apiKey
    );

    console.log(`Weekly digest posted for r/${subredditName}.`);
  } catch (err) {
    console.error('Weekly digest scheduler error:', err);
  }

  return c.json<TaskResponse>({ status: 'ok' }, 200);
});
