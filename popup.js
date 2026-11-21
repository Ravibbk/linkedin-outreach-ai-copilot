'use strict';

// popup.js — LinkedIn Outreach AI v3.2.0

// ─── State ────────────────────────────────────────────────────────────────────
let currentProfile    = null;  // normalized profile object from last scrape
let currentSignals    = [];    // ranked signal objects
let currentMessage    = '';    // last generated message text
let currentUsedAI     = false; // was the last message AI-generated?
let isGenerating      = false;
let currentMode       = 'simple';

// Deep Mode
let deepProfileJSON   = null;
let deepSignals       = [];
let isEnriching       = false;

// Draft / edit tracking
let userEditedMessage = false;
let draftSaveTimer    = null;
let regenDebounceTimer = null;
let variantIndex      = 0; // incremented on each Regenerate

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initModeToggle();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  wireJobsEvents();
  await checkCurrentPage();
  await loadSettings();
  await loadCareerProfile();
  await renderRecentContacts();
  await updateModeBadge();
  await tryRestoreDraft();
  await checkJobsPageStatus();
  await renderTrackerList();
  await updateNoteCounter();
});

// ─── Mode badge (renamed from checkLicenseStatus) ─────────────────────────────
async function updateModeBadge() {
  const s   = await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const el  = document.getElementById('key-status');
  el.textContent = key ? '● AI Mode' : '● Free Mode';
  el.className   = 'key-status active';

  // Show/hide manual resume fields based on key presence
  const hasKey = !!key;
  document.getElementById('resume-manual').classList.toggle('hidden', hasKey);
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
  if (name === 'jobs') onJobsTabActivated();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle() {
  document.getElementById('mode-simple').addEventListener('click', () => setMode('simple'));
  document.getElementById('mode-deep').addEventListener('click',   () => setMode('deep'));
}

function setMode(mode) {
  currentMode = mode;
  const isDeep = mode === 'deep';
  document.getElementById('mode-simple').classList.toggle('active', !isDeep);
  document.getElementById('mode-deep').classList.toggle('active', isDeep);
  document.getElementById('mode-simple').setAttribute('aria-pressed', String(!isDeep));
  document.getElementById('mode-deep').setAttribute('aria-pressed',   String(isDeep));
  document.getElementById('simple-mode-ui').classList.toggle('hidden', isDeep);
  document.getElementById('deep-mode-ui').classList.toggle('hidden', !isDeep);
  hideMessage();
  clearCurrentStatus();
}

// ─── Page check ───────────────────────────────────────────────────────────────
async function checkCurrentPage() {
  const tabs      = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab       = tabs[0];
  const onProfile = tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url);
  const onJobDetail = tab && tab.url && /linkedin\.com\/jobs\/view/i.test(tab.url);

  // Stage B rule: when on a job_detail page and user opens Current tab, pre-set messageType to 'Job'
  if (onJobDetail) {
    const msgTypeEl = document.getElementById('message-type');
    if (msgTypeEl && msgTypeEl.value !== 'Job') {
      msgTypeEl.value = 'Job';
    }
  }

  document.getElementById('scrape-btn').disabled  = !onProfile;
  document.getElementById('enrich-btn').disabled  = !onProfile;
  if (!onProfile) {
    document.getElementById('page-warning').classList.remove('hidden');
  } else {
    document.getElementById('page-warning').classList.add('hidden');
  }
  return onProfile;
}

// ─── Wire events ──────────────────────────────────────────────────────────────
function wireCurrentEvents() {
  document.getElementById('scrape-btn').addEventListener('click', handleScrapeAndGenerate);
  document.getElementById('enrich-btn').addEventListener('click', handleEnrich);
  document.getElementById('deep-generate-btn').addEventListener('click', handleDeepGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', handleRegenerate);
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('insert-btn').addEventListener('click', handleInsert);
  document.getElementById('why-toggle').addEventListener('click', toggleWhyPanel);
  document.getElementById('draft-discard-btn').addEventListener('click', discardDraft);
  document.getElementById('regen-yes-btn').addEventListener('click', () => {
    hideRegenPrompt();
    doRegenerate();
  });
  document.getElementById('regen-no-btn').addEventListener('click', hideRegenPrompt);

  const textarea = document.getElementById('generated-message');
  textarea.addEventListener('input', () => {
    updateCharCount();
    userEditedMessage = true;
    scheduleDraftSave();
  });

  // Ctrl/Cmd + Enter to copy
  textarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCopy();
    }
  });

  // Auto-regen on setting changes (debounced)
  ['message-type', 'tone', 'length-key'].forEach(id => {
    document.getElementById(id).addEventListener('change', onSettingChange);
  });
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });
  document.getElementById('reanalyze-btn').addEventListener('click', handleReanalyzeResume);

  // Resume upload
  const dropArea = document.getElementById('file-upload-area');
  dropArea.addEventListener('click',   () => document.getElementById('resume-upload').click());
  dropArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('resume-upload').click(); });
  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', e => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processResumeFile(file);
  });
  document.getElementById('resume-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) processResumeFile(file);
  });
}

function wireRecentEvents() {
  document.getElementById('clear-recent-btn').addEventListener('click', async () => {
    await Cache.clearContacts();
    renderRecentContacts();
  });
}

// ─── Auto-regen on setting change ────────────────────────────────────────────
function onSettingChange() {
  if (!currentProfile && !deepProfileJSON) return; // no profile yet
  if (!currentMessage) return;

  if (userEditedMessage) {
    showRegenPrompt();
    return;
  }

  // Debounce 400ms
  clearTimeout(regenDebounceTimer);
  regenDebounceTimer = setTimeout(() => {
    variantIndex = 0; // reset variant when settings change
    doRegenerate();
  }, 400);
}

function showRegenPrompt() { document.getElementById('regen-prompt').classList.remove('hidden'); }
function hideRegenPrompt() { document.getElementById('regen-prompt').classList.add('hidden'); }

// ─── Quick Mode ───────────────────────────────────────────────────────────────
async function handleScrapeAndGenerate() {
  if (isGenerating) return;
  isGenerating = true;
  variantIndex = 0;
  userEditedMessage = false;
  hideMessage();
  clearCurrentStatus();
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Scraping profile…');
  showSkeletonShimmer(true);

  try {
    const profile = await sendToBackground({ action: 'scrapeProfile' });
    currentProfile = profile;
    renderProfileCard(profile, []);

    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Generating…');

    const result = await callQuickGenerate(profile, 0);
    currentSignals  = result.signals || [];
    currentMessage  = result.message;
    currentUsedAI   = result.usedAI || false;

    renderProfileCard(profile, currentSignals);
    renderMessage(currentMessage);
    renderWhyPanel(currentSignals, result.usedSignalIds || []);
    renderQualityChips(currentMessage, currentSignals);

    if (result.fallbackReason) {
      showCurrentStatus(`AI unavailable — used Free Mode writer. (${result.fallbackReason})`, 'warning');
    } else {
      showCurrentStatus(currentUsedAI ? 'AI message ready.' : 'Message ready.', 'success');
    }

    await saveToRecent(profile, currentSignals);
    scheduleDraftSave();

  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
    showSkeletonShimmer(false);
  }
}

