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
import { generateModDigestPost } from '../routes/forms';

// ─── Local type: actual shape of event.action at runtime ─────────────────────
type ModActionPayload = {
  action?: string;
  type?: string;
  details?: string;
  targetId?: string;
  moderator?: {
    name?: string;
    id?: string;
  };
};

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

const ACTION_LABELS: Record<string, string> = {
  removelink:               '📛 Post Removed',
  removecomment:            '💬 Comment Removed',
  removepost:               '📛 Post Removed',
  banuser:                  '🔨 User Banned',
  approvelink:              '✅ Post Approved',
  approvecomment:           '✅ Comment Approved',
  dev_platform_app_changed: '🔄 App Updated',
  lock:                     '🔒 Locked',
  lock_comment:             '🔒 Comment Locked',
  distinguish_comment:      '⭐ Comment Distinguished',
  sticky:                   '📌 Stickied',
  addremovalreason:         '📋 Removal Reason Added',
  spamlink:                 '🚫 Post Marked Spam',
  spamcomment:              '🚫 Comment Marked Spam',
  unbanuser:                '🔓 User Unbanned',
  muteuser:                 '🔇 User Muted',
  unmuteuser:               '🔊 User Unmuted',
};

function getActionLabel(raw: string): string {
  return (
    ACTION_LABELS[raw] ??
    ACTION_LABELS[raw.toLowerCase()] ??
    (raw.toLowerCase().replace(/_/g, ' ') || 'unknown')
  );
}

function splitActionLabel(label: string): { emoji: string; text: string } {
  const match = label.match(/^([^\w\s]+)\s+(.*)$/);
  if (!match || !match[1] || !match[2]) return { emoji: '📝', text: label };
  return { emoji: match[1] as string, text: match[2] as string };
}

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();

  // The event is FLAT — action/moderator/targetPost are all top-level fields.
  // input.action is just the action string e.g. "removelink", NOT an object.
  const ev = input as unknown as {
    action?: string;
    moderator?: { name?: string; id?: string };
    targetPost?: { id?: string; authorName?: string; title?: string };
    details?: string;
    subreddit?: { name?: string };
  };

  const rawAction = ev.action ?? '';
  const actionLabel = getActionLabel(rawAction);
  const subredditName = ev.subreddit?.name ?? input.subreddit?.name;

  console.log('DEBUG MOD:', JSON.stringify(ev.moderator));
  console.log('DEBUG ACTION:', rawAction);

  // ── Rule Explainer DM ────────────────────────────────────────────────────
  if (rawAction === 'removelink' && subredditName) {
    try {
      const ruleExplainerKey = `ruleExplainerSettings:${subredditName}`;
      const ruleExplainerRaw = await redis.get(ruleExplainerKey);
      const ruleExplainerSettings = ruleExplainerRaw
        ? (JSON.parse(ruleExplainerRaw) as RuleExplainerSettings)
        : null;

      if (ruleExplainerSettings?.enabled) {
        const details = (ev.details ?? '').toLowerCase();
        const matchedRule = ruleExplainerSettings.rules.find((rule) =>
          details.includes(rule.keyword.toLowerCase())
        );

        if (matchedRule && ev.targetPost?.id) {
          const post = await reddit.getPostById(ev.targetPost.id as T3);
          const authorName = post.authorName ?? '';
          const postTitle = post.title ?? '';

          await reddit.sendPrivateMessage({
            to: authorName,
            subject: `Your post in r/${subredditName} was removed`,
            text:
              `Hey u/${authorName},\n\n` +
              `Your post **"${postTitle}"** was removed because it appears to violate **${matchedRule.ruleName}**.\n\n` +
              `**What went wrong:**\n\n${matchedRule.explanation}\n\n` +
              `**How to repost correctly:**\n\n${matchedRule.howToRepost}\n\n` +
              `If you think this was a mistake, please [message the mods](https://www.reddit.com/message/compose?to=/r/${subredditName}).\n\n` +
              `${ruleExplainerSettings.signoff}`,
          });
        }
      }
    } catch (err) {
      console.error('Rule explainer DM error:', err);
    }
  }

  // ── Transparency Log ─────────────────────────────────────────────────────
  if (subredditName) {
    const moderatorName =
      ev.moderator?.name ??
      ev.moderator?.id ??
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

      const logSettingsRaw = await redis.get(`logSettings:${subredditName}`);
      const logSettings = logSettingsRaw
        ? JSON.parse(logSettingsRaw)
        : { retentionDays: 30 };
      const retentionDays: number = logSettings.retentionDays ?? 30;
      const filteredEntries = retentionDays === 0
        ? entries
        : entries.filter((entry) => {
            if (!entry.createdAt) return true;
            const ageDays =
              (Date.now() - new Date(entry.createdAt).getTime()) / 86400000;
            return ageDays <= retentionDays;
          });

      const lines: string[] = [];
      filteredEntries.slice(-30).forEach((entry) => {
        const date = entry.createdAt
          ? new Date(entry.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : 'Unknown date';
        const modName = (entry as { modName?: string }).modName ?? 'unknown';
        const entryLabel = getActionLabel(entry.action);
        const split = splitActionLabel(entryLabel);
        lines.unshift(`| ${split.emoji} | ${split.text} | u/${modName} | ${date} |`);
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

      const logPost = await reddit.getPostById(logPostId as T3);
      await logPost.edit({ text: body });
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

    await reddit.submitPost({ subredditName, title, text: body });

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

triggers.post('/internal/scheduler/weekly-mod-digest', async (c) => {
  try {
    const input = await c.req.json<{ context?: { subredditName?: string } }>();
    const subredditName = input.context?.subredditName ?? '';

    if (!subredditName) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const rawSettings = await redis.get(`digestSettings:${subredditName}`);
    const settings = rawSettings ? JSON.parse(rawSettings) : null;
    if (settings?.enabled === false) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    await generateModDigestPost(subredditName);
  } catch (err) {
    console.error('Weekly mod digest scheduler error:', err);
  }

  return c.json<TaskResponse>({ status: 'ok' }, 200);
});