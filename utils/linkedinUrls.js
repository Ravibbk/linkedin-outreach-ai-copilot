'use strict';

// utils/linkedinUrls.js — LinkedIn URL builder for jobs and people search
// IMPORTANT: LinkedIn filter parameters (f_TPR, f_WT, f_E) are undocumented
// and change without notice. They are applied best-effort; the base
// keywords+location search always works as a fallback.
// Last verified: Nov 2024. Re-verify before demo.

const LinkedInURLs = (() => {

  // Work-type codes (best-effort, may drift)
  const WORK_TYPE_CODES = {
    remote:  '2',
    hybrid:  '3',
    onsite:  '1',
    'on-site': '1',
  };

  // Experience-level codes (best-effort)
  const EXP_LEVEL_CODES = {
    internship:   '1',
    entry:        '2',
    associate:    '3',
    mid:          '3',
    senior:       '4',
    director:     '5',
    executive:    '6',
  };

  /**
   * Build a LinkedIn Jobs search URL.
   * @param {string} keywords  - Job title / role
   * @param {string} location  - City, country, or "Remote"
   * @param {object} opts      - { workType, experienceLevel, pastWeek }
   */
  function jobsSearch(keywords, location, opts = {}) {
    const params = new URLSearchParams();
    if (keywords) params.set('keywords', keywords.trim());
    if (location) params.set('location', location.trim());

    // Best-effort filters — treat as optional
    if (opts.pastWeek !== false) {
      params.set('f_TPR', 'r604800'); // past 7 days in seconds
    }
    const wtCode = WORK_TYPE_CODES[(opts.workType || '').toLowerCase()];
    if (wtCode) params.set('f_WT', wtCode);

    const expCode = EXP_LEVEL_CODES[(opts.experienceLevel || '').toLowerCase()];
    if (expCode) params.set('f_E', expCode);

    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  }

  /**
   * Build LinkedIn people-search URLs for a company.
   * Returns an array of { label, url } objects.
   * @param {string} company       - Company name
   * @param {string} jobTitle      - Job title for context
   * @param {string} userSchool    - User's school (for alumni search)
   * @param {string[]} jobKeywords - Keywords from job description
   */
  function peopleAtCompany(company, jobTitle, userSchool, jobKeywords = []) {
    if (!company) return [];
    const results = [];

    // Recruiter / Talent Acquisition
    results.push({
      label: `Recruiters at ${company}`,
      url: peopleSearch(`"${company}" recruiter OR "talent acquisition" OR "talent partner"`),
    });

    // Hiring manager / team function (from job keywords)
    const funcKeyword = jobKeywords.slice(0, 2).join(' ');
    if (funcKeyword) {
      results.push({
        label: `${funcKeyword} team at ${company}`,
        url: peopleSearch(`"${company}" ${funcKeyword}`),
      });
    }

    // Alumni (user's school)
    if (userSchool) {
      const school = extractSchoolName(userSchool);
      results.push({
        label: `${school} alumni at ${company}`,
        url: peopleSearch(`"${company}" "${school}"`),
      });
    }

    return results;
  }

  /**
   * Build a LinkedIn people-search URL.
   */
  function peopleSearch(query) {
    const params = new URLSearchParams({ keywords: query.trim() });
    return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
  }

  /**
   * Extract the school name from an education entry string like "MIT — Computer Science".
   */
  function extractSchoolName(edu) {
    return String(edu || '').split(/[—–\-,]/)[0].trim();
  }

  /**
   * Generate 3–5 job search suggestions from a careerProfile.
   * Returns [{ label, keywords, location, url }]
   */
  function suggestSearches(careerProfile = {}) {
    const roles     = (careerProfile.targetRoles     || []).slice(0, 3);
    const locations = (careerProfile.preferredLocations || ['Remote']).slice(0, 2);
    const workType  = careerProfile.workType || '';
    const expLevel  = careerProfile.experienceLevel || '';

    if (roles.length === 0) return [];

    const suggestions = [];

    // Primary role × locations
    for (const loc of locations) {
      for (const role of roles.slice(0, 2)) {
        suggestions.push({
          label:    `${role} — ${loc}`,
          keywords: role,
          location: loc,
          url: jobsSearch(role, loc, { workType, experienceLevel: expLevel }),
        });
        if (suggestions.length >= 5) break;
      }
      if (suggestions.length >= 5) break;
    }

    // If only 1 location, add a remote variant
    if (suggestions.length < 3 && locations.length === 1) {
      const role = roles[0];
      suggestions.push({
        label:    `${role} — Remote`,
        keywords: role,
        location: 'Remote',
        url: jobsSearch(role, 'Remote', { workType: 'remote', experienceLevel: expLevel }),
      });
    }

    return suggestions.slice(0, 5);
  }

  return { jobsSearch, peopleAtCompany, peopleSearch, suggestSearches, extractSchoolName };
})();
