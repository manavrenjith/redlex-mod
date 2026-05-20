import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import { handleNuke, handleNukePost } from '../core/nuke';
import {
  buildDigestContent,
  getCelebratedMilestones,
  postWeeklyDigest,
  saveMilestoneSettings,
} from '../routes/api';

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
  {
  const mopCommentValues = await c.req.json<NukeFormValues>();
  const mopCommentNormalized = normalizeValues(mopCommentValues);

  if (!mopCommentNormalized.lock && !mopCommentNormalized.remove) {
    return c.json<UiResponse>({ showToast: 'You must select either lock or remove.' }, 200);
  }

  const mopCommentTargetId = getTargetId(mopCommentValues);
  if (!isT1(mopCommentTargetId)) {
    return c.json<UiResponse>({ showToast: 'Mop failed! Please try again later.' }, 200);
  }

  const mopCommentResult = await handleNuke({
    ...mopCommentNormalized,
    commentId: mopCommentTargetId,
    subredditId: context.subredditId,
  });

  return c.json<UiResponse>(
    {
      showToast: `${mopCommentResult.success ? 'Success' : 'Failed'} : ${mopCommentResult.message}`,
    },
    200
  );
  }
});

forms.post('/mop-post-submit', async (c) => {
  {
  const mopPostValues = await c.req.json<NukeFormValues>();
  const mopPostNormalized = normalizeValues(mopPostValues);

  if (!mopPostNormalized.lock && !mopPostNormalized.remove) {
    return c.json<UiResponse>({ showToast: 'You must select either lock or remove.' }, 200);
  }

  const mopPostTargetId = getTargetId(mopPostValues);
  if (!isT3(mopPostTargetId)) {
    return c.json<UiResponse>({ showToast: 'Mop failed! Please try again later.' }, 200);
  }

  const mopPostResult = await handleNukePost({
    ...mopPostNormalized,
    postId: mopPostTargetId,
    subredditId: context.subredditId,
  });

  return c.json<UiResponse>(
    { showToast: `${mopPostResult.success ? 'Success' : 'Failed'} : ${mopPostResult.message}` },
    200
  );
  }
});

