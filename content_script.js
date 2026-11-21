'use strict';

// content_script.js — LinkedIn Outreach AI v3.3.0
// Injected into LinkedIn pages. Scrapes profile data, job data, people search, and can insert messages.

// ── Guard against double injection ───────────────────────────────────────────
if (window.__outreachAIInjected) {
  // Already running — do nothing (prevents duplicate listeners)
} else {
  window.__outreachAIInjected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ success: true });
      return true;
    }

    if (msg.action === 'getPageType') {
      try {
        const pageType = detectPageType();
        sendResponse({ success: true, data: pageType });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.action === 'scrapeProfile') {
      scrapeWithProgressiveScroll()
        .then(profile => sendResponse({ success: true, data: profile }))
        .catch(err   => sendResponse({ success: false, error: err.message }));
      return true; // keep channel open for async response
    }

    if (msg.action === 'scrapeJobCards') {
      try {
        const cards = scrapeJobCards();
        sendResponse({ success: true, data: cards });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.action === 'scrapeJobDetail') {
      try {
        const detail = scrapeJobDetail();
        sendResponse({ success: true, data: detail });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.action === 'scrapePeopleCards') {
      try {
        const people = scrapePeopleCards();
        sendResponse({ success: true, data: people });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.action === 'insertMessage') {
      insertMessage(msg.text || '')
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
}

// ── Progressive scroll with bounded time (~4s max) ────────────────────────────
async function scrapeWithProgressiveScroll() {
  const originalY = window.scrollY;
  const pageH     = document.body.scrollHeight;
  const STEP      = Math.round(pageH / 5); // 5 steps regardless of page height
  const MAX_STEPS = 6;
  const STEP_WAIT = 400; // ms per step
  const MAX_TOTAL = 4000; // 4s hard cap

  const start = Date.now();

  // Scroll down in steps, polling for content
  let pos = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (Date.now() - start >= MAX_TOTAL) break;
    pos = Math.min(pos + STEP, pageH);
    window.scrollTo(0, pos);
    await wait(STEP_WAIT);
  }

  // Scroll back to where the user was
  window.scrollTo(0, originalY);
  await wait(200);

  return scrapeProfile();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main scraper ───────────────────────────────────────────────────────────────
function scrapeProfile() {
  const clean = str => (str || '').replace(/\s+/g, ' ').trim();

  // ── Section finder: multi-strategy ────────────────────────────────────────
  // Strategy 1: heading text (English + common variants)
  // Strategy 2: data-section or aria-label attributes
  // Strategy 3: DOM structure fallback
  function getSection(headingVariants) {
    const variants = Array.isArray(headingVariants) ? headingVariants : [headingVariants];

    // Strategy 1: h2 text match
    const byHeading = Array.from(document.querySelectorAll('section')).find(sec => {
      const h = sec.querySelector('h2,h3');
      if (!h) return false;
      const text = (h.innerText || h.textContent || '').trim().toLowerCase();
      return variants.some(v => text.includes(v.toLowerCase()));
    });
    if (byHeading) return byHeading;

    // Strategy 2: aria-label or data-section attributes
    const byAttr = Array.from(document.querySelectorAll('section,div')).find(el => {
      const label = (el.getAttribute('aria-label') || el.getAttribute('data-section') || '').toLowerCase();
      return variants.some(v => label.includes(v.toLowerCase()));
    });
    if (byAttr) return byAttr;

    return null;
  }

  // Leaf text nodes from p and span elements
  function getTexts(section, minLen = 2) {
    if (!section) return [];
    return Array.from(section.querySelectorAll('p, span, li'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText || el.textContent))
      .filter(t => t.length > minLen && !/^[·•·\s]+$/.test(t));
  }

  // ── NAME ──────────────────────────────────────────────────────────────────
  const name = clean(document.querySelector('h1')?.innerText) ||
               clean(document.title.split('|')[0]);

  // ── HEADLINE ──────────────────────────────────────────────────────────────
  let headline = null;
  const allSections = Array.from(document.querySelectorAll('section'));
  for (const sec of allSections) {
    if (!sec.querySelector('h1')) continue;
    const pTags = Array.from(sec.querySelectorAll('p'))
      .filter(p => p.children.length === 0)
      .map(p => clean(p.innerText || p.textContent))
      .filter(t => t.length > 5 && t !== name);
    const headlineEl = pTags.find(t =>
      t.includes('|') || t.includes('@') || t.includes('·') ||
      /manager|engineer|analyst|developer|designer|founder|director|lead|specialist|consultant|intern|fellow|trainee|scientist|researcher|architect|officer|head of|vp |cto|ceo|coo|cso/i.test(t)
    ) || pTags[0];
    if (headlineEl) { headline = headlineEl; break; }
  }

  // ── LOCATION ──────────────────────────────────────────────────────────────
  // Relaxed: no mandatory comma. Accept short location-like strings.
  let location = null;
  for (const sec of allSections) {
    if (!sec.querySelector('h1')) continue;
    const pTags = Array.from(sec.querySelectorAll('p'))
      .filter(p => p.children.length === 0)
      .map(p => clean(p.innerText || p.textContent))
      .filter(t => t.length > 3 && t.length < 70);
    const locEl = pTags.find(t =>
      !t.includes('|') && !t.includes('@') && t !== name && t !== headline &&
      (t.includes(',') || /\b(area|region|remote|india|usa|uk|canada|australia|germany|france|singapore|bay area|new york|london)\b/i.test(t))
    );
    if (locEl) { location = locEl; break; }
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  // Multi-language heading variants
  const aboutSection = getSection(['About', 'À propos', 'Acerca de', 'Über mich', 'Sobre', 'Hakkında']);
  let about = null;
  if (aboutSection) {
    const texts = getTexts(aboutSection);
    const longText = texts.find(t =>
      t.length > 60 &&
      !t.includes('Experience') && !t.includes('Skills') &&
      !/^(show|see)\s+(more|all|less)/i.test(t)
    );
    if (longText) about = longText;
    else if (texts.length > 0) {
      // Concatenate short fragments into an about
      const combined = texts.filter(t => t.length > 15).join(' ');
      if (combined.length > 40) about = combined.slice(0, 500);
    }
  }

  // ── EXPERIENCE ────────────────────────────────────────────────────────────
  const experienceEntries = [];
  const expSection = getSection(['Experience', 'Expérience', 'Experiencia', 'Berufserfahrung', 'Experiência', 'Deneyim']);
  if (expSection) {
    const pTags = Array.from(expSection.querySelectorAll('p, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText || el.textContent))
      .filter(t =>
        t.length > 2 &&
        !/^(experience|show (more|all|less)|see (more|all))$/i.test(t) &&
        !/^(·|•)$/.test(t)
      );

    // Detect "Present" to find current role accurately
    function isPresentMarker(s) {
      return /\bpresent\b|\bcurrent\b|\bnow\b/i.test(s);
    }

    let i = 0;
    while (i < pTags.length) {
      const title = pTags[i];

      // Skip if this line looks like a date or location
      if (/^\d{4}|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(title) ||
          /\d{4}\s*[-–]\s*(\d{4}|present)/i.test(title)) {
        i++; continue;
      }

      const company  = pTags[i + 1] || null;
      const dur      = pTags[i + 2] || null;
      const hasDur   = dur && /\d{4}|present|yr|mos|\bmo\b/i.test(dur);

      // isCurrent: look for "Present" in the duration string, not just position
      const isCurrent = hasDur ? isPresentMarker(dur) : experienceEntries.length === 0;

      if (title && title.length > 1) {
        experienceEntries.push({
          title,
          company: company ? company.split('·')[0].trim() : null,
          duration: hasDur ? dur : null,
          isCurrent,
        });
      }

      // Advance: title + company + duration + optional location = 3 or 4 lines
      const nextLine = pTags[i + 3] || '';
      const hasLocation = /remote|onsite|on-site|hybrid|india|bengaluru|mumbai|delhi|pune|bangalore|hyderabad|chennai|kolkata|usa|new york|london|singapore/i.test(nextLine);
      i += hasLocation ? 4 : 3;
    }
  }

  // Find the actual current entry (first one with isCurrent=true, or first entry)
  const currentEntry   = experienceEntries.find(e => e.isCurrent) || experienceEntries[0] || null;
  const currentTitle   = currentEntry?.title   || extractFromHeadline(headline, 'title');
  const currentCompany = currentEntry?.company || extractFromHeadline(headline, 'company');
  const pastCompanies  = [...new Set(
    experienceEntries
      .filter(e => !e.isCurrent && e !== currentEntry)
      .map(e => e.company)
      .filter(Boolean)
  )];

  // ── SKILLS ────────────────────────────────────────────────────────────────
  const skills = [];
  const skillsSection = getSection(['Skills', 'Compétences', 'Habilidades', 'Kenntnisse', 'Competências', 'Beceriler']);
  if (skillsSection) {
    const texts = getTexts(skillsSection);
    texts
      .filter(t =>
        t.length > 2 && t.length < 60 &&
        !/^\d+$/.test(t) &&
        !/\b(follower|connection|endorsement|endorse|show all|see all|dialog|window|escape|notification|premium|people you may|might also know)\b/i.test(t) &&
        !/^(skills|see more|show more)$/i.test(t.toLowerCase())
      )
      .forEach(t => skills.push(t));
  }

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  const educationEntries = [];
  const eduSection = getSection(['Education', 'Formation', 'Educación', 'Ausbildung', 'Educação', 'Eğitim']);
  if (eduSection) {
    const pTags = Array.from(eduSection.querySelectorAll('p, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText || el.textContent))
      .filter(t =>
        t.length > 2 &&
        !/^(education|show (more|all))$/i.test(t.toLowerCase())
      );
    // Group: school, degree (optional), years (optional)
    for (let i = 0; i < pTags.length; i += 3) {
      if (pTags[i]) {
        const entry = [pTags[i], pTags[i + 1]].filter(Boolean).join(' — ');
        educationEntries.push(entry);
      }
    }
  }

  // ── RECENT POSTS (Activity section) ───────────────────────────────────────
  const recentPosts = [];
  const activitySection = getSection(['Activity', 'Activité', 'Actividad', 'Aktivität', 'Atividade', 'Etkinlik']);
  if (activitySection) {
    // Tighter filter: exclude obvious UI chrome
    const chromePattern = /\b(dialog|window|escape|cancel|close|beginning of|notifications|premium|people you may|you might|connect|follow|message|see all activity|show all|load more|ago|like|comment|repost|share|reaction)\b/i;
    Array.from(activitySection.querySelectorAll('p, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText || el.textContent))
      .filter(t =>
        t.length > 50 && t.length < 500 &&
        !chromePattern.test(t) &&
        !/^\d+\s*(like|comment|repost|reaction)/i.test(t)
      )
      .forEach(t => { if (!recentPosts.includes(t)) recentPosts.push(t); });
  }

  // ── Build mainText (cleaned, deduplicated, capped ~6000 chars) ─────────────
  const rawChunks = [
    name, headline, location, about,
    ...experienceEntries.map(e => [e.title, e.company, e.duration].filter(Boolean).join(', ')),
    ...skills.slice(0, 10),
    ...educationEntries,
    ...recentPosts.slice(0, 2),
  ].filter(Boolean);

  const seen = new Set();
  const deduped = rawChunks.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });
  const mainText = deduped.join('\n').slice(0, 6000);

  // ── Scrape quality score (0-100) ─────────────────────────────────────────
  const fields = { name, headline, currentTitle, currentCompany, about };
  const filled  = Object.values(fields).filter(v => v && String(v).trim().length > 0).length;
  const bonus   = (skills.length > 0 ? 10 : 0) + (recentPosts.length > 0 ? 10 : 0);
  const scrapeQuality = Math.min(100, Math.round((filled / Object.keys(fields).length) * 80) + bonus);

  return {
    name,
    headline,
    currentTitle,
    currentCompany,
    location,
    about,
    recentPosts:       recentPosts.slice(0, 3),
    experienceEntries: experienceEntries.slice(0, 5),
    pastCompanies:     pastCompanies.slice(0, 4),
    educationEntries:  educationEntries.slice(0, 3),
    skills:            skills.slice(0, 10),
    profileUrl:        window.location.href.split('?')[0],
    rawTitle:          document.title,
    mainText,
    scrapeQuality,
  };
}

function extractFromHeadline(headline, field) {
  if (!headline) return null;
  const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) return field === 'title' ? atMatch[1].trim() : atMatch[2].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
  if (pipeMatch) return field === 'title' ? pipeMatch[1].trim() : pipeMatch[2].trim();
  return null;
}

// ── Insert message into LinkedIn composer ────────────────────────────────────
async function insertMessage(text) {
  if (!text) return { success: false, error: 'No text to insert.' };

  // Try multiple selector strategies for composer/note fields
  const selectors = [
    // "Add a note" textarea in connect dialog
    'div[aria-label="Add a note"]',
    'textarea[name="message"]',
    // Message composer contenteditable
    'div.msg-form__contenteditable',
    'div[data-artdeco-is-focused]',
    '[contenteditable="true"].msg-form__contenteditable',
    // Generic contenteditable in a dialog
    'div[role="dialog"] [contenteditable="true"]',
    // Fallback: any visible contenteditable
    '[contenteditable="true"]',
  ];

  let target = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) { target = el; break; }
  }

  if (!target) {
    return {
      success: false,
      error: 'Open a "Message" or "Add a note" composer first, then click Insert again.',
    };
  }

  // Set text and dispatch input events so React/Angular picks it up
  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // contenteditable
    target.focus();
    target.textContent = text;
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  return { success: true };
}

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 &&
    window.getComputedStyle(el).visibility !== 'hidden' &&
    window.getComputedStyle(el).display !== 'none';
}

// ── Stage B: Job & People Scrapers ───────────────────────────────────────────
function csClean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function csGetText(el) {
  return el ? csClean(el.innerText || el.textContent || '') : '';
}

function csGetAttr(el, ...attrs) {
  if (!el) return '';
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v) return v.trim();
  }
  return '';
}

function csCleanDescription(raw) {
  return (raw || '')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\s+|\s+$/gm, '')
    .trim();
}

function detectPageType(url) {
  url = url || window.location.href;
  if (/linkedin\.com\/jobs\/search/i.test(url))            return 'jobs_search';
  if (/linkedin\.com\/jobs\/view/i.test(url))              return 'job_detail';
  if (/linkedin\.com\/search\/results\/people/i.test(url)) return 'people_search';
  if (/linkedin\.com\/in\/[^/?#]+/i.test(url))            return 'profile';
  return 'other';
}

function scrapeJobCards() {
  const cards = [];
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
      const jobId = csGetAttr(el, 'data-occludable-job-id', 'data-job-id', 'data-entity-urn') || String(idx);
      const titleEl = el.querySelector([
        '.job-card-list__title',
        '.jobs-unified-top-card__job-title',
        '[class*="job-card"][class*="title"]',
        '[class*="job-title"]',
        'a strong',
        'h3', 'h4',
      ].join(','));
      const title = csGetText(titleEl);

      const companyEl = el.querySelector([
        '.job-card-container__company-name',
        '.job-card-list__company-name',
        '.artdeco-entity-lockup__subtitle',
        '[class*="company-name"]',
        '[class*="primary-subtitle"]',
      ].join(','));
      const company = csGetText(companyEl);

      const locationEl = el.querySelector([
        '.job-card-container__metadata-item',
        '.job-card-list__location',
        '[class*="location"]',
        '[class*="secondary-subtitle"]',
      ].join(','));
      const location = csGetText(locationEl);

      const timeEl = el.querySelector('time, [class*="listdate"], [class*="posted"]');
      const postedTime = csGetText(timeEl) || csGetAttr(timeEl, 'datetime', 'title');

      const snippetEl = el.querySelector('.job-card-list__insight, .job-card-container__insight, p');
      const snippet = csGetText(snippetEl).slice(0, 200);

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
      const txt = csGetText(el);
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
    const txt = csGetText(el);
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
    const txt = csGetText(el);
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
  const employmentType = csGetText(typeEl);

  // Posted time
  const timeEl = document.querySelector([
    '.jobs-unified-top-card__posted-date',
    '.job-details-jobs-unified-top-card__primary-description-without-tagline span',
    'time',
    '[class*="posted"]',
  ].join(','));
  const postedTime = csGetText(timeEl) || csGetAttr(timeEl, 'datetime');

  // Apply type (Easy Apply vs external)
  const easyApplyBtn = document.querySelector([
    '.jobs-apply-button--top-card',
    'button[aria-label*="Easy Apply"]',
    '.jobs-s-apply button',
  ].join(','));
  const applyType = easyApplyBtn ? 'easy_apply' : 'external';

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
      description = csCleanDescription(el.innerText || el.textContent);
      break;
    }
  }

  if (!description) {
    const headings = Array.from(document.querySelectorAll('h2, h3, h4'));
    const aboutHeading = headings.find(h => /about the job|job description/i.test(h.textContent || ''));
    if (aboutHeading) {
      const parent = aboutHeading.closest('section, article, div.job-details-module, div');
      if (parent && parent.textContent.length > 80) {
        description = csCleanDescription(parent.innerText || parent.textContent);
      }
    }
  }

  if (!description) {
    const divs = Array.from(document.querySelectorAll('div, section, article'))
      .filter(d => d.textContent.length > 200 && d.children.length < 15)
      .sort((a, b) => b.textContent.length - a.textContent.length);
    if (divs[0]) description = csCleanDescription(divs[0].innerText || divs[0].textContent);
  }

  description = description.slice(0, 6000);
  const jobUrl = window.location.href.split('?')[0];

  const fields = { title, company, location, description };
  const filled  = Object.values(fields).filter(v => v && v.trim().length > 0).length;
  const scrapeQuality = Math.round((filled / Object.keys(fields).length) * 100);

  return {
    title, company, location, employmentType, postedTime,
    applyType, applyUrl, description, jobUrl, scrapeQuality,
  };
}

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
      const name = csGetText(nameEl);

      const headlineEl = el.querySelector([
        '.entity-result__primary-subtitle',
        '.entity-result__secondary-subtitle',
        '[class*="subtitle"]',
      ].join(','));
      const headline = csGetText(headlineEl);

      const linkEl = el.querySelector('a[href*="/in/"]');
      const link = linkEl ? linkEl.href.split('?')[0] : '';

      if (name || link) people.push({ name, headline, link });
    } catch (_) { /* skip broken card */ }
  });

  return people;
}
