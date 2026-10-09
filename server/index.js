'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// A random secret per boot is fine for a local app; set JWT_SECRET to keep
// sessions valid across restarts.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// --- Uploads ----------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|gif|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Doar imagini sunt permise (jpg, png, gif, webp).'));
  },
});

// --- Middleware -------------------------------------------------------------
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: TOKEN_MAX_AGE,
  });
}

// Attach req.user when a valid token is present (does not block).
function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies.token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db
        .prepare('SELECT id, username, full_name, bio, avatar, created_at FROM users WHERE id = ?')
        .get(payload.id);
      if (user) req.user = user;
    } catch {
      /* invalid / expired token: treat as anonymous */
    }
  }
  next();
}

// Require an authenticated user.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Trebuie sa fii autentificat.' });
  next();
}

app.use(loadUser);

// --- Helpers ----------------------------------------------------------------
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    bio: u.bio,
    avatar: u.avatar,
    createdAt: u.created_at,
  };
}

const enrichStmt = {
  author: db.prepare('SELECT id, username, full_name, avatar FROM users WHERE id = ?'),
  likeCount: db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?'),
  commentCount: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?'),
  likedByMe: db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?'),
};

function enrichPost(post, viewerId) {
  const author = enrichStmt.author.get(post.user_id);
  return {
    id: post.id,
    image: '/uploads/' + post.image,
    caption: post.caption,
    createdAt: post.created_at,
    author: {
      id: author.id,
      username: author.username,
      fullName: author.full_name,
      avatar: author.avatar,
    },
    likeCount: enrichStmt.likeCount.get(post.id).n,
    commentCount: enrichStmt.commentCount.get(post.id).n,
    likedByMe: viewerId ? !!enrichStmt.likedByMe.get(post.id, viewerId) : false,
    mine: viewerId === post.user_id,
  };
}

function usernameValid(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9._]{3,30}$/.test(name);
}

// ============================================================================
// AUTH
// ============================================================================
app.post('/api/auth/register', (req, res) => {
  const { username, password, fullName } = req.body || {};
  if (!usernameValid(username)) {
    return res.status(400).json({
      error: 'Username invalid (3-30 caractere: litere, cifre, . sau _).',
    });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Parola trebuie sa aiba minim 6 caractere.' });
  }

  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Username-ul este deja folosit.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, full_name, password) VALUES (?, ?, ?)')
    .run(username, (fullName || '').trim().slice(0, 60), hash);

  const user = db
    .prepare('SELECT id, username, full_name, bio, avatar, created_at FROM users WHERE id = ?')
    .get(info.lastInsertRowid);

  setAuthCookie(res, signToken(user));
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    return res.status(401).json({ error: 'Username sau parola gresita.' });
  }
  setAuthCookie(res, signToken(user));
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

// ============================================================================
// POSTS
// ============================================================================
app.post('/api/posts', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Trebuie sa incarci o imagine.' });
  const caption = (req.body.caption || '').toString().slice(0, 2200);
  const info = db
    .prepare('INSERT INTO posts (user_id, image, caption) VALUES (?, ?, ?)')
    .run(req.user.id, req.file.filename, caption);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ post: enrichPost(post, req.user.id) });
});

// Feed: posts from people you follow, plus your own, newest first.
app.get('/api/feed', requireAuth, (req, res) => {
  const posts = db
    .prepare(
      `SELECT * FROM posts
       WHERE user_id = @me
          OR user_id IN (SELECT followee_id FROM follows WHERE follower_id = @me)
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 100`
    )
    .all({ me: req.user.id });
  res.json({ posts: posts.map((p) => enrichPost(p, req.user.id)) });
});

// Explore: everything recent.
app.get('/api/explore', (req, res) => {
  const posts = db
    .prepare('SELECT * FROM posts ORDER BY datetime(created_at) DESC, id DESC LIMIT 100')
    .all();
  const viewerId = req.user ? req.user.id : null;
  res.json({ posts: posts.map((p) => enrichPost(p, viewerId)) });
});

