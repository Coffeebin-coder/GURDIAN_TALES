'use strict';
const ASSET_VERSION = 48;
const $ = (s) => document.querySelector(s);

const scoreEl = $('#score');
const characterImage = $('#characterImage');
const buttonEl = $('#characterButton');
const authBtn = $('#authBtn');
const authDialog = $('#authDialog');
const motionDialog = $('#motionDialog');
const authError = $('#authError');
const motionError = $('#motionError');
const podiumRows = $('#podiumRows');
const motionNameEl = $('#motionName');
const toastEl = $('#unlockToast');
const floatLayer = $('#floatLayer');
const motionSelect = $('#motionSelect');
const motionHint = $('#motionSettingHint');
const soundToggle = $('#soundEnabled');
const loadingScreen = $('#loadingScreen');
const loadingBar = $('#loadingBar');
const loadingText = $('#loadingText');
const loadingCount = $('#loadingCount');
const loadingSkipBtn = $('#loadingSkipBtn');
const gameEl = $('.game');

const MOTIONS = [
  { threshold: 0, name: '기본 콕', image: '/assets/pressed-user.png' },
  { threshold: 1000, name: '반짝 미소 콕', image: '/assets/motions/1000.png' },
  { threshold: 10000, name: '무지개 콕', image: '/assets/motions/10000.png' },
  { threshold: 100000, name: '하트 분신 콕', image: '/assets/motions/100000.png' },
  { threshold: 1000000, name: '황금 오라 콕', image: '/assets/motions/1000000.png' },
  { threshold: 10000000, name: '강화 오라 콕', image: '/assets/motions/10000000.png' },
  { threshold: 100000000, name: '마법책 콕', image: '/assets/motions/100000000.png' },
  { threshold: 1000000000, name: '축제 피날레 콕', image: '/assets/motions/1000000000.png' }
];

let token = localStorage.getItem('eungae_token') || '';
let user = null;
let localScore = 0;
let pending = 0;
let flushTimer = null;
let settleTimer = null;
let lastRandom = -1;
let previousMotion = 0;
let gameReady = false;
let bootReleased = false;
let loadingSkipTimer = null;
let bootSafetyTimer = null;
let audioCtx = null;

let motionMode = localStorage.getItem('eungae_motion_mode') || 'random';
let selectedMotion = Number(localStorage.getItem('eungae_selected_motion') || 0);
let soundEnabled = (localStorage.getItem('eungae_sound_enabled') || '1') !== '0';

const format = (n) => new Intl.NumberFormat('ko-KR').format(Number(n) || 0);
const assetUrl = (path) => `${path}?v=${ASSET_VERSION}`;

