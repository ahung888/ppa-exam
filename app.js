// =====================================================================
// STATE
// =====================================================================
let questions = [];
let progress = {};
let attemptLog = []; // [{ date: 'YYYY-MM-DD', correct: bool }, ...]
let examHistory = []; // [{ date: 'YYYY-MM-DD', correct: number, total: number }, ...]
let tags = {}; // { [questionId]: string[] }
let currentView = 'dashboard';

let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswered = false;
let reviewUserAnswer = null;
let reviewFilters = { topics: [], order: 'srs' };

let readingTagFilter = [];
let categoryTagFilter = [];

let quizConfig = { topics: [], count: 20, type: 'mixed', mode: 'practice', tags: [], order: 'random' }; // mode: 'practice' | 'exam'; order: 'random' | 'unseen'
let quizQueue = [];
let quizIndex = 0;
let quizAnswers = []; // parallel to quizQueue: { answered: bool, userAnswer: string|null }
let quizResults = null;
let quizDetailFilter = 'wrong'; // 'wrong' | 'all'

let currentAIQuestion = null;
let _topicDropdownHandler = null;

const FONT_SIZES = ['15px', '17px', '19px', '21px'];

// =====================================================================
// UTILITIES
// =====================================================================
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function accColor(pct) {
  return pct >= 80 ? { text: 'text-green-600', bar: 'bg-green-400' }
       : pct >= 60 ? { text: 'text-yellow-500', bar: 'bg-yellow-400' }
       : { text: 'text-red-500', bar: 'bg-red-400' };
}

const RECENT_WINDOW_DAYS = 7;

function computeRecentAccuracy() {
  const cutoff = addDays(todayStr(), -(RECENT_WINDOW_DAYS - 1));
  const recent = attemptLog.filter(a => a.date >= cutoff);
  const correct = recent.filter(a => a.correct).length;
  const total = recent.length;
  return { correct, total, pct: total > 0 ? Math.round(correct / total * 100) : null };
}

function computeRecentExamAvg() {
  const cutoff = addDays(todayStr(), -(RECENT_WINDOW_DAYS - 1));
  const recent = examHistory.filter(e => e.date >= cutoff);
  const correct = recent.reduce((s, e) => s + e.correct, 0);
  const total = recent.reduce((s, e) => s + e.total, 0);
  return { sessionCount: recent.length, correct, total, pct: total > 0 ? Math.round(correct / total * 100) : null };
}

// =====================================================================
// FONT SIZE
// =====================================================================
function setFontSize(index) {
  localStorage.setItem('ppa_font_size', index);
  applyFontSize(index);
}

function applyFontSize(index) {
  document.documentElement.style.fontSize = FONT_SIZES[index] || FONT_SIZES[1];
  for (let i = 0; i < FONT_SIZES.length; i++) {
    const btn = document.getElementById(`font-btn-${i}`);
    if (!btn) continue;
    const active = i === index;
    btn.classList.toggle('bg-blue-100', active);
    btn.classList.toggle('text-blue-700', active);
    btn.classList.toggle('border-blue-300', active);
    btn.classList.toggle('text-gray-400', !active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('hover:bg-gray-100', !active);
  }
}

// =====================================================================
// STORAGE & SRS
// =====================================================================
let MASTERY_THRESHOLD = 3;

function loadMasteryThreshold() {
  const n = parseInt(localStorage.getItem('ppa_mastery_threshold') ?? '3', 10);
  MASTERY_THRESHOLD = isNaN(n) ? 3 : Math.max(2, Math.min(10, n));
}

function saveMasteryThreshold(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 2 || n > 10) return;
  MASTERY_THRESHOLD = n;
  localStorage.setItem('ppa_mastery_threshold', String(n));
}

function loadProgress() {
  try {
    progress = JSON.parse(localStorage.getItem('ppa_progress') || '{}');
  } catch {
    progress = {};
  }
  migrateProgress();

  try {
    attemptLog = JSON.parse(localStorage.getItem('ppa_attempt_log') || '[]');
  } catch {
    attemptLog = [];
  }
  try {
    examHistory = JSON.parse(localStorage.getItem('ppa_exam_history') || '[]');
  } catch {
    examHistory = [];
  }
}

function migrateProgress() {
  let dirty = false;
  for (const id in progress) {
    const s = progress[id];
    if (s.consecutive_correct === undefined) {
      s.consecutive_correct = (s.wrong_count || 0) === 0 && (s.correct_count || 0) > 0
        ? s.correct_count : 0;
      dirty = true;
    }
  }
  if (dirty) saveProgress();
}

function saveProgress() {
  localStorage.setItem('ppa_progress', JSON.stringify(progress));
}

function saveAttemptLog() {
  const cutoff = addDays(todayStr(), -30); // 只保留近30天，控制儲存量
  attemptLog = attemptLog.filter(a => a.date >= cutoff);
  localStorage.setItem('ppa_attempt_log', JSON.stringify(attemptLog));
}

function logAttempt(isCorrect) {
  attemptLog.push({ date: todayStr(), correct: isCorrect });
  saveAttemptLog();
}

function saveExamHistory() {
  const cutoff = addDays(todayStr(), -30);
  examHistory = examHistory.filter(e => e.date >= cutoff);
  localStorage.setItem('ppa_exam_history', JSON.stringify(examHistory));
}

function loadTags() {
  try {
    tags = JSON.parse(localStorage.getItem('ppa_tags') || '{}');
  } catch {
    tags = {};
  }
}

function saveTags() {
  localStorage.setItem('ppa_tags', JSON.stringify(tags));
}

function getAllTags() {
  return [...new Set(Object.values(tags).flat())].sort();
}

function addTag(qId, name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!tags[qId]) tags[qId] = [];
  if (!tags[qId].includes(trimmed)) {
    tags[qId].push(trimmed);
    saveTags();
  }
}

function removeTag(qId, name) {
  if (!tags[qId]) return;
  tags[qId] = tags[qId].filter(t => t !== name);
  if (tags[qId].length === 0) delete tags[qId];
  saveTags();
}

function updateQuestionStats(id, isCorrect) {
  logAttempt(isCorrect);
  const today = todayStr();
  const stat = progress[id] || { wrong_count: 0, correct_count: 0, interval_days: 1, consecutive_correct: 0 };
  if (isCorrect) {
    stat.correct_count = (stat.correct_count || 0) + 1;
    stat.consecutive_correct = (stat.consecutive_correct || 0) + 1;
    const mastered = stat.consecutive_correct >= MASTERY_THRESHOLD;
    const cap = mastered ? 90 : 30;
    const factor = mastered ? 3 : 2;
    stat.interval_days = Math.min((stat.interval_days || 1) * factor, cap);
  } else {
    stat.wrong_count = (stat.wrong_count || 0) + 1;
    stat.consecutive_correct = 0;
    stat.interval_days = 1;
  }
  stat.last_seen = today;
  stat.next_review = addDays(today, stat.interval_days);
  progress[id] = stat;
  saveProgress();
}

// =====================================================================
// EXAM DATE
// =====================================================================
function getExamDate() {
  return localStorage.getItem('ppa_exam_date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

function getDaysLeft() {
  const examDate = new Date(getExamDate() + 'T00:00:00');
  return Math.max(0, Math.ceil((examDate - new Date()) / 86400000));
}

function updateCountdownUI() {
  const daysLeft = getDaysLeft();
  document.getElementById('countdown-text').textContent = `距考試還有 ${daysLeft} 天`;
  const mobileCountdown = document.getElementById('mobile-countdown');
  if (mobileCountdown) mobileCountdown.textContent = `剩 ${daysLeft} 天`;
}

function openExamDateModal() {
  document.getElementById('exam-date-input').value = getExamDate();
  document.getElementById('exam-date-modal').classList.remove('hidden');
}

function closeExamDateModal() {
  document.getElementById('exam-date-modal').classList.add('hidden');
}

function saveExamDate() {
  const val = document.getElementById('exam-date-input').value;
  if (!val) return;
  localStorage.setItem('ppa_exam_date', val);
  closeExamDateModal();
  updateCountdownUI();
  if (document.getElementById('nav-dashboard').classList.contains('bg-blue-50')) {
    navigate('dashboard');
  }
}

// =====================================================================
// SIDEBAR (DESKTOP COLLAPSE + MOBILE MENU)
// =====================================================================
function toggleDesktopSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isCollapsed = sidebar.classList.toggle('desktop-collapsed');
  document.getElementById('sidebar-collapse-icon').classList.toggle('hidden', isCollapsed);
  document.getElementById('sidebar-expand-icon').classList.toggle('hidden', !isCollapsed);
  const toggle = document.getElementById('desktop-sidebar-toggle');
  toggle.title = isCollapsed ? '展開側欄' : '收合側欄';
  localStorage.setItem('ppa_sidebar_collapsed', isCollapsed ? '1' : '0');
}

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const isOpen = !sidebar.classList.contains('-translate-x-full');
  if (isOpen) closeMobileMenu(); else openMobileMenu();
}

function openMobileMenu() {
  document.getElementById('sidebar').classList.remove('-translate-x-full');
  document.getElementById('mobile-overlay').classList.remove('hidden');
  document.getElementById('menu-icon-open').classList.add('hidden');
  document.getElementById('menu-icon-close').classList.remove('hidden');
}

function closeMobileMenu() {
  document.getElementById('sidebar').classList.add('-translate-x-full');
  document.getElementById('mobile-overlay').classList.add('hidden');
  document.getElementById('menu-icon-open').classList.remove('hidden');
  document.getElementById('menu-icon-close').classList.add('hidden');
}

