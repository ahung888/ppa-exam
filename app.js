// =====================================================================
// STATE
// =====================================================================
let questions = [];
let progress = {};
let chartInstance = null;

let practiceQueue = [];
let practiceIndex = 0;
let practiceAnswered = false;
let practiceUserAnswer = null;
let practiceFilters = { topic: 'all', type: 'all', order: 'random' };

let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswered = false;
let reviewUserAnswer = null;
let reviewFilters = { topics: [], order: 'srs' };

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

function updateQuestionStats(id, isCorrect) {
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
  closeMobileMenu();

  if (typeof gtag !== 'undefined') {
    gtag('event', 'section_view', { section: view });
  }

  if (chartInstance && view !== 'dashboard') {
    chartInstance.destroy();
    chartInstance = null;
  }

  ['dashboard', 'practice', 'review', 'reading', 'category', 'author'].forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (!btn) return;
    btn.classList.toggle('bg-blue-50', v === view);
    btn.classList.toggle('text-blue-700', v === view);
    btn.classList.toggle('font-semibold', v === view);
    btn.classList.toggle('text-gray-600', v !== view);
  });

  const content = document.getElementById('app-content');
  if (view === 'dashboard') renderDashboard(content);
  else if (view === 'practice') renderPractice(content);
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
      <input type="text" id="reading-search" oninput="onReadingSearch()" placeholder="搜尋題目關鍵字..."
        class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
      <div id="reading-count" class="text-xs text-gray-400 px-1"></div>
      <div id="reading-list" class="space-y-4"></div>
    </div>
  `;
  renderReadingList(questions);
}

function onReadingSearch() {
  const term = document.getElementById('reading-search').value.trim();
  const filtered = term ? questions.filter(q => q.question.includes(term)) : questions;
  renderReadingList(filtered, term);
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
    </div>`;
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
        <button id="category-toggle-all" onclick="toggleAllCategoryRows()"
          class="shrink-0 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-100 whitespace-nowrap">
          全部展開
        </button>
      </div>
      <div id="category-list" class="space-y-2"></div>
    </div>
  `;

  document.getElementById('category-select').value = categoryActiveIndex;
  renderCategoryQuestionList();
}

function onCategorySelectChange() {
  categoryActiveIndex = Number(document.getElementById('category-select').value);
  renderCategoryQuestionList();
}

function renderCategoryQuestionList() {
  const list = categoryActiveIndex === -1
    ? questions
    : questions.filter(q => q.topic === categoryTopics[categoryActiveIndex]);

  document.getElementById('category-list').innerHTML =
    list.map(q => renderCategoryRow(q, questions.indexOf(q) + 1)).join('');
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
function renderDashboard(container) {
  const total = questions.length;
  const seenIds = Object.keys(progress).filter(id => progress[id].last_seen);
  const seen = seenIds.length;

  let totalCorrect = 0, totalAttempts = 0;
  for (const id in progress) {
    const s = progress[id];
    totalCorrect += s.correct_count || 0;
    totalAttempts += (s.correct_count || 0) + (s.wrong_count || 0);
  }

  const coverage = total > 0 ? Math.round(seen / total * 100) : 0;
  const accuracy = totalAttempts > 0 ? Math.round(totalCorrect / totalAttempts * 100) : 0;

  const daysLeft = getDaysLeft();

  const accColor = accuracy >= 80 ? 'text-green-600' : accuracy >= 60 ? 'text-yellow-500' : 'text-red-500';

  container.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold text-gray-800">數據看板</h2>
        <span class="text-sm text-gray-500">距考試還有 <strong class="text-red-500">${daysLeft}</strong> 天</span>
      </div>
      <div class="grid grid-cols-2 gap-3 md:gap-4 mb-5 md:mb-6">
        <div class="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
          <div class="text-xs text-gray-400 mb-1 uppercase tracking-wide">全題庫覆蓋率</div>
          <div class="text-3xl md:text-5xl font-bold text-blue-600">${coverage}<span class="text-lg md:text-2xl">%</span></div>
          <div class="text-xs text-gray-400 mt-1.5">${seen} / ${total} 題</div>
          <div class="mt-2 h-1.5 bg-gray-100 rounded-full"><div class="h-1.5 bg-blue-400 rounded-full" style="width:${coverage}%"></div></div>
        </div>
        <div class="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100">
          <div class="text-xs text-gray-400 mb-1 uppercase tracking-wide">整體正確率</div>
          <div class="text-3xl md:text-5xl font-bold ${accColor}">${accuracy}<span class="text-lg md:text-2xl">%</span></div>
          <div class="text-xs text-gray-400 mt-1.5">${totalCorrect} / ${totalAttempts} 次</div>
          <div class="mt-2 h-1.5 bg-gray-100 rounded-full"><div class="h-1.5 ${accuracy >= 80 ? 'bg-green-400' : accuracy >= 60 ? 'bg-yellow-400' : 'bg-red-400'} rounded-full" style="width:${accuracy}%"></div></div>
        </div>
      </div>
      <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 class="text-sm font-semibold text-gray-700 mb-4">各章節正確率</h3>
        <div style="height:340px"><canvas id="topic-chart"></canvas></div>
      </div>
    </div>
  `;

  renderTopicChart();
}

