// dev/check-writer.js — Quality gate for the local message writer
// Run: node dev/check-writer.js
// Not included in the extension popup; for local testing only.

'use strict';

// ── Inline the parts of background.js needed for testing ─────────────────────

const SIGNAL_PRIORITY = {
  shared_ground: 1, recent_post: 2, about: 3, current_role: 4,
  current_company: 5, past_company: 6, education: 7, skill: 8, headline: 9,
};

function detectSignals(profile = {}, senderProfile = {}) {
  const signals = [];
  const recipEdu   = (profile.educationEntries || []).map(e => String(e).toLowerCase());
  const senderEdu  = (senderProfile.education  || []).map(e => String(e).toLowerCase());
  const sharedSchool = recipEdu.find(re => senderEdu.some(se => se && re.includes(se.split(' ')[0])));
  if (sharedSchool) signals.push({ id: 'shared_school', type: 'shared_ground', value: sharedSchool, reason: 'Same school', priority: 1 });

  const recipSkills  = (profile.skills || []).map(s => s.toLowerCase());
  const senderSkills = (senderProfile.topSkills || []).map(s => s.toLowerCase());
  const sharedSkill  = recipSkills.find(rs => senderSkills.some(ss => ss && rs.includes(ss.split(' ')[0])));
  if (sharedSkill && !sharedSchool) signals.push({ id: 'shared_skill', type: 'shared_ground', value: sharedSkill, reason: 'Shared skill', priority: 1 });

  const firstPost = (profile.recentPosts || [])[0];
  if (firstPost && String(firstPost).trim().length > 20)
    signals.push({ id: 'recent_post_0', type: 'recent_post', value: String(firstPost).slice(0, 80), reason: 'Recent post', priority: 2 });

  const about = String(profile.about || '').trim();
  if (about.length > 60) {
    const frag = about.split(/[.!?]/)[0].trim();
    if (frag.length > 20 && frag.length < 120)
      signals.push({ id: 'about_snippet', type: 'about', value: frag.slice(0, 90), reason: 'About section', priority: 3 });
  }

  if (profile.currentTitle && profile.currentCompany)
    signals.push({ id: 'current_role', type: 'current_role', value: `${profile.currentTitle} at ${profile.currentCompany}`, reason: 'Current role', priority: 4 });
  else if (profile.currentTitle)
    signals.push({ id: 'current_role', type: 'current_role', value: profile.currentTitle, reason: 'Current title', priority: 4 });

  if ((profile.skills || []).length > 0)
    signals.push({ id: 'skill_0', type: 'skill', value: profile.skills.slice(0, 3).join(', '), reason: 'Skills', priority: 8 });

  if (signals.length === 0 && profile.headline)
    signals.push({ id: 'headline', type: 'headline', value: profile.headline.slice(0, 80), reason: 'Headline', priority: 9 });

  signals.sort((a, b) => a.priority - b.priority);
  const seenTypes = new Set();
  return signals.filter(s => { if (seenTypes.has(s.type)) return false; seenTypes.add(s.type); return true; }).slice(0, 3);
}

const Limits = { CONNECTION_NOTE: 300, SHORT_DM: 500, FULL_MESSAGE: 900 };

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.lastIndexOf(' ', n - 2);
  return (cut > 0 ? s.slice(0, cut) : s.slice(0, n - 1)) + '…';
}

function cleanFirstName(raw) {
  return String(raw || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\([\w/\s]+\)/g, '').replace(/,?\s*(Dr\.|PhD|MBA|MSc|BSc)\s*/gi, '')
    .trim().split(/\s+/)[0] || 'there';
}

function getLimitForKey(key) { return Limits[key] || 500; }

