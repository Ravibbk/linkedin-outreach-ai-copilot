'use strict';

// utils/tracker.js — Application tracker: local CRUD, capped at 100 jobs.
// All data in chrome.storage.local. CSV export is client-side only.

const Tracker = (() => {
  const KEY     = 'jobTracker';
  const MAX     = 100;
  const FOLLOW_UP_DAYS = 7; // flag for follow-up after this many days

  // Valid status values (ordered pipeline)
  const STATUSES = ['Saved', 'Preparing', 'Applied', 'Referral asked', 'Interview', 'Offer', 'Rejected'];

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function getAll() {
    return new Promise(resolve => {
      chrome.storage.local.get([KEY], r => resolve(r[KEY] || []));
    });
  }

  async function getById(id) {
    const all = await getAll();
    return all.find(j => j.id === id) || null;
  }

  /**
   * Add a new job to the tracker.
   * If a job with the same link already exists, update it instead.
   * Returns the saved record.
   */
  async function addJob(jobData) {
    const all = await getAll();

    // Dedup by link
    const existingIdx = all.findIndex(j => (jobData.link && j.link === jobData.link) || (jobData.id && j.id === jobData.id));
    const id = existingIdx >= 0 ? all[existingIdx].id : (jobData.id || generateId());

    const record = {
      id,
      title:          jobData.title          || '',
      company:        jobData.company         || '',
      link:           jobData.link            || '',
      status:         jobData.status          || 'Saved',
      notes:          jobData.notes           || '',
      savedAt:        jobData.savedAt         || Date.now(),
      appliedAt:      jobData.appliedAt       || null,
      followUpDue:    jobData.followUpDue     || null,
      linkedContacts: jobData.linkedContacts  || [],
      kit:            jobData.kit             || null, // savedKit JSON
      checklist: jobData.checklist || {
        summaryCopied:   false,
        coverNoteReady:  false,
        reachedOut:      false,
        applyPageOpened: false,
      },
    };

    if (existingIdx >= 0) {
      all[existingIdx] = { ...all[existingIdx], ...record };
    } else {
      // Cap at MAX: remove oldest if needed
      if (all.length >= MAX) {
        const oldest = all.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))[0];
        const idx = all.indexOf(oldest);
        all.splice(idx, 1);
      }
      all.unshift(record);
    }

    await saveAll(all);
    return record;
  }

  /**
   * Update specific fields of a job record.
   */
  async function updateJob(id, updates = {}) {
    const all = await getAll();
    const idx = all.findIndex(j => j.id === id);
    if (idx < 0) return null;

    // If status is being set to Applied, record appliedAt
    if (updates.status === 'Applied' && !all[idx].appliedAt) {
      updates.appliedAt  = Date.now();
      updates.followUpDue = Date.now() + FOLLOW_UP_DAYS * 86400 * 1000;
    }

    all[idx] = { ...all[idx], ...updates };
    await saveAll(all);
    return all[idx];
  }

  async function deleteJob(id) {
    const all = await getAll();
    const filtered = all.filter(j => j.id !== id);
    await saveAll(filtered);
  }

  async function clearAll() {
    await saveAll([]);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async function getByStatus(status) {
    const all = await getAll();
    return status ? all.filter(j => j.status === status) : all;
  }

  async function getFollowUpDue() {
    const all  = await getAll();
    const now  = Date.now();
    return all.filter(j =>
      j.status === 'Applied' &&
      j.followUpDue && j.followUpDue < now
    );
  }

  async function getStats() {
    const all = await getAll();
    const stats = {};
    STATUSES.forEach(s => { stats[s] = 0; });
    all.forEach(j => { if (stats[j.status] !== undefined) stats[j.status]++; });
    stats.total = all.length;
    stats.followUpDue = (await getFollowUpDue()).length;
    return stats;
  }

  // ── CSV Export ────────────────────────────────────────────────────────────

  /**
   * Generate a CSV string from all tracked jobs.
   * Client-side only — no server involved.
   */
  async function exportCSV() {
    const all    = await getAll();
    const cols   = ['title', 'company', 'status', 'link', 'notes', 'savedAt', 'appliedAt'];
    const header = cols.join(',');
    const rows   = all.map(j =>
      cols.map(c => {
        let v = j[c] || '';
        if (c === 'savedAt' || c === 'appliedAt') {
          v = v ? new Date(v).toISOString().split('T')[0] : '';
        }
        return csvEscape(String(v));
      }).join(',')
    );
    return [header, ...rows].join('\r\n');
  }

  /** Escape a CSV field: wrap in quotes if it contains comma, quote, or newline. */
  function csvEscape(value) {
    const s = String(value || '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ── Daily note counter ────────────────────────────────────────────────────

  const NOTE_COUNTER_KEY = 'dailyNoteCount';
  const DAILY_NOTE_WARNING = 15; // soft limit — reminder, not a block

  async function incrementNoteCount() {
    return new Promise(resolve => {
      chrome.storage.local.get([NOTE_COUNTER_KEY], r => {
        const data   = r[NOTE_COUNTER_KEY] || { count: 0, date: todayStr() };
        const today  = todayStr();
        const count  = data.date === today ? data.count + 1 : 1;
        chrome.storage.local.set({ [NOTE_COUNTER_KEY]: { count, date: today } }, () => resolve(count));
      });
    });
  }

  async function getNoteCount() {
    return new Promise(resolve => {
      chrome.storage.local.get([NOTE_COUNTER_KEY], r => {
        const data = r[NOTE_COUNTER_KEY] || { count: 0, date: todayStr() };
        resolve(data.date === todayStr() ? data.count : 0);
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function saveAll(arr) {
    return new Promise(resolve => chrome.storage.local.set({ [KEY]: arr }, resolve));
  }

  function generateId() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  return {
    getAll, getById, addJob, updateJob, deleteJob, clearAll,
    getByStatus, getFollowUpDue, getStats,
    exportCSV, csvEscape,
    incrementNoteCount, getNoteCount,
    STATUSES, MAX, DAILY_NOTE_WARNING,
  };
})();
