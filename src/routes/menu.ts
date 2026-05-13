import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
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
              helpText: 'Reddit username of the offender (without u/)',
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
              defaultValue: '',
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
              helpText: 'Reddit username of the offender (without u/)',
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
              defaultValue: '',
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
menu.post('/create-redlex-post', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'createRedlexPost',
        form: {
          title: '⚖️ Create RedLex Dashboard',
          acceptLabel: 'Create',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'title',
              label: 'Post Title',
              type: 'string',
              required: true,
              defaultValue: '⚖️ RedLex — Mod Strike Dashboard',
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