function buildHookLine(signal, p, tone, variantIndex) {
  if (!signal) {
    const role = p.currentTitle || p.headline || 'your work';
    const co   = p.currentCompany ? ` at ${p.currentCompany}` : '';
    return `I noticed your work as ${role}${co} and thought I'd reach out.`;
  }
  const v = variantIndex % 2;
  const map = {
    recent_post:     [`Your recent post on "${signal.value}" caught my attention.`,
                      `I read your recent thoughts on "${signal.value}" — really interesting perspective.`],
    shared_ground:   [`I noticed we share some common ground — ${signal.reason.toLowerCase()}.`,
                      `We seem to have a connection — ${signal.reason.toLowerCase()}.`],
    about:           [`Your focus on "${signal.value}" stood out to me.`,
                      `I was drawn to your work around "${signal.value}".`],
    current_role:    [`I came across your profile as ${signal.value}.`,
                      `Your role as ${signal.value} is exactly the background I hoped to connect with.`],
    current_company: [`I noticed you're at ${signal.value} — a team doing interesting work.`,
                      `Your work at ${signal.value} caught my attention.`],
    past_company:    [`I saw your background at ${signal.value}.`,
                      `Your experience at ${signal.value} stood out.`],
    education:       [`I noticed your background at ${signal.value}.`,
                      `Your education at ${signal.value} caught my eye.`],
    skill:           [`Your expertise in ${signal.value} drew me to your profile.`,
                      `I came across your profile while looking for people with ${signal.value} experience.`],
  };
  const lines = map[signal.type] || [`I came across your profile and wanted to reach out.`];
  return lines[v % lines.length];
}

function buildBioLine(bio, tone) {
  const short = truncate(bio, 100);
  if (tone === 'Formal') return `By way of background: ${short}`;
  if (tone === 'Casual') return `A quick bit about me: ${short}`;
  return `A bit about me: ${short}`;
}

function buildAsk(messageType, tone, company, isRecruiter, variantIndex) {
  const v = variantIndex % 2;
  const co = company || '';
  const asks = {
    Networking: { Formal: [`I would value the opportunity to connect.`, `I would appreciate connecting to exchange perspectives.`], Neutral: [`I'd love to connect and hear more about what you're working on.`, `Would you be open to connecting?`], Casual: [`Would love to grab a virtual coffee and chat!`, `Would be great to connect!`] },
    Job:        { Formal: [`I am exploring new opportunities and believe my background aligns. Would you be open to a brief call?`, `I'm exploring my next role and would value your perspective.`], Neutral: [`I'm exploring roles${co && isRecruiter ? ' at ' + co : ''} — open to a quick chat?`, `Would you be open to a brief call about opportunities?`], Casual: [`Looking for my next role and would love to chat — even just 15 mins!`, `Would be great to connect about any openings!`] },
    Referral:   { Formal: [`If open to it, I'd appreciate guidance on roles${co ? ' at ' + co : ''}, or a referral if you think I'd be a fit.`, `I would be grateful for any advice on the hiring process${co ? ' at ' + co : ''}.`], Neutral: [`If you're open, I'd appreciate advice on roles${co ? ' at ' + co : ''} — or a referral if I'd be a fit.`, `Would you be comfortable pointing me toward any opportunities?`], Casual: [`Any chance you'd put in a good word? Really appreciate it!`, `Would love a nudge toward any openings if you know of any!`] },
    Collaboration: { Formal: [`I believe there may be a meaningful collaboration opportunity and would welcome the chance to explore it.`, `I would love to explore a potential collaboration.`], Neutral: [`I think there could be a great opportunity to collaborate — would you be open to a quick call?`, `Would love to run some ideas by you about a potential collab.`], Casual: [`I've got ideas for a collab and would love to chat — interested?`, `Think we could build something cool together!`] },
  };
  const typAsks = asks[messageType] || asks.Networking;
  const toneAsks = typAsks[tone] || typAsks.Neutral;
  return toneAsks[v % toneAsks.length];
}

function trimToLimit(text, limit) {
  if (text.length <= limit) return text;
  const sub = text.slice(0, limit - 1);
  const last = Math.max(sub.lastIndexOf('. '), sub.lastIndexOf('! '), sub.lastIndexOf('? '));
  if (last > limit * 0.5) return sub.slice(0, last + 1).trim();
  const sp = sub.lastIndexOf(' ');
  return (sp > 0 ? sub.slice(0, sp) : sub) + '…';
}

