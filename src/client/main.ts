import '@devvit/web-view-scripts/scripts/devvit.v1.min.js';
import { context } from '@devvit/web/client';
const input = document.getElementById('usernameInput') as HTMLInputElement;
const btn = document.getElementById('lookupBtn') as HTMLButtonElement;
const results = document.getElementById('results') as HTMLDivElement;

const severityEmoji = (s: string) =>
  s === 'major' ? '🔴' : s === 'minor' ? '🟡' : '⚠️';

const lookup = async () => {
  const username = input.value.replace(/^u\//, '').trim().toLowerCase();
  if (!username) return;

  btn.disabled = true;
  btn.textContent = '...';
  results.innerHTML = '';

  try {
    const res = await fetch(`/api/strikes/${username}`);
    const data = await res.json();
    const strikes = data.strikes ?? [];

    if (strikes.length === 0) {
      results.innerHTML = `<div class="empty">✅ No strikes found for u/${username}</div>`;
      return;
    }

    const badgeColor = strikes.length >= 3 ? '#ff4444' : '#ffaa00';
    let html = `
      <div class="user-header">
        <span><strong>u/${username}</strong></span>
        <span class="badge" style="background:${badgeColor}">
          ${strikes.length} strike${strikes.length !== 1 ? 's' : ''}
        </span>
      </div>
    `;

    for (const s of strikes) {
      const date = new Date(s.createdAt).toLocaleDateString();
      html += `
        <div class="strike-card ${s.severity}">
          <div class="strike-top">
            <span class="strike-rule">${severityEmoji(s.severity)} ${s.rule}</span>
            <span class="strike-date">${date}</span>
          </div>
          <div class="strike-reason">${s.reason}</div>
          <div class="strike-meta">
            logged by u/${s.modName}
            ${s.postUrl ? `· <a href="${s.postUrl}" target="_blank">view post</a>` : ''}
          </div>
        </div>
      `;
    }

    results.innerHTML = html;
  } catch {
    results.innerHTML = `<div class="empty">❌ Failed to load strikes. Try again.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Look Up';
  }
};

btn.addEventListener('click', lookup);
input.addEventListener('keydown', (e) => e.key === 'Enter' && lookup());