import { Hono } from 'hono';
import { reddit, redis } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';

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

export async function buildDigestContent(
  subredditName: string
): Promise<{
  posts: Array<{ title: string; score: number; comments: number }>;
  summary: string;
}> {
  const subreddit = await reddit.getSubredditByName(subredditName);
  const posts = await subreddit.getTopPosts({
    timeframe: 'week',
    limit: 10,
  });
  const postsArray = await posts.all();

  const simplified = postsArray.map((post: Post) => ({
    title: post.title,
    score: post.score,
    comments: post.numberOfComments,
  }));

  const summary = generateDigestSummary(subredditName, simplified);

  return { posts: simplified, summary };
}

export function generateDigestSummary(
  subredditName: string,
  posts: Array<{ title: string; score: number; comments: number }>
): string {
  if (posts.length === 0) {
    return `This week r/${subredditName} had no top posts to summarize. Keep the conversation going!`;
  }

  const topPost = posts.reduce((best, post) =>
    post.score > best.score ? post : best
  );
  const mostDiscussed = posts.reduce((best, post) =>
    post.comments > best.comments ? post : best
  );
  const totalUpvotes = posts.reduce((sum, post) => sum + post.score, 0);

  return `This week r/${subredditName} had ${posts.length} posts competing for the top spot. The community showed strong interest in "${topPost.title}" which led the pack with ${topPost.score} upvotes. Discussion was especially lively around "${mostDiscussed.title}" with ${mostDiscussed.comments} comments. Overall the community contributed ${totalUpvotes} upvotes this week — keep it up!`;
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