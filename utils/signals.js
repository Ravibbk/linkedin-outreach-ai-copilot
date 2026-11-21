'use strict';

// utils/signals.js — Personalization signal detector and ranker
// detectSignals(profile, senderProfile) → [{id, type, value, reason, priority}]
// Rules:
//   - Never invent facts. If a field is missing or empty, skip it.
//   - Prefer specific over generic (recent_post > role > skill).
//   - shared_ground (overlap between sender and recipient) ranks highest.
//   - Return at most MAX_SIGNALS ranked signals.

const MAX_SIGNALS = 3;

// Priority order (lower number = higher priority)
const SIGNAL_PRIORITY = {
  shared_ground:   1,
  recent_post:     2,
  about:           3,
  current_role:    4,
  current_company: 5,
  past_company:    6,
  education:       7,
  skill:           8,
  headline:        9,
};

/**
 * Clean a name: strip emojis, pronouns in parens, honorifics like "Dr." "MBA",
 * and reduce to first name only.
 */
function cleanFirstName(raw) {
  if (!raw) return 'there';
  let name = String(raw)
    // Remove emoji sequences
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    // Remove pronouns e.g. "(she/her)" "(he/him)"
    .replace(/\([\w/]+\)/g, '')
    // Remove trailing honorifics and credentials
    .replace(/,?\s*(Dr\.|PhD|MBA|MSc|BSc|CPA|CFA|PMP|Jr\.|Sr\.)\s*/gi, '')
    .trim();
  // Take just the first word as first name
  const first = name.split(/\s+/)[0];
  return first || 'there';
}

/**
 * Truncate a string at a word boundary, never mid-word, and append ellipsis.
 */
function truncateSentence(s, max) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max - 1);
  return (cut > 0 ? s.slice(0, cut) : s.slice(0, max - 1)) + '…';
}

/**
 * Detect personalization signals from profile and optional senderProfile.
 * Returns an array of signal objects sorted by priority.
 */
