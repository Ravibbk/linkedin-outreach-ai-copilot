'use strict';

// utils/jobRanker.js — Local job and people ranking against careerProfile.
// All ranking is deterministic and explainable. No fake percentages.
// Labels: Strong (score >= 7) / Good (3-6) / Stretch (< 3).

const JobRanker = (() => {

  // ── Job ranking ────────────────────────────────────────────────────────────

  /**
   * Rank an array of job card objects against a careerProfile.
   * Returns the same array with { score, label, reason } added, sorted descending.
   *
   * Weights:
   *   title vs targetRoles: 3 per match
   *   snippet/title vs keySkills: 2 per match (capped at 3 skills)
   *   location vs preferredLocations: 1 per match
   *   avoidKeywords: -2 per match
   */
  function rankJobs(jobs = [], careerProfile = {}) {
    const targetRoles      = normalizeTerms(careerProfile.targetRoles || []);
    const keySkills        = normalizeTerms(careerProfile.keySkills    || []);
    const preferredLocs    = normalizeTerms(careerProfile.preferredLocations || []);
    const avoidKeywords    = normalizeTerms(careerProfile.avoidKeywords || []);

    return jobs.map(job => {
      const jobText = normalizeText(`${job.title} ${job.snippet || ''}`);
      const locText = normalizeText(job.location || '');

      let score = 0;
      const matchedRoles   = [];
      const matchedSkills  = [];
      const matchedLocs    = [];
      const avoidHits      = [];

      // Title vs target roles
      for (const role of targetRoles) {
        if (jobText.includes(role)) { score += 3; matchedRoles.push(role); }
      }

      // Text vs key skills (cap bonus at 3 skills to avoid gaming)
      let skillMatches = 0;
      for (const skill of keySkills) {
        if (skillMatches >= 3) break;
        if (jobText.includes(skill)) { score += 2; matchedSkills.push(skill); skillMatches++; }
      }

      // Location
      for (const loc of preferredLocs) {
        if (locText.includes(loc) || jobText.includes('remote')) {
          score += 1; matchedLocs.push(loc); break;
        }
      }

      // Avoid keywords penalty
      for (const kw of avoidKeywords) {
        if (jobText.includes(kw)) { score -= 2; avoidHits.push(kw); }
      }

      // Build reason
      const reasons = [];
      if (matchedRoles.length)  reasons.push(`Role matches: ${matchedRoles.slice(0, 2).join(', ')}`);
      if (matchedSkills.length) reasons.push(`Skills: ${matchedSkills.slice(0, 2).join(', ')}`);
      if (matchedLocs.length)   reasons.push(`Location: ${matchedLocs[0]}`);
      if (avoidHits.length)     reasons.push(`⚠ Contains: ${avoidHits[0]}`);
      if (!reasons.length)      reasons.push('Low keyword overlap with your profile');

      const label = score >= 7 ? 'Strong' : score >= 3 ? 'Good' : 'Stretch';

      return { ...job, score, label, reason: reasons.join(' · ') };
    }).sort((a, b) => b.score - a.score);
  }

  // ── People ranking ────────────────────────────────────────────────────────

  /**
   * Rank people cards against a job context + careerProfile.
   * Returns array with { score, label, reason } sorted descending.
   *
   * Signals:
   *   recruiter/talent/hiring keyword in headline: +4
   *   job function keyword in headline: +2
   *   shared school: +3
   *   seniority fit (not C-suite for entry, etc.): +1
   */
  function rankPeople(people = [], jobContext = {}, careerProfile = {}) {
    const jobTitle   = normalizeText(jobContext.title   || '');
    const jobCompany = normalizeText(jobContext.company || '');
    const userSchool = normalizeText(
      LinkedInURLs?.extractSchoolName(
        (careerProfile.senderProfile?.education || [])[0] || ''
      ) || ''
    );
    const funcWords  = extractFunctionWords(jobTitle);

    return people.map(person => {
      const hl = normalizeText(person.headline || '');
      let score = 0;
      const reasons = [];

      // Recruiter / talent acquisition
      if (/recruit|talent|hiring|hr|people ops|sourcer/i.test(hl)) {
        score += 4; reasons.push('Recruiter or talent role');
      }

      // Job function match
      for (const fw of funcWords) {
        if (hl.includes(fw)) { score += 2; reasons.push(`${fw} function match`); break; }
      }

      // Shared school
      if (userSchool && hl.includes(userSchool)) {
        score += 3; reasons.push(`${userSchool} alum`);
      }

      if (!reasons.length) reasons.push('Low relevance match');

      const label = score >= 6 ? 'Strong' : score >= 3 ? 'Good' : 'Stretch';
      return { ...person, score, label, reason: reasons.join(' · ') };
    }).sort((a, b) => b.score - a.score);
  }

  // ── Keyword extraction (for kit builder and ranking) ──────────────────────

  /**
   * Extract meaningful keywords from a job description.
   * Returns [{ keyword, inResume }] — inResume is false (filled by kitBuilder).
   */
  function extractJobKeywords(description = '') {
    const text = description.toLowerCase();

    // Pattern: single words or compound phrases in common tech/skill patterns
    const rawTerms = new Set();

    // Capitalised terms (likely proper nouns / tools)
    const capMatches = description.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/g) || [];
    capMatches.forEach(t => { if (t.length > 2 && !STOP_WORDS.has(t.toLowerCase())) rawTerms.add(t.trim()); });

    // Common skill patterns
    const skillPattern = /\b(experience (?:with|in)|proficient in|knowledge of|familiar with|expertise in)\s+([A-Za-z][A-Za-z0-9\s.#+\-]{2,30})/gi;
    let m;
    while ((m = skillPattern.exec(description)) !== null) rawTerms.add(m[2].trim());

    // Years of experience patterns → extract the skill
    const yoePattern = /\b(\d+\+?\s+years?\s+(?:of\s+)?(?:experience\s+(?:with|in)\s+)?)([\w\s.#+\-]{3,30})/gi;
    while ((m = yoePattern.exec(description)) !== null) rawTerms.add(m[2].trim());

    // Degree requirements
    const degreePattern = /\b(Bachelor|Master|PhD|BS|MS|MBA|BA|MA)\b/gi;
    while ((m = degreePattern.exec(description)) !== null) rawTerms.add(m[0]);

    return Array.from(rawTerms)
      .filter(t => t.length > 2 && t.length < 40 && !STOP_WORDS.has(t.toLowerCase()))
      .slice(0, 25)
      .map(keyword => ({ keyword, inResume: false })); // inResume filled by caller
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function normalizeText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeTerms(arr) {
    return arr.map(t => normalizeText(String(t || ''))).filter(Boolean);
  }

  function extractFunctionWords(jobTitle) {
    // e.g. "Senior Software Engineer" → ["software", "engineer"]
    const stop = new Set(['senior', 'junior', 'lead', 'head', 'principal', 'staff', 'associate']);
    return jobTitle.split(' ').filter(w => w.length > 3 && !stop.has(w));
  }

  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'you', 'will', 'are',
    'our', 'your', 'have', 'has', 'had', 'not', 'but', 'they', 'their', 'what',
    'when', 'who', 'how', 'can', 'may', 'should', 'must', 'would', 'could',
    'work', 'team', 'role', 'job', 'company', 'opportunity', 'position', 'candidate',
    'experience', 'skills', 'knowledge', 'ability', 'ability', 'strong', 'excellent',
    'good', 'great', 'required', 'preferred', 'plus', 'bonus', 'ideal', 'etc',
    'including', 'such', 'other', 'more', 'also', 'well', 'highly', 'we', 'us',
    'join', 'help', 'build', 'make', 'using', 'based', 'across', 'within',
    'about', 'into', 'over', 'being', 'both', 'each', 'some', 'than', 'then',
    'looking', 'seeking', 'wanted', 'needed', 'hire', 'hiring', 'overview',
    'summary', 'description', 'responsibilities', 'requirements', 'qualifications',
    'apply', 'please', 'notes', 'note',
  ]);

  return { rankJobs, rankPeople, extractJobKeywords };
})();