// =====================================================================
// NAVIGATION
// =====================================================================
function navigate(view) {
  currentView = view;
  closeMobileMenu();

  if (typeof gtag !== 'undefined') {
    gtag('event', 'section_view', { section: view });
  }

  ['dashboard', 'quiz', 'review', 'reading', 'category', 'author'].forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (!btn) return;
    btn.classList.toggle('bg-blue-50', v === view);
    btn.classList.toggle('text-blue-700', v === view);
    btn.classList.toggle('font-semibold', v === view);
    btn.classList.toggle('text-gray-600', v !== view);
  });

  const content = document.getElementById('app-content');
  if (view === 'dashboard') renderDashboard(content);
  else if (view === 'quiz') renderQuizSetup(content);
  else if (view === 'review') renderReview(content);
  else if (view === 'reading') renderReading(content);
  else if (view === 'category') renderCategory(content);
  else if (view === 'author') renderAuthor(content);

  updateBackToTopVisibility();
}

// =====================================================================
// BACK TO TOP
// =====================================================================
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const content = document.getElementById('app-content');
  if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateBackToTopVisibility() {
  const btn = document.getElementById('back-to-top');
  const content = document.getElementById('app-content');
  if (!btn || !content) return;
  const scrollable = document.documentElement.scrollHeight > document.documentElement.clientHeight
    || content.scrollHeight > content.clientHeight;
  btn.classList.toggle('hidden', !scrollable);
}

