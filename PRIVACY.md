# Privacy Policy & Compliance Notice

**LinkedIn Outreach AI & Job-Search Copilot (v3.3.0)**

---

## 1. Core Principle: Privacy-First & Human-in-the-Loop

LinkedIn Outreach AI is built on two non-negotiable foundations:
1. **Zero unsolicited data transmission:** In Free Mode, nothing ever leaves your device. In AI Mode, data is sent only to your own Anthropic account via your personal API key when you click Generate or Analyze.
2. **Assisted, human-in-the-loop operation:** The extension never automates interactions on LinkedIn. You click Apply, Connect, or Send. We simply prepare the materials so you can put your best foot forward.

---

## 2. What Data Is Stored Locally

All application data is stored in Chrome's sandboxed local storage (`chrome.storage.local`) on your machine:

| Data Stored | Purpose | Leaves Device? |
|---|---|---|
| `careerProfile` | Your target roles, key skills, locations, work preferences | **Never** |
| `jobTracker` | Saved jobs, application status, checklist progress | **Never** |
| `recentContacts` | History of contacts and drafted outreach notes | **Never** |
| `dailyNoteCount` | Daily count of notes copied to prevent over-messaging | **Never** |
| `userApiKey` | Optional personal Anthropic API key | Sent only to `api.anthropic.com` |
| `userName`, `userBio` | Name and bio for personalized message signoffs | Sent to API only during generation in AI Mode |
| `senderProfile` | Parsed resume highlights (skills, education, achievements) | Sent to API only during generation in AI Mode |

You can clear all stored data at any time via extension settings or by removing the extension.

---

## 3. Network Communication & AI Mode

### Free Mode (No API key)
- **100% offline and deterministic.**
- Uses local keyword extraction, rule-based match scoring, and deterministic templates.
- **Zero network requests** are dispatched to any server.

### AI Mode (Optional personal API key)
- Requires your own Anthropic API key (`sk-ant-...`).
- When you explicitly click **Scrape & Generate** or **Analyze This Job**:
  - The text of the currently viewed profile or job description is packaged with your resume highlights.
  - The request is transmitted over TLS directly to `https://api.anthropic.com/v1/messages`.
  - All prompt payloads treat scraped text as untrusted data wrapped in XML tags with instructions to ignore embedded commands.
- We operate **no backend server, no proxy, no logging database, and no telemetry collector**.

---

## 4. Compliance with LinkedIn Terms of Service

To respect LinkedIn's Terms of Service and protect your account:

- **No Action Automation:** The extension does **not** click Connect, Send, Apply, or Easy Apply. It does not fill out application forms or submit answers automatically.
- **No Mass Scraping:** The extension does **not** crawl profiles, paginate search results, or run background scraping tasks. It only reads the DOM of the active tab that you are currently viewing.
- **Human Review Enforced:** All generated messages, cover notes, and screening answers are presented in editable fields for your review, verification, and manual submission.
- **Daily Safety Indicator:** A soft reminder is displayed when you draft more than 15 outreach notes in a single day to encourage authentic, high-quality relationship building over volume.

---

## 5. Third-Party Services
- **Anthropic API:** Only invoked in AI Mode using your own API credentials. Subject to Anthropic's Commercial Terms of Service and Privacy Policy.

---

## 6. Contact & Open Source
This extension was developed for educational and professional demonstration purposes. For questions or inspection, review the source code directly within your unpacked Chrome extension directory.
