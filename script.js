'use strict';

/* ---------- Constants ---------- */
const STORAGE_KEY = 'aipg_papers_v1';
const WATERMARK_TEXT = 'M Ijaz \u2022 GHS 124/NB \u2022 AI Paper Generator';
const AI_ENDPOINT = 'https://text.pollinations.ai/openai';

const MARKERS = {
  mcqs: '##MCQS##',
  short: '##SHORT##',
  long: '##LONG##',
  akMcqs: '##ANSWERKEY_MCQS##',
  akShort: '##ANSWERKEY_SHORT##',
  akLong: '##ANSWERKEY_LONG##'
};

/* ---------- DOM refs ---------- */
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const form = document.getElementById('paperForm');
const generateBtn = document.getElementById('generateBtn');
const generateBtnText = document.getElementById('generateBtnText');
const loadingBox = document.getElementById('loadingBox');
const resultBox = document.getElementById('resultBox');
const paperPreview = document.getElementById('paperPreview');
const editBtn = document.getElementById('editBtn');
const saveBtn = document.getElementById('saveBtn');
const downloadBtn = document.getElementById('downloadBtn');
const shareBtn = document.getElementById('shareBtn');
const toggleKeyBtn = document.getElementById('toggleKeyBtn');
const newBtn = document.getElementById('newBtn');
const savedList = document.getElementById('savedList');
const emptyMsg = document.getElementById('emptyMsg');
const toast = document.getElementById('toast');
const menuBtn = document.getElementById('menuBtn');

let currentPaper = null;   // the paper object currently shown in preview
let isEditing = false;
let editingSavedId = null; // if opened from saved list for editing

/* ---------- Utilities ---------- */
function showToast(msg, ms = 2200) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), ms);
}

function uid() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* ---------- Storage ---------- */
function getSavedPapers() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function setSavedPapers(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/* ---------- Tabs ---------- */
tabs.forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});
function switchTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'saved') renderSavedList();
}

menuBtn.addEventListener('click', () => {
  const other = document.querySelector('.tab:not(.active)');
  if (other) switchTab(other.dataset.tab);
});

/* ---------- Prompt building ---------- */
function buildPrompt(data) {
  const system = `You are an expert Pakistani school exam paper setter. You create clear, curriculum-appropriate exam papers strictly in the requested language and format. You always follow the exact output structure given, using the section markers exactly as written (do not translate the markers themselves, keep them in English exactly as shown), with no extra commentary before, between, or after sections.`;

  const user = `Create a complete school exam paper with an answer key.

Exam Name: ${data.examName}
School Name: ${data.schoolName}
Subject: ${data.subjectName}
Class/Grade: ${data.className || 'N/A'}
Total Marks: ${data.totalMarks}
Passing Marks: ${data.passingMarks}
Time Allowed: ${data.timeAllowed || 'N/A'}
Topics/Chapters to cover: ${data.topics}
Language: ${data.language}

Generate exactly:
- ${data.mcqCount} multiple choice questions (each with 4 options labeled A) B) C) D), covering the given topics, varying difficulty)
- ${data.shortCount} short answer questions (each answerable in 2-4 sentences)
- ${data.longCount} long/detailed answer questions (each requiring a detailed multi-part answer)

Number every question within its own section starting from 1. Write all question and option text in the requested language (${data.language}). If Bilingual is requested, write each question first in English then the Urdu translation in brackets.

Output using EXACTLY this structure, with each marker on its own line, and nothing outside these sections:

${MARKERS.mcqs}
(numbered MCQs with options here)

${MARKERS.short}
(numbered short questions here)

${MARKERS.long}
(numbered long questions here)

${MARKERS.akMcqs}
(numbered correct option letters only, e.g. "1. C")

${MARKERS.akShort}
(numbered concise model answers, 1-2 sentences each)

${MARKERS.akLong}
(numbered concise model answer outlines, key points only)

Do not add headings, titles, or any text before ${MARKERS.mcqs} or after the last section.`;

  return { system, user };
}

async function callAI(system, user) {
  const body = {
    model: 'openai',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    seed: Math.floor(Math.random() * 100000),
    private: true
  };

  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error('AI request failed: ' + res.status);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    }
    if (typeof data === 'string') return data;
    throw new Error('Unexpected AI response format');
  }
  return await res.text();
}

/* ---------- Parsing AI response ---------- */
function parseAIResponse(text) {
  const positions = [];
  Object.entries(MARKERS).forEach(([key, marker]) => {
    const idx = text.indexOf(marker);
    if (idx !== -1) positions.push({ key, idx, marker });
  });
  positions.sort((a, b) => a.idx - b.idx);

  const sections = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx + positions[i].marker.length;
    const end = i + 1 < positions.length ? positions[i + 1].idx : text.length;
    sections[positions[i].key] = text.slice(start, end).trim();
  }

  return {
    mcqs: sections.mcqs || '',
    short: sections.short || '',
    long: sections.long || '',
    akMcqs: sections.akMcqs || '',
    akShort: sections.akShort || '',
    akLong: sections.akLong || ''
  };
}