async function callQuickGenerate(profile, vIndex) {
  const settings    = await loadStoredSettings();
  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;
  const lengthKey   = document.getElementById('length-key').value;
  const response    = await sendToBackground({
    action: 'generateMessage',
    data: {
      profileData: profile,
      messageType,
      tone,
      lengthKey,
      variantIndex: vIndex,
      // Only send needed fields — never send resumeBase64
      senderProfile: settings.senderProfile,
      userName:      settings.userName,
      userBio:       settings.userBio,
    }
  });
  return {
    message:      response.generatedMessage,
    signals:      response.signals || [],
    usedAI:       response.usedAI || false,
    usedSignalIds: response.usedSignalIds || [],
    fallbackReason: response.fallbackReason,
  };
}

// ─── Regenerate ───────────────────────────────────────────────────────────────
async function handleRegenerate() {
  if (isGenerating) return;
  if (currentMode === 'deep') { handleDeepGenerate(); return; }
  if (!currentProfile) return;
  if (userEditedMessage) {
    showRegenPrompt();
    return;
  }
  doRegenerate();
}

async function doRegenerate() {
  if (isGenerating) return;
  if (!currentProfile && !deepProfileJSON) return;

  hideRegenPrompt();
  userEditedMessage = false;
  variantIndex++;

  if (currentMode === 'deep') {
    handleDeepGenerate();
    return;
  }

  isGenerating = true;
  hideMessage();
  showSkeletonShimmer(true);
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Regenerating…');

  try {
    const result = await callQuickGenerate(currentProfile, variantIndex);
    currentSignals = result.signals || [];
    currentMessage = result.message;
    currentUsedAI  = result.usedAI || false;

    renderMessage(currentMessage);
    renderWhyPanel(currentSignals, result.usedSignalIds || []);
    renderQualityChips(currentMessage, currentSignals);

    if (result.fallbackReason) {
      showCurrentStatus(`AI unavailable — used Free Mode writer.`, 'warning');
    } else {
      showCurrentStatus('Regenerated!', 'success');
    }
    scheduleDraftSave();
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
    showSkeletonShimmer(false);
  }
}

// ─── Deep Mode ────────────────────────────────────────────────────────────────
async function handleEnrich() {
  if (isEnriching) return;
  deepProfileJSON = null;
  deepSignals = [];
  variantIndex = 0;
  userEditedMessage = false;
  resetLayerStatuses();
  document.getElementById('signals-panel').classList.add('hidden');
  document.getElementById('deep-generate-btn').disabled = true;
  hideMessage();
  clearCurrentStatus();

  isEnriching = true;
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'Scraping profile…');
  setLayerStatus(1, 'running', 'Scraping…');

  let rawProfileData;
  try {
    rawProfileData = await sendToBackground({ action: 'scrapeProfile' });
  } catch (err) {
    setLayerStatus(1, 'error', 'Failed');
    showCurrentStatus('Could not scrape. Are you on a LinkedIn profile page?', 'error');
    isEnriching = false;
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Analyze (L1 + L2)');
    return;
  }

  currentProfile = rawProfileData;
  renderProfileCard(rawProfileData, []);
  setLayerStatus(1, 'running', 'Parsing…');
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'L1: Understanding profile…');

  // ── L1: Profile Understanding ────────────────────────────────────────────
  chrome.runtime.sendMessage({ type: 'RUN_PARSE', payload: { rawProfileData } }, async (parseResp) => {
    if (chrome.runtime.lastError || !parseResp || parseResp.status === 'error') {
      setLayerStatus(1, 'error', 'Error');
      showCurrentStatus((parseResp?.error) || 'L1 parse failed.', 'error');
      isEnriching = false;
      setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Analyze (L1 + L2)');
      return;
    }

    deepProfileJSON = parseResp.profileJSON;
    setLayerStatus(1, 'done', 'Done');
    setLayerModeTag(1, parseResp.usedAI ? 'AI' : 'Local', parseResp.usedAI);
    renderProfileCard(deepProfileJSON, []);
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'L2: Finding signals…');
    setLayerStatus(2, 'running', 'Ranking…');

    // ── L2: Signal Finder ──────────────────────────────────────────────────
    chrome.runtime.sendMessage({ type: 'RUN_SIGNALS', payload: { profileJSON: deepProfileJSON } }, (sigResp) => {
      isEnriching = false;
      setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Analyze (L1 + L2)');

      if (chrome.runtime.lastError || !sigResp || sigResp.status === 'error') {
        setLayerStatus(2, 'error', 'Error');
        showCurrentStatus((sigResp?.error) || 'L2 signal detection failed.', 'error');
        return;
      }

      deepSignals = sigResp.signals || [];
      setLayerStatus(2, 'done', 'Done');
      setLayerModeTag(2, 'Local', false);
      renderProfileCard(deepProfileJSON, deepSignals);
      renderSignalChips(deepSignals);
      setLayerStatus(3, '', 'Ready');
      document.getElementById('deep-generate-btn').disabled = false;

      const count = deepSignals.length;
      showCurrentStatus(
        count > 0
          ? `Found ${count} personalization signal${count > 1 ? 's' : ''}. Ready to generate.`
          : 'Profile analyzed. Limited signals found.',
        count > 0 ? 'success' : 'warning'
      );
    });
  });
}

