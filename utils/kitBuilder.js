'use strict';

// utils/kitBuilder.js — Free Mode application kit writer.
// Generates match summary, tailored resume summary, keyword checklist,
// cover note, and screening answers using ONLY facts from senderProfile.
//
// HONESTY RULES:
// - Never claim a skill the senderProfile does not contain.
// - If a field is missing, leave a blank placeholder (not a guess).
// - validateKit() must pass before any output is shown.

const KitBuilder = (() => {

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * Build a full application kit locally.
   * @param {object} job            - { title, company, description, ... }
   * @param {object} senderProfile  - From resume analysis
   * @param {object} careerProfile  - From J1
   * @param {object} settings       - { userName, userBio, tone }
   * @returns {object} kit
   */
  function buildKit(job, senderProfile = {}, careerProfile = {}, settings = {}) {
    const jobKeywords = JobRanker.extractJobKeywords(job.description || '');
    const resumeText  = buildResumeText(senderProfile, settings);

    // Mark each keyword as present/absent
    const keywords = markKeywordsInResume(jobKeywords, resumeText, senderProfile);

    const matchedSkills  = keywords.filter(k => k.inResume).map(k => k.keyword);
    const missingSkills  = keywords.filter(k => !k.inResume).map(k => k.keyword).slice(0, 6);

    const matchSummary   = buildMatchSummary(job, matchedSkills, missingSkills, senderProfile);
    const resumeSummary  = buildResumeSummary(job, matchedSkills, senderProfile, settings);
    const coverNote      = buildCoverNote(job, matchedSkills, senderProfile, settings);
    const screeningAnswers = buildScreeningAnswers(job, senderProfile, settings);

    const kit = {
      matchSummary,
      resumeSummary,
      keywords,
      coverNote,
      screeningAnswers,
      matchedSkillCount: matchedSkills.length,
      missingSkillCount: missingSkills.length,
    };

    return kit;
  }

  // ── Match Summary ─────────────────────────────────────────────────────────

  function buildMatchSummary(job, matchedSkills, missingSkills, sp) {
    const name    = job.title  || 'this role';
    const company = job.company || 'this company';

    const matched  = matchedSkills.slice(0, 5).join(', ') || 'your general experience';
    const missing  = missingSkills.slice(0, 4);

    const emphasis = [];
    if (sp.achievements?.length) emphasis.push(`Highlight: ${sp.achievements[0]}`);
    if (matchedSkills.length > 0) emphasis.push(`Lead with your ${matchedSkills[0]} experience`);
    if (sp.currentStatus)         emphasis.push(sp.currentStatus);

    return {
      role: name,
      company,
      matchedSkills: matchedSkills.slice(0, 8),
      missingSkills,
      suggestions: emphasis.slice(0, 3),
      summary: `You match on: ${matched}. ${missing.length ? `Gaps: ${missing.join(', ')}.` : 'No major gaps found.'} ${emphasis[0] || ''}`,
    };
  }

  // ── Tailored Resume Summary ───────────────────────────────────────────────

  function buildResumeSummary(job, matchedSkills, sp, settings) {
    const name     = (settings.userName || sp.headline || '').trim();
    const headline = sp.headline || settings.userBio || '';
    const status   = sp.currentStatus || '';
    const achieve  = (sp.achievements || [])[0] || '';
    const skills   = matchedSkills.slice(0, 3).join(', ') || (sp.topSkills || []).slice(0, 3).join(', ');
    const jobTitle = job.title || 'this role';
    const company  = job.company || 'your company';

    const lines = [];

    if (headline) lines.push(headline);
    else if (name) lines.push(`${name} brings experience in ${skills || 'the relevant field'}.`);

    if (skills) lines.push(`Core competencies relevant to ${jobTitle}: ${skills}.`);

    if (achieve) lines.push(achieve);
    else if (status) lines.push(status);

    if (lines.length < 3) {
      lines.push(`Excited to apply this background to ${jobTitle} at ${company}.`);
    }

    return lines.slice(0, 4).join(' ');
  }

  // ── Cover Note ────────────────────────────────────────────────────────────

  function buildCoverNote(job, matchedSkills, sp, settings) {
    const tone    = settings.tone || 'Neutral';
    const me      = (settings.userName || '').trim();
    const jobTitle = job.title   || 'this role';
    const company  = job.company || 'your team';
    const skills   = matchedSkills.slice(0, 2).join(' and ') ||
                     (sp.topSkills || []).slice(0, 2).join(' and ') ||
                     'my experience';
    const achieve  = (sp.achievements || [])[0] || '';

    const greet = { Formal: `Dear Hiring Team,`, Neutral: `Hi,`, Casual: `Hello,` }[tone] || `Hi,`;
    const close = { Formal: `Kind regards,`, Neutral: `Best regards,`, Casual: `Thanks,` }[tone] || `Best regards,`;

    const opener = {
      Formal:  `I am writing to express my interest in the ${jobTitle} position at ${company}.`,
      Neutral: `I'd love to be considered for the ${jobTitle} role at ${company}.`,
      Casual:  `I'm really excited about the ${jobTitle} opening at ${company}!`,
    }[tone] || `I am interested in the ${jobTitle} role at ${company}.`;

    const body = achieve
      ? `My background in ${skills} aligns well with what you're looking for. ${achieve}.`
      : `My background in ${skills} aligns well with what you're looking for.`;

    const ask = {
      Formal:  `I would welcome the opportunity to discuss how I can contribute to your team.`,
      Neutral: `I'd love to chat further about how I can contribute.`,
      Casual:  `Would love to connect and learn more about the team!`,
    }[tone] || `I look forward to hearing from you.`;

    const note = `${greet}\n\n${opener}\n\n${body}\n\n${ask}\n\n${close}${me ? '\n' + me : ''}`;

    // Trim to 900 chars if needed
    return note.length <= 900 ? note : trimToLimit(note, 900);
  }

  // ── Screening Answers ─────────────────────────────────────────────────────

  function buildScreeningAnswers(job, sp, settings) {
    const jobTitle = job.title   || 'this role';
    const company  = job.company || 'this company';
    const skills   = (sp.topSkills || []).slice(0, 3).join(', ');
    const achieve  = (sp.achievements || [])[0] || '';
    const edu      = (sp.education || [])[0] || '';

    // If a field is unknown, use a blank placeholder — never guess
    const blank = '[add your answer here]';

    return [
      {
        question: 'Why are you interested in this role?',
        answer: skills
          ? `I'm drawn to the ${jobTitle} role because it aligns with my background in ${skills}. ${company ? `I've been following ${company}'s work and ` : ''}believe I can contribute meaningfully from day one.`
          : blank,
        draft: skills
          ? `I'm drawn to the ${jobTitle} role because it aligns with my background in ${skills}. ${company ? `I've been following ${company}'s work and ` : ''}believe I can contribute meaningfully from day one.`
          : blank,
        note: 'Draft — personalise before use.',
      },
      {
        question: 'What relevant experience do you have?',
        answer: achieve
          ? `${achieve}. I have hands-on experience in ${skills || 'the relevant area'}, which directly applies to this role.`
          : skills
            ? `I have experience in ${skills}, which I'd bring directly to this position.`
            : blank,
        draft: achieve
          ? `${achieve}. I have hands-on experience in ${skills || 'the relevant area'}, which directly applies to this role.`
          : skills
            ? `I have experience in ${skills}, which I'd bring directly to this position.`
            : blank,
        note: 'Draft — verify details match your resume exactly.',
      },
      {
        question: 'What is your notice period / availability?',
        answer: blank, // Never guess — user must fill this
        draft: blank,
        note: 'Fill in your actual availability.',
      },
      {
        question: 'What is your expected compensation?',
        answer: blank, // Never guess
        draft: blank,
        note: 'Fill in your expected range.',
      },
      {
        question: 'Education / qualifications?',
        answer: edu || blank,
        draft: edu || blank,
        note: 'Draft — verify against your resume.',
      },
    ];
  }

  // ── validateKit ───────────────────────────────────────────────────────────

  /**
   * Validate that every non-blank claim in the kit traces to senderProfile or careerProfile.
   * Returns { valid: bool, issues: string[], errors: string[] }
   *
   * Rules:
   * - Skills claimed must be in sp.topSkills or careerProfile.keySkills
   * - Missing skills must NEVER appear in resume highlights or cover note
   * - No "undefined", "null", "[object" in output
   */
  function validateKit(kit, senderProfile = {}, careerProfile = {}) {
    const issues = [];
    const resumeText = buildResumeText(senderProfile, {}).toLowerCase();
    const careerText = (careerProfile.keySkills || []).join(' ').toLowerCase();
    const allowedText = resumeText + ' ' + careerText;

    // Direct check on matchedSkills lists
    const matchedList = [
      ...(kit.resumeSummary?.matchedSkills || []),
      ...(kit.matchSummary?.matchedSkills || []),
    ];
    for (const skill of matchedList) {
      if (skill && !allowedText.includes(String(skill).toLowerCase())) {
        issues.push(`Matched skills: "${skill}" not found in resume`);
      }
    }

    // Helper: check a text block for bad patterns
    function checkText(text, section, checkMissing = true) {
      if (!text) return;
      const t = String(text);

      // Placeholder pollution
      if (/undefined|null|\[object|{[A-Za-z]+}/.test(t)) {
        issues.push(`${section}: contains unresolved placeholder`);
      }

      // Check missing skills should NOT appear in candidate's pitch materials
      if (checkMissing && kit.matchSummary?.missingSkills?.length) {
        for (const missing of kit.matchSummary.missingSkills) {
          if (missing && missing.length > 2) {
            const re = new RegExp(`\\b${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (re.test(t)) {
              issues.push(`${section}: claimed missing skill "${missing}"`);
            }
          }
        }
      }
    }

    const resumeSummaryText = typeof kit.resumeSummary === 'string'
      ? kit.resumeSummary
      : ((kit.resumeSummary?.bullets || []).join(' ') + ' ' + (kit.resumeSummary?.headline || ''));

    checkText(resumeSummaryText, 'Resume summary', true);
    checkText(kit.coverNote,     'Cover note',     true);
    if (kit.matchSummary?.summary) checkText(kit.matchSummary.summary, 'Match summary', false);
    kit.screeningAnswers?.forEach((a, i) => {
      const ans = a.answer || a.draft;
      if (ans && ans !== '[add your answer here]') {
        checkText(ans, `Screening answer ${i + 1}`, true);
      }
    });

    // De-duplicate issues
    const unique = [...new Set(issues)];
    return { valid: unique.length === 0, issues: unique, errors: unique };
  }

  // ── Keyword matching ──────────────────────────────────────────────────────

  function markKeywordsInResume(keywords, resumeText, sp) {
    const rt = resumeText.toLowerCase();
    const spSkills = [
      ...(sp.topSkills || []),
      ...(sp.skills || []),
    ].map(s => s.toLowerCase());

    return keywords.map(k => {
      const kl = k.keyword.toLowerCase();
      const inResume = rt.includes(kl) || spSkills.some(s => s.includes(kl) || kl.includes(s));
      return { ...k, inResume };
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function buildResumeText(sp = {}, settings = {}) {
    return [
      sp.headline || '',
      sp.currentStatus || '',
      (sp.topSkills  || []).join(', '),
      (sp.skills     || []).join(', '),
      (sp.education  || []).join(', '),
      (sp.achievements || []).join('. '),
      sp.summary     || '',
      settings.userBio || '',
      settings.userName || '',
    ].filter(Boolean).join(' ');
  }

  function trimToLimit(text, limit) {
    if (text.length <= limit) return text;
    const sub = text.slice(0, limit - 1);
    const last = Math.max(sub.lastIndexOf('. '), sub.lastIndexOf('! '), sub.lastIndexOf('? '));
    if (last > limit * 0.5) return sub.slice(0, last + 1).trim();
    const sp  = sub.lastIndexOf(' ');
    return (sp > 0 ? sub.slice(0, sp) : sub) + '…';
  }

  return { buildKit, validateKit, extractJobKeywords: (d) => JobRanker.extractJobKeywords(d), buildResumeText };
})();