/* ---------- Rendering ---------- */
function renderPaperHTML(paper) {
  const p = paper.data;
  const sec = paper.sections;

  return `
    <div class="paper-head">
      <h2>${escapeHtml(p.schoolName)}</h2>
      <h3>${escapeHtml(p.examName)}</h3>
      <div class="paper-meta-row">
        <span>Subject: ${escapeHtml(p.subjectName)}</span>
        <span>Class: ${escapeHtml(p.className || '-')}</span>
      </div>
      <div class="paper-meta-row">
        <span>Date: ${escapeHtml(formatDate(p.examDate))}</span>
        <span>Time: ${escapeHtml(p.timeAllowed || '-')}</span>
      </div>
      <div class="paper-meta-row">
        <span>Total Marks: ${escapeHtml(String(p.totalMarks))}</span>
        <span>Passing Marks: ${escapeHtml(String(p.passingMarks))}</span>
      </div>
    </div>

    ${sec.mcqs ? `<div class="paper-section-title">Section A: Multiple Choice Questions</div>
    <div class="q-block">${escapeHtml(sec.mcqs)}</div>` : ''}

    ${sec.short ? `<div class="paper-section-title">Section B: Short Questions</div>
    <div class="q-block">${escapeHtml(sec.short)}</div>` : ''}

    ${sec.long ? `<div class="paper-section-title">Section C: Long Questions</div>
    <div class="q-block">${escapeHtml(sec.long)}</div>` : ''}

    <div class="watermark">${escapeHtml(WATERMARK_TEXT)}</div>

    <div class="page-break answer-key-block" id="akBreak"></div>
    <div class="answer-key-block" id="akContent">
      <div class="paper-section-title">Answer Key &mdash; MCQs</div>
      <div class="q-block">${escapeHtml(sec.akMcqs)}</div>
      <div class="paper-section-title">Answer Key &mdash; Short Questions</div>
      <div class="q-block">${escapeHtml(sec.akShort)}</div>
      <div class="paper-section-title">Answer Key &mdash; Long Questions</div>
      <div class="q-block">${escapeHtml(sec.akLong)}</div>
      <div class="watermark">${escapeHtml(WATERMARK_TEXT)}</div>
    </div>
  `;
}

function showResult(paper) {
  currentPaper = paper;
  paperPreview.innerHTML = renderPaperHTML(paper);
  paperPreview.setAttribute('contenteditable', 'false');
  isEditing = false;
  editBtn.textContent = 'Edit';
  resultBox.classList.remove('hidden');
  toggleKeyBtn.textContent = 'Show Answer Key';
  document.getElementById('akContent').classList.remove('show');
  resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Form submit -> generate ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = {
    examName: document.getElementById('examName').value.trim(),
    schoolName: document.getElementById('schoolName').value.trim(),
    examDate: document.getElementById('examDate').value,
    subjectName: document.getElementById('subjectName').value.trim(),
    className: document.getElementById('className').value.trim(),
    timeAllowed: document.getElementById('timeAllowed').value.trim(),
    totalMarks: document.getElementById('totalMarks').value,
    passingMarks: document.getElementById('passingMarks').value,
    topics: document.getElementById('topics').value.trim(),
    mcqCount: document.getElementById('mcqCount').value || '0',
    shortCount: document.getElementById('shortCount').value || '0',
    longCount: document.getElementById('longCount').value || '0',
    language: document.getElementById('language').value
  };

  if (!navigator.onLine) {
    showToast('Internet connection is required to generate a paper.');
    return;
  }

  generateBtn.disabled = true;
  generateBtnText.textContent = 'Generating...';
  loadingBox.classList.remove('hidden');
  resultBox.classList.add('hidden');

  try {
    const { system, user } = buildPrompt(data);
    const raw = await callAI(system, user);
    const sections = parseAIResponse(raw);

    if (!sections.mcqs && !sections.short && !sections.long) {
      throw new Error('empty');
    }

    const paper = {
      id: uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data,
      sections
    };

    editingSavedId = null;
    showResult(paper);
    showToast('Paper generated successfully.');
  } catch (err) {
    console.error(err);
    showToast('Could not generate paper. Please check internet and try again.');
  } finally {
    generateBtn.disabled = false;
    generateBtnText.textContent = 'Generate Paper';
    loadingBox.classList.add('hidden');
  }
});

/* ---------- Toolbar actions ---------- */
editBtn.addEventListener('click', () => {
  if (!currentPaper) return;
  isEditing = !isEditing;
  paperPreview.setAttribute('contenteditable', isEditing ? 'true' : 'false');
  editBtn.textContent = isEditing ? 'Done Editing' : 'Edit';
  if (isEditing) {
    showToast('Tap on the paper text to edit it directly.');
    paperPreview.focus();
  } else {
    // persist edited HTML back into currentPaper as raw override
    currentPaper.rawHTML = paperPreview.innerHTML;
    showToast('Edits captured. Remember to Save.');
  }
});

