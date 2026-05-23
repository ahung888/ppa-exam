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
let practiceFilters = { topic: 'all', type: 'all' };

let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswered = false;
let reviewUserAnswer = null;

let currentAIQuestion = null;

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
function loadProgress() {
  try {
    progress = JSON.parse(localStorage.getItem('ppa_progress') || '{}');
  } catch {
    progress = {};
  }
}

function saveProgress() {
  localStorage.setItem('ppa_progress', JSON.stringify(progress));
}

function updateQuestionStats(id, isCorrect) {
  const today = todayStr();
  const stat = progress[id] || { wrong_count: 0, correct_count: 0, interval_days: 1 };
  if (isCorrect) {
    stat.correct_count = (stat.correct_count || 0) + 1;
    stat.interval_days = Math.min((stat.interval_days || 1) * 2, 30);
  } else {
    stat.wrong_count = (stat.wrong_count || 0) + 1;
    stat.interval_days = 1;
  }
  stat.last_seen = today;
  stat.next_review = addDays(today, stat.interval_days);
  progress[id] = stat;
  saveProgress();
}

// =====================================================================
// MOBILE MENU
// =====================================================================
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

  if (chartInstance && view !== 'dashboard') {
    chartInstance.destroy();
    chartInstance = null;
  }

  ['dashboard', 'practice', 'review'].forEach(v => {
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

  const examDate = new Date('2026-08-22T00:00:00');
  const daysLeft = Math.max(0, Math.ceil((examDate - new Date()) / 86400000));

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
      <h2 class="text-xl font-bold text-gray-800 mb-5">單元刷題</h2>
      <div class="flex gap-3 mb-5">
        <select id="filter-topic" onchange="onPracticeFilterChange()"
          class="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">全部章節</option>
          ${topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
        </select>
        <select id="filter-type" onchange="onPracticeFilterChange()"
          class="w-28 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">全部題型</option>
          <option value="tf">是非題</option>
          <option value="mc">選擇題</option>
        </select>
      </div>
      <div id="practice-card"></div>
    </div>
  `;

  document.getElementById('filter-topic').value = practiceFilters.topic;
  document.getElementById('filter-type').value = practiceFilters.type;

  if (practiceQueue.length === 0) {
    initPracticeQueue();
  } else {
    renderPracticeCard();
  }
}

function onPracticeFilterChange() {
  practiceFilters.topic = document.getElementById('filter-topic').value;
  practiceFilters.type = document.getElementById('filter-type').value;
  initPracticeQueue();
}

function initPracticeQueue() {
  const filtered = questions.filter(q => {
    if (practiceFilters.topic !== 'all' && q.topic !== practiceFilters.topic) return false;
    if (practiceFilters.type !== 'all' && q.type !== practiceFilters.type) return false;
    return true;
  });
  practiceQueue = shuffle(filtered);
  practiceIndex = 0;
  practiceAnswered = false;
  practiceUserAnswer = null;
  renderPracticeCard();
}

function renderPracticeCard() {
  const card = document.getElementById('practice-card');
  if (!card) return;

  if (practiceQueue.length === 0) {
    card.innerHTML = emptyCard('沒有符合條件的題目');
    return;
  }
  if (practiceIndex >= practiceQueue.length) {
    card.innerHTML = completionCard(practiceQueue.length, 'initPracticeQueue()');
    return;
  }

  const q = practiceQueue[practiceIndex];
  card.innerHTML = renderQuestionCard(q, practiceIndex + 1, practiceQueue.length, practiceAnswered, practiceUserAnswer, false);
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
  const today = todayStr();
  const wrongQuestions = questions.filter(q => {
    const s = progress[q.id];
    return s && (s.wrong_count || 0) > 0;
  });

  wrongQuestions.sort((a, b) => {
    const sa = progress[a.id] || {};
    const sb = progress[b.id] || {};
    const aDue = (sa.next_review || today) <= today ? 0 : 1;
    const bDue = (sb.next_review || today) <= today ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    return (sa.next_review || '').localeCompare(sb.next_review || '');
  });

  const dueCount = wrongQuestions.filter(q => {
    const s = progress[q.id];
    return !s || !s.next_review || s.next_review <= today;
  }).length;

  reviewQueue = wrongQuestions;
  if (!reviewAnswered || reviewIndex >= reviewQueue.length) {
    reviewIndex = 0;
    reviewAnswered = false;
    reviewUserAnswer = null;
  }

  container.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-xl font-bold text-gray-800">錯題複習</h2>
        <span class="text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
          今日待複習：<strong>${dueCount}</strong> 題
        </span>
      </div>
      <div id="review-card"></div>
    </div>
  `;

  renderReviewCard();
}

function renderReviewCard() {
  const card = document.getElementById('review-card');
  if (!card) return;

  if (reviewQueue.length === 0) {
    card.innerHTML = emptyCard('目前沒有錯題 🎉', '繼續在刷題模式中練習吧');
    return;
  }
  if (reviewIndex >= reviewQueue.length) {
    card.innerHTML = completionCard(reviewQueue.length, 'navigate(\'review\')', '複習完成');
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

  const answerFn = isReview ? 'answerReview' : 'answerPractice';
  const nextFn = isReview ? 'nextReviewQuestion' : 'nextPracticeQuestion';
  const progressPct = Math.round(num / total * 100);

  let optionsHTML = '';
  if (!answered) {
    if (q.type === 'tf') {
      optionsHTML = `
        <div class="grid grid-cols-2 gap-3 mt-5">
          <button onclick="${answerFn}('O')"
            class="option-btn py-3.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-green-400 hover:bg-green-50 hover:text-green-700">
            ○ 正確
          </button>
          <button onclick="${answerFn}('X')"
            class="option-btn py-3.5 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-red-400 hover:bg-red-50 hover:text-red-700">
            ✗ 錯誤
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
  loadProgress();

  const savedSize = parseInt(localStorage.getItem('ppa_font_size') ?? '1', 10);
  applyFontSize(isNaN(savedSize) ? 1 : savedSize);

  // Countdown
  const examDate = new Date('2026-08-22T00:00:00');
  const daysLeft = Math.max(0, Math.ceil((examDate - new Date()) / 86400000));
  document.getElementById('countdown-text').textContent = `距考試還有 ${daysLeft} 天`;
  const mobileCountdown = document.getElementById('mobile-countdown');
  if (mobileCountdown) mobileCountdown.textContent = `剩 ${daysLeft} 天`;
  document.getElementById('sidebar-total').textContent = `題庫共 ${questions.length} 題`;

  navigate('dashboard');
}

window.addEventListener('DOMContentLoaded', init);
