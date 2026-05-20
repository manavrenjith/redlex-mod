import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
import type { FormField } from '@devvit/shared-types/shared/form.js';

export const menu = new Hono();

const buildNukeFields = (targetId: string): FormField[] => [
  {
    name: 'targetId',
    label: 'Target ID',
    type: 'string',
    helpText: 'Auto-filled from the selected item.',
    required: true,
    defaultValue: targetId,
  },
  {
    name: 'remove',
    label: 'Remove comments',
    type: 'boolean',
    defaultValue: true,
  },
  {
    name: 'lock',
    label: 'Lock comments',
    type: 'boolean',
    defaultValue: false,
  },
  {
    name: 'skipDistinguished',
    label: 'Skip distinguished comments',
    type: 'boolean',
    defaultValue: false,
  },
];

const buildNukeForm = (title: string, targetId: string) => ({
  fields: buildNukeFields(targetId),
  title,
  acceptLabel: 'Mop',
  cancelLabel: 'Cancel',
});

menu.post('/mop-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  console.log('request', request.targetId);
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'mopComment',
        form: buildNukeForm('Mop Comments', request.targetId),
      },
    },
    200
  );
});

menu.post('/mop-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'mopPost',
        form: buildNukeForm('Mop Post Comments', request.targetId),
      },
    },
    200
  );
});
// RedLex - Add Strike menu item on comments
menu.post('/add-strike-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  let authorName = '';
  try {
    const comment = await reddit.getCommentById(request.targetId as T1);
    authorName = comment.authorName ?? '';
  } catch {
    authorName = '';
  }
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'addStrikeComment',
        form: {
          title: '⚖️ RedLex — Add Strike',
          acceptLabel: 'Add Strike',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'username',
              label: 'Username',
              type: 'string',
              required: true,
              helpText:
                'Reddit username of the offender (without u/). Username has been pre-filled if available.',
              defaultValue: authorName,
            },
            {
              name: 'rule',
              label: 'Rule Violated',
              type: 'string',
              required: true,
              helpText: 'e.g. Rule 1, Rule 3, No spam',
            },
            {
              name: 'reason',
              label: 'Details',
              type: 'string',
              required: true,
              helpText: 'Brief description of what they did',
            },
            {
              name: 'severity',
              label: 'Severity',
              type: 'select',
              options: [
                { label: '⚠️ Warning', value: 'warning' },
                { label: '🟡 Minor', value: 'minor' },
                { label: '🔴 Major', value: 'major' },
              ],
              required: true,
            },
            {
              name: 'postUrl',
              label: 'Post URL (optional)',
              type: 'string',
              required: false,
              helpText: 'Link to the offending post or comment',
              defaultValue: request.targetId
                ? `https://reddit.com/comments/${request.targetId}`
                : '',
            },
          ],
        },
      },
    },
    200
  );
});