forms.post('/add-strike-submit', async (c) => {
  {
  const strikeValues = await c.req.json<StrikeFormValues>();

  if (!strikeValues.username || !strikeValues.rule || !strikeValues.reason || !strikeValues.severity) {
    return c.json<UiResponse>({ showToast: '❌ Please fill in all required fields.' }, 200);
  }

  const strikeSeverity = normalizeSeverityInput(strikeValues.severity);
  if (!strikeSeverity) {
    return c.json<UiResponse>({ showToast: '❌ Please select a valid severity.' }, 200);
  }

  try {
    const strikeUsername = strikeValues.username.replace(/^u\//, '').toLowerCase();
    const strikeKey = `strikes:${strikeUsername}`;

    const strikeExisting = await redis.get(strikeKey);
    const strikeStrikes = strikeExisting ? JSON.parse(strikeExisting) : [];

    const strikeMod = await reddit.getCurrentUser();
    const strikeRecord = {
      id: crypto.randomUUID(),
      username: strikeUsername,
      rule: strikeValues.rule,
      reason: strikeValues.reason,
      severity: strikeSeverity,
      postUrl: strikeValues.postUrl ?? '',
      modName: strikeMod?.username ?? 'unknown',
      createdAt: new Date().toISOString(),
    };

    strikeStrikes.push(strikeRecord);
    await redis.set(strikeKey, JSON.stringify(strikeStrikes));
    console.log(
      `✅ Strike saved for u/${strikeUsername} — total strikes: ${strikeStrikes.length}`
    );

    const strikeSubreddit = await reddit.getCurrentSubreddit();
    const strikeBody = `Hi u/${strikeUsername},

This is an automated notice from the moderation team of
r/${strikeSubreddit.name}.

You have received a guideline strike.

━━━━━━━━━━━━━━━━━━ Rule Violated: ${strikeValues.rule} Severity: ${strikeSeverity} Details: ${strikeValues.reason} ━━━━━━━━━━━━━━━━━━

Please review the community rules to avoid further violations.
Repeated violations may result in further action.

If you believe this was issued in error, please contact the
mod team via Mod Mail.

This message was sent automatically by RedLex.`;

    try {
      await reddit.sendPrivateMessage({
        to: strikeUsername,
        subject: '⚖️ RedLex — Community Guidelines Notice',
        text: strikeBody,
      });

      return c.json<UiResponse>(
        { showToast: `✅ Strike logged and u/${strikeUsername} has been notified.` },
        200
      );
    } catch (messageErr) {
      console.error('Strike notification error:', messageErr);
      return c.json<UiResponse>(
        { showToast: '✅ Strike logged. (Notification failed)' },
        200
      );
    }
  } catch (err) {
    console.error('Strike submission error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to log strike. Please try again.' }, 200);
  }
  }
});
forms.post('/view-strikes-submit', async (c) => {
  {
  const viewValues = await c.req.json<{ username?: string }>();
  const viewUsername = (viewValues.username ?? '').replace(/^u\//, '').toLowerCase();
  
  if (!viewUsername) {
    return c.json<UiResponse>({ showToast: '❌ Please enter a username.' }, 200);
  }

  const viewKey = `strikes:${viewUsername}`;
  const viewExisting = await redis.get(viewKey);
  const viewStrikes = viewExisting ? JSON.parse(viewExisting) : [];

  if (viewStrikes.length === 0) {
    return c.json<UiResponse>(
      {
        showForm: {
          name: 'viewStrikesResult',
          form: {
            title: `⚖️ u/${viewUsername} — Strike Record`,
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

  const viewStrikeFields = viewStrikes.map((viewStrike: any, viewIndex: number) => {
    const viewRawSeverity = Array.isArray(viewStrike.severity)
      ? viewStrike.severity[0]
      : viewStrike.severity;
    const viewSeverityLabel =
      typeof viewRawSeverity === 'string' ? viewRawSeverity : 'UNKNOWN';
    const viewDate = viewStrike.createdAt
      ? new Date(viewStrike.createdAt).toLocaleDateString()
      : 'Unknown date';
    const viewModName = viewStrike.modName ? `u/${viewStrike.modName}` : 'unknown';
    const viewReason = viewStrike.reason ?? '';

    return {
      name: `strike_${viewIndex}`,
      type: 'paragraph' as const,
      label: `Strike ${viewIndex + 1} — [${viewSeverityLabel}] ${viewStrike.rule}`,
      defaultValue: `${viewReason}\nBy ${viewModName} on ${viewDate}`,
    };
  });

  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewStrikesResult',
        form: {
          title: `⚖️ u/${viewUsername} — Strike Record`,
          acceptLabel: 'Close',
          fields: viewStrikeFields,
        },
      },
    },
    200
  );
  }
});
forms.post('/view-strikes-result-noop', async (c) => {
  {
  return c.json<UiResponse>({ showToast: '' }, 200);
  }
});

forms.post('/add-shift-note-submit', async (c) => {
  {
  const noteValues = await c.req.json<{ text?: string; priority?: string | string[] }>();
  const noteText = (noteValues.text ?? '').trim();

  if (!noteText) {
    return c.json<UiResponse>({ showToast: '❌ Please enter a note' }, 200);
  }

  const noteRawPriority = Array.isArray(noteValues.priority)
    ? noteValues.priority[0]
    : noteValues.priority;
  const notePriority = noteRawPriority === 'urgent' ? 'urgent' : 'normal';

  try {
    const [noteSubreddit, noteUser] = await Promise.all([
      reddit.getCurrentSubreddit(),
      reddit.getCurrentUser(),
    ]);
    const noteKey = `shiftNotes:${noteSubreddit.name}`;

    const noteExisting = await redis.get(noteKey);
    const noteNotes = noteExisting ? JSON.parse(noteExisting) : [];

    const noteEntry = {
      id: crypto.randomUUID(),
      text: noteText,
      modName: noteUser?.username ?? 'unknown',
      createdAt: new Date().toISOString(),
      resolved: false,
      priority: notePriority,
    };

    noteNotes.push(noteEntry);
    await redis.set(noteKey, JSON.stringify(noteNotes));

    return c.json<UiResponse>({ showToast: '✅ Shift note added' }, 200);
  } catch (err) {
    console.error('Shift note submission error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to save note' }, 200);
  }
  }
});

forms.post('/view-shift-notes-submit', async (c) => {
  {
  try {
    const notesSubreddit = await reddit.getCurrentSubreddit();
    const notesKey = `shiftNotes:${notesSubreddit.name}`;

    const notesExisting = await redis.get(notesKey);
    const notesItems = notesExisting ? JSON.parse(notesExisting) : [];

    const notesActive = notesItems
      .filter((note: any) => note && note.resolved === false)
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    const notesSummary =
      notesActive.length === 0
        ? '✅ No active shift notes'
        : notesActive
            .map((note: any) => {
              const notesPriority = note.priority === 'urgent' ? 'URGENT' : 'NORMAL';
              const notesIcon = notesPriority === 'URGENT' ? '🔴' : '📌';
              const notesDate = note.createdAt
                ? new Date(note.createdAt).toLocaleDateString()
                : 'Unknown date';
              const notesModName = note.modName ? `u/${note.modName}` : 'unknown mod';
              const notesText = note.text ?? '';
              return `${notesIcon} [${notesPriority}] ${notesText} — ${notesModName} on ${notesDate}`;
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
                defaultValue: notesSummary,
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
  }
});

forms.post('/view-shift-notes-result-noop', async (c) => {
  {
  return c.json<UiResponse>({ showToast: '' }, 200);
  }
});

forms.post('/resolve-shift-note-submit', async (c) => {
  {
  const resolveValues = await c.req.json<{ noteId?: string }>();
  const resolveId = (resolveValues.noteId ?? '').trim();

  if (!resolveId) {
    return c.json<UiResponse>({ showToast: '❌ Note not found' }, 200);
  }

  try {
    const resolveSubreddit = await reddit.getCurrentSubreddit();
    const resolveKey = `shiftNotes:${resolveSubreddit.name}`;

    const resolveExisting = await redis.get(resolveKey);
    const resolveNotes = resolveExisting ? JSON.parse(resolveExisting) : [];

    const resolveMatch = resolveNotes.find((note: any) => note && note.id === resolveId);
    if (!resolveMatch) {
      return c.json<UiResponse>({ showToast: '❌ Note not found' }, 200);
    }

    resolveMatch.resolved = true;
    await redis.set(resolveKey, JSON.stringify(resolveNotes));

    return c.json<UiResponse>({ showToast: '✅ Note resolved' }, 200);
  } catch (err) {
    console.error('Resolve shift note error:', err);
    return c.json<UiResponse>({ showToast: '❌ Note not found' }, 200);
  }
  }
});

forms.post('/create-log-post-submit', async (c) => {
  {
  const logValues = await c.req.json<{ title?: string }>();
  const logTitle = logValues.title ?? '📋 RedLex — Mod Action Log';

  try {
    const logSubreddit = await reddit.getCurrentSubreddit();
    const logPost = await reddit.submitPost({
      subredditName: logSubreddit.name,
      title: logTitle,
      text: '📋 This log is maintained automatically by RedLex.\nNo actions logged yet.',
    });

    const logKey = `logPostId:${logSubreddit.name}`;
    await redis.set(logKey, logPost.id);

    return c.json<UiResponse>({ showToast: '✅ Transparency log post created!' }, 200);
  } catch (err) {
    console.error('Create log post error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to create log post.' }, 200);
  }
  }
});

forms.post('/configure-milestones-submit', async (c) => {
  {
  const milestoneValues = await c.req.json<{
    enabled?: boolean;
    milestones?: string;
    postTitle?: string;
    postBody?: string;
  }>();

  try {
    const milestoneSubreddit = await reddit.getCurrentSubreddit();
    const milestoneList = (milestoneValues.milestones ?? '')
      .split(',')
      .map((entry) => Number.parseInt(entry.trim(), 10))
      .filter((entry) => Number.isFinite(entry))
      .sort((a, b) => a - b);

    await saveMilestoneSettings(milestoneSubreddit.name, {
      enabled: Boolean(milestoneValues.enabled),
      subscriberMilestones: milestoneList,
      postTitle: milestoneValues.postTitle ?? '🎉 We just hit {count} members!',
      postBody:
        milestoneValues.postBody ??
        "Thank you to every member of our community for helping us reach this milestone. Here's to the next one! 🚀\n\n— The Mod Team",
    });

    return c.json<UiResponse>({ showToast: '✅ Milestone settings saved!' }, 200);
  } catch (err) {
    console.error('Configure milestones error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to save settings.' }, 200);
  }
  }
});

forms.post('/configure-rule-explainer-submit', async (c) => {
  {
  const configureRuleExplainerValues = await c.req.json<{
    configureRuleExplainerEnabled?: boolean;
    configureRuleExplainerDefault?: string;
    configureRuleExplainerSignoff?: string;
  }>();

  try {
    const configureRuleExplainerSubreddit = await reddit.getCurrentSubreddit();
    const configureRuleExplainerKey = `ruleExplainerSettings:${configureRuleExplainerSubreddit.name}`;
    const configureRuleExplainerExisting = await redis.get(configureRuleExplainerKey);

    const configureRuleExplainerParsed = configureRuleExplainerExisting
      ? (JSON.parse(configureRuleExplainerExisting) as RuleExplainerSettings)
      : { enabled: false, rules: [], defaultMessage: '', signoff: '' };

    const configureRuleExplainerUpdated: RuleExplainerSettings = {
      ...configureRuleExplainerParsed,
      enabled: Boolean(configureRuleExplainerValues.configureRuleExplainerEnabled),
      defaultMessage: configureRuleExplainerValues.configureRuleExplainerDefault ?? '',
      signoff: configureRuleExplainerValues.configureRuleExplainerSignoff ?? '',
    };

    await redis.set(configureRuleExplainerKey, JSON.stringify(configureRuleExplainerUpdated));

    return c.json<UiResponse>({ showToast: 'Rule Explainer settings saved' }, 200);
  } catch (err) {
    console.error('Configure Rule Explainer error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to save settings.' }, 200);
  }
  }
});

forms.post('/view-milestones-submit', async (c) => {
  {
  try {
    const milestonesSubreddit = await reddit.getCurrentSubreddit();
    const milestonesList = await getCelebratedMilestones(milestonesSubreddit.name);

    if (milestonesList.length === 0) {
      return c.json<UiResponse>(
        {
          showForm: {
            name: 'viewMilestonesResult',
            form: {
              title: '🎉 Celebrated Milestones',
              acceptLabel: 'Close',
              fields: [
                {
                  name: 'result',
                  label: 'Milestones',
                  type: 'paragraph',
                  defaultValue: '🎉 No milestones celebrated yet!',
                },
              ],
            },
          },
        },
        200
      );
    }

    const milestonesFields = milestonesList.map((milestone, i) => {
      const milestonesDate = milestone.celebratedAt
        ? new Date(milestone.celebratedAt).toLocaleDateString()
        : 'Unknown date';

      return {
        name: `milestone_${i}`,
        type: 'paragraph' as const,
        label: `🎉 ${milestone.count.toLocaleString()} Members`,
        defaultValue: `Celebrated on ${milestonesDate}`,
      };
    });

    return c.json<UiResponse>(
      {
        showForm: {
          name: 'viewMilestonesResult',
          form: {
            title: '🎉 Celebrated Milestones',
            acceptLabel: 'Close',
            fields: milestonesFields,
          },
        },
      },
      200
    );
  } catch (err) {
    console.error('View milestones error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to load milestones.' }, 200);
  }
  }
});

forms.post('/view-milestones-result-noop', async (c) => {
  {
  return c.json<UiResponse>({ showToast: '' }, 200);
  }
});

forms.post('/setup-digest-submit', async (c) => {
  {
  const setupValues = await c.req.json<{
    postTitle?: string;
    enabled?: boolean;
    useAI?: boolean;
    openAIKey?: string;
  }>();

  try {
    const setupSub = await reddit.getCurrentSubreddit();
    const setupOpenAIKey = (setupValues.openAIKey ?? '').trim();

    if (setupOpenAIKey) {
      await redis.set(`digestApiKey:${setupSub.name}`, setupOpenAIKey);
    }
    await redis.set(
      `digestSettings:${setupSub.name}`,
      JSON.stringify({
        enabled: Boolean(setupValues.enabled),
        postTitle: setupValues.postTitle ?? '📰 Weekly Community Digest',
        useAI: Boolean(setupValues.useAI),
      })
    );

    const setupModeLabel = setupValues.useAI ? 'AI' : 'Template';
    return c.json<UiResponse>(
      { showToast: `✅ Digest configured! Mode: ${setupModeLabel}` },
      200
    );
  } catch (err) {
    console.error('Setup digest error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to save digest settings.' }, 200);
  }
  }
});

