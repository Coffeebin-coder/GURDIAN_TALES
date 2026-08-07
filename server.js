"use strict";

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET는 32자 이상의 안전한 문자열이어야 합니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1h' : 0 }));

const sseClients = new Set();
let leaderboardCache = [];

const TITLE_TIERS = [
  { clicks: 0, title: '응애 궁전의 새싹' },
  { clicks: 1000, title: '캔터베리의 꼬마 시종' },
  { clicks: 5000, title: '작은 공주님의 산책 메이트' },
  { clicks: 10000, title: '공주님 친위 클릭병' },
  { clicks: 50000, title: '캔터베리 기사 견습' },
  { clicks: 100000, title: '로레인 정원의 수호자' },
  { clicks: 500000, title: '공주님 전속 가디언' },
  { clicks: 1000000, title: '가디언 테일즈 원정대원' },
  { clicks: 10000000, title: '캔터베리 왕실 수호자' },
  { clicks: 100000000, title: '어린 공주님이 인정한 영웅' },
  { clicks: 1000000000, title: '응애공주의 전설 가디언' }
];

const HELPERS = [
  { id: 1, name: '해바라기 응애', price: 5000, cps: 1 },
  { id: 2, name: '울먹 응애공주', price: 12000, cps: 2 },
  { id: 3, name: '꼬마 공주 미니', price: 25000, cps: 4 }
];

const BACKGROUNDS = [
  { id: 'default', name: '하늘꽃 초원', price: 0 },
  { id: 'sunset', name: '노을빛 초원', price: 15000 },
  { id: 'night', name: '별빛 밤초원', price: 30000 }
];

const MOTION_THRESHOLDS = [0, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000];

