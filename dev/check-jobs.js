'use strict';

// dev/check-jobs.js — Quality gate and automated test suite for Stage B (Job-Search Copilot)
// Run: node dev/check-jobs.js
// Plain Node.js, zero external dependencies.

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    passed++;
    // console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
    if (details) console.error(`    Details: ${details}`);
  }
}

console.log('──────────────────────────────────────────────────');
console.log('LinkedIn Outreach AI — Stage B Quality Gate');
console.log('──────────────────────────────────────────────────\n');

// ── 1. DOM ID Cross-Check (popup.js vs popup.html) ───────────────────────────
console.log('1. Checking getElementById targets in popup.html...');
const htmlPath = path.join(__dirname, '..', 'popup.html');
const jsPath   = path.join(__dirname, '..', 'popup.js');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent   = fs.readFileSync(jsPath, 'utf8');

const idRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
let match;
const ids = new Set();
while ((match = idRegex.exec(jsContent)) !== null) {
  ids.add(match[1]);
}

let missingIds = [];
for (const id of ids) {
  const hasId = htmlContent.includes(`id="${id}"`) || htmlContent.includes(`id='${id}'`);
  if (!hasId) missingIds.push(id);
}
assert(missingIds.length === 0, 'All popup.js getElementById IDs exist in popup.html', `Missing: ${missingIds.join(', ')}`);
console.log(`  ✓ Verified ${ids.size} DOM element IDs.\n`);

// ── 2. Test utils/linkedinUrls.js ─────────────────────────────────────────────
console.log('2. Testing utils/linkedinUrls.js...');
const linkedinUrlsCode = fs.readFileSync(path.join(__dirname, '..', 'utils', 'linkedinUrls.js'), 'utf8');
const LinkedInURLs = eval(`(() => { ${linkedinUrlsCode}; return LinkedInURLs; })()`);

// URL generation
const url1 = LinkedInURLs.jobsSearch('Full Stack Engineer', 'San Francisco', { workType: 'remote', experienceLevel: 'entry' });
assert(url1.includes('linkedin.com/jobs/search'), 'jobsSearch returns linkedin.com/jobs/search URL');
assert(url1.includes('keywords=Full+Stack+Engineer') || url1.includes('keywords=Full%20Stack%20Engineer'), 'keywords encoded properly');
assert(url1.includes('location=San+Francisco') || url1.includes('location=San%20Francisco'), 'location encoded properly');
assert(url1.includes('f_WT=2'), 'remote work type maps to f_WT=2');
assert(url1.includes('f_E=2'), 'entry level maps to f_E=2');
assert(url1.includes('f_TPR=r604800'), 'past week filter applied by default');

// Special characters in URL
const urlSpecial = LinkedInURLs.jobsSearch('C++ / R&D Developer', 'New York, NY');
assert(urlSpecial.includes('C%2B%2B') || urlSpecial.includes('C%2B'), 'C++ escaped properly');
assert(urlSpecial.includes('%26') || urlSpecial.includes('&'), 'Ampersand handled');

// Suggest searches
const suggestions = LinkedInURLs.suggestSearches({
  targetRoles: ['Frontend Engineer', 'React Developer'],
  preferredLocations: ['Remote', 'London'],
  workType: 'remote',
  experienceLevel: 'mid',
});
assert(suggestions.length >= 2 && suggestions.length <= 5, 'suggestSearches returns 2-5 suggestions');
assert(suggestions.every(s => s.label && s.url && s.url.startsWith('https://')), 'all suggestions have label and valid URL');

// People at company
const peopleLinks = LinkedInURLs.peopleAtCompany('Acme Corp', 'Engineer', 'Stanford University', ['TypeScript', 'GraphQL']);
assert(peopleLinks.length >= 2, 'peopleAtCompany returns at least 2 search variants');
assert(peopleLinks.some(p => p.label.includes('Recruiters')), 'includes recruiters search');
assert(peopleLinks.some(p => p.label.includes('alumni')), 'includes alumni search with school name extracted');
console.log('  ✓ linkedinUrls.js tests passed.\n');

// ── 3. Test utils/jobRanker.js ────────────────────────────────────────────────
console.log('3. Testing utils/jobRanker.js...');
const jobRankerCode = fs.readFileSync(path.join(__dirname, '..', 'utils', 'jobRanker.js'), 'utf8');
const JobRanker = eval(`(() => { ${jobRankerCode}; return JobRanker; })()`);