function setupBackToTopWatcher() {
  const content = document.getElementById('app-content');
  window.addEventListener('scroll', updateBackToTopVisibility);
  window.addEventListener('resize', updateBackToTopVisibility);
  if (content) {
    content.addEventListener('scroll', updateBackToTopVisibility);
    new MutationObserver(updateBackToTopVisibility)
      .observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  updateBackToTopVisibility();
}

// =====================================================================
// READING MODE (全題目列表 + 搜尋)
// =====================================================================
function renderReading(container) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-4 py-2">
      <h2 class="text-xl font-bold text-gray-800 px-1">題目搜尋</h2>
      <div class="flex items-center gap-2">
        <input type="text" id="reading-search" oninput="onReadingSearch()" placeholder="搜尋題目關鍵字..."
          class="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
        <span id="reading-tag-dropdown-slot"></span>
      </div>
      <div id="reading-count" class="text-xs text-gray-400 px-1"></div>
      <div id="reading-list" class="space-y-4"></div>
    </div>
  `;

  syncReadingTagDropdownSlot();
  onReadingSearch();
}

// 標籤字典可能在使用者停留於本頁時新增/移除（例如展開卡片新增第一個標籤），
// 需要重新同步這個下拉篩選器的有無與選項，而不是只在整頁重新掛載時才建立一次。
function syncReadingTagDropdownSlot() {
  const slot = document.getElementById('reading-tag-dropdown-slot');
  if (!slot) return;
  const allTags = getAllTags();
  if (allTags.length === 0) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML = renderTagDropdownHTML('reading', allTags);
  restoreTagDropdownState('reading', allTags, readingTagFilter);
  updateTagDropdownLabel('reading');
  setupTagDropdownOutsideClick('reading-tag-dropdown-container', 'reading-tag-dropdown-panel');
}

function onReadingSearch() {
  const term = document.getElementById('reading-search').value.trim();
  const tagCbs = [...document.querySelectorAll('.reading-tag-cb')];
  if (tagCbs.length > 0) {
    readingTagFilter = tagCbs.filter(cb => cb.checked).map(cb => cb.value);
  }

  let filtered = term ? questions.filter(q => q.question.includes(term)) : questions;
  if (readingTagFilter.length > 0) {
    filtered = filtered.filter(q => (tags[q.id] || []).some(t => readingTagFilter.includes(t)));
  }
  renderReadingList(filtered, term);
}

function toggleReadingTagDropdown() {
  document.getElementById('reading-tag-dropdown-panel').classList.toggle('hidden');
}

function onReadingTagAllChange() {
  const allCb = document.getElementById('reading-tag-all-cb');
  document.querySelectorAll('.reading-tag-cb').forEach(cb => { cb.checked = allCb.checked; });
  allCb.indeterminate = false;
  updateTagDropdownLabel('reading');
  onReadingSearch();
}

function onReadingTagCbChange() {
  const cbs = [...document.querySelectorAll('.reading-tag-cb')];
  const n = cbs.filter(cb => cb.checked).length;
  const allCb = document.getElementById('reading-tag-all-cb');
  allCb.checked = n === cbs.length;
  allCb.indeterminate = n > 0 && n < cbs.length;
  updateTagDropdownLabel('reading');
  onReadingSearch();
}

function renderReadingList(list, term = '') {
  document.getElementById('reading-count').textContent = `共 ${questions.length} 題（顯示 ${list.length} 題）`;
  const listEl = document.getElementById('reading-list');
  listEl.innerHTML = list.length === 0
    ? emptyCard('找不到符合的題目')
    : list.map(q => renderReadingCard(q, questions.indexOf(q) + 1, term)).join('');
}

function renderReadingCard(q, num, term) {
  const typeLabel = q.type === 'tf' ? '是非題' : '選擇題';

  return `
    <div class="relative bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 cursor-pointer hover:shadow-md transition-shadow"
      onclick="copyReadingCard(event, '${q.id}')" title="點擊複製「題號,答案,題目」到剪貼簿">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">${typeLabel}</span>
          <span class="text-xs text-gray-400 truncate max-w-[160px]">${escapeHtml(q.topic)}</span>
        </div>
        <span class="text-xs text-gray-400 shrink-0">#${num}</span>
      </div>
      <p class="text-gray-800 text-sm leading-relaxed">${highlightMatch(q.question, term)}</p>
      ${renderQuestionDetail(q)}
    </div>`;
}

// 題目「選項 + 答案 + 法條」區塊，供題目搜尋卡片與題目總覽展開內容共用
function renderQuestionDetail(q) {
  const optionsHTML = (q.type === 'mc' && q.options) ? `
    <div class="space-y-1.5 mt-3">
      ${q.options.map((opt, i) => `
        <div class="text-sm text-gray-600"><span class="font-semibold mr-1.5 text-gray-400">(${i + 1})</span>${escapeHtml(opt)}</div>`).join('')}
    </div>` : '';

  const answerText = q.type === 'tf' ? (q.answer === 'O' ? '○ 正確' : '✗ 錯誤') : `(${q.answer})`;
  const lawHTML = q.law_ref ? ` ｜ 依據：${escapeHtml(q.law_ref)}` : '';

  return `
    ${optionsHTML}
    <div class="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-600">
      答案：<span class="font-semibold text-blue-600">${answerText}</span>${lawHTML}
    </div>
    ${renderTagsSection(q.id, false)}`;
}

// 題目搜尋／題目總覽共用的標籤編輯區塊
function renderTagsSection(qId, adding) {
  const qTags = tags[qId] || [];
  const pills = qTags.map(t => `
    <span class="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">
      ${escapeHtml(t)}
      <button data-qid="${escapeHtml(qId)}" data-tag="${escapeHtml(t)}" onclick="event.stopPropagation(); onRemoveTagClick(this)"
        class="hover:text-purple-900 leading-none">✕</button>
    </span>`).join('');

  const datalistId = `tag-suggestions-${qId}`;
  const suggestions = getAllTags().map(t => `<option value="${escapeHtml(t)}">`).join('');

  const addUI = adding
    ? `
      <input type="text" id="tag-input-${qId}" list="${datalistId}" placeholder="輸入標籤名稱"
        class="text-xs border border-gray-200 rounded-full px-2 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-purple-300"
        onkeydown="if(event.key==='Enter'){event.preventDefault(); onAddTagSubmit('${qId}');}">
      <datalist id="${datalistId}">${suggestions}</datalist>
      <button onclick="event.stopPropagation(); onAddTagSubmit('${qId}')" class="text-xs text-purple-600">✓</button>
      <button onclick="event.stopPropagation(); refreshTagsSection('${qId}', false)" class="text-xs text-gray-400">✕</button>`
    : `<button onclick="event.stopPropagation(); refreshTagsSection('${qId}', true)"
        class="text-xs text-gray-400 border border-dashed border-gray-300 rounded-full px-2 py-0.5 hover:border-purple-400 hover:text-purple-600">+ 標籤</button>`;

  return `<div id="tags-${qId}" class="flex flex-wrap items-center gap-1.5 mt-3" onclick="event.stopPropagation()">🏷️ ${pills} ${addUI}</div>`;
}

function refreshTagsSection(qId, adding) {
  const el = document.getElementById(`tags-${qId}`);
  if (!el) return;
  el.outerHTML = renderTagsSection(qId, adding);
  if (adding) document.getElementById(`tag-input-${qId}`)?.focus();
}

function onAddTagSubmit(qId) {
  const input = document.getElementById(`tag-input-${qId}`);
  if (!input) return;
  addTag(qId, input.value);
  refreshTagsSection(qId, false);
  syncTagDropdownForCurrentView();
}

function onRemoveTagClick(btn) {
  removeTag(btn.dataset.qid, btn.dataset.tag);
  refreshTagsSection(btn.dataset.qid, false);
  syncTagDropdownForCurrentView();
}

// 標籤字典（getAllTags()）可能因為剛才的增刪而改變，同步當前頁面的標籤篩選下拉
function syncTagDropdownForCurrentView() {
  if (currentView === 'reading') syncReadingTagDropdownSlot();
  else if (currentView === 'category') syncCategoryTagDropdownSlot();
}

// 題目總覽收合列用的唯讀標籤提示
function tagHintHTML(qId) {
  const t = tags[qId] || [];
  if (t.length === 0) return '';
  const extra = t.length > 1 ? ` +${t.length - 1}` : '';
  return `<span class="text-xs text-purple-500 shrink-0">🏷️${escapeHtml(t[0])}${extra}</span>`;
}

// 題目搜尋／題目總覽共用的「標籤：全部 ▾」下拉核取方塊清單，prefix 區分頁面（reading/category）
function renderTagDropdownHTML(prefix, allTags) {
  return `
    <div class="relative shrink-0" id="${prefix}-tag-dropdown-container">
      <button onclick="toggle${prefix[0].toUpperCase()}${prefix.slice(1)}TagDropdown()" id="${prefix}-tag-dropdown-btn"
        class="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 whitespace-nowrap">
        <span id="${prefix}-tag-dropdown-label">標籤：全部</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      <div id="${prefix}-tag-dropdown-panel" class="hidden absolute z-20 top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-56 max-h-64 overflow-y-auto">
        <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
          <input type="checkbox" id="${prefix}-tag-all-cb" onchange="on${prefix[0].toUpperCase()}${prefix.slice(1)}TagAllChange()">
          <span class="text-sm font-medium text-gray-700">全選</span>
        </label>
        <div class="border-t border-gray-100 my-1"></div>
        ${allTags.map(t => `
          <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
            <input type="checkbox" class="${prefix}-tag-cb" value="${escapeHtml(t)}" onchange="on${prefix[0].toUpperCase()}${prefix.slice(1)}TagCbChange()">
            <span class="text-sm text-gray-700 truncate" title="${escapeHtml(t)}">${escapeHtml(t)}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function restoreTagDropdownState(prefix, allTags, filterArr) {
  document.querySelectorAll(`.${prefix}-tag-cb`).forEach(cb => {
    cb.checked = filterArr.includes(cb.value);
  });
  const checkedCount = [...document.querySelectorAll(`.${prefix}-tag-cb`)].filter(cb => cb.checked).length;
  const allCb = document.getElementById(`${prefix}-tag-all-cb`);
  allCb.checked = checkedCount === allTags.length;
  allCb.indeterminate = checkedCount > 0 && checkedCount < allTags.length;
}

function updateTagDropdownLabel(prefix) {
  const cbs = [...document.querySelectorAll(`.${prefix}-tag-cb`)];
  const n = cbs.filter(cb => cb.checked).length;
  const label = document.getElementById(`${prefix}-tag-dropdown-label`);
  if (!label) return;
  label.textContent = n === 0 ? '標籤：全部' : `標籤：${n} 已選`;
}

let _tagDropdownHandler = null;
function setupTagDropdownOutsideClick(containerId, panelId) {
  if (_tagDropdownHandler) document.removeEventListener('click', _tagDropdownHandler);
  _tagDropdownHandler = (e) => {
    const cont = document.getElementById(containerId);
    if (cont && !cont.contains(e.target)) {
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.add('hidden');
    }
  };
  document.addEventListener('click', _tagDropdownHandler);
}

// 在 text 已 escape 的前提下，把符合 term 的片段用 <mark> 包起來
function highlightMatch(text, term) {
  const escaped = escapeHtml(text);
  if (!term) return escaped;
  const escapedTerm = escapeHtml(term);
  if (!escapedTerm) return escaped;
  return escaped.split(escapedTerm).join(`<mark class="bg-yellow-200 rounded-sm px-0.5">${escapedTerm}</mark>`);
}

// 把欄位值轉成 CSV 安全格式（含逗號/雙引號/換行時用雙引號包住並轉義內部雙引號）
function csvField(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function copyReadingCard(event, id) {
  const idx = questions.findIndex(x => x.id === id);
  if (idx === -1) return;
  const q = questions[idx];
  let questionField = q.question;
  if (q.type === 'mc' && q.options && q.options.length) {
    questionField += ' ' + q.options.map((opt, i) => `(${i + 1})${opt}`).join(' ');
  }
  const text = [idx + 1, q.answer, questionField].map(csvField).join(',');
  copyTextWithCardFeedback(text, event.currentTarget);
}

function copyTextWithCardFeedback(text, cardEl) {
  const showBadge = () => {
    const badge = document.createElement('span');
    badge.textContent = '✓ 已複製';
    badge.className = 'absolute top-3 right-3 text-xs bg-green-600 text-white px-2 py-0.5 rounded-full shadow';
    cardEl.appendChild(badge);
    setTimeout(() => badge.remove(), 1200);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showBadge).catch(() => {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showBadge(); } catch {}
    document.body.removeChild(ta);
  }
}

// =====================================================================
// CATEGORY BROWSER (分類下拉選單 → 題目單行列 → 點擊展開完整內容)
// =====================================================================
let categoryTopics = [];
let categoryActiveIndex = -1; // -1 = 全部
let categoryAllExpanded = false;

function renderCategory(container) {
  categoryTopics = [...new Set(questions.map(q => q.topic))].sort();
  if (categoryActiveIndex >= categoryTopics.length) categoryActiveIndex = -1;

  container.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-4 py-2">
      <h2 class="text-xl font-bold text-gray-800 px-1">題目總覽</h2>
      <div class="flex items-center gap-2">
        <select id="category-select" onchange="onCategorySelectChange()"
          class="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="-1">全部（${questions.length}）</option>
          ${categoryTopics.map((t, ti) => `
            <option value="${ti}">${escapeHtml(t)}（${questions.filter(q => q.topic === t).length}）</option>`).join('')}
        </select>
        <span id="category-tag-dropdown-slot"></span>
        <button id="category-toggle-all" onclick="toggleAllCategoryRows()"
          class="shrink-0 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-100 whitespace-nowrap">
          全部展開
        </button>
      </div>
      <div id="category-list" class="space-y-2"></div>
    </div>
  `;

  document.getElementById('category-select').value = categoryActiveIndex;
  syncCategoryTagDropdownSlot();
  renderCategoryQuestionList();
}

function syncCategoryTagDropdownSlot() {
  const slot = document.getElementById('category-tag-dropdown-slot');
  if (!slot) return;
  const allTags = getAllTags();
  if (allTags.length === 0) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML = renderTagDropdownHTML('category', allTags);
  restoreTagDropdownState('category', allTags, categoryTagFilter);
  updateTagDropdownLabel('category');
  setupTagDropdownOutsideClick('category-tag-dropdown-container', 'category-tag-dropdown-panel');
}

function onCategorySelectChange() {
  categoryActiveIndex = Number(document.getElementById('category-select').value);
  renderCategoryQuestionList();
}

function toggleCategoryTagDropdown() {
  document.getElementById('category-tag-dropdown-panel').classList.toggle('hidden');
}

function onCategoryTagAllChange() {
  const allCb = document.getElementById('category-tag-all-cb');
  document.querySelectorAll('.category-tag-cb').forEach(cb => { cb.checked = allCb.checked; });
  allCb.indeterminate = false;
  updateTagDropdownLabel('category');
  renderCategoryQuestionList();
}

function onCategoryTagCbChange() {
  const cbs = [...document.querySelectorAll('.category-tag-cb')];
  const n = cbs.filter(cb => cb.checked).length;
  const allCb = document.getElementById('category-tag-all-cb');
  allCb.checked = n === cbs.length;
  allCb.indeterminate = n > 0 && n < cbs.length;
  updateTagDropdownLabel('category');
  renderCategoryQuestionList();
}

function renderCategoryQuestionList() {
  const tagCbs = [...document.querySelectorAll('.category-tag-cb')];
  if (tagCbs.length > 0) {
    categoryTagFilter = tagCbs.filter(cb => cb.checked).map(cb => cb.value);
  }

  let list = categoryActiveIndex === -1
    ? questions
    : questions.filter(q => q.topic === categoryTopics[categoryActiveIndex]);
  if (categoryTagFilter.length > 0) {
    list = list.filter(q => (tags[q.id] || []).some(t => categoryTagFilter.includes(t)));
  }

  document.getElementById('category-list').innerHTML = list.length === 0
    ? emptyCard('找不到符合的題目')
    : list.map(q => renderCategoryRow(q, questions.indexOf(q) + 1)).join('');
  applyCategoryExpandState();
}

function toggleAllCategoryRows() {
  categoryAllExpanded = !categoryAllExpanded;
  applyCategoryExpandState();
}

function applyCategoryExpandState() {
  document.querySelectorAll('#category-list [id^="cat-row-"]').forEach(el => {
    el.classList.toggle('hidden', !categoryAllExpanded);
  });
  const btn = document.getElementById('category-toggle-all');
  if (btn) btn.textContent = categoryAllExpanded ? '全部合上' : '全部展開';
}

function renderCategoryRow(q, num) {
  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <button onclick="toggleCategoryRow(${num})"
        class="w-full flex items-center gap-2 px-5 py-2.5 text-left hover:bg-gray-50">
        <span class="text-xs text-gray-400 shrink-0">#${num}</span>
        <span class="text-sm text-gray-700 truncate">${escapeHtml(q.question)}</span>
        ${tagHintHTML(q.id)}
      </button>
      <div id="cat-row-${num}" class="hidden px-5 pb-4 pt-3 border-t border-gray-100">
        <p class="text-gray-800 text-sm leading-relaxed mb-1">${escapeHtml(q.question)}</p>
        ${renderQuestionDetail(q)}
      </div>
    </div>`;
}

function toggleCategoryRow(num) {
  document.getElementById(`cat-row-${num}`).classList.toggle('hidden');
}

// =====================================================================
// AUTHOR
// =====================================================================
function renderAuthor(container) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-4 py-2">
      <h2 class="text-xl font-bold text-gray-800 px-1">關於作者</h2>

      <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center gap-4">
        <img src="icons/author.svg" alt="作者頭像" class="w-16 h-16 rounded-full">
        <div>
          <div class="text-lg font-bold text-gray-800">yunhung</div>
          <div class="text-sm text-gray-500 mt-1">碼農出生，AI時代後開始用嘴砲解決問題。</div>
        </div>
      </div>

      <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div class="text-xs text-gray-400 uppercase tracking-wide mb-2">製作動機</div>
        <p class="text-sm text-gray-700 leading-relaxed">
          準備採購法考試時找不到好用的練習工具，因此自己動口做一個。
        </p>
      </div>

      <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div class="text-xs text-gray-400 uppercase tracking-wide mb-2">聯絡方式</div>
        <a href="mailto:yunhung2000@gmail.com"
           class="text-sm text-blue-600 hover:underline">yunhung2000@gmail.com</a>
      </div>
    </div>
  `;
}

// =====================================================================
// DASHBOARD
// =====================================================================
function renderStatCard(label, pct, subtext, colorMode) {
  if (pct === null) {
    return `
      <div class="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
        <div class="text-xs text-gray-400 mb-1 uppercase tracking-wide">${label}</div>
        <div class="text-2xl md:text-4xl font-bold text-gray-300">－</div>
        <div class="text-xs text-gray-400 mt-1.5">${subtext}</div>
        <div class="mt-2 h-1.5 bg-gray-100 rounded-full"></div>
      </div>`;
  }
  const col = colorMode === 'neutral' ? { text: 'text-blue-600', bar: 'bg-blue-400' } : accColor(pct);
  return `
    <div class="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
      <div class="text-xs text-gray-400 mb-1 uppercase tracking-wide">${label}</div>
      <div class="text-2xl md:text-4xl font-bold ${col.text}">${pct}<span class="text-lg md:text-2xl">%</span></div>
      <div class="text-xs text-gray-400 mt-1.5">${subtext}</div>
      <div class="mt-2 h-1.5 bg-gray-100 rounded-full"><div class="h-1.5 ${col.bar} rounded-full" style="width:${pct}%"></div></div>
    </div>`;
}

function renderDashboard(container) {
  const total = questions.length;
  const seenIds = Object.keys(progress).filter(id => progress[id].last_seen);
  const seen = seenIds.length;
  const coverage = total > 0 ? Math.round(seen / total * 100) : 0;

  const recentAcc = computeRecentAccuracy();
  const recentExam = computeRecentExamAvg();

  const daysLeft = getDaysLeft();

  container.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold text-gray-800">數據看板</h2>
        <span class="text-sm text-gray-500">距考試還有 <strong class="text-red-500">${daysLeft}</strong> 天</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-5 md:mb-6">
        ${renderStatCard('全題庫覆蓋率', coverage, `${seen} / ${total} 題`, 'neutral')}
        ${renderStatCard('近7日正確率', recentAcc.pct,
          recentAcc.total > 0 ? `${recentAcc.correct} / ${recentAcc.total} 次` : '近7日尚無作答紀錄', 'graded')}
        ${renderStatCard('近7日模擬測驗平均分', recentExam.pct,
          recentExam.sessionCount > 0 ? `共 ${recentExam.sessionCount} 場` : '近7日尚無測驗紀錄', 'graded')}
      </div>
      <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 class="text-sm font-semibold text-gray-700 mb-2">各章節覆蓋率</h3>
        <div id="topic-coverage-list" class="divide-y divide-gray-50"></div>
      </div>
    </div>
  `;

  renderTopicCoverage();
}

function renderTopicCoverage() {
  const topicMap = {};
  for (const q of questions) {
    if (!topicMap[q.topic]) topicMap[q.topic] = { seen: 0, total: 0 };
    topicMap[q.topic].total++;
  }
  for (const id in progress) {
    if (!progress[id].last_seen) continue;
    const q = questions.find(x => x.id === id);
    if (!q || !topicMap[q.topic]) continue;
    topicMap[q.topic].seen++;
  }

  const topics = Object.keys(topicMap);
  const rows = topics.map(t => {
    const s = topicMap[t];
    const pct = s.total > 0 ? Math.round(s.seen / s.total * 100) : 0;
    const col = accColor(pct);
    return `
      <div class="py-2.5">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm text-gray-700 truncate pr-3">${escapeHtml(t)}</span>
          <span class="text-xs text-gray-400 shrink-0">已答 ${s.seen} / 共 ${s.total} 題</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-gray-100 rounded-full">
            <div class="h-1.5 ${col.bar} rounded-full" style="width:${pct}%"></div>
          </div>
          <span class="text-xs font-semibold ${col.text} w-9 text-right">${pct}%</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('topic-coverage-list').innerHTML = rows;
}

// =====================================================================
// QUIZ PRACTICE (刷題練習)
// =====================================================================
function renderQuizSetup(container) {
  const topics = [...new Set(questions.map(q => q.topic))].sort();
  const selectedTopics = quizConfig.topics.length ? quizConfig.topics : topics;
  const allTags = getAllTags();

  const tagSectionHTML = allTags.length > 0 ? `
        <div>
          <div class="text-sm font-semibold text-gray-700 mb-2">選擇標籤（不選＝不限標籤）</div>
          <div class="flex flex-wrap gap-2">
            ${allTags.map(t => `
              <label class="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" class="quiz-tag-cb" value="${escapeHtml(t)}">
                <span class="text-sm text-gray-700">${escapeHtml(t)}</span>
              </label>`).join('')}
          </div>
        </div>` : '';

  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <h2 class="text-xl font-bold text-gray-800 mb-4">刷題練習</h2>
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-6">
        <div>
          <div class="text-sm font-semibold text-gray-700 mb-2">作答模式</div>
          <div class="flex gap-2">
            <button id="quiz-mode-practice" onclick="setQuizMode('practice')"
              class="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">練習模式（每題即時對錯）</button>
            <button id="quiz-mode-exam" onclick="setQuizMode('exam')"
              class="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">測驗模式（作答完才看結果）</button>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-semibold text-gray-700">選擇章節</div>
            <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" id="quiz-topic-all-cb" onchange="onQuizTopicAllChange()">
              全選 / 全不選
            </label>
          </div>
          <div class="border border-gray-100 rounded-xl max-h-48 overflow-y-auto p-1">
            ${topics.map(t => `
              <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" class="quiz-topic-cb" value="${escapeHtml(t)}" onchange="onQuizTopicCbChange()">
                <span class="text-sm text-gray-700">${escapeHtml(t)}</span>
              </label>`).join('')}
          </div>
          <div id="quiz-validation-msg" class="text-xs text-red-500 mt-1.5 hidden">請至少選擇一個章節</div>
        </div>
        ${tagSectionHTML}
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm font-semibold text-gray-700">題目數量</div>
            <span class="text-sm font-semibold text-blue-600"><span id="quiz-count-label">${quizConfig.count}</span> 題</span>
          </div>
          <input type="range" id="quiz-count-slider" min="5" max="100" step="5" value="${quizConfig.count}"
            oninput="onQuizCountChange()" class="w-full accent-blue-600">
          <div class="flex justify-between text-xs text-gray-400 mt-0.5"><span>5</span><span>100</span></div>
        </div>

        <div>
          <div class="text-sm font-semibold text-gray-700 mb-2">選題方式</div>
          <div class="flex gap-2">
            <button id="quiz-order-random" onclick="setQuizOrder('random')"
              class="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">隨機出題</button>
            <button id="quiz-order-unseen" onclick="setQuizOrder('unseen')"
              class="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">陌生優先</button>
          </div>
        </div>

        <div>
          <div class="text-sm font-semibold text-gray-700 mb-2">題型</div>
          <div class="flex gap-2">
            <button id="quiz-type-tf" onclick="setQuizType('tf')"
              class="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">全是非題</button>
            <button id="quiz-type-mc" onclick="setQuizType('mc')"
              class="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">全選擇題</button>
            <button id="quiz-type-mixed" onclick="setQuizType('mixed')"
              class="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-600">混合</button>
          </div>
        </div>

        <button id="quiz-start-btn" onclick="startQuiz()"
          class="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          開始測驗 ▶
        </button>
      </div>
    </div>
  `;

  document.querySelectorAll('.quiz-topic-cb').forEach(cb => {
    cb.checked = selectedTopics.includes(cb.value);
  });
  document.querySelectorAll('.quiz-tag-cb').forEach(cb => {
    cb.checked = quizConfig.tags.includes(cb.value);
  });
  updateQuizModePills();
  updateQuizTypePills();
  updateQuizOrderPills();
  onQuizTopicCbChange();
}

function updateQuizModePills() {
  ['practice', 'exam'].forEach(m => {
    const btn = document.getElementById(`quiz-mode-${m}`);
    if (!btn) return;
    const active = quizConfig.mode === m;
    btn.classList.toggle('border-blue-500', active);
    btn.classList.toggle('bg-blue-50', active);
    btn.classList.toggle('text-blue-700', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('text-gray-600', !active);
  });
}

function updateQuizTypePills() {
  ['tf', 'mc', 'mixed'].forEach(t => {
    const btn = document.getElementById(`quiz-type-${t}`);
    if (!btn) return;
    const active = quizConfig.type === t;
    btn.classList.toggle('border-blue-500', active);
    btn.classList.toggle('bg-blue-50', active);
    btn.classList.toggle('text-blue-700', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('text-gray-600', !active);
  });
}

function setQuizMode(mode) {
  quizConfig.mode = mode;
  updateQuizModePills();
}

function setQuizType(type) {
  quizConfig.type = type;
  updateQuizTypePills();
}

function setQuizOrder(order) {
  quizConfig.order = order;
  updateQuizOrderPills();
}

function updateQuizOrderPills() {
  ['random', 'unseen'].forEach(o => {
    const btn = document.getElementById(`quiz-order-${o}`);
    if (!btn) return;
    const active = quizConfig.order === o;
    btn.classList.toggle('border-blue-500', active);
    btn.classList.toggle('bg-blue-50', active);
    btn.classList.toggle('text-blue-700', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('text-gray-600', !active);
  });
}

function onQuizTopicAllChange() {
  const allCb = document.getElementById('quiz-topic-all-cb');
  document.querySelectorAll('.quiz-topic-cb').forEach(cb => { cb.checked = allCb.checked; });
  allCb.indeterminate = false;
  updateQuizStartButtonState();
}

function onQuizTopicCbChange() {
  const cbs = [...document.querySelectorAll('.quiz-topic-cb')];
  const n = cbs.filter(cb => cb.checked).length;
  const allCb = document.getElementById('quiz-topic-all-cb');
  if (allCb) {
    allCb.checked = n === cbs.length;
    allCb.indeterminate = n > 0 && n < cbs.length;
  }
  updateQuizStartButtonState();
}

function updateQuizStartButtonState() {
  const n = document.querySelectorAll('.quiz-topic-cb:checked').length;
  const btn = document.getElementById('quiz-start-btn');
  const msg = document.getElementById('quiz-validation-msg');
  if (!btn) return;
  btn.disabled = n === 0;
  if (msg) msg.classList.toggle('hidden', n !== 0);
}

function onQuizCountChange() {
  const slider = document.getElementById('quiz-count-slider');
  const label = document.getElementById('quiz-count-label');
  if (slider && label) label.textContent = slider.value;
}

function startQuiz() {
  const topicCbs = [...document.querySelectorAll('.quiz-topic-cb')];
  quizConfig.topics = topicCbs.filter(cb => cb.checked).map(cb => cb.value);
  const tagCbs = [...document.querySelectorAll('.quiz-tag-cb')];
  quizConfig.tags = tagCbs.filter(cb => cb.checked).map(cb => cb.value);
  const slider = document.getElementById('quiz-count-slider');
  if (slider) quizConfig.count = parseInt(slider.value, 10);
  beginQuizRound();
}

function beginQuizRound() {
  if (quizConfig.topics.length === 0) return;

  const content = document.getElementById('app-content');
  const pool = questions.filter(q => {
    if (!quizConfig.topics.includes(q.topic)) return false;
    if (quizConfig.type !== 'mixed' && q.type !== quizConfig.type) return false;
    if (quizConfig.tags.length > 0 && !(tags[q.id] || []).some(t => quizConfig.tags.includes(t))) return false;
    return true;
  });

  if (pool.length === 0) {
    content.innerHTML = `
      <div class="max-w-2xl mx-auto">
        <h2 class="text-xl font-bold text-gray-800 mb-4">刷題練習</h2>
        ${emptyCard('沒有符合條件的題目可供測驗', '請調整章節或題型後再試一次')}
        <div class="mt-4 text-center">
          <button onclick="navigate('quiz')"
            class="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">回設定畫面</button>
        </div>
      </div>`;
    return;
  }

  let orderedPool;
  if (quizConfig.order === 'unseen') {
    orderedPool = shuffle(pool).sort((a, b) => {
      const aSeen = progress[a.id] && progress[a.id].last_seen ? 1 : 0;
      const bSeen = progress[b.id] && progress[b.id].last_seen ? 1 : 0;
      if (aSeen !== bSeen) return aSeen - bSeen; // 從未作答的排最前面
      if (aSeen === 0) return 0; // 都沒作答過：維持洗牌後的隨機順序
      return progress[a.id].last_seen.localeCompare(progress[b.id].last_seen); // 都作答過：最久沒作答的排前面
    });
  } else {
    orderedPool = shuffle(pool);
  }
  quizQueue = orderedPool.slice(0, quizConfig.count);
  quizAnswers = quizQueue.map(() => ({ answered: false, userAnswer: null }));
  quizIndex = 0;
  quizResults = null;

  if (quizConfig.mode === 'practice') {
    renderQuizTakingPractice(content);
  } else {
    renderQuizTakingExam(content);
  }
}

function renderQuizTakingPractice(container) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-800">刷題練習</h2>
        <span class="text-sm text-gray-500">本次測驗 ${quizQueue.length} 題</span>
      </div>
      <div id="quiz-card"></div>
    </div>
  `;
  renderQuizPracticeCard();
}

function renderQuizPracticeCard() {
  const card = document.getElementById('quiz-card');
  if (!card) return;

  if (quizIndex >= quizQueue.length) {
    finishQuiz();
    return;
  }

  const q = quizQueue[quizIndex];
  const ans = quizAnswers[quizIndex];
  card.innerHTML = renderQuestionCard(q, quizIndex + 1, quizQueue.length, ans.answered, ans.userAnswer, false, 'answerQuizPractice', 'nextQuizPracticeQuestion');
}

function answerQuizPractice(answer) {
  const ans = quizAnswers[quizIndex];
  if (ans.answered) return;
  const q = quizQueue[quizIndex];
  const isCorrect = answer === q.answer;
  updateQuestionStats(q.id, isCorrect);
  quizAnswers[quizIndex] = { answered: true, userAnswer: answer };
  renderQuizPracticeCard();
}

function nextQuizPracticeQuestion() {
  quizIndex++;
  renderQuizPracticeCard();
}

function renderQuizTakingExam(container) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-800">刷題練習</h2>
        <span class="text-sm text-gray-500">本次測驗 ${quizQueue.length} 題</span>
      </div>
      <div id="quiz-card"></div>
    </div>
  `;
  renderQuizExamCard();
}

function renderQuizExamCard() {
  const card = document.getElementById('quiz-card');
  if (!card) return;

  const q = quizQueue[quizIndex];
  const ans = quizAnswers[quizIndex];
  const typeLabel = q.type === 'tf' ? '是非題' : '選擇題';
  const progressPct = Math.round((quizIndex + 1) / quizQueue.length * 100);

  let optionsHTML = '';
  if (q.type === 'tf') {
    optionsHTML = `
      <div class="grid grid-cols-2 gap-3 mt-5">
        ${['X', 'O'].map(val => {
          const isSelected = val === ans.userAnswer;
          const cls = isSelected
            ? 'option-btn py-3.5 border-2 border-blue-500 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium'
            : 'option-btn py-3.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50';
          return `<button onclick="selectQuizExamAnswer('${val}')" class="${cls}">${val === 'O' ? '○ 正確' : '✗ 錯誤'}</button>`;
        }).join('')}
      </div>`;
  } else {
    const opts = q.options || [];
    optionsHTML = `<div class="space-y-2.5 mt-5">
      ${opts.map((opt, i) => {
        const val = String(i + 1);
        const isSelected = val === ans.userAnswer;
        const cls = isSelected
          ? 'option-btn w-full text-left py-3 px-4 border-2 border-blue-500 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium'
          : 'option-btn w-full text-left py-3 px-4 border-2 border-gray-200 rounded-xl text-sm text-gray-700 hover:border-blue-400 hover:bg-blue-50';
        return `<button onclick="selectQuizExamAnswer('${val}')" class="${cls}">
          <span class="font-semibold mr-2 ${isSelected ? 'text-blue-400' : 'text-gray-400'}">(${i + 1})</span>${escapeHtml(opt)}
        </button>`;
      }).join('')}
    </div>`;
  }

  card.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="px-5 pt-2 pb-0">
        <div class="h-1 bg-gray-100 rounded-full mt-2">
          <div class="h-1 bg-blue-300 rounded-full transition-all" style="width:${progressPct}%"></div>
        </div>
      </div>
      <div class="px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">${typeLabel}</span>
          <span class="text-xs text-gray-400 truncate max-w-[160px]">${escapeHtml(q.topic)}</span>
        </div>
        <span class="text-xs text-gray-400 shrink-0">${quizIndex + 1} / ${quizQueue.length}</span>
      </div>
      <div class="px-5 pb-5">
        <p class="text-gray-800 text-sm leading-relaxed">${escapeHtml(q.question)}</p>
        ${optionsHTML}
        <div class="mt-5 pt-4 border-t border-gray-100 flex gap-2">
          <button onclick="quizExamPrev()" ${quizIndex === 0 ? 'disabled' : ''}
            class="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">← 上一題</button>
          <button onclick="quizExamNext()" ${quizIndex === quizQueue.length - 1 ? 'disabled' : ''}
            class="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一題 →</button>
        </div>
        <button onclick="submitQuizExam()"
          class="mt-2 w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">交卷 ✓</button>
      </div>
    </div>`;
}

function selectQuizExamAnswer(answer) {
  quizAnswers[quizIndex] = { answered: true, userAnswer: answer };
  renderQuizExamCard();
}

function quizExamPrev() {
  if (quizIndex > 0) { quizIndex--; renderQuizExamCard(); }
}

function quizExamNext() {
  if (quizIndex < quizQueue.length - 1) { quizIndex++; renderQuizExamCard(); }
}

function submitQuizExam() {
  const hasUnanswered = quizAnswers.some(a => !a.answered);
  if (hasUnanswered && !confirm('尚有題目未作答，確定要交卷嗎？')) return;
  quizQueue.forEach((q, i) => {
    const isCorrect = quizAnswers[i].userAnswer === q.answer;
    updateQuestionStats(q.id, isCorrect);
  });
  finishQuiz();
}

function finishQuiz() {
  const total = quizQueue.length;
  let correct = 0;
  const topicStats = {};
  quizQueue.forEach((q, i) => {
    const isCorrect = quizAnswers[i].userAnswer === q.answer;
    if (isCorrect) correct++;
    if (!topicStats[q.topic]) topicStats[q.topic] = { correct: 0, total: 0 };
    topicStats[q.topic].total++;
    if (isCorrect) topicStats[q.topic].correct++;
  });
  const wrong = total - correct;
  const pct = total > 0 ? Math.round(correct / total * 100) : 0;
  const details = quizQueue.map((q, i) => ({
    q,
    userAnswer: quizAnswers[i].userAnswer,
    isCorrect: quizAnswers[i].userAnswer === q.answer,
  }));
  quizResults = { total, correct, wrong, pct, topicStats, mode: quizConfig.mode, details };
  quizDetailFilter = 'wrong';

  if (quizConfig.mode === 'exam' && total > 0) {
    examHistory.push({ date: todayStr(), correct, total });
    saveExamHistory();
  }

  renderQuizResults(document.getElementById('app-content'));
}

function buildQuizSuggestion(results) {
  if (results.pct >= 80) return '🎉 表現很棒，繼續保持這個節奏！';
  let weakest = null, weakestPct = Infinity;
  for (const [topic, s] of Object.entries(results.topicStats)) {
    if (s.total === 0) continue;
    const pct = s.correct / s.total * 100;
    if (pct < weakestPct) { weakest = topic; weakestPct = pct; }
  }
  return weakest
    ? `💡 別氣餒，再接再厲！這次「${escapeHtml(weakest)}」較弱，建議加強複習。`
    : '💡 別氣餒，再接再厲！';
}

function formatQuizAnswer(q, val) {
  if (val === null || val === undefined) return '（未作答）';
  if (q.type === 'tf') return val === 'O' ? '○ 正確' : '✗ 錯誤';
  const opt = (q.options || [])[Number(val) - 1];
  return `(${val}) ${escapeHtml(opt || '')}`;
}

function renderQuizDetailRow(detail, num) {
  const { q, userAnswer, isCorrect } = detail;
  const typeLabel = q.type === 'tf' ? '是非題' : '選擇題';
  const statusBadge = userAnswer === null
    ? `<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">未作答</span>`
    : isCorrect
      ? `<span class="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">✓ 答對</span>`
      : `<span class="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">✗ 答錯</span>`;

  const userAnswerHTML = formatQuizAnswer(q, userAnswer);
  const correctAnswerRow = !isCorrect
    ? `<div class="text-xs text-green-600 mt-0.5">正確答案：${formatQuizAnswer(q, q.answer)}</div>`
    : '';

  const lawHTML = q.law_ref
    ? `<span class="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full">📖 ${escapeHtml(q.law_ref)}</span>`
    : '<span></span>';

  return `
    <div class="py-3 border-b border-gray-50 last:border-0">
      <div class="flex items-center gap-2 mb-1.5 flex-wrap">
        <span class="text-xs text-gray-400 shrink-0">#${num}</span>
        <span class="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">${typeLabel}</span>
        <span class="text-xs text-gray-400 truncate max-w-[140px]">${escapeHtml(q.topic)}</span>
        ${statusBadge}
      </div>
      <p class="text-sm text-gray-800 leading-relaxed mb-1.5 text-left">${escapeHtml(q.question)}</p>
      <div class="text-xs ${isCorrect ? 'text-gray-500' : 'text-red-500'} text-left">你的答案：${userAnswerHTML}</div>
      <div class="text-left">${correctAnswerRow}</div>
      <div class="flex items-center justify-between mt-2">
        ${lawHTML}
        <button onclick="showAIModal('${q.id}')"
          class="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50">🤖 AI 解析</button>
      </div>
    </div>`;
}

function setQuizDetailFilter(filter) {
  quizDetailFilter = filter;
  renderQuizResults(document.getElementById('app-content'));
}

function renderQuizResults(container) {
  const r = quizResults;
  const accCol = accColor(r.pct);
  const suggestion = buildQuizSuggestion(r);

  const topicRows = Object.entries(r.topicStats).map(([topic, s]) => {
    const pct = s.total > 0 ? Math.round(s.correct / s.total * 100) : 0;
    return `
      <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
        <span class="text-sm text-gray-700 truncate pr-3">${escapeHtml(topic)}</span>
        <span class="text-sm text-gray-500 shrink-0">${s.correct} / ${s.total}　${pct}%</span>
      </div>`;
  }).join('');

  let detailSection = '';
  {
    const wrongCount = r.details.filter(d => !d.isCorrect).length;
    const rowsData = r.details
      .map((d, i) => ({ d, num: i + 1 }))
      .filter(x => quizDetailFilter === 'all' || !x.d.isCorrect);
    const rowsHTML = rowsData.map(x => renderQuizDetailRow(x.d, x.num)).join('');

    const filterPills = ['wrong', 'all'].map(f => {
      const active = quizDetailFilter === f;
      const label = f === 'wrong' ? `只看答錯 (${wrongCount})` : `全部 (${r.total})`;
      const cls = active
        ? 'bg-blue-50 text-blue-700 border-blue-500 font-medium'
        : 'text-gray-600 border-gray-200';
      const roundedCls = f === 'wrong' ? 'rounded-l-xl' : 'rounded-r-xl border-l-0';
      return `<button onclick="setQuizDetailFilter('${f}')" class="px-3 py-1.5 border text-xs ${roundedCls} ${cls}">${label}</button>`;
    }).join('');

    detailSection = `
      <div class="text-left mt-6 pt-6 border-t border-gray-100">
        <div class="text-sm font-semibold text-gray-700 mb-3 text-center">── 本次測驗詳解 ──</div>
        <div class="flex justify-center gap-0 mb-3">${filterPills}</div>
        ${rowsData.length === 0
          ? emptyCard('這次全對，沒有錯題 🎉')
          : `<div class="border border-gray-100 rounded-xl px-4">${rowsHTML}</div>`}
      </div>`;
  }

  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div class="text-3xl mb-2">🎉</div>
        <div class="text-lg font-bold text-gray-800 mb-1">測驗結束！</div>
        <div class="text-sm text-gray-400 mb-5">本次測驗：${r.total} 題</div>

        <div class="flex items-center justify-center gap-6 mb-5">
          <span class="text-sm text-green-600 font-medium">✓ 答對 ${r.correct} 題</span>
          <span class="text-sm text-red-500 font-medium">✗ 答錯 ${r.wrong} 題</span>
        </div>

        <div class="text-4xl font-bold ${accCol.text} mb-2">正確率 ${r.pct}%</div>
        <div class="w-full bg-gray-100 rounded-full h-2 mb-5 max-w-sm mx-auto">
          <div class="${accCol.bar} h-2 rounded-full" style="width:${r.pct}%"></div>
        </div>

        <div class="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 mb-6 text-left">${suggestion}</div>

        <div class="text-left mb-6">
          <div class="text-sm font-semibold text-gray-700 mb-2 text-center">── 章節表現 ──</div>
          ${topicRows}
        </div>

        ${detailSection}

        <div class="flex flex-wrap gap-2 justify-center${detailSection ? ' mt-6' : ''}">
          <button onclick="beginQuizRound()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">重新測驗</button>
          <button onclick="navigate('quiz')" class="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">回設定畫面</button>
        </div>
      </div>
    </div>
  `;
}

// =====================================================================
// REVIEW CENTER
// =====================================================================
function renderReview(container) {
  const topics = [...new Set(questions.map(q => q.topic))].sort();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-800">錯題複習</h2>
        <span id="review-due-badge" class="text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full shrink-0 ml-3"></span>
      </div>
      <div class="flex flex-wrap gap-2 mb-5">
        <div class="relative" id="topic-dropdown-container">
          <button onclick="toggleTopicDropdown()" id="topic-dropdown-btn"
            class="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 whitespace-nowrap">
            <span id="topic-dropdown-label">章節：全部</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          <div id="topic-dropdown-panel" class="hidden absolute z-20 top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-56 max-h-64 overflow-y-auto">
            <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
              <input type="checkbox" id="topic-all-cb" onchange="onTopicAllChange()">
              <span class="text-sm font-medium text-gray-700">全選</span>
            </label>
            <div class="border-t border-gray-100 my-1"></div>
            ${topics.map(t => `
              <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" class="topic-cb" value="${escapeHtml(t)}" onchange="onTopicCbChange()">
                <span class="text-sm text-gray-700 truncate" title="${escapeHtml(t)}">${escapeHtml(t)}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="flex shrink-0">
          <button id="review-pill-srs" onclick="setReviewOrder('srs')"
            class="px-3 py-2 border border-gray-200 rounded-l-xl text-sm leading-none">不熟練</button>
          <button id="review-pill-random" onclick="setReviewOrder('random')"
            class="px-3 py-2 border-t border-b border-r border-gray-200 rounded-r-xl text-sm leading-none">隨機</button>
        </div>
        <button onclick="initReviewQueue()" title="重新出題"
          class="shrink-0 w-9 h-9 flex items-center justify-center border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-100">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </button>
      </div>
      <div id="review-card"></div>
    </div>
  `;

  // Restore filter state into DOM
  updateReviewPills();
  document.querySelectorAll('.topic-cb').forEach(cb => {
    cb.checked = reviewFilters.topics.length === 0 || reviewFilters.topics.includes(cb.value);
  });
  const checkedCount = [...document.querySelectorAll('.topic-cb')].filter(cb => cb.checked).length;
  const allCb = document.getElementById('topic-all-cb');
  allCb.checked = checkedCount === topics.length;
  allCb.indeterminate = checkedCount > 0 && checkedCount < topics.length;
  updateTopicDropdownLabel();

  // Close dropdown on outside click
  if (_topicDropdownHandler) document.removeEventListener('click', _topicDropdownHandler);
  _topicDropdownHandler = (e) => {
    const cont = document.getElementById('topic-dropdown-container');
    if (cont && !cont.contains(e.target)) {
      const panel = document.getElementById('topic-dropdown-panel');
      if (panel) panel.classList.add('hidden');
    }
  };
  document.addEventListener('click', _topicDropdownHandler);

  buildReviewQueue(true);
}

function toggleTopicDropdown() {
  document.getElementById('topic-dropdown-panel').classList.toggle('hidden');
}

function onTopicAllChange() {
  const allCb = document.getElementById('topic-all-cb');
  document.querySelectorAll('.topic-cb').forEach(cb => { cb.checked = allCb.checked; });
  allCb.indeterminate = false;
  updateTopicDropdownLabel();
  buildReviewQueue(false);
}

function onTopicCbChange() {
  const cbs = [...document.querySelectorAll('.topic-cb')];
  const n = cbs.filter(cb => cb.checked).length;
  const allCb = document.getElementById('topic-all-cb');
  allCb.checked = n === cbs.length;
  allCb.indeterminate = n > 0 && n < cbs.length;
  updateTopicDropdownLabel();
  buildReviewQueue(false);
}

function setReviewOrder(order) {
  reviewFilters.order = order;
  updateReviewPills();
  buildReviewQueue(false);
}

function updateReviewPills() {
  ['srs', 'random'].forEach(o => {
    const btn = document.getElementById(`review-pill-${o}`);
    if (!btn) return;
    const active = reviewFilters.order === o;
    btn.classList.toggle('bg-blue-50',     active);
    btn.classList.toggle('text-blue-700',  active);
    btn.classList.toggle('border-blue-500', active);
    btn.classList.toggle('text-gray-600',  !active);
    btn.classList.toggle('font-medium',    active);
  });
}

function updateTopicDropdownLabel() {
  const cbs = [...document.querySelectorAll('.topic-cb')];
  const n = cbs.filter(cb => cb.checked).length;
  const label = document.getElementById('topic-dropdown-label');
  if (!label) return;
  label.textContent = (n === 0 || n === cbs.length) ? '章節：全部' : `章節：${n} 已選`;
}

function updateReviewDueBadge() {
  const today = todayStr();
  const badge = document.getElementById('review-due-badge');
  if (!badge) return;
  const filtered = questions.filter(q => {
    const s = progress[q.id];
    if (!s || (s.wrong_count || 0) === 0) return false;
    if (reviewFilters.topics.length > 0 && !reviewFilters.topics.includes(q.topic)) return false;
    return true;
  });
  const dueCount = filtered.filter(q => {
    const s = progress[q.id];
    return !s || !s.next_review || s.next_review <= today;
  }).length;
  const masteredDueCount = filtered.filter(q => {
    const s = progress[q.id] || {};
    return (s.consecutive_correct || 0) >= MASTERY_THRESHOLD && (s.next_review || today) <= today;
  }).length;
  badge.textContent = `今日待複習：${dueCount} 題${masteredDueCount > 0 ? `（含 ${masteredDueCount} 已熟練）` : ''}`;
}

function buildReviewQueue(preservePosition) {
  const today = todayStr();
  const allTopics = [...new Set(questions.map(q => q.topic))];

  // Read topics from DOM if available
  const topicCbs = [...document.querySelectorAll('.topic-cb')];
  if (topicCbs.length > 0) {
    const selected = topicCbs.filter(cb => cb.checked).map(cb => cb.value);
    reviewFilters.topics = selected.length === allTopics.length ? [] : selected;
  }
  // Close panel
  const panel = document.getElementById('topic-dropdown-panel');
  if (panel) panel.classList.add('hidden');

  let pool = questions.filter(q => {
    const s = progress[q.id];
    if (!s || (s.wrong_count || 0) === 0) return false;
    if (reviewFilters.topics.length > 0 && !reviewFilters.topics.includes(q.topic)) return false;
    return true;
  });

  if (reviewFilters.order === 'srs') {
    pool.sort((a, b) => {
      const sa = progress[a.id] || {};
      const sb = progress[b.id] || {};
      const aMastered = (sa.consecutive_correct || 0) >= MASTERY_THRESHOLD ? 1 : 0;
      const bMastered = (sb.consecutive_correct || 0) >= MASTERY_THRESHOLD ? 1 : 0;
      const aDue = (sa.next_review || today) <= today ? 0 : 1;
      const bDue = (sb.next_review || today) <= today ? 0 : 1;
      const aTier = aDue * 2 + aMastered;
      const bTier = bDue * 2 + bMastered;
      if (aTier !== bTier) return aTier - bTier;
      return (sa.next_review || '').localeCompare(sb.next_review || '');
    });
  } else {
    pool = shuffle(pool);
  }

  reviewQueue = pool;
  if (!preservePosition || reviewIndex >= reviewQueue.length) {
    reviewIndex = 0;
    reviewAnswered = false;
    reviewUserAnswer = null;
  }

  updateReviewDueBadge();
  renderReviewCard();
}

function initReviewQueue() {
  buildReviewQueue(false);
}

function renderReviewCard() {
  const card = document.getElementById('review-card');
  if (!card) return;

  if (reviewQueue.length === 0) {
    card.innerHTML = emptyCard('目前沒有錯題 🎉', '繼續在刷題模式中練習吧');
    return;
  }
  if (reviewIndex >= reviewQueue.length) {
    card.innerHTML = completionCard(reviewQueue.length, 'initReviewQueue()', '複習完成');
    return;
  }

  const q = reviewQueue[reviewIndex];
  card.innerHTML = renderQuestionCard(q, reviewIndex + 1, reviewQueue.length, reviewAnswered, reviewUserAnswer, true);
}

function answerReview(answer) {
  if (reviewAnswered) return;
  const q = reviewQueue[reviewIndex];
  const isCorrect = answer === q.answer;
  updateQuestionStats(q.id, isCorrect);
  reviewAnswered = true;
  reviewUserAnswer = answer;
  renderReviewCard();
}

function nextReviewQuestion() {
  reviewIndex++;
  reviewAnswered = false;
  reviewUserAnswer = null;
  renderReviewCard();
}

// =====================================================================
// SHARED QUESTION CARD RENDERER
// =====================================================================
function renderQuestionCard(q, num, total, answered, userAnswer, isReview, answerFnName = null, nextFnName = null) {
  const s = progress[q.id] || {};
  const typeLabel = q.type === 'tf' ? '是非題' : '選擇題';
  const wrongBadge = (s.wrong_count || 0) > 0
    ? `<span class="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">錯 ${s.wrong_count} 次</span>`
    : '';
  const masteryBadge = isReview && (s.consecutive_correct || 0) >= MASTERY_THRESHOLD
    ? `<span class="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">★ 已熟練</span>`
    : '';

  const answerFn = isReview ? (answerFnName || 'answerReview') : answerFnName;
  const nextFn = isReview ? (nextFnName || 'nextReviewQuestion') : nextFnName;
  const progressPct = Math.round(num / total * 100);

  let optionsHTML = '';
  if (!answered) {
    if (q.type === 'tf') {
      optionsHTML = `
        <div class="grid grid-cols-2 gap-3 mt-5">
          <button onclick="${answerFn}('X')"
            class="option-btn py-3.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-red-400 hover:bg-red-50 hover:text-red-700">
            ✗ 錯誤
          </button>
          <button onclick="${answerFn}('O')"
            class="option-btn py-3.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-green-400 hover:bg-green-50 hover:text-green-700">
            ○ 正確
          </button>
        </div>`;
    } else {
      const opts = q.options || [];
      optionsHTML = `<div class="space-y-2.5 mt-5">
        ${opts.map((opt, i) => `
          <button onclick="${answerFn}('${i + 1}')"
            class="option-btn w-full text-left py-3 px-4 border-2 border-gray-200 rounded-xl text-sm text-gray-700 hover:border-blue-400 hover:bg-blue-50">
            <span class="font-semibold mr-2 text-gray-400">(${i + 1})</span>${escapeHtml(opt)}
          </button>`).join('')}
      </div>`;
    }
  } else {
    const isCorrect = userAnswer === q.answer;
    if (q.type === 'tf') {
      optionsHTML = `
        <div class="grid grid-cols-2 gap-3 mt-5">
          ${['X', 'O'].map(val => {
            const isUserPick = val === userAnswer;
            const isCorrectAns = val === q.answer;
            let cls = 'border-2 rounded-xl py-3.5 text-sm font-medium ';
            if (isCorrectAns) cls += 'border-green-500 bg-green-50 text-green-700';
            else if (isUserPick && !isCorrectAns) cls += 'border-red-400 bg-red-50 text-red-600';
            else cls += 'border-gray-100 bg-gray-50 text-gray-300';
            return `<div class="${cls} text-center">${val === 'O' ? '○ 正確' : '✗ 錯誤'}${isCorrectAns ? ' ✓' : ''}</div>`;
          }).join('')}
        </div>`;
    } else {
      const opts = q.options || [];
      optionsHTML = `<div class="space-y-2.5 mt-5">
        ${opts.map((opt, i) => {
          const val = String(i + 1);
          const isUserPick = val === userAnswer;
          const isCorrectAns = val === q.answer;
          let cls = 'w-full text-left py-3 px-4 border-2 rounded-xl text-sm ';
          if (isCorrectAns) cls += 'border-green-500 bg-green-50 text-green-700';
          else if (isUserPick && !isCorrectAns) cls += 'border-red-400 bg-red-50 text-red-600';
          else cls += 'border-gray-100 bg-gray-50 text-gray-300';
          return `<div class="${cls}"><span class="font-semibold mr-2 opacity-60">(${i + 1})</span>${escapeHtml(opt)}${isCorrectAns ? ' <span class="float-right">✓</span>' : ''}</div>`;
        }).join('')}
      </div>`;
    }

    const isCorr = userAnswer === q.answer;
    const lawHTML = q.law_ref
      ? `<span class="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full">📖 ${escapeHtml(q.law_ref)}</span>`
      : '';

    optionsHTML += `
      <div class="mt-5 pt-4 border-t border-gray-100">
        <div class="flex items-center gap-3 mb-4">
          <span class="${isCorr ? 'text-green-600' : 'text-red-500'} font-semibold text-sm">
            ${isCorr ? '✓ 答對了！' : '✗ 答錯了'}
          </span>
          ${lawHTML}
        </div>
        <div class="flex gap-2">
          <button onclick="${nextFn}()"
            class="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
            下一題 →
          </button>
          <button onclick="showAIModal('${q.id}')"
            class="px-4 py-2.5 border border-blue-200 text-blue-600 rounded-xl text-sm hover:bg-blue-50">
            🤖 AI 解析
          </button>
        </div>
      </div>`;
  }

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div class="px-5 pt-2 pb-0">
        <div class="h-1 bg-gray-100 rounded-full mt-2">
          <div class="h-1 bg-blue-300 rounded-full transition-all" style="width:${progressPct}%"></div>
        </div>
      </div>
      <div class="px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">${typeLabel}</span>
          <span class="text-xs text-gray-400 truncate max-w-[160px]">${escapeHtml(q.topic)}</span>
          ${wrongBadge}
          ${masteryBadge}
        </div>
        <span class="text-xs text-gray-400 shrink-0">${num} / ${total}</span>
      </div>
      <div class="px-5 pb-5">
        <p class="text-gray-800 text-sm leading-relaxed">${escapeHtml(q.question)}</p>
        ${optionsHTML}
      </div>
    </div>`;
}

function emptyCard(msg, sub = '') {
  return `
    <div class="bg-white rounded-2xl p-10 text-center shadow-sm border border-gray-100">
      <div class="text-gray-400">${msg}</div>
      ${sub ? `<div class="text-xs text-gray-300 mt-1">${sub}</div>` : ''}
    </div>`;
}

function completionCard(count, resetFn, label = '本輪完成') {
  return `
    <div class="bg-white rounded-2xl p-10 text-center shadow-sm border border-gray-100">
      <div class="text-2xl mb-2">🎉</div>
      <div class="font-semibold text-gray-700 mb-1">${label}！</div>
      <div class="text-sm text-gray-400 mb-5">共 ${count} 題</div>
      <button onclick="${resetFn}"
        class="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
        重新開始
      </button>
    </div>`;
}

// =====================================================================
// AI HELPER
// =====================================================================
function showAIModal(qId) {
  currentAIQuestion = questions.find(q => q.id === qId);
  if (!currentAIQuestion) return;

  const q = currentAIQuestion;
  let optionsText = '是非題（請判斷正確 ○ 或錯誤 ✗）';
  if (q.type === 'mc' && q.options) {
    optionsText = q.options.map((o, i) => `(${i + 1})${o}`).join(' ');
  }
  const answerDisplay = q.type === 'tf'
    ? (q.answer === 'O' ? '○ 正確' : '✗ 錯誤')
    : `(${q.answer})`;

  const prompt = `你是一位精通台灣《政府採購法》的專家。請用極其白話、邏輯清晰且貼近實務的語言，為考生解釋這道考題。

【考題內容】
題目：${q.question}
選項：${optionsText}
官方正確答案：【${answerDisplay}】
依據法條：${q.law_ref || '未提供'}

【請遵循以下格式回答】：
1. 核心邏輯：用一句話說明這條法律為什麼要這樣規定。
2. 關鍵陷阱：點出題目裡公務員或廠商最容易看錯的「關鍵字」（例如：應/得、金額級距、天數算入/排除）。`;

  document.getElementById('ai-prompt-text').value = prompt;
  document.getElementById('ai-copy-status').classList.add('hidden');
  document.getElementById('ai-modal').classList.remove('hidden');
}

function closeAIModal() {
  document.getElementById('ai-modal').classList.add('hidden');
}

function copyAIPrompt() {
  const text = document.getElementById('ai-prompt-text').value;
  const status = document.getElementById('ai-copy-status');

  const showSuccess = () => {
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showSuccess).catch(() => {
      document.getElementById('ai-prompt-text').select();
    });
  } else {
    document.getElementById('ai-prompt-text').select();
    try { document.execCommand('copy'); showSuccess(); } catch {}
  }
}

