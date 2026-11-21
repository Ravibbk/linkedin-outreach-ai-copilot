# LinkedIn Outreach AI & Job-Search Copilot — v3.3.0

A production-grade Chrome Extension (Manifest V3) that serves as an intelligent outreach and job-search copilot for LinkedIn. Built with strict anti-hallucination guarantees, privacy-first local operation, and human-in-the-loop assistance.

**"You click Apply. We prepare everything."**

---

## Quick Install

1. Download/clone the project folder
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** → select the `linkedin extention` folder
5. Open any LinkedIn profile, job search, or job posting page and click the extension icon

---

## Free Mode vs AI Mode

| Capability | Free Mode (Default) | AI Mode (Optional) |
|---|---|---|
| **API Key Required** | **No** — zero keys, zero setup | Yes (user's personal Anthropic API key) |
| **Data Privacy** | **100% on-device** — nothing leaves machine | Transmits to `api.anthropic.com` over TLS |
| **Outreach Generation** | Rule-based signals + deterministic writer | Claude 3.5 Haiku synthesis |
| **Job Search Suggestions** | Generated from your Career Profile | Generated from Career Profile |
| **Job Card Ranking** | Weighted term overlap (role +3, skills +2, loc +1, avoid -2) | Batched AI reasoning with local fallback |
| **Application Kit** | Deterministic match analysis, cover notes, Q&A | Tailored kit with AI-refined phrasing |
| **Anti-Hallucination Guarantee** | **Strictly enforced by `validateKit()`** | **Strictly enforced by `validateKit()`** |
| **Application Tracker & CRM** | Full local CRUD, status pipeline, CSV export | Full local CRUD, status pipeline, CSV export |

---

## Features (v3.3.0)

### 1. 💼 Jobs Tab (New in Stage B)
- **Career Profile:** Define target roles, key skills, preferred locations, work type (remote/hybrid/onsite), experience level, and avoid keywords.
- **"Infer from Resume":** 1-click auto-fill from your uploaded resume or manual profile skills.
- **Find Jobs with Career Profile:** 3–5 targeted LinkedIn search query links with automatic filter presets (`f_WT`, `f_E`, `f_TPR`).
- **Rank Jobs on Current Page:** Analyzes visible job search cards on LinkedIn and scores them into **Strong (≥7)**, **Good (3–6)**, or **Stretch (<3)** with 1-line plain English reasons. No fake percentages.
- **Scroll & Append:** Respects LinkedIn's pagination: "Scroll to load more, then click again."

### 2. 📋 Application Kit (Job Posting Analysis)
On any `/jobs/view/` job posting, generates a complete 6-part kit with Copy buttons:
- **Match Analysis:** Clear statement of verified matched skills, real missing skill gaps, and strategic advice.
- **Tailored Resume Highlights:** 3–4 bullet points strictly derived from your actual experience.
- **Keywords Checklist:** Interactive tags showing which job requirements match your resume (✓) vs. are missing (✗).
- **Tailored Cover Note:** High-impact, concise cover note under 1,200 characters ready for job applications.
- **Screening Question Answers:** Realistic draft answers to common screening questions (motivation, background, YOE) with explicit placeholders (`[add your answer here]`) for unknown items.
- **Find People to Reach Out:** Direct search links for recruiters, hiring team members, and university alumni at the hiring company.

### 3. 🛡️ Anti-Hallucination Guarantee
- **Never fabricates claims:** If your resume does not mention Kubernetes, Docker, or 10 years of experience, the extension **never** claims it.
- **Explicit Gaps:** Unmatched job requirements are surfaced honestly as gaps in your Match Analysis.
- **Automated Validation:** Every kit passes through `validateKit()` before rendering. If any claim cannot be verified against your resume, it is rejected.

### 4. 🗂️ Application Tracker & CRM
- Save jobs from search ranking or job detail with one click.
- Filter by status: All, Saved, Applied, Interviewing, Follow-up.
- **7-Day Follow-Up Alert:** Automatically calculates and flags applications where 7 days have passed since applying.
- **Apply Assist Checklist:** Per-job progress checkboxes (Resume tailored, Cover note ready, Contact saved, Applied on site).
- **Client-Side CSV Export:** One-click download of all tracked jobs for Excel/Sheets.
- **Daily Outreach Counter:** Soft reminder at 15 outreach notes per day to encourage high-quality, thoughtful outreach over spam.

### 5. 🎯 Outreach Generator (Preserved from Stage A)
- **Quick Mode & Deep Mode:** 3-layer honest pipeline (Profile Understanding, Signal Finder, Message Writer).
- **4 Message Types:** Networking, Job Opportunity, Referral Request, Collaboration.
- **3 Tones:** Formal, Neutral, Casual.
- **3 Bounded Lengths:** Connection Note (300 chars), Short DM (500), Full Message (900).
- **Signal Chips:** Shared school, overlapping skills, recent posts, current role, trajectory.
- **Insert into LinkedIn:** Places drafted text directly into open LinkedIn message composer without clicking Send.
- **Recent Contacts:** History of up to 20 outreach drafts with auto-restore.

---

## LinkedIn Terms of Service & Compliance

To protect user accounts and uphold LinkedIn's Terms of Service:
1. **Zero Action Automation:** The extension never clicks Apply, Connect, or Send. It never submits application forms automatically.
2. **Human-in-the-Loop:** All materials are prepared for the user to review, edit, copy, and submit manually.
3. **No Background Scraping:** Only reads the DOM of the active tab the user is viewing. No crawling, no background spiders, no automated pagination.

---

## Automated Quality Gates

Run the automated test suites locally:
```bash
# 1. Syntax check on all extension scripts
node --check background.js
node --check content_script.js
node --check popup.js
node --check utils/linkedinUrls.js
node --check utils/jobScraper.js
node --check utils/jobRanker.js
node --check utils/kitBuilder.js
node --check utils/tracker.js

# 2. Stage B Quality Gate (46 tests: DOM IDs, URL builder, Ranker, Anti-Hallucination, Tracker)
node dev/check-jobs.js

# 3. Stage A Quality Gate (2587 assertions across message writer permutations)
node dev/check-writer.js
```

---

## File Structure

```
linkedin extention/
├── manifest.json            — MV3 manifest (v3.3.0)
├── background.js            — Background service worker & copilot router
├── content_script.js        — Defensive DOM scraper (profiles, jobs, people, composer)
├── popup.html               — 4-tab UI: GENERATE, JOBS, RECENT, SETTINGS
├── popup.js                 — Popup controller & event wiring
├── popup.css                — Styles matching design tokens & accessibility
├── PRIVACY.md               — Detailed privacy policy & compliance declaration
├── CHANGELOG.md             — Version history & before→after diffs
├── utils/
│   ├── cache.js             — Storage layer for recent contacts and drafts
│   ├── limits.js            — Character limit constants
│   ├── linkedinUrls.js      — URL builder for search links with filter presets
│   ├── jobScraper.js        — Multi-strategy defensive DOM scraper helpers
│   ├── jobRanker.js         — Weighted match scoring & Strong/Good/Stretch ranker
│   ├── kitBuilder.js        — Application kit builder & validateKit() gate
│   └── tracker.js           — Local application CRM & CSV exporter
├── icons/                   — icon16.png, icon48.png, icon128.png
├── docs/
│   └── store-listing.md     — Chrome Web Store listing copy & permissions justification
└── dev/
    ├── check-jobs.js        — Stage B automated test suite (46 quality gate tests)
    ├── check-writer.js      — Stage A automated test suite (2587 writer assertions)
    └── fixtures/            — Synthetic HTML test mocks
        ├── jobs-search.html
        ├── job-detail.html
        └── people-search.html
```
- [ ] Name in greeting is clean (no emoji, no pronouns, no "Dr.")

### Empty / limited states
- [ ] Open a non-LinkedIn page → "No LinkedIn profile detected" warning, button disabled
- [ ] Open a profile with no About section → message still generates; no "undefined"
- [ ] Open a minimal profile (just name + headline) → quality badge shows "Limited profile data"
- [ ] Empty profile → message still non-empty, no broken text

### Free Mode
- [ ] No API key → header shows "● Free Mode"
- [ ] Generate message → generates instantly, no spinner hang
- [ ] Regenerate → visibly different text
- [ ] All 4 types × 3 tones × 3 lengths → all work, all within limit

### AI Mode (requires valid key)
- [ ] Enter key in Settings → click **Test** → "✓ Key works — AI Mode enabled"
- [ ] Header shows "● AI Mode"
- [ ] Generate → shows "AI message ready."
- [ ] Wrong key → "Invalid API key. Check your key in Settings."
- [ ] Offline → "Could not reach Anthropic. Check your connection."
- [ ] Rate limited (optional) → "Rate limited. Try again in a moment."
- [ ] After AI failure → fallback message shown with "AI unavailable — used Free Mode writer."

### Resume
- [ ] Upload PDF (< 4MB) → status shows "ready — click Save Settings"
- [ ] Save Settings → (with key) auto-analyzes → "Resume understood" preview appears
- [ ] (without key) → manual skill fields visible and editable
- [ ] "Re-analyze" link → re-sends for analysis

### Draft / Recent
- [ ] Generate a message, close popup, reopen → "Restored draft" pill appears
- [ ] Click "Start fresh" → clears draft
- [ ] Recent tab → shows up to 20 contacts with type/tone/mode badges
- [ ] Click **Open profile** on a recent card → new tab opens to profile
- [ ] Click **Copy** on a recent card → copies message
- [ ] Click **Clear all** → list clears

### Insert
- [ ] Generate a message, then open LinkedIn Message composer → click **Insert** → text appears in composer, no send was clicked
- [ ] Insert with no composer open → toast: "Open a 'Message' or 'Add a note' composer first…"

### Settings
- [ ] Privacy note reads: "Free Mode: Everything stays on your device. AI Mode: Profile text and resume are sent to Anthropic using your own API key."
- [ ] Save Settings with new key → only key is saved (not entire settings blob)

---

## Limitations (Cannot verify without live Chrome + LinkedIn)

1. **LinkedIn DOM selectors** may change. The scraper uses multi-strategy detection but LinkedIn's structure is not guaranteed. If scraping returns empty fields, LinkedIn may have updated their markup.
2. **Claude claude-haiku-5-5** — model availability and response format assumed correct per spec; not independently verified.
3. **Insert into LinkedIn** — composer selectors are best-effort. LinkedIn's React app changes frequently; test before demoing.
4. **PDF resume analysis** — works for text-layer PDFs; scanned image PDFs may not extract text.
5. **Non-English LinkedIn** — heading variants added for French/German/Spanish/Portuguese/Turkish. Other languages may fall back to empty sections.
6. **Connection note limit (300)** — re-verify LinkedIn's current limit before shipping; it has changed before.

---

## File Structure

```
linkedin extention/
├── manifest.json          — MV3 manifest, v3.2.0
├── background.js          — Service worker: scrape, generate, analyze, signal detection
├── content_script.js      — DOM scraper + composer insert
├── popup.html             — Extension popup UI
├── popup.js               — Popup logic and state management
├── popup.css              — Styles
├── utils/
│   ├── cache.js           — Storage layer: contacts (20) + drafts
│   ├── limits.js          — Character limit constants
│   └── signals.js         — Signal detection (reference copy; background.js is self-contained)
├── icons/                 — icon16.png, icon48.png, icon128.png
├── dev/
│   └── check-writer.js    — Quality gate: 2587 assertions across 7 profiles × 4 types × 3 tones × 3 lengths
├── README.md
└── CHANGELOG.md
```