app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Postarea nu exista.' });
  const viewerId = req.user ? req.user.id : null;
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.username, u.avatar
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY datetime(c.created_at) ASC, c.id ASC`
    )
    .all(post.id);
  res.json({
    post: enrichPost(post, viewerId),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      username: c.username,
      avatar: c.avatar,
    })),
  });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Postarea nu exista.' });
  if (post.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Poti sterge doar postarile tale.' });
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  // Best-effort cleanup of the image file.
  fs.unlink(path.join(uploadsDir, post.image), () => {});
  res.json({ ok: true });
});

// ============================================================================
// LIKES
// ============================================================================
app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Postarea nu exista.' });

  const liked = db
    .prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.user.id);
  if (liked) {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
  } else {
    db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, post.id);
  }
  const likeCount = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(post.id).n;
  res.json({ liked: !liked, likeCount });
});

// ============================================================================
// COMMENTS
// ============================================================================
app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Postarea nu exista.' });
  const body = (req.body.body || '').toString().trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: 'Comentariul este gol.' });

  const info = db
    .prepare('INSERT INTO comments (user_id, post_id, body) VALUES (?, ?, ?)')
    .run(req.user.id, post.id, body);
  const c = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.username, u.avatar
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json({
    comment: {
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      username: c.username,
      avatar: c.avatar,
    },
  });
});

// ============================================================================
// USERS / PROFILES / FOLLOW
// ============================================================================
app.get('/api/users', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ users: [] });
  const rows = db
    .prepare(
      `SELECT id, username, full_name, bio, avatar, created_at FROM users
       WHERE username LIKE ? OR full_name LIKE ? ORDER BY username LIMIT 20`
    )
    .all('%' + q + '%', '%' + q + '%');
  res.json({ users: rows.map(publicUser) });
});

app.get('/api/users/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Utilizatorul nu exista.' });

  const viewerId = req.user ? req.user.id : null;
  const posts = db
    .prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC')
    .all(u.id);
  const followers = db
    .prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?')
    .get(u.id).n;
  const following = db
    .prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?')
    .get(u.id).n;
  const isFollowing = viewerId
    ? !!db
        .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
        .get(viewerId, u.id)
    : false;

  res.json({
    user: publicUser(u),
    isMe: viewerId === u.id,
    isFollowing,
    counts: { posts: posts.length, followers, following },
    posts: posts.map((p) => enrichPost(p, viewerId)),
  });
});

app.post('/api/users/:username/follow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilizatorul nu exista.' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Nu te poti urmari pe tine insuti.' });
  }
  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .get(req.user.id, target.id);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(
      req.user.id,
      target.id
    );
  } else {
    db.prepare('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)').run(
      req.user.id,
      target.id
    );
  }
  const followers = db
    .prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?')
    .get(target.id).n;
  res.json({ following: !existing, followers });
});

// Update own profile (full name, bio, optional avatar image).
app.put('/api/profile', requireAuth, upload.single('avatar'), (req, res) => {
  const fullName = (req.body.fullName || '').toString().trim().slice(0, 60);
  const bio = (req.body.bio || '').toString().trim().slice(0, 300);
  let avatar = req.user.avatar;
  if (req.file) avatar = '/uploads/' + req.file.filename;

  db.prepare('UPDATE users SET full_name = ?, bio = ?, avatar = ? WHERE id = ?').run(
    fullName,
    bio,
    avatar,
    req.user.id
  );
  const user = db
    .prepare('SELECT id, username, full_name, bio, avatar, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({ user: publicUser(user) });
});

// --- SPA fallback: send index.html for non-API routes -----------------------
app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- Error handler (multer + thrown errors) ---------------------------------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Imaginea este prea mare (max 8 MB).' });
  }
  res.status(400).json({ error: err.message || 'A aparut o eroare.' });
});

app.listen(PORT, () => {
  console.log(`\n  Grinstagram ruleaza pe  http://localhost:${PORT}\n`);
});
