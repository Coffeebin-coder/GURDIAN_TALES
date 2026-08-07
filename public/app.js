"use strict";
const ASSET_VERSION = 62;
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
const titleSelect = $('#titleSelect');
const titleHint = $('#titleSettingHint');
const soundToggle = $('#soundEnabled');
const loadingScreen = $('#loadingScreen');
const loadingBar = $('#loadingBar');
const loadingText = $('#loadingText');
const loadingCount = $('#loadingCount');
const loadingSkipBtn = $('#loadingSkipBtn');
const gameEl = $('.game');
const shopBtn = $('#shopBtn');
const shopDialog = $('#shopDialog');
const shopWallet = $('#shopWallet');
const shopError = $('#shopError');
const helperShopGrid = $('#helperShopGrid');
const backgroundShopGrid = $('#backgroundShopGrid');
const myTitleEl = $('#myTitle');
const helperIncomeEl = $('#helperIncome');
const helperLayer = $('#helperLayer');

const IDLE_SRC = `/assets/idle-user.png?v=${ASSET_VERSION}`;
const PRESSED_SRC = `/assets/pressed-user.png?v=${ASSET_VERSION}`;
const MOTIONS = [
  { index: 0, threshold: 0, label: '기본', src: PRESSED_SRC },
  { index: 1, threshold: 1000, label: '1,000 클릭', src: `/assets/motion-1000.png?v=${ASSET_VERSION}` },
  { index: 2, threshold: 10000, label: '10,000 클릭', src: `/assets/motion-10000.png?v=${ASSET_VERSION}` },
  { index: 3, threshold: 100000, label: '100,000 클릭', src: `/assets/motion-100000.png?v=${ASSET_VERSION}` },
  { index: 4, threshold: 1000000, label: '1,000,000 클릭', src: `/assets/motion-1000000.png?v=${ASSET_VERSION}` },
  { index: 5, threshold: 10000000, label: '10,000,000 클릭', src: `/assets/motion-10000000.png?v=${ASSET_VERSION}` },
  { index: 6, threshold: 100000000, label: '100,000,000 클릭', src: `/assets/motion-100000000.png?v=${ASSET_VERSION}` },
  { index: 7, threshold: 1000000000, label: '1,000,000,000 클릭', src: `/assets/motion-1000000000.png?v=${ASSET_VERSION}` }
];
const TITLE_TIERS = [
  [0, '응애 궁전의 새싹'],
  [1000, '캔터베리의 꼬마 시종'],
  [5000, '작은 공주님의 산책 메이트'],
  [10000, '공주님 친위 클릭병'],
  [50000, '캔터베리 기사 견습'],
  [100000, '로레인 정원의 수호자'],
  [500000, '공주님 전속 가디언'],
  [1000000, '가디언 테일즈 원정대원'],
  [10000000, '캔터베리 왕실 수호자'],
  [100000000, '어린 공주님이 인정한 영웅'],
  [1000000000, '응애공주의 전설 가디언']
];
const HELPERS = [
  { id: 1, name: '해바라기 응애', price: 5000, cps: 1, src: `/assets/helper-1.gif?v=${ASSET_VERSION}` },
  { id: 2, name: '울먹 응애공주', price: 12000, cps: 2, src: `/assets/helper-2.gif?v=${ASSET_VERSION}` },
  { id: 3, name: '꼬마 공주 미니', price: 25000, cps: 4, src: `/assets/helper-3.gif?v=${ASSET_VERSION}` }
];
const BACKGROUNDS = [
  { id: 'default', name: '하늘꽃 초원', price: 0, src: `/assets/bg-day.png?v=${ASSET_VERSION}`, desc: '푸른 하늘이 크게 보이고 공주님이 꽃밭에 서 있는 듯한 도트 배경' },
  { id: 'sunset', name: '노을빛 초원', price: 15000, src: `/assets/bg-sunset.png?v=${ASSET_VERSION}`, desc: '노을빛이 수평선 너머에서 비치는 도트 꽃밭' },
  { id: 'night', name: '별빛 밤초원', price: 30000, src: `/assets/bg-night.png?v=${ASSET_VERSION}`, desc: '달과 별, 반딧불이 반짝이는 도트 밤꽃밭' }
];