// Close modal on backdrop click
document.getElementById('ai-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAIModal();
});

document.getElementById('exam-date-modal').addEventListener('click', function(e) {
  if (e.target === this) closeExamDateModal();
});

document.getElementById('tag-io-modal').addEventListener('click', function(e) {
  if (e.target === this) closeTagIOModal();
});

// =====================================================================
// TAG IMPORT/EXPORT
// =====================================================================
function openTagIOModal() {
  document.getElementById('tag-export-text').value = JSON.stringify(tags, null, 2);
  document.getElementById('tag-export-stats').textContent =
    `目前共 ${getAllTags().length} 個標籤，套用在 ${Object.keys(tags).length} 題上`;
  document.getElementById('tag-export-status').classList.add('hidden');
  document.getElementById('tag-import-text').value = '';
  document.getElementById('tag-import-file').value = '';
  document.getElementById('tag-import-status').classList.add('hidden');
  document.getElementById('tag-io-modal').classList.remove('hidden');
}

function closeTagIOModal() {
  document.getElementById('tag-io-modal').classList.add('hidden');
}

function copyTagExport() {
  const text = document.getElementById('tag-export-text').value;
  const status = document.getElementById('tag-export-status');
  const showSuccess = () => {
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showSuccess).catch(() => {
      document.getElementById('tag-export-text').select();
    });
  } else {
    document.getElementById('tag-export-text').select();
    try { document.execCommand('copy'); showSuccess(); } catch {}
  }
}