function renderTopicChart() {
  const topicMap = {};
  for (const q of questions) {
    if (!topicMap[q.topic]) topicMap[q.topic] = { correct: 0, total: 0 };
  }
  for (const id in progress) {
    const s = progress[id];
    const q = questions.find(x => x.id === id);
    if (!q || !topicMap[q.topic]) continue;
    topicMap[q.topic].correct += s.correct_count || 0;
    topicMap[q.topic].total += (s.correct_count || 0) + (s.wrong_count || 0);
  }

  const topics = Object.keys(topicMap);
  const shortLabels = topics.map(t => t.length > 14 ? t.slice(0, 14) + '…' : t);
  const data = topics.map(t => {
    const s = topicMap[t];
    return s.total > 0 ? Math.round(s.correct / s.total * 100) : 0;
  });

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(document.getElementById('topic-chart'), {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets: [{
        data,
        backgroundColor: data.map(v => v >= 80 ? '#22c55e80' : v >= 60 ? '#eab30880' : '#ef444480'),
        borderColor: data.map(v => v >= 80 ? '#22c55e' : v >= 60 ? '#eab308' : '#ef4444'),
        borderWidth: 1.5,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => topics[items[0].dataIndex],
            label: item => `正確率: ${item.raw}%`
          }
        }
      },
      scales: {
        x: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: '#f3f4f6' } },
        y: { ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =====================================================================
// PRACTICE MODE
// =====================================================================
function renderPractice(container) {
  const topics = [...new Set(questions.map(q => q.topic))].sort();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <h2 class="text-xl font-bold text-gray-800 mb-4">單元刷題</h2>
      <div class="flex items-center gap-2 mb-5 flex-wrap">
        <select id="filter-topic" onchange="onPracticeFilterChange()"
          class="flex-1 min-w-[80px] px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">全部章節</option>
          ${topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
        </select>
        <select id="filter-type" onchange="onPracticeFilterChange()"
          class="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">全部題型</option>
          <option value="tf">是非題</option>
          <option value="mc">選擇題</option>
        </select>
        <div class="flex shrink-0">
          <button id="pill-normal" onclick="setPracticeOrder('normal')"
            class="px-3 py-2 border border-gray-200 rounded-l-xl text-sm leading-none">正常</button>
          <button id="pill-unanswered" onclick="setPracticeOrder('unanswered')"
            class="px-3 py-2 border-t border-b border-r border-gray-200 text-sm leading-none">未答</button>
          <button id="pill-random" onclick="setPracticeOrder('random')"
            class="px-3 py-2 border-t border-b border-r border-gray-200 rounded-r-xl text-sm leading-none">隨機</button>
        </div>
        <button onclick="initPracticeQueue()" title="重新出題"
          class="shrink-0 w-9 h-9 flex items-center justify-center border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-100">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </button>
      </div>
      <div id="practice-card"></div>
    </div>
  `;

  document.getElementById('filter-topic').value = practiceFilters.topic;
  document.getElementById('filter-type').value = practiceFilters.type;
  updatePracticePills();

  if (practiceQueue.length === 0) {
    initPracticeQueue();
  } else {
    renderPracticeCard();
  }
}

function onPracticeFilterChange() {
  practiceFilters.topic = document.getElementById('filter-topic').value;
  practiceFilters.type  = document.getElementById('filter-type').value;
  initPracticeQueue();
}

function setPracticeOrder(order) {
  practiceFilters.order = order;
  updatePracticePills();
  initPracticeQueue();
}

function updatePracticePills() {
  ['normal', 'unanswered', 'random'].forEach(o => {
    const btn = document.getElementById(`pill-${o}`);
    if (!btn) return;
    const active = practiceFilters.order === o;
    btn.classList.toggle('bg-blue-50',    active);
    btn.classList.toggle('text-blue-700', active);
    btn.classList.toggle('border-blue-500', active);
    btn.classList.toggle('text-gray-600', !active);
    btn.classList.toggle('font-medium',   active);
  });
}

function initPracticeQueue() {
  practiceFilters.topic = document.getElementById('filter-topic')?.value ?? practiceFilters.topic;
  practiceFilters.type  = document.getElementById('filter-type')?.value  ?? practiceFilters.type;

  let filtered = questions.filter(q => {
    if (practiceFilters.topic !== 'all' && q.topic !== practiceFilters.topic) return false;
    if (practiceFilters.type !== 'all' && q.type !== practiceFilters.type) return false;
    return true;
  });

  if (practiceFilters.order === 'unanswered') {
    filtered = filtered.filter(q => {
      const s = progress[q.id];
      return !s || ((s.correct_count || 0) + (s.wrong_count || 0)) === 0;
    });
  }

  practiceQueue = practiceFilters.order === 'random' ? shuffle(filtered) : [...filtered];
  practiceIndex = 0;
  practiceAnswered = false;
  practiceUserAnswer = null;
  renderPracticeCard();
}

function renderPracticeCard() {
  const card = document.getElementById('practice-card');
  if (!card) return;

  if (practiceQueue.length === 0) {
    if (practiceFilters.order === 'unanswered') {
      card.innerHTML = practiceUnansweredCompletionCard();
    } else {
      card.innerHTML = emptyCard('沒有符合條件的題目');
    }
    return;
  }
  if (practiceIndex >= practiceQueue.length) {
    if (practiceFilters.order === 'unanswered') {
      card.innerHTML = practiceUnansweredCompletionCard();
    } else {
      card.innerHTML = completionCard(practiceQueue.length, 'initPracticeQueue()');
    }
    return;
  }

  const q = practiceQueue[practiceIndex];
  card.innerHTML = renderQuestionCard(q, practiceIndex + 1, practiceQueue.length, practiceAnswered, practiceUserAnswer, false);
}

function practiceUnansweredCompletionCard() {
  const scopeFiltered = questions.filter(q => {
    if (practiceFilters.topic !== 'all' && q.topic !== practiceFilters.topic) return false;
    if (practiceFilters.type !== 'all' && q.type !== practiceFilters.type) return false;
    return true;
  });
  const total = scopeFiltered.length;
  const answered = scopeFiltered.filter(q => {
    const s = progress[q.id];
    return s && ((s.correct_count || 0) + (s.wrong_count || 0)) > 0;
  }).length;
  const pct = total > 0 ? Math.round(answered / total * 100) : 0;
  return `
    <div class="bg-white rounded-2xl p-10 text-center shadow-sm border border-gray-100">
      <div class="text-2xl mb-2">✓</div>
      <div class="font-semibold text-gray-700 mb-1">未答過題已全部作答完畢！</div>
      <div class="text-sm text-gray-500 mb-3">已答題進度：${answered} / ${total} 題</div>
      <div class="w-full bg-gray-100 rounded-full h-2 mb-2">
        <div class="bg-blue-500 h-2 rounded-full" style="width:${pct}%"></div>
      </div>
      <div class="text-2xl font-bold text-blue-600 mb-6">${pct}%</div>
      <button onclick="initPracticeQueue()"
        class="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
        重新出題
      </button>
    </div>`;
}

function answerPractice(answer) {
  if (practiceAnswered) return;
  const q = practiceQueue[practiceIndex];
  const isCorrect = answer === q.answer;
  updateQuestionStats(q.id, isCorrect);
  practiceAnswered = true;
  practiceUserAnswer = answer;
  renderPracticeCard();
}

function nextPracticeQuestion() {
  practiceIndex++;
  practiceAnswered = false;
  practiceUserAnswer = null;
  renderPracticeCard();
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
function renderQuestionCard(q, num, total, answered, userAnswer, isReview) {
  const s = progress[q.id] || {};
  const typeLabel = q.type === 'tf' ? '是非題' : '選擇題';
  const wrongBadge = (s.wrong_count || 0) > 0
    ? `<span class="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">錯 ${s.wrong_count} 次</span>`
    : '';
  const masteryBadge = isReview && (s.consecutive_correct || 0) >= MASTERY_THRESHOLD
    ? `<span class="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">★ 已熟練</span>`
    : '';

  const answerFn = isReview ? 'answerReview' : 'answerPractice';
  const nextFn = isReview ? 'nextReviewQuestion' : 'nextPracticeQuestion';
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
          ${['O', 'X'].map(val => {
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