// RedLex - Add Strike menu item on posts
menu.post('/add-strike-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  let authorName = '';
  try {
    const post = await reddit.getPostById(request.targetId as T3);
    authorName = post.authorName ?? '';
  } catch {
    authorName = '';
  }
  const requestPostId = request.targetId?.replace('t3_', '') ?? '';
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'addStrikePost',
        form: {
          title: '⚖️ RedLex — Add Strike',
          acceptLabel: 'Add Strike',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'username',
              label: 'Username',
              type: 'string',
              required: true,
              helpText:
                'Reddit username of the offender (without u/). Username has been pre-filled if available.',
              defaultValue: authorName,
            },
            {
              name: 'rule',
              label: 'Rule Violated',
              type: 'string',
              required: true,
              helpText: 'e.g. Rule 1, Rule 3, No spam',
            },
            {
              name: 'reason',
              label: 'Details',
              type: 'string',
              required: true,
              helpText: 'Brief description of what they did',
            },
            {
              name: 'severity',
              label: 'Severity',
              type: 'select',
              options: [
                { label: '⚠️ Warning', value: 'warning' },
                { label: '🟡 Minor', value: 'minor' },
                { label: '🔴 Major', value: 'major' },
              ],
              required: true,
            },
            {
              name: 'postUrl',
              label: 'Post URL (optional)',
              type: 'string',
              required: false,
              helpText: 'Link to the offending post or comment',
              defaultValue: requestPostId
                ? `https://reddit.com/comments/${requestPostId}`
                : '',
            },
          ],
        },
      },
    },
    200
  );
});
menu.post('/view-strikes', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewStrikes',
        form: {
          title: '🔍 RedLex — View Strikes',
          acceptLabel: 'Look Up',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'username',
              label: 'Username to look up',
              type: 'string',
              required: true,
              helpText: 'Enter the Reddit username (without u/)',
              defaultValue: '',
            },
          ],
        },
      },
    },
    200
  );
});
menu.post('/create-log-post', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'createLogPost',
        form: {
          title: '📋 Create Transparency Log Post',
          acceptLabel: 'Create',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'title',
              label: 'Post Title',
              type: 'string',
              required: true,
              defaultValue: '📋 RedLex — Mod Action Log',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/add-shift-note', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'addShiftNote',
        form: {
          title: '📋 Add Shift Note',
          acceptLabel: 'Add Note',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'text',
              label: 'Note',
              type: 'paragraph',
              required: true,
              helpText: 'What should the next mod know?',
            },
            {
              name: 'priority',
              label: 'Priority',
              type: 'select',
              options: [
                { label: '📌 Normal', value: 'normal' },
                { label: '🔴 Urgent', value: 'urgent' },
              ],
              required: true,
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/view-shift-notes', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewShiftNotes',
        form: {
          title: '📋 View Shift Notes',
          acceptLabel: 'View',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'confirm',
              label: 'Load notes',
              type: 'string',
              defaultValue: 'yes',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/resolve-shift-note', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'resolveShiftNote',
        form: {
          title: '✅ Resolve Shift Note',
          acceptLabel: 'Resolve',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'noteId',
              label: 'Note ID',
              type: 'string',
              required: true,
              helpText: 'Enter the ID of the note to resolve',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/configure-rule-explainer', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'configureRuleExplainer',
        form: {
          title: '⚙️ Configure Rule Explainer',
          acceptLabel: 'Save Settings',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'configureRuleExplainerEnabled',
              label: 'Enable Rule Explainer',
              type: 'boolean',
              defaultValue: true,
            },
            {
              name: 'configureRuleExplainerDefault',
              label: 'Default message (used when no rule matches)',
              type: 'paragraph',
              required: true,
            },
            {
              name: 'configureRuleExplainerSignoff',
              label: 'Signoff line (e.g. — The mod team)',
              type: 'string',
              required: true,
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/add-rule-template', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'addRuleTemplate',
        form: {
          title: '📋 Add Rule Template',
          acceptLabel: 'Add Template',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'addRuleTemplateKeyword',
              label: 'Keyword (matched against removal reason, case-insensitive)',
              type: 'string',
              required: true,
            },
            {
              name: 'addRuleTemplateRuleName',
              label: 'Rule name (e.g. Rule 3 — No self-promotion)',
              type: 'string',
              required: true,
            },
            {
              name: 'addRuleTemplateExplanation',
              label: 'Friendly explanation of what went wrong',
              type: 'paragraph',
              required: true,
            },
            {
              name: 'addRuleTemplateHowToRepost',
              label: 'Step-by-step how to repost correctly',
              type: 'paragraph',
              required: true,
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/view-rule-templates', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewRuleTemplates',
        form: {
          title: '📋 View Rule Templates',
          acceptLabel: 'View',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'confirm',
              label: 'Load rule templates',
              type: 'string',
              defaultValue: 'yes',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/internal/menu/create-log-post', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'createLogPost',
        form: {
          title: '📋 Create Transparency Log Post',
          acceptLabel: 'Create',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'title',
              label: 'Post Title',
              type: 'string',
              required: true,
              defaultValue: '📋 RedLex — Mod Action Log',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/configure-milestones', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'configureMilestones',
        form: {
          title: '🎉 Configure Community Milestones',
          acceptLabel: 'Save Settings',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'enabled',
              label: 'Enable Milestones',
              type: 'boolean',
              defaultValue: true,
            },
            {
              name: 'milestones',
              label: 'Subscriber Milestones',
              type: 'string',
              required: true,
              helpText: 'Comma-separated numbers e.g. 100,500,1000,5000',
              defaultValue: '100,500,1000,5000,10000',
            },
            {
              name: 'postTitle',
              label: 'Celebration Post Title',
              type: 'string',
              required: true,
              helpText: 'Use {count} to insert the milestone number',
              defaultValue: '🎉 We just hit {count} members!',
            },
            {
              name: 'postBody',
              label: 'Celebration Post Body',
              type: 'paragraph',
              required: true,
              helpText: 'Use {count} to insert the milestone number',
              defaultValue:
                'Thank you to every member for helping us reach this milestone! 🚀\n\n— The Mod Team',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/internal/menu/view-milestones', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewMilestones',
        form: {
          title: '🎉 Celebrated Milestones',
          acceptLabel: 'Close',
          fields: [
            {
              name: 'confirm',
              label: 'Load milestones',
              type: 'string',
              defaultValue: 'yes',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/view-milestones', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'viewMilestones',
        form: {
          title: '🎉 View Celebrated Milestones',
          acceptLabel: 'View Milestones',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'confirm',
              label: 'Click "View" to load all celebrated milestones',
              type: 'boolean' as const,
              defaultValue: false,
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/setup-digest', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'setupDigest',
        form: {
          title: '📰 Setup Weekly Digest',
          acceptLabel: 'Save',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'postTitle',
              label: 'Digest Post Title',
              type: 'string' as const,
              required: true,
              defaultValue: '📰 Weekly Community Digest',
            },
            {
              name: 'enabled',
              label: 'Enable Weekly Digest',
              type: 'boolean' as const,
              defaultValue: true,
            },
            {
              name: 'useAI',
              label: 'Use AI Summary (requires OpenAI API key)',
              type: 'boolean' as const,
              defaultValue: false,
              helpText: 'Enable for smarter, more engaging digest summaries',
            },
            {
              name: 'openAIKey',
              label: 'OpenAI API Key (optional)',
              type: 'string' as const,
              required: false,
              helpText:
                'Get your key from platform.openai.com. Leave blank to use template mode.',
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/generate-digest-now', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'generateDigestNow',
        form: {
          title: '📰 Generate Digest Now',
          acceptLabel: 'Generate',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'confirm',
              label: "This will fetch this week's top posts and post a digest",
              type: 'boolean' as const,
              defaultValue: true,
            },
          ],
        },
      },
    },
    200
  );
});