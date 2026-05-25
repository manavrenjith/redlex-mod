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

type RuleTemplate = {
  id: string;
  keyword: string;
  ruleName: string;
  explanation: string;
  howToRepost: string;
};

type RuleExplainerSettings = {
  enabled: boolean;
  rules: RuleTemplate[];
  defaultMessage: string;
  signoff: string;
};

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
  const event = input;
  const action = event.action as {
    action?: string;
    type?: string;
    targetId?: string;
    details?: string;
    moderator?: { name?: string; id?: string };
  } | null;
  const ACTION_LABELS: Record<string, string> = {
    removelink: '📛 Post Removed',
    removecomment: '💬 Comment Removed',
    removepost: '📛 Post Removed',
    banuser: '🔨 User Banned',
    approvelink: '✅ Post Approved',
    approvecomment: '✅ Comment Approved',
    dev_platform_app_changed: '🔄 App Updated',
    lock: '🔒 Locked',
    lock_comment: '🔒 Comment Locked',
    distinguish_comment: '⭐ Comment Distinguished',
    sticky: '📌 Stickied',
    addremovalreason: '📋 Removal Reason Added',
    spamlink: '🚫 Post Marked Spam',
    spamcomment: '🚫 Comment Marked Spam',
    unbanuser: '🔓 User Unbanned',
    muteuser: '🔇 User Muted',
    unmuteuser: '🔊 User Unmuted',
  };
  const rawAction = event.action?.action ?? '';
  const actionLabel =
    ACTION_LABELS[rawAction] ??
    ACTION_LABELS[rawAction.toLowerCase()] ??
    rawAction.toLowerCase().replace(/_/g, ' ') ??
    'Unknown';

  const subredditName = event.subreddit?.name;
  if (action?.type === 'removelink' && subredditName) {
    try {
      const viewRuleExplainerKey = `ruleExplainerSettings:${subredditName}`;
      const viewRuleExplainerRaw = await redis.get(viewRuleExplainerKey);
      const viewRuleExplainerSettings = viewRuleExplainerRaw
        ? (JSON.parse(viewRuleExplainerRaw) as RuleExplainerSettings)
        : null;

      if (viewRuleExplainerSettings && viewRuleExplainerSettings.enabled) {
        const viewRuleExplainerDetails =
          typeof action.details === 'string' ? action.details.toLowerCase() : '';
        const viewRuleExplainerMatch = viewRuleExplainerSettings.rules.find((rule) =>
          viewRuleExplainerDetails.includes(rule.keyword.toLowerCase())
        );

        if (viewRuleExplainerMatch && action.targetId) {
          const viewRuleExplainerPost = await reddit.getPostById(action.targetId as T3);
          const viewRuleExplainerAuthorName = viewRuleExplainerPost.authorName ?? '';
          const viewRuleExplainerPostTitle = viewRuleExplainerPost.title ?? '';
          const viewRuleExplainerSubject = `Your post in r/${subredditName} was removed`;
          const viewRuleExplainerBody =
            `Hey u/${viewRuleExplainerAuthorName},\n\n` +
            `Your post **"${viewRuleExplainerPostTitle}"** was removed because it appears to violate **${viewRuleExplainerMatch.ruleName}**.\n\n` +
            `**What went wrong:**\n\n${viewRuleExplainerMatch.explanation}\n\n` +
            `**How to repost correctly:**\n\n${viewRuleExplainerMatch.howToRepost}\n\n` +
            `If you think this was a mistake, please [message the mods](https://www.reddit.com/message/compose?to=/r/${subredditName}).\n\n` +
            `${viewRuleExplainerSettings.signoff}`;

          await reddit.sendPrivateMessage({
            to: viewRuleExplainerAuthorName,
            subject: viewRuleExplainerSubject,
            text: viewRuleExplainerBody,
          });
        }
      }
    } catch (err) {
      console.error('Rule explainer DM error:', err);
    }
  }
  if (subredditName) {
    const moderatorName =
      event.action?.moderator?.name ??
      event.action?.moderator?.id ??
      'unknown';
    await saveLogEntry(subredditName, {
      id: crypto.randomUUID(),
      action: actionLabel,
      createdAt: new Date().toISOString(),
      modName: moderatorName,
    } as unknown as { id: string; action: string; createdAt: string });

    const logPostId = await redis.get(`logPostId:${subredditName}`);
    if (logPostId) {
      const entries = await getLogEntries(subredditName);
      const splitActionLabel = (label: string): { emoji: string; text: string } => {
        const match = label.match(/^([^\w\s]+)\s+(.*)$/);
        if (!match) {
          return { emoji: '📝', text: label };
        }
        return { emoji: match[1], text: match[2] };
      };

      const lines: string[] = [];
      entries.slice(-30).forEach((entry) => {
        const date = entry.createdAt
          ? new Date(entry.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : 'Unknown date';
        const modName = (entry as { modName?: string }).modName ?? 'unknown';
        const entryLabel =
          ACTION_LABELS[entry.action] ??
          ACTION_LABELS[entry.action.toLowerCase()] ??
          entry.action.toLowerCase().replace(/_/g, ' ') ??
          'Unknown';
        const split = splitActionLabel(entryLabel);
        lines.unshift(
          `| ${split.emoji} | ${split.text} | u/${modName} | ${date} |`
        );
      });

      const table = [
        '| Action | Type | Moderator | Date |',
        '|--------|------|-----------|------|',
        ...lines,
      ].join('\n');

      const body = [
        '## 📋 RedLex — Mod Action Log',
        '---',
        table,
        '---',
        '> 🤖 This log is maintained automatically by RedLex.',
      ].join('\n\n');

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