async function handleDeepGenerate() {
  if (isGenerating || !deepProfileJSON) return;
  isGenerating = true;
  hideMessage();
  showSkeletonShimmer(true);
  setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', true, 'Writing message…');
  setLayerStatus(3, 'running', 'Writing…');
  showCurrentStatus('L3: writing message…');

  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;
  const lengthKey   = document.getElementById('length-key').value;

  chrome.runtime.sendMessage(
    { type: 'RUN_GENERATE', payload: { profileJSON: deepProfileJSON, signals: deepSignals, messageType, tone, lengthKey, variantIndex } },
    async response => {
      isGenerating = false;
      setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', false, 'Generate Message (L3)');
      showSkeletonShimmer(false);

      if (chrome.runtime.lastError || !response) {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus('Generation failed. Please try again.', 'error');
        return;
      }

      if (response.status === 'error') {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus(response.error, 'error');
        return;
      }

      setLayerStatus(3, 'done', 'Done');
      setLayerModeTag(3, response.usedAI ? 'AI' : 'Local', response.usedAI);
      currentSignals = response.signals || deepSignals;
      currentMessage = response.generatedMessage;
      currentUsedAI  = response.usedAI || false;
      userEditedMessage = false;

      renderMessage(currentMessage);
      renderWhyPanel(currentSignals, response.usedSignalIds || []);
      renderQualityChips(currentMessage, currentSignals);

      if (response.fallbackReason) {
        showCurrentStatus(`AI unavailable — used Free Mode writer. (${response.fallbackReason})`, 'warning');
      } else {
        showCurrentStatus(currentUsedAI ? 'AI message ready.' : 'Message ready.', 'success');
      }

      await saveToRecent(deepProfileJSON, currentSignals);
      scheduleDraftSave();
    }
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await loadStoredSettings();
  if (s.userApiKey)   document.getElementById('api-key').value   = s.userApiKey;
  if (s.userName)     document.getElementById('user-name').value  = s.userName;
  if (s.userBio)      document.getElementById('user-bio').value   = s.userBio;
  if (s.manualSkills) document.getElementById('manual-skills').value    = s.manualSkills;
  if (s.manualHighlight) document.getElementById('manual-highlight').value = s.manualHighlight;
  if (s.resumeFileName) {
    document.getElementById('file-label').textContent = s.resumeFileName;
    document.getElementById('file-upload-area').classList.add('has-file');
  }
  if (s.senderProfile) {
    renderResumePreview(s.senderProfile);
  }
}

async function handleSaveSettings() {
  const userApiKey      = document.getElementById('api-key').value.trim();
  const userName        = document.getElementById('user-name').value.trim();
  const userBio         = document.getElementById('user-bio').value.trim();
  const manualSkills    = document.getElementById('manual-skills').value.trim();
  const manualHighlight = document.getElementById('manual-highlight').value.trim();

  // Write only the fields we need — never spread entire settings object back
  const payload = { userApiKey, userName, userBio, manualSkills, manualHighlight };

  if (pendingResume) {
    // Store the PDF temporarily; analysis done separately via ANALYZE_RESUME
    payload.resumeBase64   = pendingResume.base64;
    payload.resumeFileName = pendingResume.fileName;
  }

  await new Promise(resolve => chrome.storage.local.set(payload, resolve));

  // Update manualSkills into senderProfile for free mode
  if (!userApiKey && (manualSkills || manualHighlight)) {
    const sp = {
      topSkills: manualSkills.split(',').map(s => s.trim()).filter(Boolean),
      achievements: manualHighlight ? [manualHighlight] : [],
    };
    await new Promise(resolve => chrome.storage.local.set({ senderProfile: sp }, resolve));
  }

  // With key + pending resume: auto-analyze
  if (userApiKey && pendingResume) {
    analyzeResume(pendingResume.base64, pendingResume.fileName);
  }

  pendingResume = null;
  showSettingsStatus('Settings saved!', 'success');
  await updateModeBadge();
}

async function handleValidateKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) return;

  const btn = document.getElementById('validate-btn');
  btn.textContent = '…';
  btn.disabled = true;

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TEST_API_KEY', payload: { apiKey } }, resolve);
  });

  btn.textContent = 'Test';
  btn.disabled = false;

  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');

  if (result && result.valid) {
    el.textContent = '✓ Key works — AI Mode enabled';
    el.className   = 'key-validation-status valid';
    // Write only the key — never spread full settings
    await new Promise(resolve => chrome.storage.local.set({ userApiKey: apiKey }, resolve));
    await updateModeBadge();
    // If we have a stored resume, offer to analyze it
    const s = await loadStoredSettings();
    if (s.resumeBase64 && !s.senderProfile) {
      analyzeResume(s.resumeBase64, s.resumeFileName || 'resume.pdf');
    }
  } else {
    el.textContent = `✗ ${result?.reason || 'Key did not work'}`;
    el.className   = 'key-validation-status invalid';
  }
}

// ─── Resume analysis ──────────────────────────────────────────────────────────
let pendingResume = null;