function availableTitles(clicks) {
  return TITLE_TIERS.filter((tier) => Number(clicks) >= tier.clicks).map((tier) => tier.title);
}
function titleForClicks(clicks) {
  const titles = availableTitles(clicks);
  return titles[titles.length - 1] || TITLE_TIERS[0].title;
}
function helperIncome(ids = []) {
  return (Array.isArray(ids) ? ids : []).map(Number).map((id) => HELPERS.find((x) => x.id === id)?.cps || 0).reduce((sum, x) => sum + x, 0);
}
function displayedTitle(row) {
  const unlocked = availableTitles(row.clicks);
  if (row.selected_title && unlocked.includes(row.selected_title)) return row.selected_title;
  return unlocked[unlocked.length - 1] || TITLE_TIERS[0].title;
}
function safeUser(row) {
  const ownedHelpers = Array.isArray(row.owned_helpers) ? row.owned_helpers.map(Number) : [];
  const ownedBackgrounds = Array.isArray(row.owned_backgrounds) ? row.owned_backgrounds : ['default'];
  return {
    id: String(row.id),
    username: row.username,
    clicks: Number(row.clicks),
    spendableClicks: Number(row.spendable_clicks || 0),
    motionMode: row.motion_mode || 'random',
    selectedMotion: Number(row.selected_motion || 0),
    selectedTitle: displayedTitle(row),
    availableTitles: availableTitles(row.clicks),
    ownedHelpers,
    helperCps: helperIncome(ownedHelpers),
    ownedBackgrounds,
    activeBackground: row.active_background || 'default',
    clickPower: 1,
    title: displayedTitle(row)
  };
}
function signToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}
function maxUnlockedMotion(clicks) {
  let index = 0;
  for (let i = 0; i < MOTION_THRESHOLDS.length; i++) if (Number(clicks) >= MOTION_THRESHOLDS[i]) index = i;
  return index;
}
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '로그인이 만료되었습니다.' });
  }
}
function validateUsername(value) {
  return typeof value === 'string' && /^[가-힣a-zA-Z0-9_]{2,16}$/.test(value.trim());
}
function validatePassword(value) {
  return typeof value === 'string' && value.length >= 4 && value.length <= 72;
}
function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) client.write(message);
}
async function getLeaderboard() {
  const result = await pool.query(`
    SELECT username, clicks, selected_title
    FROM users
    ORDER BY clicks DESC, updated_at ASC
    LIMIT 3
  `);
  return result.rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    clicks: Number(row.clicks),
    title: displayedTitle(row)
  }));
}
async function refreshLeaderboard() {
  leaderboardCache = await getLeaderboard();
  broadcast('leaderboard', leaderboardCache);
  return leaderboardCache;
}
function userSelectFields() {
  return 'id, username, clicks, spendable_clicks, motion_mode, selected_motion, selected_title, owned_helpers, owned_backgrounds, active_background, last_passive_at';
}
async function applyPassive(client, row) {
  const ownedHelpers = Array.isArray(row.owned_helpers) ? row.owned_helpers.map(Number) : [];
  const cps = helperIncome(ownedHelpers);
  if (cps < 1) return { row, earned: 0 };
  const lastAtMs = row.last_passive_at ? new Date(row.last_passive_at).getTime() : Date.now();
  const elapsedSec = Math.max(0, Math.floor((Date.now() - lastAtMs) / 1000));
  if (elapsedSec < 1) return { row, earned: 0 };
  const earned = elapsedSec * cps;
  const updated = await client.query(`
    UPDATE users
    SET clicks = clicks + $1,
        spendable_clicks = spendable_clicks + $1,
        last_passive_at = COALESCE(last_passive_at, NOW()) + ($2 * INTERVAL '1 second'),
        updated_at = NOW()
    WHERE id = $3
    RETURNING ${userSelectFields()}
  `, [earned, elapsedSec, row.id]);
  return { row: updated.rows[0], earned };
}
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      clicks BIGINT NOT NULL DEFAULT 0,
      motion_mode VARCHAR(12) NOT NULL DEFAULT 'random',
      selected_motion INTEGER NOT NULL DEFAULT 0,
      selected_title TEXT,
      spendable_clicks BIGINT NOT NULL DEFAULT 0,
      owned_helpers JSONB NOT NULL DEFAULT '[]'::jsonb,
      owned_backgrounds JSONB NOT NULL DEFAULT '["default"]'::jsonb,
      active_background VARCHAR(20) NOT NULL DEFAULT 'default',
      last_passive_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS motion_mode VARCHAR(12) NOT NULL DEFAULT 'random'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_motion INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_title TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS spendable_clicks BIGINT');
  await pool.query('UPDATE users SET spendable_clicks = clicks WHERE spendable_clicks IS NULL');
  await pool.query('ALTER TABLE users ALTER COLUMN spendable_clicks SET DEFAULT 0');
  await pool.query('ALTER TABLE users ALTER COLUMN spendable_clicks SET NOT NULL');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_helpers JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_backgrounds JSONB NOT NULL DEFAULT '[\"default\"]'::jsonb");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS active_background VARCHAR(20) NOT NULL DEFAULT 'default'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_passive_at TIMESTAMPTZ');
  await pool.query('UPDATE users SET last_passive_at = NOW() WHERE last_passive_at IS NULL');
  await pool.query('ALTER TABLE users ALTER COLUMN last_passive_at SET DEFAULT NOW()');
  await pool.query('ALTER TABLE users ALTER COLUMN last_passive_at SET NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS users_clicks_idx ON users (clicks DESC, updated_at ASC)');
  await pool.query("UPDATE users SET selected_title = NULL WHERE selected_title = ''");
  await refreshLeaderboard();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!validateUsername(username)) return res.status(400).json({ error: '닉네임은 한글·영문·숫자·밑줄 2~16자로 입력하세요.' });
    if (!validatePassword(password)) return res.status(400).json({ error: '비밀번호는 4~72자로 입력하세요.' });
    const hash = await bcrypt.hash(password, 11);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, selected_title) VALUES ($1, $2, $3) RETURNING ${userSelectFields()}`,
      [username, hash, TITLE_TIERS[0].title]
    );
    const user = safeUser(result.rows[0]);
    await refreshLeaderboard();
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    await client.query('BEGIN');
    const result = await client.query(`SELECT ${userSelectFields()}, password_hash FROM users WHERE username = $1 FOR UPDATE`, [username]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: '닉네임 또는 비밀번호가 맞지 않습니다.' });
    }
    const passive = await applyPassive(client, row);
    await client.query('COMMIT');
    if (passive.earned > 0) await refreshLeaderboard();
    const user = safeUser(passive.row);
    res.json({ token: signToken(user), user });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/me', authRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT ${userSelectFields()} FROM users WHERE id = $1 FOR UPDATE`, [req.auth.sub]);
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const passive = await applyPassive(client, result.rows[0]);
    await client.query('COMMIT');
    if (passive.earned > 0) await refreshLeaderboard();
    res.json({ user: safeUser(passive.row) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/clicks', authRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) {
      return res.status(400).json({ error: '잘못된 클릭 수입니다.' });
    }
    await client.query('BEGIN');
    const current = await client.query(`SELECT ${userSelectFields()} FROM users WHERE id = $1 FOR UPDATE`, [req.auth.sub]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const passive = await applyPassive(client, current.rows[0]);
    const result = await client.query(`
      UPDATE users
      SET clicks = clicks + $1, spendable_clicks = spendable_clicks + $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${userSelectFields()}
    `, [amount, req.auth.sub]);
    await client.query('COMMIT');
    const user = safeUser(result.rows[0]);
    const leaderboard = await refreshLeaderboard();
    res.json({ user, leaderboard, earned: amount + passive.earned });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.put('/api/preferences', authRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const motionMode = String(req.body.motionMode || '');
    const selectedMotion = Number(req.body.selectedMotion);
    const selectedTitle = String(req.body.selectedTitle || '').trim();
    if (!['random', 'single'].includes(motionMode)) return res.status(400).json({ error: '모션 재생 방식이 올바르지 않습니다.' });
    if (!Number.isInteger(selectedMotion) || selectedMotion < 0 || selectedMotion >= MOTION_THRESHOLDS.length) return res.status(400).json({ error: '선택한 모션이 올바르지 않습니다.' });

    await client.query('BEGIN');
    const current = await client.query(`SELECT ${userSelectFields()} FROM users WHERE id = $1 FOR UPDATE`, [req.auth.sub]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const passive = await applyPassive(client, current.rows[0]);
    const maxMotion = maxUnlockedMotion(passive.row.clicks);
    if (selectedMotion > maxMotion) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '아직 해금되지 않은 모션입니다.' });
    }
    const unlockedTitles = availableTitles(passive.row.clicks);
    const safeSelectedTitle = unlockedTitles.includes(selectedTitle) ? selectedTitle : unlockedTitles[unlockedTitles.length - 1];
    const result = await client.query(`
      UPDATE users
      SET motion_mode = $1, selected_motion = $2, selected_title = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING ${userSelectFields()}
    `, [motionMode, selectedMotion, safeSelectedTitle, req.auth.sub]);
    await client.query('COMMIT');
    if (passive.earned > 0) await refreshLeaderboard();
    res.json({ user: safeUser(result.rows[0]) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/shop', authRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT ${userSelectFields()} FROM users WHERE id = $1 FOR UPDATE`, [req.auth.sub]);
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const passive = await applyPassive(client, result.rows[0]);
    await client.query('COMMIT');
    if (passive.earned > 0) await refreshLeaderboard();
    res.json({ user: safeUser(passive.row), helpers: HELPERS, backgrounds: BACKGROUNDS });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/shop/purchase', authRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const type = String(req.body.type || '');
    const id = req.body.id;
    await client.query('BEGIN');
    const result = await client.query(`SELECT ${userSelectFields()} FROM users WHERE id = $1 FOR UPDATE`, [req.auth.sub]);
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const passive = await applyPassive(client, result.rows[0]);
    const row = passive.row;

    if (type === 'helper') {
      const item = HELPERS.find((x) => x.id === Number(id));
      if (!item) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '도우미를 찾을 수 없습니다.' });
      }
      const owned = Array.isArray(row.owned_helpers) ? row.owned_helpers.map(Number) : [];
      if (owned.includes(item.id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '이미 구매한 도우미입니다.' });
      }
      if (Number(row.spendable_clicks) < item.price) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '보유 클릭이 부족합니다.' });
      }
      owned.push(item.id);
      const updated = await client.query(`
        UPDATE users
        SET spendable_clicks = spendable_clicks - $1,
            owned_helpers = $2::jsonb,
            last_passive_at = NOW(),
            updated_at = NOW()
        WHERE id = $3
        RETURNING ${userSelectFields()}
      `, [item.price, JSON.stringify(owned), req.auth.sub]);
      await client.query('COMMIT');
      await refreshLeaderboard();
      return res.json({ user: safeUser(updated.rows[0]) });
    }

    if (type === 'background') {
      const item = BACKGROUNDS.find((x) => x.id === String(id));
      if (!item || item.id === 'default') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '배경을 찾을 수 없습니다.' });
      }
      const owned = Array.isArray(row.owned_backgrounds) ? row.owned_backgrounds : ['default'];
      if (owned.includes(item.id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '이미 구매한 배경입니다.' });
      }
      if (Number(row.spendable_clicks) < item.price) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '보유 클릭이 부족합니다.' });
      }
      owned.push(item.id);
      const updated = await client.query(`
        UPDATE users
        SET spendable_clicks = spendable_clicks - $1,
            owned_backgrounds = $2::jsonb,
            active_background = $3,
            updated_at = NOW()
        WHERE id = $4
        RETURNING ${userSelectFields()}
      `, [item.price, JSON.stringify(owned), item.id, req.auth.sub]);
      await client.query('COMMIT');
      return res.json({ user: safeUser(updated.rows[0]) });
    }

    await client.query('ROLLBACK');
    return res.status(400).json({ error: '상품 종류가 올바르지 않습니다.' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/shop/equip', authRequired, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const type = String(req.body.type || '');
    const id = String(req.body.id || '');
    if (type !== 'background') return res.status(400).json({ error: '장착 종류가 올바르지 않습니다.' });
    await client.query('BEGIN');
    const current = await client.query(`SELECT ${userSelectFields()} FROM users WHERE id = $1 FOR UPDATE`, [req.auth.sub]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const passive = await applyPassive(client, current.rows[0]);
    const owned = Array.isArray(passive.row.owned_backgrounds) ? passive.row.owned_backgrounds : ['default'];
    if (!owned.includes(id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '구매하지 않은 배경입니다.' });
    }
    const updated = await client.query(`
      UPDATE users
      SET active_background = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${userSelectFields()}
    `, [id, req.auth.sub]);
    await client.query('COMMIT');
    if (passive.earned > 0) await refreshLeaderboard();
    res.json({ user: safeUser(updated.rows[0]) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/leaderboard', async (_req, res, next) => {
  try {
    if (!leaderboardCache.length) await refreshLeaderboard();
    res.json({ leaderboard: leaderboardCache });
  } catch (error) {
    next(error);
  }
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write(`event: leaderboard\ndata: ${JSON.stringify(leaderboardCache)}\n\n`);
  sseClients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: '서버에서 오류가 발생했습니다.' });
});

initDatabase()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`응애공주 서버 실행: ${PORT}`)))
  .catch((error) => {
    console.error('데이터베이스 초기화 실패:', error);
    process.exit(1);
  });