function downloadTagExport() {
  const text = document.getElementById('tag-export-text').value;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tags-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function onTagImportFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('tag-import-text').value = reader.result;
  };
  reader.readAsText(file);
}

function importTags() {
  const raw = document.getElementById('tag-import-text').value;
  const status = document.getElementById('tag-import-status');
  let imported;
  try {
    imported = JSON.parse(raw);
  } catch {
    status.textContent = '✗ JSON 格式錯誤，請確認貼上的內容';
    status.className = 'text-xs text-center mt-3 text-red-500';
    return;
  }

  const mode = document.querySelector('input[name="tag-import-mode"]:checked').value;
  if (mode === 'overwrite') {
    tags = imported;
  } else {
    for (const [qId, tagList] of Object.entries(imported)) {
      const merged = new Set([...(tags[qId] || []), ...tagList]);
      tags[qId] = [...merged];
    }
  }
  saveTags();

  status.textContent = `✓ 已匯入，共套用 ${getAllTags().length} 個標籤於 ${Object.keys(tags).length} 題`;
  status.className = 'text-xs text-center mt-3 text-green-600';
  document.getElementById('tag-export-text').value = JSON.stringify(tags, null, 2);
  document.getElementById('tag-export-stats').textContent =
    `目前共 ${getAllTags().length} 個標籤，套用在 ${Object.keys(tags).length} 題上`;

  navigate(currentView);
}