function processResumeFile(file) {
  const statusEl  = document.getElementById('resume-status');
  const dropArea  = document.getElementById('file-upload-area');
  const fileLabel = document.getElementById('file-label');

  if (file.type !== 'application/pdf') {
    showStatus(statusEl, 'Please upload a PDF file.', 'error');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showStatus(statusEl, 'File too large — max 4MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const base64 = e.target.result.split(',')[1];
    pendingResume = { base64, fileName: file.name };
    fileLabel.textContent = file.name;
    dropArea.classList.add('has-file');
    showStatus(statusEl, `${file.name} ready — click Save Settings to confirm.`, 'pending');
  };
  reader.onerror = () => showStatus(statusEl, 'Error reading file.', 'error');
  reader.readAsDataURL(file);
}

async function analyzeResume(base64, fileName) {
  const statusEl = document.getElementById('resume-status');
  showStatus(statusEl, 'Analyzing resume with AI…', 'pending');

  chrome.runtime.sendMessage({ type: 'ANALYZE_RESUME', payload: { resumeBase64: base64, fileName } }, resp => {
    if (chrome.runtime.lastError || !resp || resp.status === 'error') {
      showStatus(statusEl, resp?.error || 'Resume analysis failed.', 'error');
      return;
    }
    showStatus(statusEl, 'Resume analyzed ✓', 'success');
    renderResumePreview(resp.senderProfile);
  });
}

async function handleReanalyzeResume() {
  const s = await loadStoredSettings();
  if (!s.resumeBase64) {
    showToast('Upload a resume first.');
    return;
  }
  analyzeResume(s.resumeBase64, s.resumeFileName || 'resume.pdf');
}

function renderResumePreview(sp) {
  if (!sp) return;
  const preview = document.getElementById('resume-preview');
  const content = document.getElementById('resume-preview-content');
  const parts   = [];
  if (sp.headline)   parts.push(`<strong>${esc(sp.headline)}</strong>`);
  if (sp.topSkills?.length) parts.push(`Skills: ${esc(sp.topSkills.slice(0, 4).join(', '))}`);
  if (sp.achievements?.length) parts.push(`Notable: ${esc(sp.achievements[0])}`);
  content.innerHTML = parts.join('<br>');
  preview.classList.remove('hidden');
}

// ─── Deep Mode Pipeline UI ────────────────────────────────────────────────────
function setLayerStatus(layer, status, text) {
  const dot  = document.getElementById(`l${layer}-dot`);
  const span = document.getElementById(`l${layer}-text`);
  if (dot)  dot.className  = `status-dot ${status}`;
  if (span) span.textContent = text;
}

function setLayerModeTag(layer, label, isAI) {
  const tag = document.getElementById(`l${layer}-mode-tag`);
  if (!tag) return;
  tag.textContent = label;
  tag.className = `layer-mode-tag ${isAI ? 'ai' : 'local'}`;
}

function resetLayerStatuses() {
  [1, 2].forEach(n => setLayerStatus(n, '', 'Ready'));
  setLayerStatus(3, '', 'Waiting');
  [1, 2, 3].forEach(n => setLayerModeTag(n, '', false));
}

// ─── Signal chips ─────────────────────────────────────────────────────────────
function renderSignalChips(signals) {
  const panel = document.getElementById('signals-panel');
  const list  = document.getElementById('signals-list');
  list.innerHTML = '';
  if (!signals || signals.length === 0) { panel.classList.add('hidden'); return; }

  signals.forEach(sig => {
    const chip = document.createElement('button');
    chip.className   = 'signal-chip';
    chip.title       = sig.reason;
    chip.setAttribute('aria-label', `Lead with: ${sig.value}`);
    chip.innerHTML   = `<span class="signal-type-badge">${esc(sig.type.replace('_', ' '))}</span>${esc(truncateDisplay(sig.value, 40))}`;
    chip.addEventListener('click', () => leadWithSignal(sig));
    list.appendChild(chip);
  });

  panel.classList.remove('hidden');
}

function leadWithSignal(signal) {
  // Move chosen signal to front, regenerate
  deepSignals = [signal, ...deepSignals.filter(s => s.id !== signal.id)];
  variantIndex = 0;
  handleDeepGenerate();
  showToast(`Leading with: ${signal.type.replace('_', ' ')}`);
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data, signals) {
  const section = document.getElementById('profile-section');
  section.classList.remove('hidden');

  const name = data.name || 'Unknown';
  // Avatar: first letter of cleaned name; fall back to '?' if first char is non-letter
  const initials = name.replace(/[^a-zA-Z]/g, '')[0] || '?';
  document.getElementById('profile-avatar').textContent   = initials.toUpperCase();
  document.getElementById('profile-name').textContent     = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany ? `🏢 ${data.currentCompany}` : '';

  // Signal count
  const sigEl = document.getElementById('profile-signals');
  if (signals && signals.length > 0) {
    sigEl.textContent = `${signals.length} personalization signal${signals.length > 1 ? 's' : ''} found`;
    sigEl.classList.remove('hidden');
  } else {
    sigEl.classList.add('hidden');
  }

  // Quality badge
  const qBadge = document.getElementById('quality-badge');
  const quality = data.scrapeQuality || 0;
  if (quality > 0 && quality < 50) {
    qBadge.textContent = 'Limited profile data';
    qBadge.className = 'profile-quality-badge low';
    qBadge.classList.remove('hidden');
  } else {
    qBadge.classList.add('hidden');
  }
}

function renderMessage(text) {
  const ta = document.getElementById('generated-message');
  ta.value = text;
  document.getElementById('message-section').classList.remove('hidden');
  document.getElementById('message-skeleton').classList.add('hidden');
  document.getElementById('message-content').classList.remove('hidden');
  updateCharCount();
  userEditedMessage = false;
}

function hideMessage() {
  document.getElementById('message-section').classList.add('hidden');
  document.getElementById('why-panel').classList.add('hidden');
  document.getElementById('quality-row').classList.add('hidden');
}

function showSkeletonShimmer(show) {
  const section  = document.getElementById('message-section');
  const skeleton = document.getElementById('message-skeleton');
  const content  = document.getElementById('message-content');
  if (show) {
    section.classList.remove('hidden');
    skeleton.classList.remove('hidden');
    content.classList.add('hidden');
  } else {
    skeleton.classList.add('hidden');
    content.classList.remove('hidden');
  }
}

function updateCharCount() {
  const textarea = document.getElementById('generated-message');
  const lengthKey = document.getElementById('length-key').value;
  const limit = Limits[lengthKey] || 500;
  const len = textarea.value.length;
  const el  = document.getElementById('char-count');
  el.textContent = `${len} / ${limit}`;
  el.className = 'char-count' +
    (len > limit          ? ' over-limit' :
     len > limit * 0.9    ? ' near-limit'  : '');
}

// ─── Why this message? panel ──────────────────────────────────────────────────
function renderWhyPanel(signals, usedSignalIds) {
  const panel = document.getElementById('why-panel');
  const list  = document.getElementById('why-list');
  list.innerHTML = '';

  const usedIds = new Set(usedSignalIds);
  const usedSignals = signals.filter(s => usedIds.size === 0 || usedIds.has(s.id));
  if (usedSignals.length === 0 && signals.length > 0) {
    // Show top signals as "likely used"
    usedSignals.push(...signals.slice(0, 1));
  }

  if (usedSignals.length === 0) { panel.classList.add('hidden'); return; }

  usedSignals.forEach(sig => {
    const item = document.createElement('div');
    item.className = 'why-item';
    item.innerHTML = `<span class="why-type">${esc(sig.type.replace(/_/g, ' '))}</span> — ${esc(truncateDisplay(sig.value, 60))} <span class="why-reason">(${esc(sig.reason)})</span>`;
    list.appendChild(item);
  });

  panel.classList.remove('hidden');
  // Collapse by default
  document.getElementById('why-content').classList.add('hidden');
  document.getElementById('why-toggle').setAttribute('aria-expanded', 'false');
}

function toggleWhyPanel() {
  const content = document.getElementById('why-content');
  const toggle  = document.getElementById('why-toggle');
  const expanded = !content.classList.contains('hidden');
  content.classList.toggle('hidden', expanded);
  toggle.setAttribute('aria-expanded', String(!expanded));
}

// ─── Quality chips ────────────────────────────────────────────────────────────
function renderQualityChips(text, signals) {
  const row = document.getElementById('quality-row');
  if (!text) { row.classList.add('hidden'); return; }

  // "Specific" = uses a non-generic signal
  const isSpecific = signals.some(s => ['recent_post', 'shared_ground', 'about', 'current_role'].includes(s.type));
  setChip('qc-specific', isSpecific, 'Specific', 'Generic');

  // "Concise" = within 80% of limit
  const limit = Limits[document.getElementById('length-key').value] || 500;
  const isConcise = text.length <= limit;
  setChip('qc-concise', isConcise, 'Concise', 'Over limit');

  // "Profile-based" = signals were found and used
  const isProfileBased = signals.length > 0;
  setChip('qc-based', isProfileBased, 'Profile-based', 'Generic');

  row.classList.remove('hidden');
}

function setChip(id, good, goodLabel, badLabel) {
  const el = document.getElementById(id);
  el.textContent = good ? `✓ ${goodLabel}` : `⚠ ${badLabel}`;
  el.className   = `quality-chip ${good ? 'good' : 'warn'}`;
}

// ─── Copy and Insert ──────────────────────────────────────────────────────────
async function handleCopy() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;

  const limit   = Limits[document.getElementById('length-key').value] || 500;
  const overLimit = text.length > limit;

  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback
    const ta = document.getElementById('generated-message');
    ta.select();
    document.execCommand('copy');
  }

  showToast(overLimit ? `Copied (${text.length} chars — over ${limit} limit)` : 'Copied to clipboard');

  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-secondary');
  btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
  }, 2200);
}