function detectSignals(profile = {}, senderProfile = {}) {
  const signals = [];

  // ── SHARED GROUND (sender ↔ recipient overlap) ──────────────────────────
  // Same school
  const recipEdu = (profile.educationEntries || []).map(e => String(e).toLowerCase());
  const senderEdu = (senderProfile.education || []).map(e => String(e).toLowerCase());
  const sharedSchool = recipEdu.find(re => senderEdu.some(se => se && re && re.includes(se.split(' ')[0])));
  if (sharedSchool) {
    signals.push({
      id: 'shared_school',
      type: 'shared_ground',
      value: sharedSchool,
      reason: 'You attended the same school',
      priority: SIGNAL_PRIORITY.shared_ground,
    });
  }

  // Overlapping skills
  const recipSkills = (profile.skills || []).map(s => s.toLowerCase());
  const senderSkills = (senderProfile.topSkills || []).map(s => s.toLowerCase());
  const sharedSkill = recipSkills.find(rs => senderSkills.some(ss => ss && rs.includes(ss.split(' ')[0])));
  if (sharedSkill && !sharedSchool) { // Only add if no school match (avoid stacking shared_ground)
    signals.push({
      id: 'shared_skill',
      type: 'shared_ground',
      value: sharedSkill,
      reason: 'You share a skill or domain',
      priority: SIGNAL_PRIORITY.shared_ground,
    });
  }

  // Same past company
  const recipPast = (profile.pastCompanies || []).map(c => c.toLowerCase());
  const senderPast = (senderProfile.pastCompanies || []).map(c => c.toLowerCase());
  const sharedPast = recipPast.find(rp => senderPast.some(sp => sp && rp.includes(sp.split(' ')[0])));
  if (sharedPast && signals.filter(s => s.type === 'shared_ground').length < 1) {
    signals.push({
      id: 'shared_past_company',
      type: 'shared_ground',
      value: sharedPast,
      reason: 'You both worked at the same company',
      priority: SIGNAL_PRIORITY.shared_ground,
    });
  }

  // ── RECENT POST ─────────────────────────────────────────────────────────
  const firstPost = (profile.recentPosts || [])[0];
  if (firstPost && String(firstPost).trim().length > 20) {
    signals.push({
      id: 'recent_post_0',
      type: 'recent_post',
      value: truncateSentence(firstPost, 80),
      reason: 'They recently posted about this topic',
      priority: SIGNAL_PRIORITY.recent_post,
    });
  }

  // ── ABOUT SECTION (only if substantial and not too generic) ─────────────
  const about = String(profile.about || '').trim();
  if (about.length > 60) {
    // Extract a meaningful fragment (first sentence, capped)
    const firstSentence = about.split(/[.!?]/)[0].trim();
    if (firstSentence.length > 20 && firstSentence.length < 120) {
      signals.push({
        id: 'about_snippet',
        type: 'about',
        value: truncateSentence(firstSentence, 90),
        reason: 'From their About section',
        priority: SIGNAL_PRIORITY.about,
      });
    }
  }

  // ── CURRENT ROLE ─────────────────────────────────────────────────────────
  if (profile.currentTitle && profile.currentCompany) {
    signals.push({
      id: 'current_role',
      type: 'current_role',
      value: `${profile.currentTitle} at ${profile.currentCompany}`,
      reason: 'Their current position',
      priority: SIGNAL_PRIORITY.current_role,
    });
  } else if (profile.currentTitle) {
    signals.push({
      id: 'current_role',
      type: 'current_role',
      value: profile.currentTitle,
      reason: 'Their current title',
      priority: SIGNAL_PRIORITY.current_role,
    });
  } else if (profile.currentCompany) {
    signals.push({
      id: 'current_company',
      type: 'current_company',
      value: profile.currentCompany,
      reason: 'The company they work at',
      priority: SIGNAL_PRIORITY.current_company,
    });
  }

  // ── PAST COMPANY ─────────────────────────────────────────────────────────
  if ((profile.pastCompanies || []).length > 0 && !sharedPast) {
    signals.push({
      id: 'past_company_0',
      type: 'past_company',
      value: profile.pastCompanies[0],
      reason: 'A notable past employer',
      priority: SIGNAL_PRIORITY.past_company,
    });
  }

  // ── EDUCATION ────────────────────────────────────────────────────────────
  if ((profile.educationEntries || []).length > 0 && !sharedSchool) {
    signals.push({
      id: 'education_0',
      type: 'education',
      value: String(profile.educationEntries[0]),
      reason: 'Where they studied',
      priority: SIGNAL_PRIORITY.education,
    });
  }

  // ── TOP SKILL ────────────────────────────────────────────────────────────
  if ((profile.skills || []).length > 0) {
    signals.push({
      id: 'skill_0',
      type: 'skill',
      value: profile.skills.slice(0, 3).join(', '),
      reason: 'Skills listed on their profile',
      priority: SIGNAL_PRIORITY.skill,
    });
  }

  // ── HEADLINE (last resort if nothing else) ───────────────────────────────
  if (signals.length === 0 && profile.headline) {
    signals.push({
      id: 'headline',
      type: 'headline',
      value: truncateSentence(profile.headline, 80),
      reason: 'Their LinkedIn headline',
      priority: SIGNAL_PRIORITY.headline,
    });
  }

  // ── RANK: sort by priority, deduplicate types, keep top MAX_SIGNALS ──────
  signals.sort((a, b) => a.priority - b.priority);

  // Remove lower-priority signals of the same type (keep only the best per type)
  const seenTypes = new Set();
  const ranked = signals.filter(s => {
    if (seenTypes.has(s.type)) return false;
    seenTypes.add(s.type);
    return true;
  });

  return ranked.slice(0, MAX_SIGNALS);
}
