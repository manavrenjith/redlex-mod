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
  severity?: 'warning' | 'minor' | 'major' | string[];
  postUrl?: string;
};

export const forms = new Hono();

const normalizeSeverityInput = (
  severity: unknown
): 'warning' | 'minor' | 'major' | null => {
  const raw = Array.isArray(severity) ? severity[0] : severity;
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'warning' || normalized === 'minor' || normalized === 'major') {
    return normalized;
  }

  return null;
};

const formatSeverityLabel = (severity: unknown): string => {
  const normalized = normalizeSeverityInput(severity);
  if (normalized) {
    return normalized.toUpperCase();
  }

  const raw = Array.isArray(severity) ? severity[0] : severity;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.toUpperCase();
  }

  return 'UNKNOWN';
};

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

  const normalizedSeverity = normalizeSeverityInput(values.severity);
  if (!normalizedSeverity) {
    return c.json<UiResponse>({ showToast: '❌ Please select a valid severity.' }, 200);
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
      severity: normalizedSeverity,
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
      {
        showForm: {
          name: 'viewStrikesResult',
          form: {
            title: `⚖️ u/${username} — Strike Record`,
            acceptLabel: 'Close',
            fields: [
              {
                name: 'result',
                label: 'Strike History',
                type: 'paragraph',
                defaultValue: '✅ No strikes on record.',
              },
            ],
          },
        },
      },
      200
    );
  }

  const lines = strikes
    .map(
      (s: any, i: number) =>
        `${i + 1}. [${formatSeverityLabel(s.severity)}] ${s.rule}\n   ${s.reason}\n   By u/${s.modName} on ${new Date(s.createdAt).toLocaleDateString()}`
    )
    .join('\n\n');

  const summary = `${strikes.length} strike(s) on record:\n\n${lines}`;

  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewStrikesResult',
        form: {
          title: `⚖️ u/${username} — Strike Record`,
          acceptLabel: 'Close',
          fields: [
            {
              name: 'result',
              label: 'Strike History',
              type: 'paragraph',
              defaultValue: summary,
            },
          ],
        },
      },
    },
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

forms.post('/view-strikes-result-noop', async (c) => {
  return c.json<UiResponse>({ showToast: '' }, 200);
});

forms.post('/add-shift-note-submit', async (c) => {
  const values = await c.req.json<{ text?: string; priority?: string | string[] }>();
  const text = (values.text ?? '').trim();

  if (!text) {
    return c.json<UiResponse>({ showToast: '❌ Please enter a note' }, 200);
  }

  const rawPriority = Array.isArray(values.priority)
    ? values.priority[0]
    : values.priority;
  const priority = rawPriority === 'urgent' ? 'urgent' : 'normal';

  try {
    const [subreddit, user] = await Promise.all([
      reddit.getCurrentSubreddit(),
      reddit.getCurrentUser(),
    ]);
    const key = `shiftNotes:${subreddit.name}`;

    const existing = await redis.get(key);
    const notes = existing ? JSON.parse(existing) : [];

    const note = {
      id: crypto.randomUUID(),
      text,
      modName: user?.username ?? 'unknown',
      createdAt: new Date().toISOString(),
      resolved: false,
      priority,
    };

    notes.push(note);
    await redis.set(key, JSON.stringify(notes));

    return c.json<UiResponse>({ showToast: '✅ Shift note added' }, 200);
  } catch (err) {
    console.error('Shift note submission error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to save note' }, 200);
  }
});

forms.post('/view-shift-notes-submit', async (c) => {
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const key = `shiftNotes:${subreddit.name}`;

    const existing = await redis.get(key);
    const notes = existing ? JSON.parse(existing) : [];

    const activeNotes = notes
      .filter((note: any) => note && note.resolved === false)
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    const summary =
      activeNotes.length === 0
        ? '✅ No active shift notes'
        : activeNotes
            .map((note: any) => {
              const priority = note.priority === 'urgent' ? 'URGENT' : 'NORMAL';
              const icon = priority === 'URGENT' ? '🔴' : '📌';
              const date = note.createdAt
                ? new Date(note.createdAt).toLocaleDateString()
                : 'Unknown date';
              const modName = note.modName ? `u/${note.modName}` : 'unknown mod';
              const text = note.text ?? '';
              return `${icon} [${priority}] ${text} — ${modName} on ${date}`;
            })
            .join('\n\n');

    return c.json<UiResponse>(
      {
        showForm: {
          name: 'viewShiftNotesResult',
          form: {
            title: '📋 View Shift Notes',
            acceptLabel: 'Close',
            fields: [
              {
                name: 'result',
                label: 'Shift Notes',
                type: 'paragraph',
                defaultValue: summary,
              },
            ],
          },
        },
      },
      200
    );
  } catch (err) {
    console.error('View shift notes error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to load notes' }, 200);
  }
});

forms.post('/view-shift-notes-result-noop', async (c) => {
  return c.json<UiResponse>({ showToast: '' }, 200);
});

forms.post('/resolve-shift-note-submit', async (c) => {
  const values = await c.req.json<{ noteId?: string }>();
  const noteId = (values.noteId ?? '').trim();

  if (!noteId) {
    return c.json<UiResponse>({ showToast: '❌ Note not found' }, 200);
  }

  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const key = `shiftNotes:${subreddit.name}`;

    const existing = await redis.get(key);
    const notes = existing ? JSON.parse(existing) : [];

    const match = notes.find((note: any) => note && note.id === noteId);
    if (!match) {
      return c.json<UiResponse>({ showToast: '❌ Note not found' }, 200);
    }

    match.resolved = true;
    await redis.set(key, JSON.stringify(notes));

    return c.json<UiResponse>({ showToast: '✅ Note resolved' }, 200);
  } catch (err) {
    console.error('Resolve shift note error:', err);
    return c.json<UiResponse>({ showToast: '❌ Note not found' }, 200);
  }
});