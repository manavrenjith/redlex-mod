# RedLex — Reddit Moderation Toolkit

A comprehensive moderation suite built with Devvit for the Reddit Mod Tools Hackathon. RedLex combines seven moderation features into a single app, giving mod teams everything they need to manage communities effectively.

## Features

RedLex includes seven fully working mod tools:

### ⚖️ Strike Ledger
Track rule violations per user with a structured strike system.

- Add a strike via right-click on any post or comment
- Username and post URL are auto-prefilled from context
- Severity levels: warning, minor, major
- User receives a private message notification on every strike
- View full strike history per user from the post or subreddit menu

### 📰 Weekly Community Digest
Weekly roundup of top community content — with optional AI summaries.

- Two modes: AI (OpenAI GPT-3.5 Turbo) or Template
- Fetches the week's top posts from the subreddit
- AI mode calls `api.openai.com` and generates a natural language summary
- Template mode builds a smart digest locally — no API key needed
- Weekly scheduler + manual trigger
- Setup form to configure your OpenAI API key and preferred mode

### 📋 Shift Handoff Notes
Leave notes between mod shifts so nothing gets missed.

- Add a note with a text body and priority (normal / urgent)
- View all unresolved notes at a glance
- Resolve notes by ID once handled
- Notes stored per subreddit

### 📜 Transparency Log
Automatically log every mod action to a public post in the subreddit.

- Hooks into the `onModAction` trigger — no manual logging needed
- Creates and maintains a single pinned log post
- Post body is updated live with each new action
- Action emoji mapping: `removelink` → 📛, `removecomment` → 💬, `banuser` → 🔨, `approvelink` → ✅

### 🎉 Community Milestones
Celebrate subscriber milestones automatically.

- Configure which subscriber counts to celebrate (e.g. 100, 500, 1000)
- Milestone check runs on every new post submission via `onPostSubmit`
- Posts a celebration thread when a milestone is hit
- Each milestone is only ever celebrated once

### 📊 Mod Action Digest

A weekly summary of mod team activity, posted automatically.

- Tracks every mod action with the acting moderator's name via the onModAction trigger
- Groups actions by moderator and counts each type (removals, bans, approvals)
- Two modes: AI (OpenAI GPT-3.5 Turbo) for a natural language summary, or Template for a clean markdown table with no API key needed
- Posts a formatted digest to the subreddit every Monday at 9AM via the scheduler
- Manual "Generate Digest Now" option for on-demand reports at any time
- Configure post title, AI mode, and OpenAI API key via the Configure Mod Digest menu item
- Resets the action log after each digest so each week starts fresh



### 💬 Rule Explainer
Automatically send a friendly DM to users when their post is removed.

- Triggers on every `removelink` mod action via `onModAction`
- Matches the removal reason against configurable rule templates using keyword matching
- Falls back to a default message if no template matches
- DM explains exactly which rule was broken and how to repost correctly
- Fully configurable: enable/disable, custom signoff, per-rule templates
- Add and view rule templates directly from the subreddit menu

## Tech Stack

- [Devvit](https://developers.reddit.com/) — Reddit's platform for building and deploying apps
- [Hono](https://hono.dev/) — Lightweight web framework for backend logic
- [Vite](https://vite.dev/) — Fast build tool
- [TypeScript](https://www.typescriptlang.org/) — Type-safe development
- [Redis](https://developers.reddit.com/docs/redis) — Persistent storage via `@devvit/web/server`
- [OpenAI GPT-3.5 Turbo](https://platform.openai.com/) — Optional AI summaries for the weekly digest

## Getting Started

1. Install the Devvit CLI:

```bash
npm install -g devvit
```

2. Clone this repo and install dependencies:

```bash
git clone https://github.com/Dry_Finance_1240/redlex-mod
cd redlex-mod
npm install
```

3. Configure your app in `devvit.json`:
   - Update the app name if forking
   - Set your development subreddit under `"dev"`

4. Start developing:

```bash
npm run dev
```

5. Upload and test in your development subreddit:

```bash
devvit upload
```

6. Hard refresh Reddit (Ctrl+Shift+R) after each upload so menu items update.

## Project Structure

```
src/
├── index.ts              # Hono server entry point
└── routes/
    ├── api.ts            # Public API endpoints
    ├── forms.ts          # All form submission handlers
    ├── menu.ts           # Context menu item handlers
    └── triggers.ts       # onModAction, onPostSubmit, onAppInstall
```

## Commands

- `npm run dev` — Watch mode with live rebuild
- `npm run build` — Production build
- `devvit upload` — Upload a new version to Reddit
- `devvit logs r/your_subreddit` — Stream live logs from your app

## How It Works

All features are accessed through Reddit's native context menus — no external UI or webview required.

**Post or comment menu**
- Right-click a post or comment to add a strike or view a user's strike history

**Subreddit menu**
- Access shift notes, transparency log, milestones, digests, and rule explainer config from the subreddit mod menu

**Automatic triggers**
- `onModAction` — powers the transparency log and rule explainer DMs
- `onPostSubmit` — powers the milestone checker
- Scheduled tasks — fire the mod digest and community digest every Monday at 9AM

## Development Notes

- All persistent state lives in Redis — no external database needed
- External API calls are restricted by Devvit; only `api.openai.com` is on the allowlist
- `select` field values from forms come back as arrays — always normalize with `Array.isArray()`
- `getTopPosts()` returns a `Listing` — call `.all()` to convert to an array
- `TaskRequest` has no subreddit property — use `context.subredditName` instead

## Deployment

1. Test thoroughly in your development subreddit
2. Run `devvit upload` to upload your app
3. Once ready, submit for Reddit's app review process
4. Once approved, other communities can install RedLex from Reddit's app directory

## Test Subreddit

[r/redlex_mod_dev](https://www.reddit.com/r/redlex_mod_dev)