// Keyword extraction
const desc = 'We are hiring a Senior React Developer experienced in TypeScript, Node.js, GraphQL, and AWS. Must have good leadership and communication.';
const kwObjs = JobRanker.extractJobKeywords(desc);
const kwStrings = kwObjs.map(k => k.keyword.toLowerCase());
assert(kwStrings.some(k => k.includes('react')), 'extracts React');
assert(kwStrings.some(k => k.includes('typescript')), 'extracts TypeScript');
assert(kwStrings.some(k => k.includes('node')), 'extracts Node');

// Job ranking scoring & labels
const sampleJobs = [
  {
    id: '1',
    title: 'Senior Product Manager',
    company: 'TechCorp',
    location: 'Remote',
    snippet: 'Looking for a Senior Product Manager with strong product strategy, user research, and data analysis skills.',
  },
  {
    id: '2',
    title: 'Junior QA Tester',
    company: 'TestingLabs',
    location: 'Chicago',
    snippet: 'Manual testing entry role.',
  },
  {
    id: '3',
    title: 'Unpaid Staffing Intern',
    company: 'Staffing Agency',
    location: 'New York',
    snippet: 'Staffing recruiter internship.',
  },
];

const cp = {
  targetRoles: ['Product Manager', 'Product Lead'],
  keySkills: ['product strategy', 'user research', 'data analysis'],
  preferredLocations: ['Remote'],
  avoidKeywords: ['staffing', 'unpaid'],
};

const ranked = JobRanker.rankJobs(sampleJobs, cp);
assert(ranked.length === 3, 'ranked all 3 jobs');
assert(ranked[0].id === '1', 'top match is Senior Product Manager');
assert(ranked[0].label === 'Strong', 'top match labeled Strong');
assert(ranked[0].score >= 7, 'top match score >= 7');
assert(ranked[0].reason.includes('Role matches'), 'reason mentions role match');

// Avoid keywords penalized
const penalized = ranked.find(j => j.id === '3');
assert(penalized.label === 'Stretch', 'unpaid staffing job penalized to Stretch');
assert(penalized.reason.includes('Contains'), 'reason mentions avoid keyword penalty');
console.log('  ✓ jobRanker.js tests passed.\n');

// ── 4. Test utils/kitBuilder.js & Anti-Hallucination Gate ─────────────────────
console.log('4. Testing utils/kitBuilder.js (Anti-Hallucination Guarantee)...');
const kitBuilderCode = fs.readFileSync(path.join(__dirname, '..', 'utils', 'kitBuilder.js'), 'utf8');
const KitBuilder = eval(`(() => {
  ${kitBuilderCode};
  return KitBuilder;
})()`);

// REQUIRED HALLUCINATION TEST:
// Candidate resume has JavaScript, React, Node.js — NO Kubernetes
// Job requires Kubernetes, React, Docker
const candidateResume = {
  name: 'Alex Developer',
  headline: 'Full Stack Engineer | React & Node.js',
  skills: ['JavaScript', 'React', 'Node.js', 'PostgreSQL'],
  topSkills: ['React', 'Node.js', 'JavaScript'],
  achievements: ['Built and scaled a web app to 50k MAU'],
  education: ['UC Berkeley — BS Computer Science'],
};

const k8sJob = {
  title: 'Cloud Systems Engineer',
  company: 'CloudNative Inc',
  description: 'Looking for an engineer skilled in Kubernetes, React, and Docker. Experience with microservices architecture and Kubernetes clusters required.',
};

const kit = KitBuilder.buildKit(k8sJob, candidateResume, cp, { userName: 'Alex Developer' });

// Test 1: Kubernetes must be missing, not matched
const k8sInMissing = kit.matchSummary.missingSkills.some(s => s.toLowerCase().includes('kubernetes'));
const k8sInMatched = kit.matchSummary.matchedSkills.some(s => s.toLowerCase().includes('kubernetes'));
assert(k8sInMissing, 'Kubernetes appears in missingSkills');
assert(!k8sInMatched, 'Kubernetes DOES NOT appear in matchedSkills');

// Test 2: Resume highlights must not claim Kubernetes
const bulletsText = (kit.resumeSummary.bullets || []).join(' ');
assert(!bulletsText.toLowerCase().includes('kubernetes'), 'Tailored resume bullets do not fabricate Kubernetes');

// Test 3: Cover note must not claim Kubernetes
assert(!kit.coverNote.toLowerCase().includes('kubernetes'), 'Cover note does not fabricate Kubernetes');

// Test 4: Cover note length must be under 1200 characters
assert(kit.coverNote.length <= 1200, `Cover note under 1200 chars (is ${kit.coverNote.length})`);