function localMessage(p, signals, messageType, tone, lengthKey, settings = {}, variantIndex = 0) {
  const limit = getLimitForKey(lengthKey);
  const me    = (settings.userName || '').trim();
  const bio   = (settings.userBio  || '').trim();
  const fn    = p.firstName || cleanFirstName(p.name || '') || 'there';
  const isRecruiter = /recruit|talent|hiring|hr|people ops/i.test(p.currentTitle || '');

  const greetings = {
    Formal:  [`Dear ${fn},`,  `Hello ${fn},`],
    Neutral: [`Hi ${fn},`,    `Hey ${fn} —`],
    Casual:  [`Hey ${fn}!`,   `Hi ${fn}! Hope you're doing well.`],
  };
  const closes = { Formal: 'Kind regards,', Neutral: 'Best,', Casual: 'Cheers,' };

  const greet    = (greetings[tone] || greetings.Neutral)[variantIndex % 2];
  const close    = closes[tone] || 'Best,';
  const hookLine = buildHookLine(signals[0] || null, p, tone, variantIndex);
  const bioLine  = bio ? buildBioLine(bio, tone, variantIndex) : '';
  const ask      = buildAsk(messageType, tone, p.currentCompany, isRecruiter, variantIndex);
  const signOff  = `\n\n${close}${me ? '\n' + me : ''}`;

  let full = `${greet}\n\n${hookLine}${bioLine ? '\n\n' + bioLine : ''}\n\n${ask}${signOff}`;
  if (full.length <= limit) return full;
  let noBio = `${greet}\n\n${hookLine}\n\n${ask}${signOff}`;
  if (noBio.length <= limit) return noBio;
  return trimToLimit(noBio, limit);
}

// ── Mock profiles ─────────────────────────────────────────────────────────────
const mockProfiles = {
  complete: {
    name: 'Jane Smith', firstName: 'Jane',
    headline: 'Senior Engineer at Google | AI/ML',
    currentTitle: 'Senior Software Engineer', currentCompany: 'Google',
    location: 'San Francisco, CA',
    about: 'I build scalable ML systems. Previously led the Search infra team at Meta.',
    recentPosts: ['Just published a post on transformer architecture optimizations for production systems.'],
    skills: ['Python', 'TensorFlow', 'Distributed Systems', 'Kubernetes'],
    pastCompanies: ['Meta', 'Amazon'],
    educationEntries: ['MIT — Computer Science (2016)'],
  },
  noAbout: {
    name: 'Bob Chen', firstName: 'Bob',
    headline: 'Product Manager at Stripe',
    currentTitle: 'Product Manager', currentCompany: 'Stripe',
    about: '', recentPosts: [], skills: ['Product Strategy', 'SQL', 'A/B Testing'],
    pastCompanies: ['Uber'], educationEntries: ['Stanford — MBA'],
  },
  sparse: {
    name: 'Ali Hassan', firstName: 'Ali',
    headline: 'Looking for opportunities',
    currentTitle: '', currentCompany: '',
    about: '', recentPosts: [], skills: [], pastCompanies: [], educationEntries: [],
  },
  noActivity: {
    name: 'Priya Patel', firstName: 'Priya',
    headline: 'UX Designer | Figma | Design Systems',
    currentTitle: 'UX Designer', currentCompany: 'Shopify',
    about: 'I design systems that scale. Focus on accessibility and inclusivity.',
    recentPosts: [], skills: ['Figma', 'UX Research', 'Design Systems'],
    pastCompanies: ['Atlassian'], educationEntries: ['RISD — Graphic Design'],
  },
  emojiName: {
    name: '🌟 David Lee (he/him)', firstName: 'David',
    headline: 'Founder & CEO at StartupXYZ',
    currentTitle: 'Founder & CEO', currentCompany: 'StartupXYZ',
    about: 'Serial entrepreneur. Building AI tools for the next billion users.',
    recentPosts: [], skills: ['Entrepreneurship', 'Product', 'Fundraising'],
    pastCompanies: ['YCombinator'], educationEntries: [],
  },
  longAbout: {
    name: 'Sarah Connor', firstName: 'Sarah',
    headline: 'ML Research Scientist at DeepMind',
    currentTitle: 'ML Research Scientist', currentCompany: 'DeepMind',
    about: 'I am a machine learning researcher specializing in reinforcement learning and multi-agent systems. My work has been published at NeurIPS, ICML, and ICLR. I am passionate about making AI safe and beneficial. Before DeepMind, I was at OpenAI working on alignment research. I hold a PhD from Cambridge and was a visiting researcher at Berkeley AI Research. I mentor PhD students and love hiking.',
    recentPosts: ['Excited to share our new paper on multi-agent cooperation.'],
    skills: ['Reinforcement Learning', 'Python', 'PyTorch', 'Research'],
    pastCompanies: ['OpenAI'], educationEntries: ['Cambridge — PhD Computer Science'],
  },
  empty: {
    name: '', firstName: 'there',
    headline: '', currentTitle: '', currentCompany: '',
    about: '', recentPosts: [], skills: [], pastCompanies: [], educationEntries: [],
  },
};