function motionIndex(score) {
  let i = 0;
  MOTIONS.forEach((m, n) => { if (score >= m.threshold) i = n; });
  return i;
}
function unlocked() {
  return MOTIONS.map((m, index) => ({ ...m, index })).filter((m) => localScore >= m.threshold);
}
function normalize() {
  const max = motionIndex(localScore);
  if (!['random', 'single'].includes(motionMode)) motionMode = 'random';
  if (!Number.isInteger(selectedMotion) || selectedMotion < 0 || selectedMotion > max) selectedMotion = max;
}
function storePrefs() {
  localStorage.setItem('eungae_motion_mode', motionMode);
  localStorage.setItem('eungae_selected_motion', String(selectedMotion));
  localStorage.setItem('eungae_sound_enabled', soundEnabled ? '1' : '0');
}
function renderScore() {
  normalize();
  scoreEl.textContent = format(localScore);
  motionNameEl.textContent = motionMode === 'random'
    ? `랜덤 · ${unlocked().length}개 해금`
    : `고정 · ${MOTIONS[selectedMotion].name}`;
}
function escapeHtml(v) {
  return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function renderLeaderboard(items = []) {
  const medals = ['🥇', '🥈', '🥉'];
  podiumRows.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const x = items[i] || { username: '빈자리', clicks: 0 };
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.dataset.username = x.username === '빈자리' ? '' : x.username;
    row.dataset.clicks = String(x.clicks || 0);
    row.innerHTML = `<span class="rank-medal">${medals[i]}</span><span class="rank-name">${escapeHtml(x.username)}</span><span class="rank-score">${format(x.clicks)}</span>`;
    podiumRows.appendChild(row);
  }
}
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...options, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || '요청에 실패했습니다.');
  return d;
}
function updateAuth() {
  authBtn.textContent = user ? `${user.username} · 로그아웃` : '로그인';
}
function applyUser(u) {
  if (!u) return;
  motionMode = u.motionMode || motionMode;
  selectedMotion = Number.isInteger(u.selectedMotion) ? u.selectedMotion : selectedMotion;
  normalize();
  storePrefs();
}
async function restore() {
  if (!token) { renderScore(); return; }
  try {
    const d = await api('/api/me');
    user = d.user;
    localScore = user.clicks;
    applyUser(user);
    previousMotion = motionIndex(localScore);
  } catch {
    token = '';
    localStorage.removeItem('eungae_token');
  }
  updateAuth();
  renderScore();
}
async function auth(mode) {
  authError.textContent = '';
  try {
    const d = await api(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value })
    });
    token = d.token;
    user = d.user;
    localScore = user.clicks;
    applyUser(user);
    previousMotion = motionIndex(localScore);
    localStorage.setItem('eungae_token', token);
    updateAuth();
    renderScore();
    authDialog.close();
  } catch (e) {
    authError.textContent = e.message;
  }
}
function chooseMotion() {
  const list = unlocked();
  if (motionMode === 'single') return MOTIONS[selectedMotion] || list.at(-1) || MOTIONS[0];
  const specials = list.filter((m) => m.index > 0);
  const pool = specials.length ? specials : list;
  if (pool.length <= 1) return pool[0] || MOTIONS[0];
  let i = Math.floor(Math.random() * pool.length);
  if (i === lastRandom) i = (i + 1) % pool.length;
  lastRandom = i;
  return pool[i];
}
const imageCache = new Map();
function cachedAsset(path) {
  return imageCache.get(path) || assetUrl(path);
}
function setCharacter(path, altText) {
  const src = cachedAsset(path);
  if (characterImage.getAttribute('src') !== src) characterImage.setAttribute('src', src);
  characterImage.alt = altText;
  characterImage.classList.add('is-visible');
}
function showPressed() {
  const m = chooseMotion();
  setCharacter(m.image, `응애공주 ${m.name}`);
  buttonEl.classList.add('is-pressed');
}
function showIdle() {
  setCharacter('/assets/idle-user.png', '응애공주 기본 상태');
  buttonEl.classList.remove('is-pressed');
}
function stopClickAnimation() {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  showIdle();
}
function playClickFrame() {
  showPressed();
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    showIdle();
    settleTimer = null;
  }, 260);
}
function showFloat(e) {
  const r = buttonEl.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'float-score';
  el.textContent = '+1';
  el.style.left = `${e?.clientX ?? r.width / 2}px`;
  el.style.top = `${e?.clientY ?? r.height / 2}px`;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 800);
}
function checkUnlock() {
  const now = motionIndex(localScore);
  if (now > previousMotion) {
    selectedMotion = now;
    motionMode = 'single';
    storePrefs();
    if (user) {
      api('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify({ motionMode, selectedMotion })
      }).catch(() => {});
    }
    toastEl.innerHTML = `✨ ${MOTIONS[now].name}<br><small>새 모션 해금!</small>`;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  previousMotion = now;
}
function optimistic() {
  if (!user) return;
  const rows = [...document.querySelectorAll('.rank-row')]
    .map((r) => ({ username: r.dataset.username, clicks: Number(r.dataset.clicks) }))
    .filter((x) => x.username);
  const f = rows.find((x) => x.username === user.username);
  if (f) f.clicks = localScore; else rows.push({ username: user.username, clicks: localScore });
  rows.sort((a, b) => b.clicks - a.clicks);
  renderLeaderboard(rows.slice(0, 3));
}
async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!token || pending < 1) return;
  const amount = pending;
  pending = 0;
  try {
    const d = await api('/api/clicks', { method: 'POST', body: JSON.stringify({ amount }) });
    user = d.user;
    localScore = Math.max(localScore, user.clicks);
    applyUser(user);
    renderScore();
    renderLeaderboard(d.leaderboard);
  } catch (e) {
    pending += amount;
    console.error(e);
  }
}
function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}
async function playClickSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    return;
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(680, now);
  osc.frequency.exponentialRampToValueAtTime(430, now + 0.075);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.075, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}