saveBtn.addEventListener('click', () => {
  if (!currentPaper) return;
  if (isEditing) {
    currentPaper.rawHTML = paperPreview.innerHTML;
  }
  currentPaper.updatedAt = Date.now();

  const list = getSavedPapers();
  const existingIndex = list.findIndex(p => p.id === currentPaper.id);
  if (existingIndex !== -1) {
    list[existingIndex] = currentPaper;
  } else {
    list.unshift(currentPaper);
  }
  setSavedPapers(list);
  showToast('Paper saved.');
});

downloadBtn.addEventListener('click', () => {
  if (!currentPaper) return;
  document.getElementById('akContent').classList.add('show');
  setTimeout(() => {
    window.print();
    document.getElementById('akContent').classList.toggle('show', toggleKeyBtn.textContent === 'Hide Answer Key');
  }, 100);
});

shareBtn.addEventListener('click', async () => {
  if (!currentPaper) return;
  const p = currentPaper.data;
  const summary = `${p.schoolName}\n${p.examName}\nSubject: ${p.subjectName}  |  Class: ${p.className || '-'}\nDate: ${formatDate(p.examDate)}\nTotal Marks: ${p.totalMarks}  Passing Marks: ${p.passingMarks}\n\nGenerated with AI Paper Generator - M Ijaz GHS 124/NB`;

  if (navigator.share) {
    try {
      await navigator.share({ title: p.examName, text: summary });
    } catch (e) { /* user cancelled */ }
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(summary);
    showToast('Paper summary copied to clipboard.');
  } else {
    showToast('Sharing not supported on this browser.');
  }
});

toggleKeyBtn.addEventListener('click', () => {
  const ak = document.getElementById('akContent');
  const showing = ak.classList.toggle('show');
  toggleKeyBtn.textContent = showing ? 'Hide Answer Key' : 'Show Answer Key';
});

newBtn.addEventListener('click', () => {
  currentPaper = null;
  editingSavedId = null;
  resultBox.classList.add('hidden');
  form.reset();
  document.getElementById('mcqCount').value = 10;
  document.getElementById('shortCount').value = 6;
  document.getElementById('longCount').value = 3;
  form.scrollIntoView({ behavior: 'smooth' });
});

/* ---------- Saved list ---------- */
function renderSavedList() {
  const list = getSavedPapers();
  savedList.innerHTML = '';
  if (!list.length) {
    savedList.appendChild(emptyMsg);
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  list.sort((a, b) => b.updatedAt - a.updatedAt).forEach(paper => {
    const card = document.createElement('div');
    card.className = 'saved-card';
    card.innerHTML = `
      <div class="saved-card-info">
        <h4>${escapeHtml(paper.data.examName)}</h4>
        <p>${escapeHtml(paper.data.subjectName)} &bull; ${escapeHtml(formatDate(paper.data.examDate))}</p>
      </div>
      <div class="saved-card-actions">
        <button class="open-btn" data-id="${paper.id}">Open</button>
        <button class="del-btn" data-id="${paper.id}">Delete</button>
      </div>
    `;
    savedList.appendChild(card);
  });

  savedList.querySelectorAll('.open-btn').forEach(btn => {
    btn.addEventListener('click', () => openSavedPaper(btn.dataset.id));
  });
  savedList.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSavedPaper(btn.dataset.id));
  });
}

function openSavedPaper(id) {
  const list = getSavedPapers();
  const paper = list.find(p => p.id === id);
  if (!paper) return;
  switchTab('create');
  editingSavedId = id;
  currentPaper = paper;
  paperPreview.innerHTML = paper.rawHTML || renderPaperHTML(paper);
  paperPreview.setAttribute('contenteditable', 'false');
  isEditing = false;
  editBtn.textContent = 'Edit';
  resultBox.classList.remove('hidden');
  document.getElementById('akContent') && document.getElementById('akContent').classList.remove('show');
  toggleKeyBtn.textContent = 'Show Answer Key';
  resultBox.scrollIntoView({ behavior: 'smooth' });
}

function deleteSavedPaper(id) {
  if (!confirm('Delete this saved paper? This cannot be undone.')) return;
  let list = getSavedPapers();
  list = list.filter(p => p.id !== id);
  setSavedPapers(list);
  renderSavedList();
  showToast('Paper deleted.');
}

/* ---------- URL shortcut actions ---------- */
(function handleShortcutParams() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (action === 'saved') {
    window.addEventListener('DOMContentLoaded', () => switchTab('saved'));
  }
})();

/* ---------- Default date ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('examDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
});

/* ---------- Service worker registration ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