forms.post('/generate-digest-now-submit', async (c) => {
  {
  try {
    const nowSub = await reddit.getCurrentSubreddit();
    const nowSubredditName = nowSub.name;

    const nowDigestApiKey = await redis.get(`digestApiKey:${nowSubredditName}`);
    if (!nowDigestApiKey) {
      return c.json<UiResponse>({ showToast: '❌ Please set up digest first.' }, 200);
    }

    const nowRaw = await redis.get(`digestSettings:${nowSubredditName}`);
    const nowSettings = nowRaw ? JSON.parse(nowRaw) : { enabled: false, useAI: false };
    const nowUseAI = nowSettings.useAI ?? false;

    const nowApiKey = (await redis.get(`digestApiKey:${nowSubredditName}`)) ?? undefined;

    const { posts: nowPosts } = await buildDigestContent(nowSubredditName);
    await postWeeklyDigest(
      nowSubredditName,
      nowPosts,
      nowSettings.postTitle ?? '📰 Weekly Community Digest',
      nowUseAI,
      nowApiKey
    );

    return c.json<UiResponse>(
      { showToast: `✅ Digest posted! (${nowUseAI ? 'AI mode' : 'Template mode'})` },
      200
    );
  } catch (err) {
    console.error('Generate digest error:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to generate digest.' }, 200);
  }
  }
});