let token = localStorage.getItem('eungae_token') || '';
let user = null;
let localScore = 0;
let pending = 0;
let flushTimer = null;
let settleTimer = null;
let previousMotion = 0;
let gameReady = false;
let bootReleased = false;
let loadingSkipTimer = null;
let bootSafetyTimer = null;
let audioCtx = null;
let randomBag = [];
let lastRandom = -1;
const loadedSources = new Set();
let motionMode = localStorage.getItem('eungae_motion_mode') || 'random';
let selectedMotion = Number(localStorage.getItem('eungae_selected_motion') || 0);
let selectedTitle = localStorage.getItem('eungae_selected_title') || '';
let soundEnabled = (localStorage.getItem('eungae_sound_enabled') || '1') !== '0';
let helperTickTimer = null;
let syncTimer = null;

const format = (n) => new Intl.NumberFormat('ko-KR').format(Number(n) || 0);

function titleForClicks(clicks) {
  let title = TITLE_TIERS[0][1];
  for (const [threshold, label] of TITLE_TIERS) if (Number(clicks) >= threshold) title = label;
  return title;
}
function unlockedTitlesFromClicks(clicks) {
  return TITLE_TIERS.filter(([threshold]) => Number(clicks) >= threshold).map(([, label]) => label);
}
function helperById(id) { return HELPERS.find((x) => x.id === Number(id)); }
function helperIncome(ids = []) {
  return (ids || []).map(Number).map((id) => helperById(id)?.cps || 0).reduce((sum, x) => sum + x, 0);
}
function activeTitle() {
  const unlockedTitles = user?.availableTitles || unlockedTitlesFromClicks(localScore);
  if (selectedTitle && unlockedTitles.includes(selectedTitle)) return selectedTitle;
  return user?.title || titleForClicks(localScore);
}
function motionIndex(score) {
  let i = 0;
  for (let n = 0; n < MOTIONS.length; n++) if (score >= MOTIONS[n].threshold) i = n;
  return i;
}
function unlocked() { return MOTIONS.filter((m) => localScore >= m.threshold); }
function normalize() {
  const max = motionIndex(localScore);
  if (!['random', 'single'].includes(motionMode)) motionMode = 'random';
  if (!Number.isInteger(selectedMotion) || selectedMotion < 0 || selectedMotion > max) selectedMotion = max;
  const availableTitles = user?.availableTitles || unlockedTitlesFromClicks(localScore);
  if (!availableTitles.includes(selectedTitle)) selectedTitle = availableTitles[availableTitles.length - 1] || TITLE_TIERS[0][1];
}
function storePrefs() {
  localStorage.setItem('eungae_motion_mode', motionMode);
  localStorage.setItem('eungae_selected_motion', String(selectedMotion));
  localStorage.setItem('eungae_selected_title', selectedTitle || '');
  localStorage.setItem('eungae_sound_enabled', soundEnabled ? '1' : '0');
}
function renderScore() {
  normalize();
  scoreEl.textContent = format(localScore);
  motionNameEl.textContent = motionMode === 'random'
    ? `랜덤 · ${unlocked().length}개 사용 중`
    : `고정 · ${MOTIONS[selectedMotion]?.label || '기본'}`;
  myTitleEl.textContent = activeTitle();
  const cps = helperIncome(user?.ownedHelpers || []);
  helperIncomeEl.textContent = cps > 0 ? `도우미 +${format(cps)}/초` : '도우미 없음';
}
function escapeHtml(v) {
  return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function renderLeaderboard(items = []) {
  const medals = ['🥇', '🥈', '🥉'];
  podiumRows.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const x = items[i] || { username: '빈자리', clicks: 0, title: '' };
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.dataset.username = x.username === '빈자리' ? '' : x.username;
    row.dataset.clicks = String(x.clicks || 0);
    row.dataset.title = x.title || '';
    const title = x.username === '빈자리' ? '' : (x.title || titleForClicks(x.clicks));
    row.innerHTML = `<span class="rank-medal">${medals[i]}</span><span class="rank-person"><span class="rank-name">${escapeHtml(x.username)}</span>${title ? `<small class="rank-title">${escapeHtml(title)}</small>` : ''}</span><span class="rank-score">${format(x.clicks)}</span>`;
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
function updateAuth() { authBtn.textContent = user ? `${user.username} · 로그아웃` : '로그인'; }
function applyBackground() {
  const id = user?.activeBackground || 'default';
  const bg = BACKGROUNDS.find((x) => x.id === id) || BACKGROUNDS[0];
  gameEl.classList.remove('bg-default', 'bg-sunset', 'bg-night');
  gameEl.classList.add(`bg-${bg.id}`);
  gameEl.style.backgroundImage = `url('${bg.src}')`;
}
function renderHelpers() {
  if (!helperLayer) return;
  const owned = (user?.ownedHelpers || []).map(Number);
  if (!owned.length) {
    helperLayer.innerHTML = '';
    helperLayer.classList.add('is-hidden');
    return;
  }
  helperLayer.classList.remove('is-hidden');
  const spots = ['helper-pos-1', 'helper-pos-2', 'helper-pos-3', 'helper-pos-4'];
  helperLayer.innerHTML = owned.map((id, idx) => {
    const item = helperById(id);
    if (!item) return '';
    return `<div class="helper-buddy ${spots[idx % spots.length]}" data-helper-id="${item.id}"><img src="${item.src}" alt="${escapeHtml(item.name)}" draggable="false"><span>+${item.cps}/초</span></div>`;
  }).join('');
}
function applyUser(u) {
  if (!u) return;
  user = u;
  motionMode = u.motionMode || motionMode;
  selectedMotion = Number.isInteger(u.selectedMotion) ? u.selectedMotion : selectedMotion;
  selectedTitle = u.selectedTitle || selectedTitle || u.title || titleForClicks(u.clicks);
  localScore = Number(u.clicks || localScore || 0);
  normalize();
  storePrefs();
  applyBackground();
  renderHelpers();
  renderScore();
  restartHelperTimers();
}
async function restore() {
  if (!token) { renderScore(); return; }
  try {
    const d = await api('/api/me');
    user = d.user;
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
    localStorage.setItem('eungae_token', token);
    applyUser(d.user);
    previousMotion = motionIndex(localScore);
    updateAuth();
    renderScore();
    authDialog.close();
    await loadBoard();
  } catch (e) { authError.textContent = e.message; }
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function chooseMotion() {
  const allUnlocked = unlocked();
  const loadedUnlocked = allUnlocked.filter((m) => loadedSources.has(m.src));
  const candidates = loadedUnlocked.length ? loadedUnlocked : allUnlocked;

  if (motionMode === 'single') {
    const fixed = MOTIONS[selectedMotion];
    return fixed && candidates.some((m) => m.index === fixed.index)
      ? fixed
      : candidates[candidates.length - 1] || MOTIONS[0];
  }

  const valid = candidates.map((m) => m.index);
  randomBag = randomBag.filter((i) => valid.includes(i));
  if (!randomBag.length) {
    randomBag = shuffle(valid);
    if (randomBag.length > 1 && randomBag[0] === lastRandom) {
      const swapWith = randomBag.findIndex((i) => i !== lastRandom);
      if (swapWith > 0) [randomBag[0], randomBag[swapWith]] = [randomBag[swapWith], randomBag[0]];
    }
  }
  if (randomBag.length > 1 && randomBag[0] === lastRandom) {
    const swapWith = randomBag.findIndex((i) => i !== lastRandom);
    if (swapWith > 0) [randomBag[0], randomBag[swapWith]] = [randomBag[swapWith], randomBag[0]];
  }

  const idx = randomBag.shift();
  const selected = MOTIONS.find((m) => m.index === idx) || candidates[0] || MOTIONS[0];
  lastRandom = selected.index;
  return selected;
}
function forceImageSwap(src, alt) {
  characterImage.alt = alt;
  characterImage.setAttribute('src', src);
}
function showPressed() {
  const m = chooseMotion();
  forceImageSwap(m.src, m.label);
  buttonEl.classList.add('is-pressed');
  motionNameEl.textContent = m.index > 0 ? `이번 모션 · ${m.label}` : '이번 모션 · 기본';
}
function showIdle() {
  forceImageSwap(IDLE_SRC, '응애공주 기본 상태');
  buttonEl.classList.remove('is-pressed');
  renderScore();
}
function stopClickAnimation() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  showIdle();
}
function playClickFrame() {
  showPressed();
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { showIdle(); settleTimer = null; }, 320);
}
function showFloat(e, amount = 1, className = '') {
  const rect = buttonEl.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = `float-score ${className}`.trim();
  el.textContent = `+${amount}`;
  el.style.left = `${e?.clientX ?? rect.left + rect.width / 2}px`;
  el.style.top = `${e?.clientY ?? rect.top + rect.height / 2}px`;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 800);
}
function showHelperFloat(amount) {
  const buddies = [...document.querySelectorAll('.helper-buddy')];
  if (!buddies.length) return;
  buddies.forEach((buddy, idx) => {
    const rect = buddy.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'float-score helper-float';
    el.textContent = idx === 0 ? `+${amount}` : '✨';
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top + 10}px`;
    floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 700);
  });
}
function checkUnlock() {
  const now = motionIndex(localScore);
  if (now !== previousMotion) randomBag = [];
  if (now > previousMotion) {
    selectedMotion = now;
    storePrefs();
    if (user) api('/api/preferences', { method: 'PUT', body: JSON.stringify({ motionMode, selectedMotion, selectedTitle }) }).catch(() => {});
    toastEl.innerHTML = `✨ ${MOTIONS[now].label}<br><small>새 이미지 해금!</small>`;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  previousMotion = now;
}
function optimistic() {
  if (!user) return;
  const rows = [...document.querySelectorAll('.rank-row')]
    .map((r) => ({ username: r.dataset.username, clicks: Number(r.dataset.clicks), title: r.dataset.title }))
    .filter((x) => x.username);
  const f = rows.find((x) => x.username === user.username);
  const current = { username: user.username, clicks: localScore, title: activeTitle() };
  if (f) Object.assign(f, current); else rows.push(current);
  rows.sort((a, b) => b.clicks - a.clicks);
  renderLeaderboard(rows.slice(0, 3));
}
async function flush() {
  clearTimeout(flushTimer); flushTimer = null;
  if (!token || pending < 1) return;
  const amount = pending; pending = 0;
  try {
    const d = await api('/api/clicks', { method: 'POST', body: JSON.stringify({ amount }) });
    applyUser(d.user);
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
  try { if (ctx.state !== 'running') await ctx.resume(); } catch { return; }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(680, now);
  osc.frequency.exponentialRampToValueAtTime(430, now + 0.075);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.075, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 0.15);
}
function onClick(e) {
  if (!gameReady) return;
  if (!user) { authDialog.showModal(); return; }
  localScore += 1;
  pending += 1;
  void playClickSound();
  playClickFrame();
  renderScore();
  checkUnlock();
  showFloat(e, 1);
  optimistic();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 180);
}
async function loadBoard() {
  try {
    const d = await api('/api/leaderboard');
    renderLeaderboard(d.leaderboard);
  } catch (e) { console.error(e); }
}
function events() {
  const es = new EventSource('/api/events');
  es.addEventListener('leaderboard', (e) => { try { renderLeaderboard(JSON.parse(e.data)); } catch {} });
  es.onerror = () => { es.close(); setTimeout(events, 4000); };
}
function populateSettings() {
  normalize();
  motionSelect.innerHTML = '';
  unlocked().forEach((m) => {
    const o = document.createElement('option');
    o.value = String(m.index);
    o.textContent = m.label;
    motionSelect.appendChild(o);
  });
  motionSelect.value = String(selectedMotion);
  titleSelect.innerHTML = '';
  const titles = user?.availableTitles || unlockedTitlesFromClicks(localScore);
  titles.forEach((title) => {
    const o = document.createElement('option');
    o.value = title;
    o.textContent = title;
    titleSelect.appendChild(o);
  });
  titleSelect.value = selectedTitle;
  const radio = document.querySelector(`input[name="motionMode"][value="${motionMode}"]`);
  if (radio) radio.checked = true;
  soundToggle.checked = soundEnabled;
  updateSettingsState();
}
function updateSettingsState() {
  const mode = document.querySelector('input[name="motionMode"]:checked')?.value || 'random';
  motionHint.textContent = mode === 'random'
    ? `현재 해금된 ${unlocked().length}개 이미지를 한 바퀴씩 섞어서, 같은 이미지가 연속으로 최대한 덜 나오게 합니다.`
    : '선택한 이미지 하나만 계속 표시합니다.';
  titleHint.textContent = `${(user?.availableTitles || unlockedTitlesFromClicks(localScore)).length}개의 칭호가 해금되어 있어요.`;
}
async function saveSettings() {
  motionError.textContent = '';
  motionMode = document.querySelector('input[name="motionMode"]:checked')?.value || 'random';
  selectedMotion = Number(motionSelect.value || 0);
  selectedTitle = titleSelect.value || titleForClicks(localScore);
  soundEnabled = !!soundToggle.checked;
  normalize(); randomBag = []; storePrefs();
  try {
    if (user) {
      const d = await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ motionMode, selectedMotion, selectedTitle }) });
      applyUser(d.user);
    }
    renderScore();
    motionDialog.close();
  } catch (e) { motionError.textContent = e.message; }
}
function shopButtonHtml(kind, id, price, owned, equipped) {
  if (kind === 'helper') {
    if (owned) return `<button type="button" class="shop-item-btn equipped" disabled>활동 중</button>`;
    return `<button type="button" class="shop-item-btn buy" data-action="buy" data-type="helper" data-id="${id}">${format(price)} 클릭</button>`;
  }
  if (equipped) return `<button type="button" class="shop-item-btn equipped" disabled>적용 중</button>`;
  if (owned) return `<button type="button" class="shop-item-btn" data-action="equip" data-type="background" data-id="${id}">적용하기</button>`;
  return `<button type="button" class="shop-item-btn buy" data-action="buy" data-type="background" data-id="${id}">${format(price)} 클릭</button>`;
}
function renderShop() {
  if (!user || !helperShopGrid || !backgroundShopGrid) return;
  shopWallet.textContent = format(user.spendableClicks || 0);
  const ownedHelpers = new Set((user.ownedHelpers || []).map(Number));
  helperShopGrid.innerHTML = HELPERS.map((item) => {
    const owned = ownedHelpers.has(item.id);
    return `<article class="shop-item ${owned ? 'is-equipped' : ''}">
      <div class="helper-thumb"><img src="${item.src}" alt="${escapeHtml(item.name)}"></div>
      <strong>${escapeHtml(item.name)}</strong>
      <small>초당 +${item.cps} 클릭 자동 획득</small>
      ${shopButtonHtml('helper', item.id, item.price, owned, owned)}
    </article>`;
  }).join('');

  const ownedBackgrounds = new Set(user.ownedBackgrounds || ['default']);
  backgroundShopGrid.innerHTML = BACKGROUNDS.map((item) => {
    const owned = item.id === 'default' || ownedBackgrounds.has(item.id);
    const equipped = (user.activeBackground || 'default') === item.id;
    return `<article class="shop-item background-item ${equipped ? 'is-equipped' : ''}">
      <div class="background-preview" style="background-image:url('${item.src}')"></div>
      <strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml(item.desc)}</small>
      ${shopButtonHtml('background', item.id, item.price, owned, equipped)}
    </article>`;
  }).join('');
}
async function shopAction(action, type, id) {
  shopError.textContent = '';
  try {
    const path = action === 'buy' ? '/api/shop/purchase' : '/api/shop/equip';
    const d = await api(path, { method: 'POST', body: JSON.stringify({ type, id }) });
    applyUser(d.user);
    renderShop();
    if (type === 'helper') {
      toastEl.innerHTML = '🤝 새 도우미가 합류했어요!';
    } else {
      toastEl.innerHTML = action === 'buy' ? '🌄 새 배경을 구매했어요!' : '🌄 배경을 변경했어요!';
    }
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 1600);
    await loadBoard();
  } catch (e) { shopError.textContent = e.message; }
}
function preload(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { loadedSources.add(src); resolve(true); };
    img.onerror = () => { console.error('이미지 로드 실패:', src); resolve(false); };
    img.src = src;
  });
}
function updateLoading(done, total, label) {
  const percent = total ? Math.round(done / total * 100) : 0;
  loadingBar.style.width = `${percent}%`;
  loadingCount.textContent = `${done} / ${total}`;
  loadingText.textContent = label || `이미지를 불러오고 있어요… ${percent}%`;
}
function releaseGame(total) {
  if (bootReleased) return;
  bootReleased = true;
  clearTimeout(loadingSkipTimer); clearTimeout(bootSafetyTimer);
  loadingSkipBtn.classList.remove('is-visible');
  showIdle();
  gameReady = true;
  gameEl.classList.remove('is-loading');
  loadingBar.style.width = '100%';
  loadingCount.textContent = `${total} / ${total}`;
  loadingText.textContent = '준비 완료!';
  setTimeout(() => loadingScreen.classList.add('is-hidden'), 250);
}
async function bootGame() {
  const srcs = [IDLE_SRC, PRESSED_SRC, ...MOTIONS.slice(1).map((m) => m.src), ...HELPERS.map((h) => h.src), ...BACKGROUNDS.map((b) => b.src)];
  let done = 0;
  const total = srcs.length;
  updateLoading(0, total, '이미지를 준비하고 있어요…');
  loadingSkipTimer = setTimeout(() => loadingSkipBtn.classList.add('is-visible'), 3000);
  bootSafetyTimer = setTimeout(() => releaseGame(total), 12000);
  await Promise.all(srcs.map(async (src) => { await preload(src); done += 1; updateLoading(done, total); }));
  releaseGame(total);
}
function skipBoot() { releaseGame(MOTIONS.length + HELPERS.length + 1); }

function stopHelperTimers() {
  if (helperTickTimer) clearInterval(helperTickTimer);
  if (syncTimer) clearInterval(syncTimer);
  helperTickTimer = null;
  syncTimer = null;
}
async function syncMe() {
  if (!user || !token) return;
  try {
    const d = await api('/api/me');
    applyUser(d.user);
    optimistic();
  } catch (e) {
    console.error(e);
  }
}
function restartHelperTimers() {
  stopHelperTimers();
  if (!user || !token) return;
  const cps = helperIncome(user.ownedHelpers || []);
  if (cps > 0) {
    helperTickTimer = setInterval(() => {
      localScore += cps;
      renderScore();
      checkUnlock();
      optimistic();
      showHelperFloat(cps);
    }, 1000);
  }
  syncTimer = setInterval(syncMe, 15000);
}

authBtn.addEventListener('click', async () => {
  if (user) {
    await flush();
    token = '';
    user = null;
    localScore = 0;
    stopHelperTimers();
    localStorage.removeItem('eungae_token');
    updateAuth();
    applyBackground();
    renderHelpers();
    renderScore();
  } else authDialog.showModal();
});
shopBtn?.addEventListener('click', () => {
  if (!user) { authDialog.showModal(); return; }
  renderShop();
  shopDialog.showModal();
});
$('#shopCloseBtn')?.addEventListener('click', () => shopDialog.close());
shopDialog?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  shopAction(btn.dataset.action, btn.dataset.type, btn.dataset.id);
});
$('#motionSettingsBtn').addEventListener('click', () => { populateSettings(); motionDialog.showModal(); });
document.querySelectorAll('input[name="motionMode"]').forEach((x) => x.addEventListener('change', updateSettingsState));
motionSelect.addEventListener('change', () => {
  const single = document.querySelector('input[name="motionMode"][value="single"]');
  if (single) single.checked = true;
  updateSettingsState();
});
titleSelect?.addEventListener('change', updateSettingsState);
$('#saveMotionBtn').addEventListener('click', saveSettings);
$('#loginBtn').addEventListener('click', () => auth('login'));
$('#registerBtn').addEventListener('click', () => auth('register'));
loadingSkipBtn?.addEventListener('click', skipBoot);
buttonEl.addEventListener('pointerdown', (e) => { e.preventDefault(); onClick(e); });
window.addEventListener('blur', stopClickAnimation);
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && !authDialog.open && !motionDialog.open && !shopDialog.open) {
    e.preventDefault();
    onClick();
  }
});

document.querySelectorAll('dialog .close').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

renderLeaderboard();
renderScore();
updateAuth();
applyBackground();
renderHelpers();
Promise.allSettled([restore(), loadBoard()]).finally(() => bootGame());
events();