function onClick(e) {
  if (!gameReady) return;
  if (!user) { authDialog.showModal(); return; }
  localScore++;
  pending++;
  void playClickSound();
  playClickFrame();
  renderScore();
  checkUnlock();
  showFloat(e);
  optimistic();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 170);
}
async function loadBoard() {
  try {
    const d = await api('/api/leaderboard');
    renderLeaderboard(d.leaderboard);
  } catch (e) {
    console.error(e);
  }
}
function events() {
  const es = new EventSource('/api/events');
  es.addEventListener('leaderboard', (e) => {
    try { renderLeaderboard(JSON.parse(e.data)); } catch {}
  });
  es.onerror = () => { es.close(); setTimeout(events, 4000); };
}
function populateSettings() {
  normalize();
  motionSelect.innerHTML = '';
  unlocked().forEach((m) => {
    const o = document.createElement('option');
    o.value = String(m.index);
    o.textContent = `${m.name} · ${format(m.threshold)} 클릭`;
    motionSelect.appendChild(o);
  });
  motionSelect.value = String(selectedMotion);
  const radio = document.querySelector(`input[name="motionMode"][value="${motionMode}"]`);
  if (radio) radio.checked = true;
  soundToggle.checked = soundEnabled;
  updateSettingsState();
}
function updateSettingsState() {
  const mode = document.querySelector('input[name="motionMode"]:checked')?.value || 'random';
  motionSelect.disabled = false;
  motionHint.textContent = mode === 'random'
    ? `해금된 ${unlocked().length}개 모션 중 하나가 매번 랜덤으로 나옵니다.`
    : '선택한 모션 하나만 계속 나옵니다.';
}
async function saveSettings() {
  motionError.textContent = '';
  motionMode = document.querySelector('input[name="motionMode"]:checked')?.value || 'random';
  selectedMotion = Number(motionSelect.value || 0);
  soundEnabled = !!soundToggle.checked;
  normalize();
  storePrefs();
  try {
    if (user) {
      const d = await api('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify({ motionMode, selectedMotion })
      });
      user = d.user;
      applyUser(user);
    }
    renderScore();
    motionDialog.close();
  } catch (e) {
    motionError.textContent = e.message;
  }
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`이미지 로드 시간 초과: ${url}`));
    }, 8000);
    img.onload = async () => {
      if (settled) return;
      try { if (typeof img.decode === 'function') await img.decode(); } catch {}
      settled = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`이미지 로드 실패: ${url}`));
    };
    img.decoding = 'async';
    img.src = url;
  });
}
function updateLoading(done, total, label) {
  const percent = Math.round((done / total) * 100);
  loadingBar.style.width = `${percent}%`;
  loadingCount.textContent = `${done} / ${total}`;
  loadingText.textContent = label || `이미지를 불러오고 있어요… ${percent}%`;
}
function releaseGame(failed, total) {
  if (bootReleased) return;
  bootReleased = true;
  clearTimeout(loadingSkipTimer);
  clearTimeout(bootSafetyTimer);
  loadingSkipBtn.classList.remove('is-visible');
  showIdle();
  gameReady = true;
  gameEl.classList.remove('is-loading');
  loadingBar.style.width = '100%';
  loadingCount.textContent = `${total} / ${total}`;
  loadingText.textContent = failed ? `일부 이미지 ${failed}개 확인 필요 · 게임은 시작됩니다.` : '준비 완료!';
  setTimeout(() => loadingScreen.classList.add('is-hidden'), failed ? 700 : 250);
}
function skipBoot() {
  releaseGame(0, 10);
}
async function bootGame() {
  const paths = ['/assets/field-background.png', '/assets/idle-user.png', ...MOTIONS.map((m) => m.image)];
  const total = paths.length;
  let done = 0;
  let failed = 0;
  updateLoading(0, total, '이미지를 불러오고 있어요…');
  loadingSkipTimer = setTimeout(() => loadingSkipBtn.classList.add('is-visible'), 3200);
  bootSafetyTimer = setTimeout(() => skipBoot(), 12000);

  await Promise.all(paths.map(async (path) => {
    try {
      const img = await loadImage(assetUrl(path));
      imageCache.set(path, img.src);
    } catch (e) {
      failed++;
      console.error(e);
    } finally {
      done++;
      updateLoading(done, total, `이미지를 준비하고 있어요… ${Math.round(done / total * 100)}%`);
    }
  }));

  releaseGame(failed, total);
}

authBtn.addEventListener('click', async () => {
  if (user) {
    await flush();
    token = '';
    user = null;
    localScore = 0;
    localStorage.removeItem('eungae_token');
    updateAuth();
    renderScore();
  } else {
    authDialog.showModal();
  }
});
$('#motionSettingsBtn').addEventListener('click', () => { populateSettings(); motionDialog.showModal(); });
document.querySelectorAll('input[name="motionMode"]').forEach((x) => x.addEventListener('change', updateSettingsState));
motionSelect.addEventListener('change', () => {
  const single = document.querySelector('input[name="motionMode"][value="single"]');
  if (single) single.checked = true;
  updateSettingsState();
});
$('#saveMotionBtn').addEventListener('click', saveSettings);
$('#loginBtn').addEventListener('click', () => auth('login'));
$('#registerBtn').addEventListener('click', () => auth('register'));
loadingSkipBtn?.addEventListener('click', skipBoot);
buttonEl.addEventListener('pointerdown', (e) => { e.preventDefault(); onClick(e); });
window.addEventListener('blur', stopClickAnimation);
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && !authDialog.open && !motionDialog.open) {
    e.preventDefault();
    onClick();
  }
});

renderLeaderboard();
renderScore();
updateAuth();
Promise.allSettled([restore(), loadBoard()]).finally(() => bootGame());
events();