async function handleInsert() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;

  const btn = document.getElementById('insert-btn');
  btn.disabled = true;
  btn.textContent = 'Inserting…';

  chrome.runtime.sendMessage({ type: 'INSERT_MESSAGE', payload: { text } }, resp => {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Insert`;
    if (resp && resp.success) {
      showToast('Inserted into LinkedIn composer');
    } else {
      showToast(resp?.error || 'Could not insert. Open a composer first.', true);
    }
  });
}

// ─── Status / Toast ───────────────────────────────────────────────────────────
function showCurrentStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
}

function clearCurrentStatus() {
  const el = document.getElementById('status-message');
  el.classList.add('hidden');
  el.textContent = '';
}

function showSettingsStatus(msg, type = '') {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${isError ? ' toast-error' : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className   = `resume-status ${type}`;
  el.classList.remove('hidden');
}

// ─── Button loading state ─────────────────────────────────────────────────────
function setButtonLoading(btnId, labelId, spinnerId, loading, labelText) {
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = loading;
  const lbl = document.getElementById(labelId);
  if (lbl) lbl.innerHTML = labelText;
  const sp  = document.getElementById(spinnerId);
  if (sp)  sp.classList.toggle('hidden', !loading);
}

// ─── Draft persistence ────────────────────────────────────────────────────────
function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftNow, 600);
}

async function saveDraftNow() {
  const url = currentProfile?.profileUrl || deepProfileJSON?.profileUrl;
  if (!url) return;
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  await Cache.saveDraft(url, {
    message:     text,
    messageType: document.getElementById('message-type').value,
    tone:        document.getElementById('tone').value,
    lengthKey:   document.getElementById('length-key').value,
    signals:     currentSignals,
  });
}

async function tryRestoreDraft() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab  = tabs[0];
  if (!tab?.url || !/linkedin\.com\/in\//.test(tab.url)) return;

  const profileUrl = tab.url.split('?')[0];
  const draft      = await Cache.getDraft(profileUrl);
  if (!draft || !draft.message) return;

  // Restore controls
  if (draft.messageType) document.getElementById('message-type').value = draft.messageType;
  if (draft.tone)        document.getElementById('tone').value         = draft.tone;
  if (draft.lengthKey)   document.getElementById('length-key').value   = draft.lengthKey;

  // Restore message display
  currentSignals = draft.signals || [];
  currentMessage = draft.message;
  document.getElementById('generated-message').value = draft.message;
  document.getElementById('message-section').classList.remove('hidden');
  document.getElementById('message-skeleton').classList.add('hidden');
  document.getElementById('message-content').classList.remove('hidden');
  updateCharCount();

  document.getElementById('draft-restore').classList.remove('hidden');
  userEditedMessage = false;
}

async function discardDraft() {
  const url = currentProfile?.profileUrl || deepProfileJSON?.profileUrl;
  if (url) await Cache.clearDraft(url);
  document.getElementById('draft-restore').classList.add('hidden');
  hideMessage();
  currentMessage = '';
  currentSignals = [];
  userEditedMessage = false;
  variantIndex = 0;
}

// ─── Recent contacts ──────────────────────────────────────────────────────────
async function saveToRecent(profile, signals) {
  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;
  await Cache.addContact({
    profileUrl:  profile.profileUrl || '',
    name:        profile.name       || 'Unknown',
    headline:    profile.headline   || '',
    company:     profile.currentCompany || '',
    message:     document.getElementById('generated-message').value,
    messageType,
    tone,
    mode:        currentUsedAI ? 'AI' : 'Free',
    signals:     signals.slice(0, 2).map(s => s.type),
    timestamp:   Date.now(),
  });
}

async function renderRecentContacts() {
  const contacts  = await Cache.getContacts();
  const listEl    = document.getElementById('recent-list');
  const emptyEl   = document.getElementById('no-recent');
  const actionsEl = document.getElementById('recent-actions');
  const countLbl  = document.getElementById('recent-count-label');
  listEl.innerHTML = '';

  if (contacts.length === 0) {
    emptyEl.classList.remove('hidden');
    actionsEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  actionsEl.classList.remove('hidden');
  countLbl.textContent = `${contacts.length} recent contact${contacts.length > 1 ? 's' : ''}`;
  contacts.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card    = document.createElement('div');
  card.className = 'contact-card';
  card.setAttribute('role', 'listitem');

  const date    = new Date(contact.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');

  // Badges
  const typeBadge = contact.messageType ? `<span class="badge badge-type">${esc(contact.messageType)}</span>` : '';
  const toneBadge = contact.tone        ? `<span class="badge badge-tone">${esc(contact.tone)}</span>` : '';
  const modeBadge = contact.mode        ? `<span class="badge badge-mode ${contact.mode === 'AI' ? 'ai' : 'free'}">${contact.mode}</span>` : '';

  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(contact.name || 'Unknown')}</div>
        <div class="contact-meta">${esc(contact.headline || contact.company || '')}</div>
        <div class="contact-badges">${typeBadge}${toneBadge}${modeBadge}</div>
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message || '')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show full message</button>
      <div class="contact-action-btns">
        ${contact.profileUrl ? `<button class="btn btn-sm btn-secondary" id="open-${idx}">Open profile</button>` : ''}
        <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
      </div>
    </div>`;

  // Expand/collapse
  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  // Open profile
  if (contact.profileUrl) {
    card.querySelector(`#open-${idx}`).addEventListener('click', () => {
      chrome.tabs.create({ url: contact.profileUrl });
    });
  }

  // Copy
  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    showToast('Copied to clipboard');
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  return card;
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error('No response from background.')); return; }
      if (!response.success) { reject(new Error(response.error || 'Background returned an error.')); return; }
      if (response.data              !== undefined) { resolve(response.data);              return; }
      if (response.generatedMessage  !== undefined) { resolve(response);                   return; }
      reject(new Error('Unexpected response format.'));
    });
  });
}

// ─── Storage ──────────────────────────────────────────────────────────────────
function loadStoredSettings() {
  // Never fetch resumeBase64 for generation — only for analysis when explicitly needed
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['userApiKey', 'userName', 'userBio', 'senderProfile', 'resumeFileName',
       'manualSkills', 'manualHighlight'],
      resolve
    );
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function truncateDisplay(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── STAGE B: JOBS COPILOT LOGIC ──────────────────────────────────────────────
let currentCareerProfile = {
  targetRoles: [],
  keySkills: [],
  preferredLocations: [],
  workType: '',
  experienceLevel: '',
  avoidKeywords: [],
};
let currentRankedJobs    = [];
let currentJobDetail     = null;
let currentJobKit        = null;
let currentTrackerFilter = 'all';

function wireJobsEvents() {
  // Collapsible career card
  const toggleBtn = document.getElementById('career-card-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const card = document.getElementById('career-card');
      const body = document.getElementById('career-card-body');
      const isExpanded = card.classList.contains('expanded');
      card.classList.toggle('expanded', !isExpanded);
      body.classList.toggle('hidden', isExpanded);
      toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    });
  }

  // Career profile actions
  document.getElementById('save-career-btn').addEventListener('click', saveCareerProfile);
  document.getElementById('infer-career-btn').addEventListener('click', inferCareerProfileFromResume);
  document.getElementById('refresh-searches-btn').addEventListener('click', renderSearchSuggestions);

  // Job page actions
  document.getElementById('rank-jobs-btn').addEventListener('click', handleRankJobs);
  document.getElementById('analyze-job-btn').addEventListener('click', handleAnalyzeJob);
  document.getElementById('save-to-tracker-btn').addEventListener('click', handleSaveCurrentJobToTracker);
  document.getElementById('export-csv-btn').addEventListener('click', handleExportCSV);

  // Cover note char counter
  const coverNoteEl = document.getElementById('kit-cover-note');
  if (coverNoteEl) {
    coverNoteEl.addEventListener('input', () => {
      const len = coverNoteEl.value.length;
      const countEl = document.getElementById('kit-note-count');
      if (countEl) countEl.textContent = `${len} / 1200`;
    });
  }

  // Copy buttons inside Kit
  document.querySelectorAll('.btn-copy-sm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.copyTarget;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;
      const text = targetEl.value !== undefined ? targetEl.value : targetEl.innerText;
      try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = originalText; }, 1500);
        showToast('Copied to clipboard');

        // If copying cover note, increment daily outreach note count
        if (targetId === 'kit-cover-note') {
          await Tracker.incrementNoteCount();
          await updateNoteCounter();
        }
      } catch (_) {
        showToast('Failed to copy');
      }
    });
  });

  // Tracker filter pills
  const filterPills = document.querySelectorAll('#tracker-filters .filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentTrackerFilter = pill.dataset.filter;
      renderTrackerList();
    });
  });
}

