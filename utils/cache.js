'use strict';

// utils/cache.js — Persistent storage layer (single source of truth for recent contacts & drafts)
// background.js SAVE_RECENT/GET_RECENT handlers have been removed; use this directly.

const Cache = (() => {
  const CONTACTS_KEY = 'recentContacts';
  const DRAFTS_KEY   = 'drafts';
  const MAX_CONTACTS = 20; // Raised from 5

  // ── Contacts (Recent tab) ────────────────────────────────────────────────

  async function getContacts() {
    return new Promise(resolve => {
      chrome.storage.local.get([CONTACTS_KEY], result => {
        resolve(result[CONTACTS_KEY] || []);
      });
    });
  }

  async function addContact(contact) {
    const contacts = await getContacts();
    const filtered = contacts.filter(c => c.profileUrl !== contact.profileUrl);
    const updated  = [contact, ...filtered].slice(0, MAX_CONTACTS);
    return new Promise(resolve => {
      chrome.storage.local.set({ [CONTACTS_KEY]: updated }, resolve);
    });
  }

  async function clearContacts() {
    return new Promise(resolve => {
      chrome.storage.local.set({ [CONTACTS_KEY]: [] }, resolve);
    });
  }

  // ── Drafts (per profileUrl) ───────────────────────────────────────────────

  async function getDraft(profileUrl) {
    if (!profileUrl) return null;
    return new Promise(resolve => {
      chrome.storage.local.get([DRAFTS_KEY], result => {
        const drafts = result[DRAFTS_KEY] || {};
        resolve(drafts[profileUrl] || null);
      });
    });
  }

  async function saveDraft(profileUrl, draft) {
    if (!profileUrl) return;
    return new Promise(resolve => {
      chrome.storage.local.get([DRAFTS_KEY], result => {
        const drafts = result[DRAFTS_KEY] || {};
        drafts[profileUrl] = { ...draft, savedAt: Date.now() };
        // Keep at most 50 drafts to avoid unbounded storage growth
        const urls = Object.keys(drafts);
        if (urls.length > 50) {
          const oldest = urls.sort((a, b) => (drafts[a].savedAt || 0) - (drafts[b].savedAt || 0))[0];
          delete drafts[oldest];
        }
        chrome.storage.local.set({ [DRAFTS_KEY]: drafts }, resolve);
      });
    });
  }

  async function clearDraft(profileUrl) {
    if (!profileUrl) return;
    return new Promise(resolve => {
      chrome.storage.local.get([DRAFTS_KEY], result => {
        const drafts = result[DRAFTS_KEY] || {};
        delete drafts[profileUrl];
        chrome.storage.local.set({ [DRAFTS_KEY]: drafts }, resolve);
      });
    });
  }

  return { getContacts, addContact, clearContacts, getDraft, saveDraft, clearDraft };
})();
