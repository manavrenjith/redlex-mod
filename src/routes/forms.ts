import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import { handleNuke, handleNukePost } from '../core/nuke';

type NukeFormValues = {
  remove?: boolean;
  lock?: boolean;
  skipDistinguished?: boolean;
  targetId?: string;
};

type StrikeFormValues = {
  username?: string;
  rule?: string;
  reason?: string;
  severity?: 'warning' | 'minor' | 'major';
  postUrl?: string;
};

export const forms = new Hono();

const normalizeValues = (values: NukeFormValues) => ({
  remove: Boolean(values.remove),
  lock: Boolean(values.lock),
  skipDistinguished: Boolean(values.skipDistinguished),
});

const getTargetId = (values: NukeFormValues) => {
  if (typeof values.targetId === 'string' && values.targetId.trim()) {
    return values.targetId.trim();
  }
  return context.postId;
};

forms.post('/mop-comment-submit', async (c) => {
  const values = await c.req.json<NukeFormValues>();
  const normalized = normalizeValues(values);

  if (!normalized.lock && !normalized.remove) {
    return c.json<UiResponse>({ showToast: 'You must select either lock or remove.' }, 200);
  }

  const targetId = getTargetId(values);
  if (!isT1(targetId)) {
    return c.json<UiResponse>({ showToast: 'Mop failed! Please try again later.' }, 200);
  }

  const result = await handleNuke({
    ...normalized,
    commentId: targetId,
    subredditId: context.subredditId,
  });

  return c.json<UiResponse>(
    { showToast: `${result.success ? 'Success' : 'Failed'} : ${result.message}` },
    200
  );
});

forms.post('/mop-post-submit', async (c) => {
  const values = await c.req.json<NukeFormValues>();
  const normalized = normalizeValues(values);

  if (!normalized.lock && !normalized.remove) {
    return c.json<UiResponse>({ showToast: 'You must select either lock or remove.' }, 200);
  }

  const targetId = getTargetId(values);
  if (!isT3(targetId)) {
    return c.json<UiResponse>({ showToast: 'Mop failed! Please try again later.' }, 200);
  }

  const result = await handleNukePost({
    ...normalized,
    postId: targetId,
    subredditId: context.subredditId,
  });

  return c.json<UiResponse>(
    { showToast: `${result.success ? 'Success' : 'Failed'} : ${result.message}` },
    200
  );
});

forms.post('/add-strike-submit', async (c) => {
  const values = await c.req.json<StrikeFormValues>();

  if (!values.username || !values.rule || !values.reason || !values.severity) {
    return c.json<UiResponse>({ showToast: '❌ Please fill in all required fields.' }, 200);
  }

  try {
    const username = values.username.replace(/^u\//, '').toLowerCase();
    const key = `strikes:${username}`;

    const existing = await redis.get(key);
    const strikes = existing ? JSON.parse(existing) : [];

    const mod = await reddit.getCurrentUser();
    const strike = {
      id: crypto.randomUUID(),
      username,
      rule: values.rule,
      reason: values.reason,
      severity: values.severity,
      postUrl: values.postUrl ?? '',
      modName: mod?.username ?? 'unknown',
      createdAt: new Date().toISOString(),
    };

    strikes.push(strike);
    await redis.set(key, JSON.stringify(strikes));
    console.log(`✅ Strike saved for u/${username} — total strikes: ${strikes.length}`);
    return c.json<UiResponse>({ showToast: `✅ Strike logged for u/${username}` }, 200);
  } catch (err) {
    console.error('Strike submission error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to log strike. Please try again.' }, 200);
  }
});
forms.post('/view-strikes-submit', async (c) => {
  const values = await c.req.json<{ username?: string }>();
  const username = (values.username ?? '').replace(/^u\//, '').toLowerCase();
  if (!username) {
    return c.json<UiResponse>({ showToast: '❌ Please enter a username.' }, 200);
  }
  const key = `strikes:${username}`;
  const existing = await redis.get(key);
  const strikes = existing ? JSON.parse(existing) : [];

  if (strikes.length === 0) {
    return c.json<UiResponse>(
      { showToast: `✅ u/${username} has no strikes.` },
      200
    );
  }

  const summary = strikes
    .map((s: any, i: number) => `${i + 1}. [${s.severity}] ${s.rule} — ${s.reason} (by u/${s.modName})`)
    .join('\n');

  return c.json<UiResponse>(
    { showToast: `⚖️ u/${username} has ${strikes.length} strike(s):\n${summary}` },
    200
  );
});
forms.post('/create-redlex-post-submit', async (c) => {
  const values = await c.req.json<{ title?: string }>();
  const title = values.title ?? '⚖️ RedLex — Mod Strike Dashboard';

  try {
    const sub = await reddit.getCurrentSubreddit();
    await reddit.submitPost({
  subredditName: sub.name,
  title,
  text: '⚖️ This is the RedLex Strike Dashboard. Use mod actions to look up user strikes.',
});
    return c.json<UiResponse>({ showToast: '✅ RedLex dashboard post created!' }, 200);
  } catch (err) {
    console.error('Create post error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to create post.' }, 200);
  }
});