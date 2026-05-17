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

export type LogEntry = {
  id: string;
  action: string;
  rule?: string;
  createdAt: string;
};

export type MilestoneSettings = {
  enabled: boolean;
  subscriberMilestones: number[];
  postTitle: string;
  postBody: string;
};

export type CelebratedMilestone = {
  id: string;
  type: 'subscribers';
  count: number;
  celebratedAt: string;
};

export async function getMilestoneSettings(
  subredditName: string
): Promise<MilestoneSettings> {
  const key = `milestoneSettings:${subredditName}`;
  const existing = await redis.get(key);

  if (existing) {
    return JSON.parse(existing) as MilestoneSettings;
  }

  return {
    enabled: true,
    subscriberMilestones: [100, 500, 1000, 5000, 10000, 50000, 100000],
    postTitle: '🎉 We just hit {count} members!',
    postBody:
      "Thank you to every member of our community for helping us reach this milestone. Here's to the next one! 🚀\n\n— The Mod Team",
  };
}

export async function saveMilestoneSettings(
  subredditName: string,
  settings: MilestoneSettings
): Promise<void> {
  const key = `milestoneSettings:${subredditName}`;
  await redis.set(key, JSON.stringify(settings));
}

export async function getCelebratedMilestones(
  subredditName: string
): Promise<CelebratedMilestone[]> {
  const key = `milestones:${subredditName}`;
  const existing = await redis.get(key);
  return existing ? (JSON.parse(existing) as CelebratedMilestone[]) : [];
}

export async function saveCelebratedMilestone(
  subredditName: string,
  milestone: CelebratedMilestone
): Promise<void> {
  const key = `milestones:${subredditName}`;
  const existing = await redis.get(key);
  const milestones: CelebratedMilestone[] = existing
    ? (JSON.parse(existing) as CelebratedMilestone[])
    : [];
  milestones.push(milestone);
  await redis.set(key, JSON.stringify(milestones));
}

export async function saveLogEntry(
  subredditName: string,
  entry: LogEntry
): Promise<void> {
  const key = `transparencyLog:${subredditName}`;
  const existing = await redis.get(key);
  const entries: LogEntry[] = existing ? JSON.parse(existing) : [];
  entries.push(entry);

  const trimmed = entries.length > 30 ? entries.slice(-30) : entries;
  await redis.set(key, JSON.stringify(trimmed));
}

export async function getLogEntries(
  subredditName: string
): Promise<LogEntry[]> {
  const key = `transparencyLog:${subredditName}`;
  const existing = await redis.get(key);
  return existing ? (JSON.parse(existing) as LogEntry[]) : [];
}

export async function buildDigestPrompt(
  subredditName: string
): Promise<{
  posts: Array<{ title: string; score: number; comments: number }>;
  prompt: string;
}> {
  const posts = await reddit.getTopPosts({
    subredditName,
    timeFilter: 'week',
    limit: 10,
  });

  const simplified = posts.map((post) => ({
    title: post.title,
    score: post.score,
    comments: post.numberOfComments,
  }));

  const list = simplified
    .map(
      (post, index) =>
        `${index + 1}. ${post.title} (Score: ${post.score}, Comments: ${post.comments})`
    )
    .join('\n');

  const prompt = `You are a friendly community manager for r/${subredditName} on Reddit.
Summarize this week's top posts into an engaging weekly digest.
Top posts this week:
${list}
Write a digest with:

A warm 2-sentence intro
3-4 sentence summary of the week's themes and highlights
A brief mention of the top 3 posts
An encouraging closing line

Keep it under 400 words. Use friendly plain text, no markdown headers.`;

  return { posts: simplified, prompt };
}

export async function callGrokAPI(
  apiKey: string,
  prompt: string
): Promise<string> {
  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content as string;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Grok API call failed: ${message}`);
  }
}

export async function postWeeklyDigest(
  subredditName: string,
  summary: string,
  posts: Array<{ title: string; score: number; comments: number }>,
  postTitle: string
): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${weekAgo.toLocaleDateString()} – ${now.toLocaleDateString()}`;

  const topPosts = posts.slice(0, 3).map((post) => {
    const title = post.title.trim();
    return `"${title}" — ${post.score} upvotes`;
  });

  const body = `📰 Weekly Community Digest
Week of ${dateRange}
${summary}
━━━━━━━━━━━━━━━━━━
🔥 Top Posts This Week

${topPosts.join('\n')}
━━━━━━━━━━━━━━━━━━
Generated automatically by RedLex`;

  await reddit.submitPost({
    subredditName,
    title: postTitle,
    text: body,
  });
}

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