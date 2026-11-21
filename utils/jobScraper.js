'use strict';

// utils/jobScraper.js — Defensive scraping helpers for job cards, job detail, people cards.
// All selectors are multi-strategy. Never crashes on missing elements.
// IMPORTANT: LinkedIn DOM changes frequently. These selectors were written Nov 2024.
// Re-verify selectors before demo. scrapeQuality score tells you how much was found.

const JobScraper = (() => {

  const clean = s => (s || '').replace(/\s+/g, ' ').trim();

  // ── Shared: visible element check ─────────────────────────────────────────
  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) { return false; }
  }

  // ── Shared: safe text extraction ───────────────────────────────────────────
  function getText(el) {
    return el ? clean(el.innerText || el.textContent || '') : '';
  }

  function getAttr(el, ...attrs) {
    if (!el) return '';
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v) return v.trim();
    }
    return '';
  }

  // ── JOB CARDS (jobs search results page) ──────────────────────────────────
  /**
   * Scrape all rendered job cards on the current jobs search page.
   * Does NOT auto-scroll or paginate — only reads what is already in the DOM.
   * Returns [{ id, title, company, location, postedTime, snippet, link }]
   */
  function scrapeJobCards() {
    const cards = [];

    // Strategy 1: standard job card container
    const selectors = [
      '.job-card-container',
      '.jobs-search-results__list-item',
      '[data-occludable-job-id]',
      '[data-job-id]',
      '.scaffold-layout__list-item',
      '.jobs-search-results-list__list-item',
      'li.ember-view',
    ];

    let cardEls = [];
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel))
        .filter(el => el.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="], a[href*="/jobs/"]') !== null);
      if (found.length > 0) { cardEls = found; break; }
    }

    // Strategy 2: any anchor pointing to a job wrapped in a list item
    if (cardEls.length === 0) {
      const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="], a[class*="job-card-list__title"]'));
      const seen = new Set();
      anchors.forEach(a => {
        const li = a.closest('li, [data-occludable-job-id], [data-job-id], .job-card-container, .scaffold-layout__list-item');
        if (li && !seen.has(li)) { seen.add(li); cardEls.push(li); }
      });
    }

    cardEls.slice(0, 25).forEach((el, idx) => {
      try {
        // Job ID
        const jobId = getAttr(el, 'data-occludable-job-id', 'data-job-id', 'data-entity-urn') ||
          String(idx);

        // Title
        const titleEl = el.querySelector([
          '.job-card-list__title',
          '.jobs-unified-top-card__job-title',
          '[class*="job-card"][class*="title"]',
          '[class*="job-title"]',
          'a strong',
          'h3', 'h4',
        ].join(','));
        const title = getText(titleEl);

        // Company
        const companyEl = el.querySelector([
          '.job-card-container__company-name',
          '.job-card-list__company-name',
          '.artdeco-entity-lockup__subtitle',
          '[class*="company-name"]',
          '[class*="primary-subtitle"]',
        ].join(','));
        const company = getText(companyEl);

        // Location
        const locationEl = el.querySelector([
          '.job-card-container__metadata-item',
          '.job-card-list__location',
          '[class*="location"]',
          '[class*="secondary-subtitle"]',
        ].join(','));
        const location = getText(locationEl);

        // Posted time
        const timeEl = el.querySelector('time, [class*="listdate"], [class*="posted"]');
        const postedTime = getText(timeEl) || getAttr(timeEl, 'datetime', 'title');

        // Snippet
        const snippetEl = el.querySelector('.job-card-list__insight, .job-card-container__insight, p');
        const snippet = getText(snippetEl).slice(0, 200);

        // Link
        const linkEl = el.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="], a[class*="job-card"]');
        let link = '';
        if (linkEl && linkEl.href) {
          if (linkEl.href.includes('/jobs/view/')) {
            link = linkEl.href.split('?')[0];
          } else if (linkEl.href.includes('currentJobId=')) {
            const m = linkEl.href.match(/currentJobId=(\d+)/);
            link = m ? `https://www.linkedin.com/jobs/view/${m[1]}/` : linkEl.href.split('&')[0];
          } else {
            link = linkEl.href.split('?')[0];
          }
        }

        if (title || company) {
          cards.push({ id: jobId, title, company, location, postedTime, snippet, link });
        }
      } catch (_) { /* skip broken card */ }
    });

    return cards;
  }

  // ── JOB DETAIL (individual job posting page) ──────────────────────────────
  /**
   * Scrape the full job detail from a /jobs/view/ page.
   * Returns a single job object.
   */
  function scrapeJobDetail() {
    // Title: Multi-strategy cascade
    let title = '';
    const titleSelectors = [
      'h1.job-details-jobs-unified-top-card__job-title',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.jobs-details-top-card__job-title',
      'h1[class*="job-title"]',
      '[class*="job-title"] h1',
      '[class*="job-title"]',
      '.top-card-layout__title',
      '.topcard__title',
      'h1.t-24',
      'h2.t-24',
      'h1',
      'h2',
    ];
    for (const sel of titleSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const txt = getText(el);
        if (txt && txt.length > 2 && !/^(linkedin|jobs|feed|home|search|notifications|messaging)$/i.test(txt)) {
          title = txt;
          break;
        }
      }
      if (title) break;
    }

    // Fallback 1: Extract title from document.title
    if (!title && document.title) {
      const raw = document.title.replace(/\|.*$/i, '').trim();
      const hiringMatch = raw.match(/hiring\s+(.+?)(?:\s+in|\s+at|$)/i);
      const atMatch = raw.match(/^(.+?)\s+at\s+/i);
      if (hiringMatch) {
        title = hiringMatch[1].trim();
      } else if (atMatch) {
        title = atMatch[1].trim();
      } else {
        title = raw.split(/[-–—]/)[0].trim();
      }
    }

    // Company: Multi-strategy cascade
    let company = '';
    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '.topcard__flavor--black-link',
      'a[href*="/company/"]',
      '[class*="company-name"] a',
      '[class*="company-name"]',
      '[class*="org-name"]',
      '.jobs-unified-top-card__primary-description a',
      '.job-details-jobs-unified-top-card__primary-description-without-tagline a',
    ];
    for (const sel of companySelectors) {
      const el = document.querySelector(sel);
      const txt = getText(el);
      if (txt && txt.length > 1 && !/^(about|home|jobs|linkedin|feed|notifications)$/i.test(txt)) {
        company = txt;
        break;
      }
    }

    // Fallback: Extract company from document.title
    if (!company && document.title) {
      const raw = document.title.replace(/\|.*$/i, '').trim();
      const beforeHiring = raw.match(/^(.+?)\s+hiring\s+/i);
      const atMatch = raw.match(/\sat\s+([^|–—]+)/i);
      if (beforeHiring) {
        company = beforeHiring[1].trim();
      } else if (atMatch) {
        company = atMatch[1].trim();
      }
    }

    // Location: Multi-strategy cascade
    let location = '';
    const locationSelectors = [
      '.job-details-jobs-unified-top-card__bullet',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet',
      '[class*="bullet"]',
      '[class*="location"]',
      '[class*="workplace-type"]',
      '.job-details-jobs-unified-top-card__primary-description-without-tagline span',
      '.jobs-unified-top-card__primary-description-without-tagline span',
    ];
    for (const sel of locationSelectors) {
      const el = document.querySelector(sel);
      const txt = getText(el);
      if (txt && txt.length > 2 && !txt.includes('ago') && !txt.includes('repost')) {
        location = txt;
        break;
      }
    }

    // Employment type
    const typeEl = document.querySelector([
      '.job-details-jobs-unified-top-card__job-insight span',
      '[class*="employment-type"]',
      '.jobs-unified-top-card__workplace-type',
      '[class*="workplace-type"]',
    ].join(','));
    const employmentType = getText(typeEl);

    // Posted time
    const timeEl = document.querySelector([
      '.jobs-unified-top-card__posted-date',
      '.job-details-jobs-unified-top-card__primary-description-without-tagline span',
      'time',
      '[class*="posted"]',
    ].join(','));
    const postedTime = getText(timeEl) || getAttr(timeEl, 'datetime');

    // Apply type (Easy Apply vs external)
    const easyApplyBtn = document.querySelector([
      '.jobs-apply-button--top-card',
      'button[aria-label*="Easy Apply"]',
      '.jobs-s-apply button',
    ].join(','));
    const applyType = easyApplyBtn ? 'easy_apply' : 'external';

    // Apply URL (for external)
    let applyUrl = '';
    if (applyType === 'external') {
      const extLink = document.querySelector([
        '.jobs-apply-button--top-card a',
        'a[href*="apply"]',
      ].join(','));
      applyUrl = extLink ? extLink.href : window.location.href;
    } else {
      applyUrl = window.location.href;
    }

    // Description: Multi-strategy with "About the job" heading fallback
    let description = '';
    const descSelectors = [
      '#job-details',
      '.jobs-description__content',
      '.job-details-module__content',
      '.jobs-description',
      '[class*="jobs-description"]',
      '[class*="description__content"]',
      'article',
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 80) {
        description = cleanDescription(el.innerText || el.textContent);
        break;
      }
    }

    if (!description) {
      const headings = Array.from(document.querySelectorAll('h2, h3, h4'));
      const aboutHeading = headings.find(h => /about the job|job description/i.test(h.textContent || ''));
      if (aboutHeading) {
        const parent = aboutHeading.closest('section, article, div.job-details-module, div');
        if (parent && parent.textContent.length > 80) {
          description = cleanDescription(parent.innerText || parent.textContent);
        }
      }
    }

    if (!description) {
      const divs = Array.from(document.querySelectorAll('div, section, article'))
        .filter(d => d.textContent.length > 200 && d.children.length < 15)
        .sort((a, b) => b.textContent.length - a.textContent.length);
      if (divs[0]) description = cleanDescription(divs[0].innerText || divs[0].textContent);
    }

    description = description.slice(0, 6000);

    // Job URL
    const jobUrl = window.location.href.split('?')[0];

    // scrapeQuality
    const fields = { title, company, location, description };
    const filled  = Object.values(fields).filter(v => v && v.trim().length > 0).length;
    const scrapeQuality = Math.round((filled / Object.keys(fields).length) * 100);

    return {
      title, company, location, employmentType, postedTime,
      applyType, applyUrl, description, jobUrl, scrapeQuality,
    };
  }

  // ── PEOPLE CARDS (people search results page) ─────────────────────────────
  /**
   * Scrape rendered people result cards on a /search/results/people/ page.
   * Does NOT scroll or paginate.
   * Returns [{ name, headline, link }]
   */
  function scrapePeopleCards() {
    const people = [];

    const cardSelectors = [
      '.entity-result',
      '.search-result',
      '[data-chameleon-result-urn]',
      'li.reusable-search__result-container',
    ];

    let cardEls = [];
    for (const sel of cardSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) { cardEls = found; break; }
    }

    cardEls.slice(0, 20).forEach(el => {
      try {
        const nameEl = el.querySelector([
          '.entity-result__title-text a span[aria-hidden]',
          '.entity-result__title-text a',
          '[class*="actor-name"]',
          'span[dir="ltr"]',
        ].join(','));
        const name = getText(nameEl);

        const headlineEl = el.querySelector([
          '.entity-result__primary-subtitle',
          '.entity-result__secondary-subtitle',
          '[class*="subtitle"]',
        ].join(','));
        const headline = getText(headlineEl);

        const linkEl = el.querySelector('a[href*="/in/"]');
        const link = linkEl ? linkEl.href.split('?')[0] : '';

        if (name || link) people.push({ name, headline, link });
      } catch (_) { /* skip broken card */ }
    });

    return people;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function cleanDescription(raw) {
    return (raw || '')
      .replace(/\t/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/^\s+|\s+$/gm, '')
      .trim();
  }

  /**
   * Detect what kind of LinkedIn page we're on.
   * Returns: 'jobs_search' | 'job_detail' | 'people_search' | 'profile' | 'other'
   */
  function detectPageType(url) {
    url = url || window.location.href;
    if (/linkedin\.com\/jobs\/search/i.test(url))          return 'jobs_search';
    if (/linkedin\.com\/jobs\/view/i.test(url))            return 'job_detail';
    if (/linkedin\.com\/search\/results\/people/i.test(url)) return 'people_search';
    if (/linkedin\.com\/in\/[^/?#]+/i.test(url))          return 'profile';
    return 'other';
  }

  return { scrapeJobCards, scrapeJobDetail, scrapePeopleCards, detectPageType };
})();