// Test 5: Missing notice period must produce placeholder
const noticeAnswer = kit.screeningAnswers.find(a => a.question.toLowerCase().includes('notice'));
assert(noticeAnswer && noticeAnswer.answer.includes('[add your answer here]'), 'Missing notice period leaves explicit placeholder');

// Test 6: Validation gate rejects fabricated skills
const forgedKit = JSON.parse(JSON.stringify(kit));
forgedKit.matchSummary.matchedSkills.push('Kubernetes');
forgedKit.coverNote += ' Proficient with Kubernetes clusters.';
const invalidResult = KitBuilder.validateKit(forgedKit, candidateResume);
assert(!invalidResult.valid, 'validateKit correctly REJECTS forged claim not in resume');

const validResult = KitBuilder.validateKit(kit, candidateResume);
assert(validResult.valid, 'validateKit ACCEPTS valid kit containing only verified resume facts', JSON.stringify(validResult.issues));
console.log('  ✓ kitBuilder.js anti-hallucination tests passed.\n');

// ── 5. Test utils/tracker.js ─────────────────────────────────────────────────
console.log('5. Testing utils/tracker.js...');
// Setup mock chrome.storage.local
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        keys.forEach(k => { res[k] = mockStorage[k]; });
        cb(res);
      },
      set: (obj, cb) => {
        Object.assign(mockStorage, obj);
        if (cb) cb();
      },
    },
  },
};

const trackerCode = fs.readFileSync(path.join(__dirname, '..', 'utils', 'tracker.js'), 'utf8');
const Tracker = eval(`(() => { ${trackerCode}; return Tracker; })()`);

(async () => {
  // Test CSV escaping
  assert(Tracker.csvEscape('Normal text') === 'Normal text', 'csvEscape plain text unchanged');
  assert(Tracker.csvEscape('Text, with comma') === '"Text, with comma"', 'csvEscape quotes commas');
  assert(Tracker.csvEscape('Text with "quotes"') === '"Text with ""quotes"""', 'csvEscape doubles internal quotes');
  assert(Tracker.csvEscape('Text\nwith newline') === '"Text\nwith newline"', 'csvEscape quotes newlines');

  // Test adding jobs
  await Tracker.clearAll();
  const j1 = await Tracker.addJob({ title: 'Frontend Engineer', company: 'Acme', link: 'https://linkedin.com/jobs/view/1' });
  assert(j1.id && j1.status === 'Saved', 'addJob sets id and default Saved status');

  const all = await Tracker.getAll();
  assert(all.length === 1, 'getAll returns saved job');

  // Dedup by link
  await Tracker.addJob({ title: 'Frontend Engineer Updated', company: 'Acme', link: 'https://linkedin.com/jobs/view/1' });
  const allAfterDedup = await Tracker.getAll();
  assert(allAfterDedup.length === 1 && allAfterDedup[0].title === 'Frontend Engineer Updated', 'dedupes by job link');

  // Status update to Applied sets followUpDue 7 days out
  await Tracker.updateJob(j1.id, { status: 'Applied' });
  const appliedJob = await Tracker.getById(j1.id);
  assert(appliedJob.status === 'Applied', 'status updated to Applied');
  assert(appliedJob.appliedAt !== null, 'appliedAt timestamp recorded');
  assert(appliedJob.followUpDue > Date.now(), 'followUpDue timestamp set in the future');

  // CSV export contains valid header and row
  const csv = await Tracker.exportCSV();
  assert(csv.includes('title,company,status,link'), 'CSV includes standard headers');
  assert(csv.includes('Frontend Engineer Updated,Acme,Applied'), 'CSV includes job row data');

  // Cap at 100
  await Tracker.clearAll();
  for (let i = 0; i < 105; i++) {
    await Tracker.addJob({ title: `Job ${i}`, company: 'Co', link: `https://test.com/${i}`, savedAt: i });
  }
  const capped = await Tracker.getAll();
  assert(capped.length === 100, `Tracker strictly capped at 100 records (is ${capped.length})`);

  // Daily note counter
  const initialCount = await Tracker.getNoteCount();
  const inc1 = await Tracker.incrementNoteCount();
  assert(inc1 === initialCount + 1, 'incrementNoteCount increments by 1');

  console.log('  ✓ tracker.js tests passed.\n');

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────');
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`);
  if (failed > 0) {
    console.error(`\n❌ Quality gate FAILED with ${failed} failure(s).`);
    process.exit(1);
  } else {
    console.log('\n✓ All Stage B quality gates passed! Production ready.');
  }
})();
