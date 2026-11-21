# CHANGELOG — LinkedIn Outreach AI v3.1.0 → v3.2.0

| # | Problem (Before) | Fix (After) | Files Touched |
|---|---|---|---|
| 1 | Deep Mode L1/L2 were labeled "OpenAI — Profile Parser" and "OpenAI — Web Enrichment" but only ran local JS | Renamed to "Profile Understanding" and "Signal Finder"; labels accurately reflect what runs (Local or AI tag shown per layer) | `popup.html`, `popup.js` |
| 2 | `handleEnrich()` ran local `normalizeProfile()` + `buildHooks()` then `await delay(300)` (a fake wait) and returned | Real pipeline: `RUN_PARSE` (L1) then `RUN_SIGNALS` (L2) with true per-layer status; L1 optionally calls Claude with key | `background.js`, `popup.js` |
| 3 | `companyNews` was always `[]`; L2 label claimed "Searches company news & public work" | `companyNews` removed entirely; L2 is Signal Finder (local ranking), no web research claimed or attempted | `background.js`, `popup.html`, `popup.js` |
| 4 | Resume PDF stored as base64 and sent in every generate payload but never read | Resume only sent once to Claude on analysis; subsequent calls use stored `senderProfile` JSON fields; `resumeBase64` never sent in generate payloads | `background.js`, `popup.js` |
| 5 | `localMessage()` was deterministic — Regenerate returned identical text | Variant-based writer with `variantIndex`: different opener bank, ask bank per variant; always produces different output | `background.js` |
| 6 | No length selector; AI prompt said "under 600 chars"; LinkedIn connection notes are 300 chars max | Length selector: Connection Note (300), Short DM (500), Full Message (900); counter shows `N / LIMIT` with amber at 90%, red over | `popup.html`, `popup.js`, `popup.css`, `utils/limits.js` |
| 7 | AI failure showed raw error; no timeout, no retry, no fallback | 25-second `AbortController` timeout; one retry on 429/5xx; graceful fallback to local writer with clear notice | `background.js` |
| 8 | Scraper used fixed scroll offsets (800/1600/2400/0) with hardcoded waits | Progressive bounded scroll: page-relative steps, 4-second hard cap, restores original scroll position | `content_script.js` |
| 9 | No double-injection guard; content script could register twice | `if (window.__outreachAIInjected) return;` guard at top of CS | `content_script.js` |
| 10 | `isCurrent: experienceEntries.length === 0` — first scraped entry assumed current | `isCurrent` now detected via "Present" / "Current" date marker in duration string | `content_script.js` |
| 11 | English-only section detection (`getSection('About')` etc.) | Multi-language variants: French, German, Spanish, Portuguese, Turkish added for About/Experience/Skills/Education/Activity | `content_script.js` |
| 12 | Location detection required a comma | Relaxed: accepts city names, regional keywords ("Bay Area", "Remote") without mandatory comma | `content_script.js` |
| 13 | Loose recentPosts filter let UI chrome through | Tighter filter: excludes "like", "comment", "repost", "ago", "see all activity", "load more" and similar | `content_script.js` |
| 14 | No `mainText` or `scrapeQuality` fields | Added `mainText` (cleaned, deduped, capped ~6000 chars) for AI profile parse; `scrapeQuality` (0–100) for quality badge | `content_script.js` |
| 15 | `buildHooks()` returned generic strings; `localMessage()` used banned cliché "I came across your profile and was impressed" | `detectSignals()` returns ranked `{id, type, value, reason, priority}` objects; hook lines per signal type never use banned phrases | `background.js` |
| 16 | Job message said "with your team" to all recipients regardless of their role | "with your team" only used when recipient appears to be a recruiter/HR (title regex check) | `background.js` |
| 17 | No name cleaning — emoji names, pronoun suffixes, honorifics used raw; avatar showed emoji | `cleanName()` / `cleanFirstName()` strip emoji, `(he/him)`, `Dr.`, `MBA` etc.; avatar shows first Latin letter | `background.js`, `popup.js` |
| 18 | State lost on popup close; no draft persistence | Draft saved per profileUrl (600ms debounce); restored on reopen with "Restored draft" pill + "Start fresh" | `popup.js`, `utils/cache.js` |
| 19 | Recent capped at 5; label said "Last 5 contacts" | Raised to 20; label shows dynamic count; cards show type/tone/mode badges, Open Profile link, expand/collapse | `utils/cache.js`, `popup.js`, `popup.html`, `popup.css` |
| 20 | `SAVE_RECENT` / `GET_RECENT` background handlers duplicated `cache.js` | Dead handlers removed from `background.js`; popup uses `Cache` directly | `background.js` |
| 21 | `checkLicenseStatus()` was misleadingly named | Renamed to `updateModeBadge()` | `popup.js` |
| 22 | `license-key-*` CSS classes and HTML attributes | Renamed to `api-key-*` throughout | `popup.html`, `popup.css` |
| 23 | Empty `#no-key-warning` alert div (blank content, never shown) | Removed | `popup.html` |
| 24 | `response.remaining` dead read (never set by background) | Removed | `popup.js` |
| 25 | Settings note said "No data is sent to any company server" (false in AI Mode) | Accurate note: "Free Mode: local only. AI Mode: sent to Anthropic using your own key." | `popup.html` |
| 26 | `handleValidateKey()` spread all stored settings (including resumeBase64) back into storage | Writes only `userApiKey` via targeted `chrome.storage.local.set` | `popup.js` |
| 27 | No signals shown to user; no explanation of why the message was written | "Why this message?" expandable panel showing real signals used; signal chips in Deep Mode | `popup.html`, `popup.js`, `popup.css` |
| 28 | No quality indicators | Quality chips: Specific / Concise / Profile-based (computed from real checks, no fake %) | `popup.html`, `popup.js`, `popup.css` |
| 29 | Changing Tone/Type required re-clicking Scrape; Regenerate did nothing different in terms of settings | Setting changes auto-trigger regenerate (400ms debounce); if user edited text first, prompts "Regenerate?" | `popup.js` |
| 30 | No loading feedback for message generation | Skeleton shimmer while generating; respects `prefers-reduced-motion` | `popup.html`, `popup.css`, `popup.js` |
| 31 | Copy button didn't show feedback on clipboard failure | Toast shows "Copied to clipboard" (success) or fallback if clipboard API fails; Ctrl+Enter shortcut added | `popup.js`, `popup.css` |
| 32 | No Insert button | Insert button sends message to `insertMessage()` in content_script; never clicks Send; shows error if no composer open | `popup.html`, `popup.js`, `content_script.js` |
| 33 | No ARIA roles on tabs; no aria-live on status | `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `aria-live="polite"` on status and char-count | `popup.html` |
| 34 | No visible focus rings | `:focus-visible` with `outline: 2px solid var(--accent)` on all interactive elements | `popup.css` |
| 35 | Resume not usable in Free Mode | Manual skill fields (topSkills, one achievement) shown without key; feeds `senderProfile` for personalization | `popup.html`, `popup.js` |
| 36 | Resume preview after analysis | "Resume understood" card with headline, top skills, one achievement; "Re-analyze" link | `popup.html`, `popup.js`, `popup.css` |
| 37 | Version was 3.1.0 | Bumped to 3.2.0 | `manifest.json` |

---

# CHANGELOG — LinkedIn Outreach AI v3.2.0 → v3.3.0 (Stage B: Job-Search Copilot)

| # | Feature / Area | Implementation Details | Files Touched |
|---|---|---|---|
| 38 | 4th Tab: JOBS | Added a dedicated JOBS tab in nav (`GENERATE`, `JOBS`, `RECENT`, `SETTINGS`) with the tagline *"You click Apply. We prepare everything."* Fits seamlessly within the 400px popup shell. | `popup.html`, `popup.css`, `popup.js` |
| 39 | Career Profile (J1) | Collapsible profile card with target roles, key skills, locations, work type (remote/hybrid/onsite), seniority, and avoid keywords. Stores locally in `chrome.storage.local`. Includes 1-click *"Infer from Resume"*. | `popup.html`, `popup.js`, `popup.css` |
| 40 | Smart Search URL Builder (J2) | Generates 3–5 tailored LinkedIn job searches. Uses `LinkedInURLs.jobsSearch()` with best-effort filter parameters (`f_WT`, `f_E`, `f_TPR=r604800` past 7 days) and proper URI encoding. Opens in a new tab. | `utils/linkedinUrls.js`, `popup.js`, `popup.html` |
| 41 | Page Context Auto-Detection | Detects whether active tab is a jobs search (`/jobs/search`), job posting (`/jobs/view`), people search, or user profile. Adjusts UI actions dynamically. When opening Current tab from a job page, pre-sets message type to "Job". | `utils/jobScraper.js`, `content_script.js`, `popup.js`, `popup.html` |
| 42 | Search Results Job Ranker (J3) | Scrapes only rendered job cards on current search page (no auto-scroll/crawling). Scores against Career Profile (role match: +3, skill match: +2, location: +1, avoid: -2). Shows Strong (≥7), Good (3–6), Stretch (<3) with 1-line reasons. | `utils/jobScraper.js`, `utils/jobRanker.js`, `content_script.js`, `popup.js`, `popup.html` |
| 43 | Application Kit (J4) | On any job detail page, extracts title, company, description, apply type (Easy Apply vs external) and generates a 6-part kit: Match Analysis, Tailored Resume Bullets, Keyword Checklist (✓/✗), Cover Note (<1200 chars), Screening Q&A, and Recruiter/Alumni finder. | `utils/kitBuilder.js`, `utils/jobScraper.js`, `content_script.js`, `popup.js`, `popup.html` |
| 44 | Anti-Hallucination Gate | `validateKit()` enforces that every skill in the kit exists in `senderProfile`. Missing skills are reported honestly under Gaps and NEVER claimed in resume bullets, cover notes, or screening answers. Missing notice/salary info outputs `[add your answer here]`. | `utils/kitBuilder.js`, `background.js`, `dev/check-jobs.js` |
| 45 | Reach Out to People at Company | Generates search URLs for recruiters, hiring team members, and university alumni at the hiring company using `LinkedInURLs.peopleAtCompany()`. | `utils/linkedinUrls.js`, `popup.js`, `popup.html` |
| 46 | Application Tracker & CRM (J5) | Local CRUD capped at 100 jobs. Filter by All, Saved, Applied, Interviewing, Follow-up. Automated 7-day follow-up reminder flag for Applied jobs. Apply Assist checklist per job. Client-side CSV export. | `utils/tracker.js`, `popup.js`, `popup.html`, `popup.css` |
| 47 | Daily Outreach Safety Counter | Tracks daily count of copied outreach notes. Displays soft warning at 15 notes/day to protect user from LinkedIn spam flags. | `utils/tracker.js`, `popup.js`, `popup.html` |
| 48 | Stage B Automated Test Suite | `dev/check-jobs.js` quality gate with 46 tests: DOM ID cross-check (112 targets), URL builder encoding, weighted job ranker, anti-hallucination verification, and tracker CRUD/CSV. | `dev/check-jobs.js`, `dev/fixtures/` |
| 49 | Documentation & Compliance | `PRIVACY.md` detailing on-device vs. AI operation and zero-automation compliance; `docs/store-listing.md` drafting Chrome Web Store submission; updated `README.md`. Version bumped to 3.3.0. | `PRIVACY.md`, `docs/store-listing.md`, `README.md`, `manifest.json` |
