require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const seedQuestions = require('./questions');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ Не задан MONGODB_URI. Скопируйте .env.example в .env и вставьте строку подключения.');
  process.exit(1);
}

const ADMIN_USERNAME = 'mrgarder';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('❌ Не задан ADMIN_PASSWORD — пароль админа MrGarder. Добавьте его в .env (или в Environment на Render).');
  process.exit(1);
}

/* ---------- Модели MongoDB ---------- */
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'user' },
  totalScore: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}));

const Question = mongoose.model('Question', new mongoose.Schema({
  order: Number,
  text: String,
  type: { type: String, default: 'single' },
  options: [String],
  correct: [Number],
  time: { type: Number, default: 20 }
}));

const Game = mongoose.model('Game', new mongoose.Schema({
  pin: String,
  hostName: String,
  results: [{ userId: String, name: String, score: Number }],
  finishedAt: { type: Date, default: Date.now }
}));

/* ---------- Express ---------- */
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.get('/healthz', (req, res) => res.send('ok'));
// Отдаём только index.html (чтобы server.js и .env не были доступны из браузера)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const sign = (u) => jwt.sign({ id: u._id.toString(), name: u.name, role: u.role }, JWT_SECRET, { expiresIn: '30d' });

function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Войдите в аккаунт' }); }
}

app.post('/api/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Введите имя (минимум 2 символа)' });
    if (username.length < 3) return res.status(400).json({ error: 'Логин — минимум 3 символа' });
    if (username === ADMIN_USERNAME) return res.status(400).json({ error: 'Этот логин зарезервирован' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль — минимум 4 символа' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Такой логин уже занят' });
    const user = await User.create({ name, username, passwordHash: await bcrypt.hash(password, 10) });
    res.json({ token: sign(user), name: user.name, role: user.role });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash)))
      return res.status(400).json({ error: 'Неверный логин или пароль' });
    res.json({ token: sign(user), name: user.name, role: user.role });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/me', auth, async (req, res) => {
  const u = await User.findById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Аккаунт не найден' });
  res.json({ role: u.role, name: u.name, totalScore: u.totalScore, gamesPlayed: u.gamesPlayed });
});

app.get('/api/leaderboard', auth, async (req, res) => {
  const top = await User.find({ gamesPlayed: { $gt: 0 }, role: { $ne: 'admin' } }).sort({ totalScore: -1 }).limit(10).select('name totalScore gamesPlayed -_id');
  res.json(top);
});

/* ---------- Игровая логика (Socket.IO) ---------- */
const games = new Map(); // pin -> game

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET); next(); }
  catch { next(new Error('unauthorized')); }
});