// =====================================================================
// INIT
// =====================================================================
function init() {
  if (!window.QUESTIONS || window.QUESTIONS.length === 0) {
    document.getElementById('app-content').innerHTML = `
      <div class="max-w-md mx-auto mt-20 bg-white rounded-2xl p-8 shadow-sm border border-red-100 text-center">
        <div class="text-3xl mb-3">⚠️</div>
        <h2 class="font-bold text-gray-700 mb-2">題庫尚未產生</h2>
        <p class="text-sm text-gray-500 mb-4">請先執行以下指令產生題庫資料，再重新整理頁面：</p>
        <code class="block text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 text-left text-gray-700">
          python3 scripts/parse_csv.py
        </code>
      </div>`;
    return;
  }

  questions = window.QUESTIONS;
  loadMasteryThreshold();
  loadProgress();
  loadTags();

  const masteryInput = document.getElementById('mastery-threshold-input');
  if (masteryInput) masteryInput.value = MASTERY_THRESHOLD;

  const savedSize = parseInt(localStorage.getItem('ppa_font_size') ?? '1', 10);
  applyFontSize(isNaN(savedSize) ? 1 : savedSize);

  // Countdown
  updateCountdownUI();
  document.getElementById('sidebar-total').textContent = `題庫共 ${questions.length} 題`;

  if (localStorage.getItem('ppa_sidebar_collapsed') === '1') {
    document.getElementById('sidebar').classList.add('desktop-collapsed');
    document.getElementById('sidebar-collapse-icon').classList.add('hidden');
    document.getElementById('sidebar-expand-icon').classList.remove('hidden');
    document.getElementById('desktop-sidebar-toggle').title = '展開側欄';
  }

  setupBackToTopWatcher();
  navigate('dashboard');
}

window.addEventListener('DOMContentLoaded', init);
