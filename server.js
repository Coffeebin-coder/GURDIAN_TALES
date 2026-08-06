'use strict';

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

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      clicks BIGINT NOT NULL DEFAULT 0,
      motion_mode VARCHAR(12) NOT NULL DEFAULT 'random',
      selected_motion INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS motion_mode VARCHAR(12) NOT NULL DEFAULT 'random'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_motion INTEGER NOT NULL DEFAULT 0');
  await pool.query('CREATE INDEX IF NOT EXISTS users_clicks_idx ON users (clicks DESC, updated_at ASC)');
  await refreshLeaderboard();
}

function safeUser(row) {
  return {
    id: String(row.id),
    username: row.username,
    clicks: Number(row.clicks),
    motionMode: row.motion_mode || 'random',
    selectedMotion: Number(row.selected_motion || 0)
  };
}

const MOTION_THRESHOLDS = [0, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000];

function maxUnlockedMotion(clicks) {
  let index = 0;
  for (let i = 0; i < MOTION_THRESHOLDS.length; i++) {
    if (Number(clicks) >= MOTION_THRESHOLDS[i]) index = i;
  }
  return index;
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, JWT_SECRET, { expiresIn: '30d' });
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

async function getLeaderboard() {
  const result = await pool.query(`
    SELECT username, clicks
    FROM users
    ORDER BY clicks DESC, updated_at ASC
    LIMIT 3
  `);
  return result.rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    clicks: Number(row.clicks)
  }));
}

async function refreshLeaderboard() {
  leaderboardCache = await getLeaderboard();
  broadcast('leaderboard', leaderboardCache);
  return leaderboardCache;
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) client.write(message);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!validateUsername(username)) {
      return res.status(400).json({ error: '닉네임은 한글·영문·숫자·밑줄 2~16자로 입력하세요.' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: '비밀번호는 4~72자로 입력하세요.' });
    }
    const hash = await bcrypt.hash(password, 11);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, clicks, motion_mode, selected_motion',
      [username, hash]
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
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const result = await pool.query('SELECT id, username, password_hash, clicks, motion_mode, selected_motion FROM users WHERE username = $1', [username]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: '닉네임 또는 비밀번호가 맞지 않습니다.' });
    }
    const user = safeUser(row);
    res.json({ token: signToken(user), user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', authRequired, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT id, username, clicks, motion_mode, selected_motion FROM users WHERE id = $1', [req.auth.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json({ user: safeUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/clicks', authRequired, async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) {
      return res.status(400).json({ error: '잘못된 클릭 수입니다.' });
    }
    const result = await pool.query(`
      UPDATE users
      SET clicks = clicks + $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, username, clicks, motion_mode, selected_motion
    `, [amount, req.auth.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const user = safeUser(result.rows[0]);
    const leaderboard = await refreshLeaderboard();
    res.json({ user, leaderboard });
  } catch (error) {
    next(error);
  }
});

app.put('/api/preferences', authRequired, async (req, res, next) => {
  try {
    const motionMode = String(req.body.motionMode || '');
    const selectedMotion = Number(req.body.selectedMotion);
    if (!['random', 'single'].includes(motionMode)) {
      return res.status(400).json({ error: '모션 재생 방식이 올바르지 않습니다.' });
    }
    if (!Number.isInteger(selectedMotion) || selectedMotion < 0 || selectedMotion >= MOTION_THRESHOLDS.length) {
      return res.status(400).json({ error: '선택한 모션이 올바르지 않습니다.' });
    }

    const current = await pool.query('SELECT clicks FROM users WHERE id = $1', [req.auth.sub]);
    if (!current.rows[0]) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const maxMotion = maxUnlockedMotion(current.rows[0].clicks);
    if (selectedMotion > maxMotion) {
      return res.status(403).json({ error: '아직 해금되지 않은 모션입니다.' });
    }

    const result = await pool.query(`
      UPDATE users
      SET motion_mode = $1, selected_motion = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, username, clicks, motion_mode, selected_motion
    `, [motionMode, selectedMotion, req.auth.sub]);
    res.json({ user: safeUser(result.rows[0]) });
  } catch (error) {
    next(error);
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