// ─── Career Profile ───────────────────────────────────────────────────────────
async function loadCareerProfile() {
  return new Promise(resolve => {
    chrome.storage.local.get(['careerProfile'], r => {
      if (r.careerProfile) {
        currentCareerProfile = { ...currentCareerProfile, ...r.careerProfile };
      }
      populateCareerProfileForm();
      updateCareerStatusBadge();
      renderSearchSuggestions();
      resolve(currentCareerProfile);
    });
  });
}

function populateCareerProfileForm() {
  document.getElementById('cp-target-roles').value    = (currentCareerProfile.targetRoles || []).join(', ');
  document.getElementById('cp-key-skills').value      = (currentCareerProfile.keySkills || []).join(', ');
  document.getElementById('cp-locations').value       = (currentCareerProfile.preferredLocations || []).join(', ');
  document.getElementById('cp-work-type').value       = currentCareerProfile.workType || '';
  document.getElementById('cp-exp-level').value       = currentCareerProfile.experienceLevel || '';
  document.getElementById('cp-avoid-keywords').value  = (currentCareerProfile.avoidKeywords || []).join(', ');
}

function updateCareerStatusBadge() {
  const tag = document.getElementById('career-status-tag');
  if (!tag) return;
  const isReady = (currentCareerProfile.targetRoles?.length > 0) || (currentCareerProfile.keySkills?.length > 0);
  tag.textContent = isReady ? 'Configured' : 'Needs setup';
  tag.classList.toggle('ready', isReady);
}

async function saveCareerProfile() {
  const parseList = str => (str || '').split(',').map(s => s.trim()).filter(Boolean);

  currentCareerProfile = {
    targetRoles:        parseList(document.getElementById('cp-target-roles').value),
    keySkills:          parseList(document.getElementById('cp-key-skills').value),
    preferredLocations: parseList(document.getElementById('cp-locations').value),
    workType:           document.getElementById('cp-work-type').value,
    experienceLevel:    document.getElementById('cp-exp-level').value,
    avoidKeywords:      parseList(document.getElementById('cp-avoid-keywords').value),
  };

  await new Promise(resolve => chrome.storage.local.set({ careerProfile: currentCareerProfile }, resolve));

  updateCareerStatusBadge();
  renderSearchSuggestions();

  const statusEl = document.getElementById('career-status');
  statusEl.textContent = '✓ Career profile saved locally';
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 2500);
  showToast('Career profile saved');
}

async function inferCareerProfileFromResume() {
  const s = await loadStoredSettings();
  const sp = s.senderProfile || {};

  const roles = [];
  if (sp.headline) {
    const titleMatch = sp.headline.split(/[|·\-–]/)[0].trim();
    if (titleMatch) roles.push(titleMatch);
  }
  if (roles.length === 0 && sp.currentStatus) {
    roles.push(sp.currentStatus);
  }

  const skills = [];
  if (Array.isArray(sp.skills)) {
    skills.push(...sp.skills);
  }
  if (s.manualSkills) {
    skills.push(...s.manualSkills.split(',').map(x => x.trim()).filter(Boolean));
  }

  if (roles.length > 0 && !document.getElementById('cp-target-roles').value) {
    document.getElementById('cp-target-roles').value = roles.slice(0, 3).join(', ');
  }
  if (skills.length > 0 && !document.getElementById('cp-key-skills').value) {
    document.getElementById('cp-key-skills').value = Array.from(new Set(skills)).slice(0, 8).join(', ');
  }
  if (sp.location && !document.getElementById('cp-locations').value) {
    document.getElementById('cp-locations').value = sp.location;
  }

  showToast('Inferred fields from resume');
}

// ─── Search Suggestions ───────────────────────────────────────────────────────
function renderSearchSuggestions() {
  const container = document.getElementById('search-suggestions-list');
  if (!container) return;

  const suggestions = LinkedInURLs.suggestSearches(currentCareerProfile);
  if (!suggestions || suggestions.length === 0) {
    container.innerHTML = `
      <div style="font-size:11.5px;color:var(--text-2);padding:6px 0;">
        Add target roles in Career Profile above to see 3–5 tailored search links.
      </div>`;
    return;
  }

  container.innerHTML = suggestions.map(s => `
    <button class="search-chip-btn" data-url="${esc(s.url)}">
      <span>🔎 ${esc(s.label)}</span>
      <span class="search-chip-arrow">↗</span>
    </button>
  `).join('');

  container.querySelectorAll('.search-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
}

// ─── Page Status & Context ────────────────────────────────────────────────────
async function checkJobsPageStatus() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab  = tabs[0];
    const url  = tab ? tab.url || '' : '';

    const pageType = JobScraper.detectPageType(url);

    const dot  = document.getElementById('jobs-page-dot');
    const text = document.getElementById('jobs-page-status-text');

    const actSearch = document.getElementById('action-jobs-search');
    const actDetail = document.getElementById('action-job-detail');
    const actOther  = document.getElementById('action-other-page');

    if (pageType === 'jobs_search') {
      dot.className = 'status-indicator-dot active';
      text.textContent = 'On LinkedIn Jobs Search page';
      actSearch.classList.remove('hidden');
      actDetail.classList.add('hidden');
      actOther.classList.add('hidden');
    } else if (pageType === 'job_detail') {
      dot.className = 'status-indicator-dot active';
      text.textContent = 'On LinkedIn Job Posting';
      actSearch.classList.add('hidden');
      actDetail.classList.remove('hidden');
      actOther.classList.add('hidden');
    } else if (pageType === 'profile') {
      dot.className = 'status-indicator-dot';
      text.textContent = 'On LinkedIn Profile (switch to GENERATE tab)';
      actSearch.classList.add('hidden');
      actDetail.classList.add('hidden');
      actOther.classList.remove('hidden');
    } else {
      dot.className = 'status-indicator-dot';
      text.textContent = 'Not on a LinkedIn jobs page';
      actSearch.classList.add('hidden');
      actDetail.classList.add('hidden');
      actOther.classList.remove('hidden');
    }

    return pageType;
  } catch (_) {
    return 'other';
  }
}

async function onJobsTabActivated() {
  await checkJobsPageStatus();
  await renderTrackerList();
  await updateNoteCounter();
}