const genPin = () => { let p; do { p = String(Math.floor(100000 + Math.random() * 900000)); } while (games.has(p)); return p; };
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const board = (g) => [...g.players.values()].sort((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
const publicQ = (q, i, total) => ({ index: i, total, text: q.text, type: q.type, options: q.options, time: q.time });

io.on('connection', (socket) => {
  socket.on('host:create', async () => {
    if (socket.user.role !== 'admin') return socket.emit('error:msg', 'Игру может создать только админ MrGarder');
    const questions = await Question.find().sort({ order: 1 }).lean();
    if (!questions.length) return socket.emit('error:msg', 'В базе нет вопросов');
    const pin = genPin();
    games.set(pin, { pin, hostSocket: socket.id, hostName: socket.user.name, questions, players: new Map(),
      state: 'lobby', qIndex: -1, answers: new Map(), startedAt: 0, timer: null });
    socket.join(pin); socket.data.hostPin = pin;
    socket.emit('host:created', { pin, total: questions.length });
  });

  socket.on('player:join', ({ pin }) => {
    const g = games.get(String(pin || '').trim());
    if (!g) return socket.emit('error:msg', 'Игра с таким PIN не найдена');
    const uid = socket.user.id;
    if (g.state !== 'lobby' && !g.players.has(uid)) return socket.emit('error:msg', 'Игра уже началась');
    const existing = g.players.get(uid);
    g.players.set(uid, { id: uid, name: socket.user.name, score: existing ? existing.score : 0, socketId: socket.id });
    socket.join(g.pin); socket.data.playerPin = g.pin;
    socket.emit('player:joined', { pin: g.pin, name: socket.user.name });
    io.to(g.hostSocket).emit('lobby:update', { players: [...g.players.values()].map((p) => p.name) });
  });

  socket.on('host:start', () => {
    const g = games.get(socket.data.hostPin);
    if (!g || g.state !== 'lobby') return;
    if (!g.players.size) return socket.emit('error:msg', 'Нужен хотя бы один игрок');
    nextQuestion(g);
  });

  socket.on('host:next', () => {
    const g = games.get(socket.data.hostPin);
    if (g && g.state === 'results') nextQuestion(g);
  });

  socket.on('host:end', () => {
    const g = games.get(socket.data.hostPin);
    if (!g) return;
    clearTimeout(g.timer);
    if (g.qIndex < 0) { io.to(g.pin).emit('game:closed'); games.delete(g.pin); }
    else finishGame(g);
  });

  socket.on('player:answer', ({ choice }) => {
    const g = games.get(socket.data.playerPin);
    if (!g || g.state !== 'question') return;
    const uid = socket.user.id;
    if (g.answers.has(uid) || !g.players.has(uid)) return;
    const arr = (Array.isArray(choice) ? choice : [choice]).map(Number).filter((n) => Number.isInteger(n));
    g.answers.set(uid, { choice: arr, time: Date.now() - g.startedAt });
    socket.emit('answer:ack');
    io.to(g.hostSocket).emit('answer:count', { count: g.answers.size, total: g.players.size });
    if (g.answers.size >= g.players.size) endQuestion(g);
  });

  socket.on('disconnect', () => {
    const pin = socket.data.hostPin;
    if (pin && games.has(pin)) {
      const g = games.get(pin);
      clearTimeout(g.timer);
      io.to(pin).emit('game:closed');
      games.delete(pin);
    }
  });
});

function nextQuestion(g) {
  g.qIndex++;
  if (g.qIndex >= g.questions.length) return finishGame(g);
  const q = g.questions[g.qIndex];
  g.state = 'question'; g.answers = new Map(); g.startedAt = Date.now();
  io.to(g.pin).emit('question', publicQ(q, g.qIndex, g.questions.length));
  g.timer = setTimeout(() => endQuestion(g), q.time * 1000 + 500);
}

function endQuestion(g) {
  if (g.state !== 'question') return;
  clearTimeout(g.timer);
  g.state = 'results';
  const q = g.questions[g.qIndex];
  const dist = q.options.map(() => 0);
  const gained = new Map();
  for (const p of g.players.values()) {
    const a = g.answers.get(p.id);
    let pts = 0, ok = false;
    if (a) {
      a.choice.forEach((c) => { if (dist[c] !== undefined) dist[c]++; });
      ok = sameSet([...new Set(a.choice)].sort(), [...q.correct].sort());
      pts = ok ? 1 : -1; // верный ответ +1, неверный −1, без ответа 0
    }
    p.score += pts; gained.set(p.id, { ok, pts, answered: !!a });
  }
  const lb = board(g);
  for (const p of g.players.values()) {
    const r = gained.get(p.id);
    const rank = lb.findIndex((x) => x.name === p.name && x.score === p.score) + 1;
    io.to(p.socketId).emit('result', { correct: r.ok, answered: r.answered, points: r.pts, score: p.score, rank, correctIdx: q.correct });
  }
  io.to(g.hostSocket).emit('question:results', {
    correctIdx: q.correct, dist, top: lb.slice(0, 10),
    last: g.qIndex === g.questions.length - 1
  });
}

async function finishGame(g) {
  g.state = 'end';
  const lb = board(g);
  io.to(g.pin).emit('game:end', { leaderboard: lb });
  try {
    for (const p of g.players.values())
      await User.updateOne({ _id: p.id }, { $inc: { totalScore: p.score, gamesPlayed: 1 } });
    await Game.create({ pin: g.pin, hostName: g.hostName, results: [...g.players.values()].map((p) => ({ userId: p.id, name: p.name, score: p.score })) });
  } catch (e) { console.error('Не удалось сохранить результаты:', e.message); }
  games.delete(g.pin);
}

/* ---------- Запуск ---------- */
(async () => {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ MongoDB подключена');
  await User.updateOne({ username: ADMIN_USERNAME },
    { $set: { name: 'MrGarder', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), role: 'admin' } }, { upsert: true });
  console.log('👑 Админ MrGarder готов');
  if (process.env.RESEED === '1' || (await Question.countDocuments()) === 0) {
    await Question.deleteMany({});
    await Question.insertMany(seedQuestions.map((q, i) => ({ ...q, order: i })));
    console.log(`📚 Вопросы загружены в базу: ${seedQuestions.length}`);
  }
  server.listen(PORT, '0.0.0.0', () => console.log(`🚀 http://localhost:${PORT}`));
})().catch((e) => { console.error('Ошибка запуска:', e.message); process.exit(1); });