const TYPES  = ['Networking', 'Job', 'Referral', 'Collaboration'];
const TONES  = ['Formal', 'Neutral', 'Casual'];
const LENGTHS = ['CONNECTION_NOTE', 'SHORT_DM', 'FULL_MESSAGE'];

// ── Assertions ─────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const errors = [];

function assert(condition, label) {
  if (condition) { pass++; }
  else { fail++; errors.push(`FAIL: ${label}`); }
}

// ── Run tests ──────────────────────────────────────────────────────────────────
for (const [profileName, profile] of Object.entries(mockProfiles)) {
  for (const type of TYPES) {
    for (const tone of TONES) {
      for (const lengthKey of LENGTHS) {
        const limit   = Limits[lengthKey];
        const signals = detectSignals(profile, { topSkills: ['Python'], education: ['MIT'] });

        // Test variant 0 and variant 1
        const msg0 = localMessage(profile, signals, type, tone, lengthKey, { userName: 'Test User', userBio: '' }, 0);
        const msg1 = localMessage(profile, signals, type, tone, lengthKey, { userName: 'Test User', userBio: '' }, 1);

        const label = `[${profileName}/${type}/${tone}/${lengthKey}]`;

        // 1. Non-empty
        assert(msg0 && msg0.trim().length > 10, `${label} v0: non-empty`);
        assert(msg1 && msg1.trim().length > 10, `${label} v1: non-empty`);

        // 2. Within limit
        assert(msg0.length <= limit, `${label} v0: within ${limit} chars (got ${msg0.length})`);
        assert(msg1.length <= limit, `${label} v1: within ${limit} chars (got ${msg1.length})`);

        // 3. No placeholder tokens
        assert(!/undefined|null|\[object|\{[A-Za-z]+\}|\[Name\]|\[Company\]/.test(msg0), `${label} v0: no placeholders`);
        assert(!/undefined|null|\[object|\{[A-Za-z]+\}|\[Name\]|\[Company\]/.test(msg1), `${label} v1: no placeholders`);

        // 4. Variant differs (at least one of the 36 combos should differ; allow same for edge cases)
        // We just check they're not identical for the "complete" profile
        if (profileName === 'complete') {
          assert(msg0 !== msg1, `${label}: v0 !== v1 (variants differ)`);
        }

        // 5. No banned clichés
        const lower0 = msg0.toLowerCase();
        assert(!lower0.includes('i hope this message finds you well'), `${label} v0: no banned cliché #1`);
        assert(!lower0.includes('impressed by your journey'), `${label} v0: no banned cliché #2`);
        assert(!lower0.includes('i came across your profile and was impressed'), `${label} v0: no banned cliché #3`);

        // 6. Signals ranked 1–3
        assert(signals.length >= 0 && signals.length <= 3, `${label}: signals 0–3 (got ${signals.length})`);
      }
    }
  }
}

// 7. Tones actually differ for the same profile/type/length
for (const [profileName, profile] of Object.entries(mockProfiles)) {
  if (profileName === 'empty') continue; // edge case
  for (const type of TYPES) {
    const signals = detectSignals(profile, {});
    const formalMsg  = localMessage(profile, signals, type, 'Formal',  'SHORT_DM', {}, 0);
    const neutralMsg = localMessage(profile, signals, type, 'Neutral', 'SHORT_DM', {}, 0);
    const casualMsg  = localMessage(profile, signals, type, 'Casual',  'SHORT_DM', {}, 0);
    assert(formalMsg !== neutralMsg || formalMsg !== casualMsg, `[${profileName}/${type}]: tones differ`);
  }
}

// 8. detectSignals returns max 3
for (const [name, p] of Object.entries(mockProfiles)) {
  const sigs = detectSignals(p, { topSkills: ['Python'], education: ['MIT'], pastCompanies: ['Meta'] });
  assert(sigs.length <= 3, `detectSignals[${name}]: max 3 signals`);
}

// ── Report ─────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`LinkedIn Outreach AI — Writer Quality Gate`);
console.log(`${'─'.repeat(50)}`);
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);
if (errors.length) {
  console.log('\nFailed assertions:');
  errors.forEach(e => console.log(' ', e));
  process.exit(1);
} else {
  console.log('\n✓ All assertions passed.');
  process.exit(0);
}