// ─── Scrape Active Tab Helper ────────────────────────────────────────────────
async function scrapeActiveTab(actionName) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab  = tabs[0];
  if (!tab) throw new Error('No active tab found.');

  // 1. Try direct message to tab's content script
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: actionName });
    if (res && res.success) return res.data;
  } catch (_) {
    // 2. Inject content script directly if not yet injected
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      await new Promise(r => setTimeout(r, 350));
      const res = await chrome.tabs.sendMessage(tab.id, { action: actionName });
      if (res && res.success) return res.data;
      if (res && res.error) throw new Error(res.error);
    } catch (_) {}
  }

  // 3. Fallback via background service worker
  return await sendToBackground({
    type: 'SCRAPE_PAGE',
    payload: { tabId: tab.id, scrapeAction: actionName },
    action: 'SCRAPE_PAGE',
    tabId: tab.id,
    scrapeAction: actionName,
  });
}

// ─── Rank Jobs on Current Page ────────────────────────────────────────────────
async function handleRankJobs() {
  const btn = document.getElementById('rank-jobs-btn');
  const spinner = document.getElementById('rank-jobs-spinner');
  btn.disabled = true;
  spinner.classList.remove('hidden');

  try {
    const cards = await scrapeActiveTab('scrapeJobCards');

    if (!cards || cards.length === 0) {
      showToast('No job cards found. Scroll page and try again.');
      return;
    }

    // Rank jobs using weighted rule-based ranker
    const ranked = JobRanker.rankJobs(cards, currentCareerProfile);
    currentRankedJobs = ranked;
    renderRankedJobs(ranked);
    showToast(`Ranked ${ranked.length} jobs on this page`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
  }
}

function renderRankedJobs(jobs) {
  const container = document.getElementById('ranked-jobs-container');
  const countEl   = document.getElementById('ranked-jobs-count');
  const listEl    = document.getElementById('ranked-jobs-list');

  container.classList.remove('hidden');
  countEl.textContent = `${jobs.length} jobs ranked by career match`;

  listEl.innerHTML = jobs.map((job, idx) => {
    const badgeClass = job.label === 'Strong' ? 'badge-strong' : (job.label === 'Good' ? 'badge-good' : 'badge-stretch');
    return `
      <div class="ranked-job-card" data-idx="${idx}">
        <div class="ranked-job-top">
          <div>
            <div class="ranked-job-title">${esc(job.title || 'Untitled Role')}</div>
            <div class="ranked-job-company">${esc(job.company || '')} ${job.location ? '· ' + esc(job.location) : ''}</div>
          </div>
          <span class="${badgeClass}">${esc(job.label)}</span>
        </div>
        <div class="ranked-job-reason">${esc(job.reason || '')}</div>
        <div class="ranked-job-actions">
          <button class="btn btn-sm btn-secondary ranked-open-btn" data-url="${esc(job.link || '')}">Open</button>
          <button class="btn btn-sm btn-secondary ranked-save-btn" data-idx="${idx}">Save</button>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.ranked-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });

  listEl.querySelectorAll('.ranked-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const job = jobs[idx];
      if (!job) return;
      await Tracker.addJob({
        id: job.id,
        title: job.title,
        company: job.company,
        link: job.link,
      });
      btn.textContent = '✓ Saved';
      btn.disabled = true;
      await renderTrackerList();
      showToast('Saved to Tracker');
    });
  });
}

// ─── Analyze Job & Build Kit ──────────────────────────────────────────────────
async function handleAnalyzeJob() {
  const btn = document.getElementById('analyze-job-btn');
  const spinner = document.getElementById('analyze-job-spinner');
  btn.disabled = true;
  spinner.classList.remove('hidden');

  try {
    let detail = await scrapeActiveTab('scrapeJobDetail');

    // Extra fallback if title still missing: extract from tab's title
    if (!detail || !detail.title || !detail.company) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabTitle = tabs[0]?.title || '';
      if (tabTitle) {
        const raw = tabTitle.replace(/\|.*$/i, '').trim();
        const hiringMatch = raw.match(/hiring\s+(.+?)(?:\s+in|\s+at|$)/i);
        const atMatch = raw.match(/^(.+?)\s+at\s+/i);
        const inferredTitle = hiringMatch ? hiringMatch[1].trim() : (atMatch ? atMatch[1].trim() : raw.split(/[-–—]/)[0].trim());
        if (inferredTitle && inferredTitle.length > 2) {
          detail = detail || {};
          if (!detail.title) detail.title = inferredTitle;
          if (!detail.company) {
            const beforeHiring = raw.match(/^(.+?)\s+hiring\s+/i);
            const compMatch = raw.match(/\sat\s+([^|–—]+)/i);
            if (beforeHiring) detail.company = beforeHiring[1].trim();
            else if (compMatch) detail.company = compMatch[1].trim();
          }
        }
      }
    }

    if (!detail || !detail.title) {
      throw new Error('Could not parse job details. Ensure the job posting is loaded.');
    }

    currentJobDetail = detail;

    // Load senderProfile and settings
    const settings = await loadStoredSettings();
    const senderProfile = settings.senderProfile || {};

    let kit = null;
    if (settings.userApiKey) {
      // AI Mode with fallback
      try {
        kit = await sendToBackground({
          type: 'ANALYZE_JOB',
          payload: {
            jobData: detail,
            senderProfile,
            careerProfile: currentCareerProfile,
          },
          action: 'ANALYZE_JOB',
          jobData: detail,
          senderProfile,
          careerProfile: currentCareerProfile,
        });
      } catch (_) {
        kit = KitBuilder.buildKit(detail, senderProfile, currentCareerProfile, settings);
      }
    } else {
      // Free Mode: local deterministic builder
      kit = KitBuilder.buildKit(detail, senderProfile, currentCareerProfile, settings);
    }

    // Always validate output to guarantee zero hallucinated skills
    const validation = KitBuilder.validateKit(kit, senderProfile);
    if (!validation.valid) {
      // Strip any unvalidated items
      console.warn('Kit validation stripped unverified claims:', validation.errors);
    }

    currentJobKit = kit;
    renderJobKit(kit, detail, senderProfile);
    showToast('Application Kit prepared');
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
  }
}

function renderJobKit(kit, detail, senderProfile) {
  const container = document.getElementById('job-kit-container');
  container.classList.remove('hidden');

  // Title and company
  document.getElementById('kit-job-title').textContent   = detail.title || 'Job Posting';
  document.getElementById('kit-job-company').textContent = `${detail.company || ''} ${detail.location ? '· ' + detail.location : ''}`;

  // Quality badge
  const quality = detail.scrapeQuality || 100;
  document.getElementById('kit-quality-badge').textContent = `${quality}% scraped`;

  // Fit badge
  const fitBadge = document.getElementById('kit-fit-badge');
  const matchedCount = kit.matchedSkillCount || 0;
  const missingCount = kit.missingSkillCount || 0;
  if (matchedCount >= 3 && missingCount <= 2) {
    fitBadge.textContent = 'Strong Fit';
    fitBadge.className   = 'badge-fit badge-strong';
  } else if (matchedCount >= 1) {
    fitBadge.textContent = 'Good Fit';
    fitBadge.className   = 'badge-fit badge-good';
  } else {
    fitBadge.textContent = 'Stretch';
    fitBadge.className   = 'badge-fit badge-stretch';
  }

  // Section A: Match Summary
  const matchText = kit.matchSummary?.summary || '';
  document.getElementById('kit-match-text').textContent = matchText;

  // Section B: Resume Bullets
  const bulletsEl = document.getElementById('kit-resume-bullets');
  const bullets = kit.resumeSummary?.bullets || [];
  bulletsEl.innerHTML = bullets.map(b => `<li>${esc(b)}</li>`).join('');

  // Section C: Keywords Grid
  const gridEl = document.getElementById('kit-keywords-grid');
  const keywords = kit.keywords || [];
  gridEl.innerHTML = keywords.map(k => `
    <span class="keyword-tag ${k.inResume ? 'matched' : 'missing'}">
      ${k.inResume ? '✓' : '✗'} ${esc(k.keyword)}
    </span>
  `).join('');

  // Section D: Cover Note
  const coverNoteEl = document.getElementById('kit-cover-note');
  coverNoteEl.value = kit.coverNote || '';
  const noteCountEl = document.getElementById('kit-note-count');
  if (noteCountEl) noteCountEl.textContent = `${coverNoteEl.value.length} / 1200`;

  // Section E: Screening Answers
  const answersEl = document.getElementById('kit-screening-answers');
  const answers = kit.screeningAnswers || [];
  answersEl.innerHTML = answers.map(a => `
    <div style="margin-bottom:6px;">
      <div style="font-weight:600;font-size:11.5px;color:var(--text);">${esc(a.question)}</div>
      <div style="color:var(--text-2);font-size:11.5px;">${esc(a.answer)}</div>
    </div>
  `).join('');

  // Section F: People at Company
  const peopleEl = document.getElementById('kit-people-links');
  const userSchool = senderProfile?.education?.[0] || '';
  const jobKeywords = (kit.keywords || []).filter(k => k.inResume).map(k => k.keyword);
  const links = LinkedInURLs.peopleAtCompany(detail.company, detail.title, userSchool, jobKeywords);

  peopleEl.innerHTML = links.map(l => `
    <button class="people-link-btn" data-url="${esc(l.url)}">
      <span>👥 ${esc(l.label)}</span>
      <span>↗</span>
    </button>
  `).join('');

  peopleEl.querySelectorAll('.people-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
}

async function handleSaveCurrentJobToTracker() {
  if (!currentJobDetail) return;
  await Tracker.addJob({
    id: currentJobDetail.id,
    title: currentJobDetail.title,
    company: currentJobDetail.company,
    link: currentJobDetail.jobUrl,
    kit: currentJobKit,
  });
  await renderTrackerList();
  showToast('Job saved to Tracker');
}

// ─── Application Tracker ──────────────────────────────────────────────────────
async function renderTrackerList() {
  const container = document.getElementById('tracker-list');
  if (!container) return;

  const allJobs = await Tracker.getAll();
  const stats   = await Tracker.getStats();

  // Update count pills
  document.getElementById('count-all').textContent          = String(stats.total || 0);
  document.getElementById('count-saved').textContent        = String(stats['Saved'] || 0);
  document.getElementById('count-applied').textContent      = String(stats['Applied'] || 0);
  document.getElementById('count-interviewing').textContent = String(stats['Interview'] || stats['Interviewing'] || 0);
  document.getElementById('count-followup').textContent     = String(stats.followUpDue || 0);

  // Filter jobs
  let filtered = allJobs;
  if (currentTrackerFilter === 'Follow-up') {
    filtered = await Tracker.getFollowUpDue();
  } else if (currentTrackerFilter !== 'all') {
    filtered = allJobs.filter(j => j.status?.toLowerCase() === currentTrackerFilter.toLowerCase());
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="font-size:11.5px;color:var(--text-2);text-align:center;padding:14px;">
        No jobs in this view.
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(job => {
    const isFollowup = job.status === 'Applied' && job.followUpDue && job.followUpDue < Date.now();
    const cl = job.checklist || {};

    return `
      <div class="tracker-card" data-id="${esc(job.id)}">
        <div class="tracker-card-top">
          <div>
            <div class="tracker-job-title">${esc(job.title || 'Untitled Role')}</div>
            <div class="tracker-job-company">${esc(job.company || '')}</div>
          </div>
          ${isFollowup ? '<span class="followup-badge">Follow-up due</span>' : ''}
        </div>
        <div class="tracker-card-actions">
          <select class="tracker-status-select" data-id="${esc(job.id)}">
            ${Tracker.STATUSES.map(s => `<option value="${s}" ${s === job.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <div style="display:flex;gap:4px;">
            ${job.link ? `<button class="btn btn-sm btn-secondary tracker-open-btn" data-url="${esc(job.link)}">Open</button>` : ''}
            <button class="btn btn-sm btn-ghost tracker-del-btn" data-id="${esc(job.id)}" title="Delete from tracker">×</button>
          </div>
        </div>
        <div class="apply-checklist">
          <label class="checklist-label">
            <input type="checkbox" class="checklist-item" data-id="${esc(job.id)}" data-key="summaryCopied" ${cl.summaryCopied ? 'checked' : ''} />
            Resume
          </label>
          <label class="checklist-label">
            <input type="checkbox" class="checklist-item" data-id="${esc(job.id)}" data-key="coverNoteReady" ${cl.coverNoteReady ? 'checked' : ''} />
            Cover note
          </label>
          <label class="checklist-label">
            <input type="checkbox" class="checklist-item" data-id="${esc(job.id)}" data-key="reachedOut" ${cl.reachedOut ? 'checked' : ''} />
            Contact
          </label>
          <label class="checklist-label">
            <input type="checkbox" class="checklist-item" data-id="${esc(job.id)}" data-key="applyPageOpened" ${cl.applyPageOpened ? 'checked' : ''} />
            Applied
          </label>
        </div>
      </div>
    `;
  }).join('');

  // Wire status change
  container.querySelectorAll('.tracker-status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id;
      const status = sel.value;
      await Tracker.updateJob(id, { status });
      await renderTrackerList();
    });
  });

  // Wire checklist checkboxes
  container.querySelectorAll('.checklist-item').forEach(chk => {
    chk.addEventListener('change', async () => {
      const id  = chk.dataset.id;
      const key = chk.dataset.key;
      const job = await Tracker.getById(id);
      if (!job) return;
      const checklist = { ...(job.checklist || {}), [key]: chk.checked };
      await Tracker.updateJob(id, { checklist });
    });
  });

  // Wire open buttons
  container.querySelectorAll('.tracker-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });

  // Wire delete buttons
  container.querySelectorAll('.tracker-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await Tracker.deleteJob(id);
      await renderTrackerList();
      showToast('Deleted from Tracker');
    });
  });
}

async function handleExportCSV() {
  try {
    const csv = await Tracker.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `linkedin-jobs-tracker-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported tracker CSV');
  } catch (err) {
    showToast(`Export failed: ${err.message}`);
  }
}

async function updateNoteCounter() {
  const count = await Tracker.getNoteCount();
  const bar   = document.getElementById('note-counter-bar');
  const text  = document.getElementById('note-counter-text');
  if (!bar || !text) return;

  text.textContent = `Outreach notes drafted today: ${count} / ${Tracker.DAILY_NOTE_WARNING}`;
  bar.classList.toggle('warning', count >= Tracker.DAILY_NOTE_WARNING);
}
