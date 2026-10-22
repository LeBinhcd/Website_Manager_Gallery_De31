import { canDeleteAlbum, canEditAlbum, canViewAlbum } from './permissions.js';







import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDatabase, isDatabaseConfigured, query } from './db.js';
import { clearSessionCookie, createSession, destroySession, hashPassword, loadSession, publicUser, requireAuth, setSessionCookie, verifyPassword } from './auth.js';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import multer from 'multer';
import express from 'express';




const metricCounters = new Map();
const metricHistograms = new Map();
function metricKey(name, labels) { return `${name}|${Object.entries(labels).sort().map(([key, value]) => `${key}=${value}`).join(',')}`; }
function incrementMetric(name, labels = {}, value = 1) {
  const key = metricKey(name, labels);
  metricCounters.set(key, (metricCounters.get(key) || { name, labels, value: 0 }));
  metricCounters.get(key).value += value;
}
function observeMetric(name, labels, value) {
  const key = metricKey(name, labels);
  const item = metricHistograms.get(key) || { name, labels, count: 0, sum: 0, buckets: [0, 0, 0, 0, 0, 0] };
  const limits = [0.005, 0.01, 0.05, 0.1, 0.5, 1];
  item.count += 1; item.sum += value;
  limits.forEach((limit, index) => { if (value <= limit) item.buckets[index] += 1; });
  metricHistograms.set(key, item);
}
function prometheusLabels(labels) {
  const entries = Object.entries(labels).map(([key, value]) => `${key}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"') }"`);
  return entries.length ? `{${entries.join(',')}}` : '';
}
function metricsText() {
  const lines = ['# HELP gallery_http_requests_total Total HTTP requests handled by Gallery.', '# TYPE gallery_http_requests_total counter'];
  for (const item of metricCounters.values()) {
    lines.push(`${item.name}${prometheusLabels(item.labels)} ${item.value}`);
  }
  for (const item of metricHistograms.values()) {
    const limits = [0.005, 0.01, 0.05, 0.1, 0.5, 1];
    lines.push(`# TYPE ${item.name} histogram`);
    limits.forEach((limit, index) => lines.push(`${item.name}_bucket${prometheusLabels({ ...item.labels, le: limit })} ${item.buckets[index]}`));
    lines.push(`${item.name}_bucket${prometheusLabels({ ...item.labels, le: '+Inf' })} ${item.count}`);
    lines.push(`${item.name}_sum${prometheusLabels(item.labels)} ${item.sum}`);
    lines.push(`${item.name}_count${prometheusLabels(item.labels)} ${item.count}`);
  }
  return `${lines.join('\n')}\n`;
}

const app = express();
const port = Number(process.env.PORT || 3000);

function logEvent(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'gallery-app', event, ...fields }));
}

function requestUserId(req) {
  return req.session?.user?.id ?? null;
}



const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
function slugify(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseUserTag(value) {
  const match = String(value).trim().match(/^([a-zA-Z0-9_.-]{3,80})#(\d{4})$/);
  return match ? { username: match[1], userCode: match[2] } : { username: String(value).trim(), userCode: null };
}

function validVisibility(value) {
  return ['public', 'private', 'link'].includes(value);
}

function userTag(user) {
  return `${user.username}#${String(user.user_code).padStart(4, '0')}`;
}

async function findUserByIdentifier(identifier) {
  const parsed = parseUserTag(identifier);
  if (parsed.userCode) {
    const [user] = await query('SELECT id, username, user_code, password_hash, role FROM users WHERE username = ? AND user_code = ?', [parsed.username, parsed.userCode]);
    return user;
  }
  const [user] = await query('SELECT id, username, user_code, password_hash, role FROM users WHERE username = ?', [parsed.username]);
  return user;
}

async function createUserWithCode(username, passwordHash) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const userCode = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    try {
      const result = await query('INSERT INTO users (username, user_code, password_hash) VALUES (?, ?, ?)', [username, userCode, passwordHash]);
      return { id: result.insertId, username, user_code: userCode, role: 'user' };
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY' || attempt === 9) throw error;
    }
  }
}

function badRequest(res, message) {
  return res.status(400).json({ error: 'bad_request', message });
}

function databaseError(res, error) {
  if (error.message === 'database_not_configured') return res.status(503).json({ error: 'database_not_configured' });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'already_exists' });
  console.error(JSON.stringify({ event: 'database_error', code: error.code || 'unknown', message: error.message || 'unknown error' }));
  return res.status(500).json({ error: 'database_error' });
}
const startedAt = Date.now();


const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_COUNT = 10;
const USER_STORAGE_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;
const ALBUM_THEMES = new Set(['default', 'sunset', 'ocean', 'forest', 'lavender', 'mono']);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_IMAGE_COUNT, fieldSize: 100 * 1024 }
});

app.delete('/api/images/:id', requireAuth, imageEditor, async (req, res) => {
  try {
    await query('DELETE FROM images WHERE id = ?', [req.image.id]);
    const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
    if (req.image.stored_name) await fs.unlink(path.join(uploadDir, req.image.stored_name)).catch(() => {});
    res.status(204).end();
  } catch (error) { databaseError(res, error); }
});
const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE, files: 1 } });
const IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: 'jpg', signature: buffer => buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],

  ['image/png', { extension: 'png', signature: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/gif', { extension: 'gif', signature: buffer => buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a' }],
  ['image/webp', { extension: 'webp', signature: buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' }]
]);

function validateImageFile(file) {
  const type = IMAGE_TYPES.get(file.mimetype);
  const extension = path.extname(file.originalname).toLowerCase().slice(1);
  if (!type || !((type.extension === 'jpg' && ['jpg', 'jpeg'].includes(extension)) || extension === type.extension) || !type.signature(file.buffer)) return 'only valid JPEG, PNG, GIF, or WebP image files are allowed';
  return null;
}

function uploadError(res, error) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large', message: 'each image must be 10 MB or smaller' });
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'too_many_files', message: 'you can upload up to 10 images at once' });
  return badRequest(res, error.message || 'invalid image upload');
}



app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(publicDir, { index: false }));

app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(metricsText());
});

app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path || req.path || 'unknown';
    if (req.path === '/api/images' && res.statusCode >= 400) logEvent('image_upload_failed', { user_id: requestUserId(req), status: res.statusCode, method: req.method });

    logEvent('http_request', { method: req.method, route, status: res.statusCode, duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6), user_id: requestUserId(req) });

    const labels = { method: req.method, route, status: res.statusCode };
    incrementMetric('gallery_http_requests_total', labels);
    if (res.statusCode >= 400) incrementMetric('gallery_http_errors_total', { method: req.method, route, status: res.statusCode });
    observeMetric('gallery_http_request_duration_seconds', { method: req.method, route }, Number(process.hrtime.bigint() - started) / 1e9);
  });
  next();
});
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'gallery-app' });
});




app.get('/health/db', async (_req, res) => {
  try {
    res.status(200).json(await checkDatabase());
  } catch (error) {
    res.status(503).json({ configured: isDatabaseConfigured(), connected: false, error: 'database_unavailable' });
  }
});
function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.session.user.username !== 'admin' || req.session.user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
    next();
  });
}

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  try {
    const [[users], [albums], [images], [storage], [shares]] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM users'),
      query('SELECT COUNT(*) AS total, SUM(visibility = "public") AS public_total, SUM(visibility = "private") AS private_total, SUM(visibility = "link") AS link_total FROM albums'),
      query('SELECT COUNT(*) AS total, SUM(visibility = "public") AS public_total, SUM(visibility = "private") AS private_total, SUM(visibility = "link") AS link_total FROM images'),
      query('SELECT COALESCE(SUM(file_size), 0) AS total_bytes FROM images'),
      query('SELECT COUNT(*) AS total FROM image_shares')
    ]);
    res.json({ data: {
      users: Number(users.total),
      albums: { total: Number(albums.total), public: Number(albums.public_total || 0), private: Number(albums.private_total || 0), link: Number(albums.link_total || 0) },
      images: { total: Number(images.total), public: Number(images.public_total || 0), private: Number(images.private_total || 0), link: Number(images.link_total || 0) },
      storageBytes: Number(storage.total_bytes),
      shareLinks: Number(shares.total)
    }});
  } catch (error) { databaseError(res, error); }
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const users = await query(`SELECT users.id, users.username, users.user_code, users.created_at,
      (SELECT COUNT(*) FROM albums WHERE albums.owner_id = users.id) AS album_count,
      (SELECT COUNT(*) FROM images WHERE images.uploaded_by = users.id) AS upload_count,
      (SELECT COALESCE(SUM(file_size), 0) FROM images WHERE images.uploaded_by = users.id) AS upload_bytes
      FROM users ORDER BY users.created_at DESC`);
    res.json({ data: users.map(user => ({ ...user, user_tag: userTag(user), album_count: Number(user.album_count), upload_count: Number(user.upload_count), upload_bytes: Number(user.upload_bytes) })) });
  } catch (error) { databaseError(res, error); }
});

app.get('/api/admin/albums', requireAdmin, async (_req, res) => {
  try {
    const albums = await query(`SELECT albums.id, albums.name, albums.visibility, albums.created_at,
      users.username AS owner_username, users.user_code AS owner_user_code,
      (SELECT COUNT(*) FROM images WHERE images.album_id = albums.id) AS image_count
      FROM albums LEFT JOIN users ON users.id = albums.owner_id
      ORDER BY albums.created_at DESC LIMIT 100`);
    res.json({ data: albums.map(album => ({ ...album, owner_tag: album.owner_username ? userTag({ username: album.owner_username, user_code: album.owner_user_code }) : 'Hệ thống', image_count: Number(album.image_count) })) });
  } catch (error) { databaseError(res, error); }
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username)) return badRequest(res, 'invalid username');
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) return badRequest(res, 'password must contain 6-200 characters');
  try {
    const passwordHash = await hashPassword(password);
    const userRecord = await createUserWithCode(username, passwordHash);
    const user = publicUser(userRecord);
    const session = await createSession(user);
    setSessionCookie(res, session.sid, session.expires);
    logEvent('user_registered', { user_id: user.id, role: user.role });
    res.status(201).json({ data: user });
  } catch (error) { databaseError(res, error); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return badRequest(res, 'username and password are required');
  try {
    const user = await findUserByIdentifier(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ error: 'invalid_credentials' });
    const safeUser = publicUser(user);
    const session = await createSession(safeUser);
    setSessionCookie(res, session.sid, session.expires);
    logEvent('login_succeeded', { user_id: safeUser.id, role: safeUser.role });
    res.json({ data: safeUser });

  } catch (error) { databaseError(res, error); }
});

app.post('/api/auth/logout', async (req, res) => {
  try { await destroySession(req); clearSessionCookie(res); res.status(204).end(); }
  catch (error) { databaseError(res, error); }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const session = await loadSession(req);
    if (!session?.user) return res.status(401).json({ error: 'authentication_required' });
    res.json({ data: session.user });
  } catch (error) { databaseError(res, error); }
});




app.post('/api/albums', requireAuth, (req, res, next) => {
  coverUpload.single('cover_image')(req, res, error => {
    if (error) return uploadError(res, error);
    next();
  });
}, async (req, res) => {
  const { name, description = '', visibility = 'private', cover_theme: coverTheme = 'default' } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) return badRequest(res, 'name must contain 2-120 characters');
  if (!validVisibility(visibility)) return badRequest(res, 'invalid visibility');
  if (typeof coverTheme !== 'string' || !ALBUM_THEMES.has(coverTheme)) return badRequest(res, 'invalid cover theme');
  if (req.file) {
    const invalidFile = validateImageFile(req.file);
    if (invalidFile) return badRequest(res, invalidFile);
  }
    const [duplicate] = await query('SELECT id FROM albums WHERE owner_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [req.session.user.id, name]);
    if (duplicate) return res.status(409).json({ error: 'album_name_exists', message: 'Bạn đã có album cùng tên.' });

  try {
    if (req.file) {
      const [storage] = await query('SELECT COALESCE((SELECT SUM(file_size) FROM images WHERE uploaded_by = ?), 0) + COALESCE((SELECT SUM(cover_file_size) FROM albums WHERE owner_id = ?), 0) AS total_bytes', [req.session.user.id, req.session.user.id]);
      if (Number(storage.total_bytes) + req.file.size > USER_STORAGE_QUOTA_BYTES) return res.status(413).json({ error: 'storage_quota_exceeded', message: 'Dung lượng lưu trữ của tài khoản là 20 GB. Không đủ dung lượng cho ảnh khung album.', storageBytes: Number(storage.total_bytes), storageQuotaBytes: USER_STORAGE_QUOTA_BYTES });
    }
    const coverStoredName = req.file ? `${crypto.randomUUID()}.${IMAGE_TYPES.get(req.file.mimetype).extension}` : null;
    const result = await query('INSERT INTO albums (owner_id, name, slug, description, visibility, cover_theme, cover_stored_name, cover_original_name, cover_file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.session.user.id, name.trim(), `${slugify(name)}-${Date.now()}`, String(description).slice(0, 5000), visibility, coverTheme, coverStoredName, req.file ? path.basename(req.file.originalname) : null, req.file?.size || 0]);
    if (req.file) {
      try {
        const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, coverStoredName), req.file.buffer, { flag: 'wx' });
      } catch (error) {
        await query('DELETE FROM albums WHERE id = ?', [result.insertId]);
        throw error;
      }
    }
    const [album] = await query('SELECT id, owner_id, name, slug, description, visibility, cover_theme, cover_stored_name, cover_original_name, created_at FROM albums WHERE id = ?', [result.insertId]);
    if (album.cover_stored_name) album.cover_url = `/uploads/${encodeURIComponent(album.cover_stored_name)}`;
    res.status(201).json({ data: album });
  } catch (error) { databaseError(res, error); }
});

app.get('/api/albums', requireAuth, async (req, res) => {
  try {
    const albums = await query('SELECT id, owner_id, name, slug, description, visibility, cover_theme, cover_stored_name, cover_original_name, created_at FROM albums WHERE owner_id = ? ORDER BY created_at DESC', [req.session.user.id]);
    albums.forEach(album => { if (album.cover_stored_name) album.cover_url = `/uploads/${encodeURIComponent(album.cover_stored_name)}`; });
    res.json({ data: albums });
  } catch (error) { databaseError(res, error); }
});


async function albumAccess(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return badRequest(res, 'id must be a positive integer');
    const [album] = await query('SELECT id, owner_id, name, slug, description, visibility, cover_theme, cover_stored_name, cover_original_name, created_at FROM albums WHERE id = ?', [id]);
    if (!album) return res.status(404).json({ error: 'album_not_found' });
    const [share] = await query('SELECT role FROM album_shares WHERE album_id = ? AND user_id = ?', [id, req.session.user.id]);
    if (!canViewAlbum({ ownerId: album.owner_id, userId: req.session.user.id, userRole: req.session.user.role, shareRole: share?.role, visibility: album.visibility })) return res.status(403).json({ error: 'forbidden' });
    req.albumRole = share?.role || (album.owner_id === req.session.user.id || req.session.user.role === 'admin' ? 'owner' : 'viewer');
    if (album.cover_stored_name) album.cover_url = `/uploads/${encodeURIComponent(album.cover_stored_name)}`;
    req.album = album;
    next();
  } catch (error) { databaseError(res, error); }
}

app.get('/api/albums/:id', requireAuth, albumAccess, async (req, res) => {
  try {
    const images = await query(`SELECT images.id, images.original_name, images.stored_name, images.mime_type, images.file_size, images.title, images.description, images.visibility, images.created_at, images.category_id, categories.name AS category_name
      FROM images LEFT JOIN categories ON categories.id = images.category_id WHERE images.album_id = ? ORDER BY images.created_at DESC`, [req.album.id]);
    res.json({ data: { ...req.album, role: req.albumRole, images: images.map(image => ({ ...image, url: `/uploads/${encodeURIComponent(image.stored_name)}` })) } });
  } catch (error) { databaseError(res, error); }
});

app.use('/uploads', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads'), { index: false }));

app.get('/api/recent', async (req, res) => {
  try {
    const session = await loadSession(req);
    const images = await query("SELECT images.id, images.album_id, images.title, images.original_name, images.created_at, images.visibility, albums.name AS album_name FROM images JOIN albums ON albums.id = images.album_id WHERE (images.visibility = 'public' OR albums.owner_id = ?) ORDER BY images.created_at DESC LIMIT 24", [session?.user?.id ?? null]);
    res.json({ data: images });
  } catch (error) { databaseError(res, error); }
});
app.get('/api/shared', requireAuth, async (req, res) => {
  try {
    const albums = await query(`SELECT albums.id, albums.owner_id, albums.name, albums.slug, albums.description, albums.visibility, albums.cover_theme, albums.cover_stored_name,
      albums.created_at, users.username AS owner_username, users.user_code AS owner_user_code, album_shares.role
      FROM album_shares JOIN albums ON albums.id = album_shares.album_id
      JOIN users ON users.id = albums.owner_id
      WHERE album_shares.user_id = ? ORDER BY album_shares.created_at DESC`, [req.session.user.id]);
    albums.forEach(album => { if (album.cover_stored_name) album.cover_url = `/uploads/${encodeURIComponent(album.cover_stored_name)}`; });
    res.json({ data: albums });
  } catch (error) { databaseError(res, error); }
});

app.get('/api/shared/images/:id', requireAuth, async (req, res) => {
  const imageId = Number(req.params.id);
  if (!Number.isInteger(imageId) || imageId < 1) return badRequest(res, 'id must be a positive integer');
  try {
    const [image] = await query(`SELECT images.stored_name FROM images JOIN albums ON albums.id = images.album_id
      WHERE images.id = ? AND (albums.owner_id = ? OR EXISTS (SELECT 1 FROM image_user_shares WHERE image_id = images.id AND user_id = ?))`, [imageId, req.session.user.id, req.session.user.id]);
    if (!image) return res.status(404).send('Not found');
    res.redirect(`/uploads/${encodeURIComponent(image.stored_name)}`);
  } catch (error) { databaseError(res, error); }
});

app.get('/api/shared/images', requireAuth, async (req, res) => {
  try {
    const directImages = await query(`SELECT image_user_shares.id, images.id AS image_id, images.title, images.original_name, albums.name AS album_name,
      users.username AS owner_username, users.user_code AS owner_user_code, image_user_shares.created_at
      FROM image_user_shares JOIN images ON images.id = image_user_shares.image_id JOIN albums ON albums.id = images.album_id JOIN users ON users.id = albums.owner_id
      WHERE image_user_shares.user_id = ? ORDER BY image_user_shares.created_at DESC`, [req.session.user.id]);
    const linkImages = await query(`SELECT image_shares.id, image_shares.image_id, image_shares.share_token, image_shares.expires_at, image_shares.created_at,
      images.title, images.original_name, albums.name AS album_name
      FROM image_shares JOIN images ON images.id = image_shares.image_id JOIN albums ON albums.id = images.album_id
      WHERE albums.owner_id = ? ORDER BY image_shares.created_at DESC`, [req.session.user.id]);
    const images = [...directImages.map(image => ({ ...image, kind: 'direct', url: `/api/shared/images/${image.image_id}` })), ...linkImages.map(image => ({ ...image, kind: 'link', url: `/share/${image.share_token}` }))];
    res.json({ data: images });
  } catch (error) { databaseError(res, error); }
});
app.delete('/api/images/:id/share-links/:shareId', requireAuth, imageEditor, async (req, res) => {

  const shareId = Number(req.params.shareId);
  if (!Number.isInteger(shareId) || shareId < 1) return badRequest(res, 'shareId must be a positive integer');
  try {
    const result = await query('DELETE FROM image_shares WHERE id = ? AND image_id = ?', [shareId, req.image.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'share_not_found' });
    res.status(204).end();
  } catch (error) { databaseError(res, error); }
});

app.get('/share/:token', async (req, res) => {
  try {
    const [image] = await query(`SELECT images.original_name, images.title, images.description, images.stored_name, image_shares.expires_at
      FROM image_shares JOIN images ON images.id = image_shares.image_id
      WHERE image_shares.share_token = ? AND (image_shares.expires_at IS NULL OR image_shares.expires_at > UTC_TIMESTAMP())`, [req.params.token]);
    if (!image) return res.status(404).type('html').send('<h1>Liên kết ảnh không tồn tại hoặc đã hết hạn.</h1>');
    res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(image.title || image.original_name).replace(/[<&>]/g, '')} — Frame</title><style>body{margin:0;background:#202336;color:#fff;font:16px system-ui;text-align:center}img{display:block;max-width:95vw;max-height:85vh;margin:5vh auto 16px}p{color:#c9cbe0}</style></head><body><img src="/uploads/${encodeURIComponent(image.stored_name)}" alt="Ảnh được chia sẻ"><p>${String(image.title || image.original_name).replace(/[<&>]/g, '')}</p></body></html>`);
  } catch (error) { databaseError(res, error); }
});


app.get('/api/overview', requireAuth, async (req, res) => {
  try {
    const [[albums], [images], [sharedImages], [storage]] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM albums WHERE owner_id = ?', [req.session.user.id]),
      query('SELECT COUNT(*) AS total FROM images JOIN albums ON albums.id = images.album_id WHERE albums.owner_id = ?', [req.session.user.id]),
      query('SELECT COUNT(*) AS total FROM images JOIN album_shares ON album_shares.album_id = images.album_id WHERE album_shares.user_id = ?', [req.session.user.id]),
      query('SELECT COALESCE((SELECT SUM(file_size) FROM images WHERE uploaded_by = ?), 0) + COALESCE((SELECT SUM(cover_file_size) FROM albums WHERE owner_id = ?), 0) AS total_bytes', [req.session.user.id, req.session.user.id])
    ]);
    const storageBytes = Number(storage.total_bytes);
    res.json({ data: { albumCount: Number(albums.total), imageCount: Number(images.total), sharedImageCount: Number(sharedImages.total), storageBytes, storageQuotaBytes: USER_STORAGE_QUOTA_BYTES } });
  } catch (error) { databaseError(res, error); }
});

app.get('/api/albums/:id/shares', requireAuth, albumOwner, async (req, res) => {
  try {
    const shares = await query(`SELECT album_shares.id, album_shares.user_id, users.username, users.user_code, album_shares.role, album_shares.created_at
      FROM album_shares JOIN users ON users.id = album_shares.user_id
      WHERE album_shares.album_id = ? ORDER BY users.username`, [req.album.id]);
    res.json({ data: shares.map(share => ({ ...share, user_tag: userTag(share) })) });
  } catch (error) { databaseError(res, error); }
});

app.post('/api/albums/:id/shares', requireAuth, albumOwner, async (req, res) => {
  const { username, role = 'viewer' } = req.body || {};
  if (typeof username !== 'string' || !username.trim()) return badRequest(res, 'username is required');
  if (!['viewer', 'editor'].includes(role)) return badRequest(res, 'role must be viewer or editor');
  try {
    const user = await findUserByIdentifier(username);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.id === req.session.user.id) return badRequest(res, 'cannot share an album with yourself');
    const result = await query('INSERT INTO album_shares (album_id, user_id, role) VALUES (?, ?, ?)', [req.album.id, user.id, role]);
    const [share] = await query(`SELECT album_shares.id, album_shares.user_id, users.username, users.user_code, album_shares.role, album_shares.created_at
      FROM album_shares JOIN users ON users.id = album_shares.user_id WHERE album_shares.id = ?`, [result.insertId]);
    res.status(201).json({ data: { ...share, user_tag: userTag(share) } });
  } catch (error) { databaseError(res, error); }
});

app.patch('/api/albums/:id/shares/:userId', requireAuth, albumOwner, async (req, res) => {
  const userId = Number(req.params.userId);
  const { role } = req.body || {};
  if (!Number.isInteger(userId) || userId < 1) return badRequest(res, 'userId must be a positive integer');
  if (!['viewer', 'editor'].includes(role)) return badRequest(res, 'role must be viewer or editor');
  try {
    const result = await query('UPDATE album_shares SET role = ? WHERE album_id = ? AND user_id = ?', [role, req.album.id, userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'share_not_found' });
      const [share] = await query(`SELECT album_shares.id, album_shares.user_id, users.username, users.user_code, album_shares.role, album_shares.created_at
      FROM album_shares JOIN users ON users.id = album_shares.user_id WHERE album_shares.album_id = ? AND album_shares.user_id = ?`, [req.album.id, userId]);
    res.json({ data: { ...share, user_tag: userTag(share) } });
  } catch (error) { databaseError(res, error); }
});

app.delete('/api/albums/:id/shares/:userId', requireAuth, albumOwner, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1) return badRequest(res, 'userId must be a positive integer');
  try {
    const result = await query('DELETE FROM album_shares WHERE album_id = ? AND user_id = ?', [req.album.id, userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'share_not_found' });
    res.status(204).end();
  } catch (error) { databaseError(res, error); }
});

app.post('/api/images', requireAuth, (req, res, next) => {
  imageUpload.array('images', MAX_IMAGE_COUNT)(req, res, error => {
    if (error) return uploadError(res, error);
    next();
  });
}, async (req, res) => {
  const albumId = Number(req.body?.album_id);
  const categoryId = req.body?.category_id ? Number(req.body.category_id) : null;
  if (!Number.isInteger(albumId) || albumId < 1) return badRequest(res, 'album_id must be a positive integer');
  if (!req.files?.length) return badRequest(res, 'at least one image is required');
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId < 1)) return badRequest(res, 'invalid category');
  const invalidFile = req.files.map(validateImageFile).find(Boolean);
  if (invalidFile) return badRequest(res, invalidFile);
  try {
    const [album] = await query('SELECT id, owner_id FROM albums WHERE id = ?', [albumId]);
    if (!album) return res.status(404).json({ error: 'album_not_found' });
    if (categoryId !== null) {
      const [category] = await query('SELECT id FROM categories WHERE id = ?', [categoryId]);
      if (!category) return res.status(400).json({ error: 'invalid_category' });
    }
    const uploadBytes = req.files.reduce((total, file) => total + file.size, 0);
    const [storage] = await query('SELECT COALESCE((SELECT SUM(file_size) FROM images WHERE uploaded_by = ?), 0) + COALESCE((SELECT SUM(cover_file_size) FROM albums WHERE owner_id = ?), 0) AS total_bytes', [req.session.user.id, req.session.user.id]);
    const storageBytes = Number(storage.total_bytes);
    if (storageBytes + uploadBytes > USER_STORAGE_QUOTA_BYTES) {
      return res.status(413).json({ error: 'storage_quota_exceeded', message: 'Dung lượng lưu trữ của tài khoản là 20 GB. Không đủ dung lượng cho ảnh đã chọn.', storageBytes, storageQuotaBytes: USER_STORAGE_QUOTA_BYTES });
    }
    const [share] = await query('SELECT role FROM album_shares WHERE album_id = ? AND user_id = ?', [albumId, req.session.user.id]);
    if (!canEditAlbum({ ownerId: album.owner_id, userId: req.session.user.id, userRole: req.session.user.role, shareRole: share?.role })) return res.status(403).json({ error: 'forbidden' });
    const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    const saved = [];
    try {
      for (const file of req.files) {
        const storedName = `${crypto.randomUUID()}.${IMAGE_TYPES.get(file.mimetype).extension}`;
        await fs.writeFile(path.join(uploadDir, storedName), file.buffer, { flag: 'wx' });
        const result = await query('INSERT INTO images (album_id, category_id, uploaded_by, original_name, stored_name, mime_type, file_size, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [albumId, categoryId, req.session.user.id, path.basename(file.originalname), storedName, file.mimetype, file.size, '']);
        saved.push({ id: result.insertId, stored_name: storedName, original_name: path.basename(file.originalname), mime_type: file.mimetype, file_size: file.size });
      }
    } catch (error) {
      await Promise.all(saved.map(image => fs.unlink(path.join(uploadDir, image.stored_name)).catch(() => {})));
      throw error;
    }
    incrementMetric('gallery_uploads_total', { status: 'success' }, saved.length);

    incrementMetric('gallery_upload_bytes_total', { status: 'success' }, uploadBytes);
    logEvent('image_upload_completed', { user_id: req.session.user.id, album_id: albumId, file_count: saved.length, bytes: uploadBytes });

    res.status(201).json({ data: saved });
  } catch (error) { databaseError(res, error); }
});

async function albumOwner(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return badRequest(res, 'id must be a positive integer');
    const [album] = await query('SELECT id, owner_id FROM albums WHERE id = ?', [id]);
    if (!album) return res.status(404).json({ error: 'not_found' });
    if (!canDeleteAlbum({ ownerId: album.owner_id, userId: req.session.user.id, userRole: req.session.user.role })) return res.status(403).json({ error: 'forbidden' });
    req.album = album;
    next();
  } catch (error) { databaseError(res, error); }
}

async function imageOwner(req, res, next) {
  const imageId = Number(req.params.id);
  if (!Number.isInteger(imageId) || imageId < 1) return badRequest(res, 'id must be a positive integer');
  try {
    const [image] = await query('SELECT images.id, images.album_id, images.original_name, albums.owner_id FROM images JOIN albums ON albums.id = images.album_id WHERE images.id = ?', [imageId]);
    if (!image) return res.status(404).json({ error: 'image_not_found' });
    if (image.owner_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    req.image = image;
    next();
  } catch (error) { databaseError(res, error); }
}

app.patch('/api/albums/:id', requireAuth, albumOwner, async (req, res) => {
  const { name, description, visibility, cover_theme: coverTheme } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120)) return badRequest(res, 'name must contain 2-120 characters');
  if (visibility !== undefined && !validVisibility(visibility)) return badRequest(res, 'invalid visibility');
  if (coverTheme !== undefined && (typeof coverTheme !== 'string' || !ALBUM_THEMES.has(coverTheme))) return badRequest(res, 'invalid cover theme');
  const fields = []; const values = [];
    if (name !== undefined) { fields.push('name = ?', 'slug = ?'); values.push(name.trim(), `${slugify(name)}-${Date.now()}`); }
  if (description !== undefined) { fields.push('description = ?'); values.push(String(description).slice(0, 5000)); }
  if (visibility !== undefined) { fields.push('visibility = ?'); values.push(visibility); }
  if (coverTheme !== undefined) { fields.push('cover_theme = ?'); values.push(coverTheme); }

async function imageOwner(req, res, next) {
  const imageId = Number(req.params.id);
  if (!Number.isInteger(imageId) || imageId < 1) return badRequest(res, 'id must be a positive integer');
  try {
    const [image] = await query('SELECT images.id, images.album_id, images.stored_name, albums.owner_id FROM images JOIN albums ON albums.id = images.album_id WHERE images.id = ?', [imageId]);
    if (!image) return res.status(404).json({ error: 'image_not_found' });
    if (image.owner_id !== req.session.user.id && req.session.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    req.image = image;
    next();
  } catch (error) { databaseError(res, error); }
}

  if (!fields.length) return badRequest(res, 'at least one field is required');
  try {
    await query(`UPDATE albums SET ${fields.join(', ')} WHERE id = ?`, [...values, req.album.id]);
    const [album] = await query('SELECT id, name, slug, description, visibility, cover_theme, created_at FROM albums WHERE id = ?', [req.album.id]);
    res.json({ data: album });
  } catch (error) { databaseError(res, error); }
});

app.delete('/api/albums/:id', requireAuth, albumOwner, async (req, res) => {
  try {
    const [album] = await query('SELECT cover_stored_name FROM albums WHERE id = ?', [req.album.id]);
    await query('DELETE FROM albums WHERE id = ?', [req.album.id]);
    if (album?.cover_stored_name) {
      const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
      await fs.unlink(path.join(uploadDir, album.cover_stored_name)).catch(() => {});
    }
    res.status(204).end();
  }
  catch (error) { databaseError(res, error); }
});

async function imageEditor(req, res, next) {
  const imageId = Number(req.params.id);
  if (!Number.isInteger(imageId) || imageId < 1) return badRequest(res, 'id must be a positive integer');
  try {
    const [image] = await query('SELECT images.id, images.album_id, images.stored_name, albums.owner_id FROM images JOIN albums ON albums.id = images.album_id WHERE images.id = ?', [imageId]);
    if (!image) return res.status(404).json({ error: 'image_not_found' });
    const [share] = await query('SELECT role FROM album_shares WHERE album_id = ? AND user_id = ?', [image.album_id, req.session.user.id]);
    if (!canEditAlbum({ ownerId: image.owner_id, userId: req.session.user.id, userRole: req.session.user.role, shareRole: share?.role })) return res.status(403).json({ error: 'forbidden' });
    req.image = image;
    next();
  } catch (error) { databaseError(res, error); }
}

app.get('/api/images/:id/shares', requireAuth, imageOwner, async (req, res) => {
  try {
    const shares = await query(`SELECT image_user_shares.id, image_user_shares.user_id, users.username, users.user_code, image_user_shares.created_at
      FROM image_user_shares JOIN users ON users.id = image_user_shares.user_id
      WHERE image_user_shares.image_id = ? ORDER BY users.username`, [req.image.id]);
    res.json({ data: shares.map(share => ({ ...share, user_tag: userTag(share) })) });
  } catch (error) { databaseError(res, error); }
});

app.post('/api/images/:id/shares', requireAuth, imageOwner, async (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== 'string' || !username.trim()) return badRequest(res, 'username is required');
  try {
    const user = await findUserByIdentifier(username);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    if (user.id === req.session.user.id) return badRequest(res, 'cannot share an image with yourself');
    const result = await query('INSERT INTO image_user_shares (image_id, user_id) VALUES (?, ?)', [req.image.id, user.id]);
    const [share] = await query(`SELECT image_user_shares.id, image_user_shares.user_id, users.username, users.user_code, image_user_shares.created_at
      FROM image_user_shares JOIN users ON users.id = image_user_shares.user_id WHERE image_user_shares.id = ?`, [result.insertId]);
    res.status(201).json({ data: { ...share, user_tag: userTag(share) } });
  } catch (error) { databaseError(res, error); }
});

app.delete('/api/images/:id/shares/:userId', requireAuth, imageOwner, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1) return badRequest(res, 'userId must be a positive integer');
  try {
    const result = await query('DELETE FROM image_user_shares WHERE image_id = ? AND user_id = ?', [req.image.id, userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'share_not_found' });
    res.status(204).end();
  } catch (error) { databaseError(res, error); }
});

app.post('/api/images/:id/share-links', requireAuth, imageEditor, async (req, res) => {
  try {
    incrementMetric('gallery_share_links_created_total', { status: 'success' });

    const shareToken = crypto.randomBytes(24).toString('base64url');
    const result = await query('INSERT INTO image_shares (image_id, share_token) VALUES (?, ?)', [req.image.id, shareToken]);
    logEvent('share_link_created', { user_id: req.session.user.id, image_id: req.image.id, share_id: result.insertId });
    res.status(201).json({ data: { id: result.insertId, image_id: req.image.id, share_token: shareToken, url: `/share/${shareToken}` } });
  } catch (error) { databaseError(res, error); }
});

app.patch('/api/images/:id', requireAuth, imageEditor, async (req, res) => {

  const imageId = Number(req.params.id);
  const { title, description, visibility } = req.body || {};
  const categoryId = req.body?.category_id === '' || req.body?.category_id === undefined ? undefined : Number(req.body.category_id);
  if (title !== undefined && (typeof title !== 'string' || title.length > 160)) return badRequest(res, 'title must contain 0-160 characters');
  if (description !== undefined && (typeof description !== 'string' || description.length > 5000)) return badRequest(res, 'description must contain 0-5000 characters');
  if (visibility !== undefined && !validVisibility(visibility)) return badRequest(res, 'invalid visibility');
  if (categoryId !== undefined && (!Number.isInteger(categoryId) || categoryId < 1)) return badRequest(res, 'invalid category');
  if (title === undefined && description === undefined && visibility === undefined && categoryId === undefined) return badRequest(res, 'at least one field is required');
  try {
    const fields = []; const values = [];
    if (title !== undefined) {
      const extension = path.extname(req.image.original_name || '');
      const normalizedTitle = title.trim();
      const titleWithoutExtension = extension && normalizedTitle.toLowerCase().endsWith(extension.toLowerCase())
        ? normalizedTitle.slice(0, -extension.length).trim()
        : normalizedTitle;
      fields.push('title = ?'); values.push(titleWithoutExtension);
    }
    if (description !== undefined) { fields.push('description = ?'); values.push(description.trim()); }
    if (visibility !== undefined) { fields.push('visibility = ?'); values.push(visibility); }
    if (categoryId !== undefined) { const [category] = await query('SELECT id FROM categories WHERE id = ?', [categoryId]); if (!category) return badRequest(res, 'invalid category'); fields.push('category_id = ?'); values.push(categoryId); }
    await query(`UPDATE images SET ${fields.join(', ')} WHERE id = ?`, [...values, imageId]);
    const [updated] = await query('SELECT images.id, images.album_id, images.original_name, images.stored_name, images.mime_type, images.file_size, images.title, images.description, images.visibility, images.created_at, images.category_id, categories.name AS category_name FROM images LEFT JOIN categories ON categories.id = images.category_id WHERE images.id = ?', [imageId]);
    res.json({ data: { ...updated, url: `/uploads/${encodeURIComponent(updated.stored_name)}` } });
  } catch (error) { databaseError(res, error); }
});



app.get('/api/categories', async (_req, res) => {
  try { res.json({ data: await query('SELECT id, name, slug FROM categories ORDER BY name') }); }
  catch (error) { databaseError(res, error); }
});


app.post('/api/categories', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) return badRequest(res, 'name must contain 2-80 characters');
  const slug = slugify(name);
  try {
    const result = await query('INSERT INTO categories (name, slug) VALUES (?, ?)', [name.trim(), slug]);
    const [category] = await query('SELECT id, name, slug FROM categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: category });

  } catch (error) { databaseError(res, error); }
});
app.get('/metrics', (_req, res) => {

  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  res.type('text/plain').send([
    '# HELP gallery_app_up Whether the Gallery application is running.',
    '# TYPE gallery_app_up gauge',
    'gallery_app_up 1',
    '# HELP gallery_app_uptime_seconds Application uptime in seconds.',
    '# TYPE gallery_app_uptime_seconds gauge',
    `gallery_app_uptime_seconds ${uptime}`,
    ''
  ].join('\n'));
});

app.get(['/', '/collections', '/shared', '/recent', '/admin'], async (req, res) => {
  const collectionPage = req.path === '/collections';
  const sharedPage = req.path === '/shared';
  const recentPage = req.path === '/recent';
  const adminPage = req.path === '/admin';
  if (adminPage) {
    const session = await loadSession(req);
    if (session?.user?.role !== 'admin') return res.redirect('/');
  }

  res.type('html').send(`<!doctype html>
<html lang="vi">


<head>
  <meta charset="utf-8">

  <meta name="viewport" content="width=device-width,initial-scale=1">

  <meta name="description" content="Không gian lưu giữ và khám phá những khoảnh khắc đáng nhớ.">
  <title>Frame — Gallery Đề 31</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body class="night" data-page="${adminPage ? 'admin' : sharedPage ? 'shared' : recentPage ? 'recent' : collectionPage ? 'collections' : 'overview'}">
  <section class="auth-screen" id="auth-panel"><div class="auth-card"><div class="auth-brand"><span class="brand-mark">F</span><strong>frame<span class="brand-dot">.</span></strong></div><div id="login-panel"><p class="eyebrow">KHÔNG GIAN CỦA BẠN</p><h1>Chào mừng trở lại</h1><p class="auth-copy">Đăng nhập để tiếp tục quản lý những khoảnh khắc của bạn.</p><form id="login-form"><label for="login-username">Tên người dùng</label><input id="login-username" name="username" placeholder="Nhập tên người dùng" autocomplete="username" required minlength="3"><label for="login-password">Mật khẩu</label><input id="login-password" name="password" type="password" placeholder="Nhập mật khẩu" autocomplete="current-password" required minlength="3"><button class="primary-button" id="login-button" type="submit"><span class="button-label">Đăng nhập</span><span class="button-spinner" aria-hidden="true"></span></button><p id="auth-message" role="status" aria-live="polite"></p></form><button class="auth-switch" id="show-register" type="button">Chưa có tài khoản? Đăng ký</button></div><div id="register-panel" hidden><p class="eyebrow">TÀI KHOẢN MỚI</p><h1>Tạo không gian riêng</h1><p class="auth-copy">Đăng ký để bắt đầu lưu trữ và quản lý ảnh của bạn.</p><form id="register-form"><label for="register-username">Tên người dùng</label><input id="register-username" name="username" placeholder="3–80 ký tự: chữ, số, ., _, -" autocomplete="username" required minlength="3" maxlength="80" pattern="[A-Za-z0-9_.-]{3,80}"><label for="register-password">Mật khẩu</label><input id="register-password" name="password" type="password" placeholder="Ít nhất 6 ký tự" autocomplete="new-password" required minlength="6" maxlength="200"><label for="register-password-confirm">Nhập lại mật khẩu</label><input id="register-password-confirm" name="passwordConfirm" type="password" placeholder="Nhập lại mật khẩu" autocomplete="new-password" required minlength="6" maxlength="200"><button class="primary-button" id="register-button" type="submit"><span class="button-label">Đăng ký</span><span class="button-spinner" aria-hidden="true"></span></button><p id="register-message" role="status" aria-live="polite"></p></form><button class="auth-switch" id="show-login" type="button">Đã có tài khoản? Đăng nhập</button></div></div></section>
  <div class="app-shell dashboard" id="dashboard">
    <aside class="sidebar">
        <div id="image-edit-dialog" class="upload-dialog" hidden><div class="upload-dialog-card" role="dialog" aria-modal="true" aria-labelledby="image-edit-title"><button class="upload-dialog-close" id="image-edit-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">THÔNG TIN ẢNH</p><h2 id="image-edit-title">Chỉnh sửa ảnh</h2><form id="image-edit-form"><label for="image-edit-name">Tên ảnh (không gồm đuôi file)</label><input id="image-edit-name" name="title" maxlength="160" placeholder="Nhập tên ảnh, không cần .jpg hoặc .png"><label for="image-edit-description">Mô tả</label><textarea id="image-edit-description" name="description" maxlength="5000" rows="4"></textarea><label for="image-edit-category">Danh mục</label><select id="image-edit-category" name="category_id"></select><label for="image-edit-visibility">Quyền hiển thị</label><select id="image-edit-visibility" name="visibility"><option value="public">Công khai</option><option value="private">Riêng tư</option><option value="link">Có liên kết</option></select><p id="image-edit-message" class="upload-progress" role="status"></p><div class="upload-dialog-actions"><button class="secondary-button" id="image-edit-cancel-action" type="button">Huỷ</button><button class="primary-button" type="submit">Lưu thay đổi</button></div></form></div></div>

      <a class="brand" href="/" aria-label="Frame trang chủ"><span class="brand-mark">F</span><span>frame<span class="brand-dot">.</span></span></a>
      <nav class="main-nav" aria-label="Điều hướng chính">
        <a class="nav-link${recentPage ? '' : sharedPage ? '' : collectionPage ? '' : ' active'}" href="/"><span class="nav-icon">⌂</span> Tổng quan</a>
        <a class="nav-link${sharedPage ? ' active' : ''}" href="/shared"><span class="nav-icon">↗</span> Chia sẻ</a>

        <a class="nav-link${collectionPage ? ' active' : ''}" href="/collections"><span class="nav-icon">▦</span> Bộ sưu tập</a>
        <a class="nav-link${recentPage ? ' active' : ''}" href="/recent"><span class="nav-icon">◷</span> Gần đây</a>
        <a class="nav-link admin-nav-link${adminPage ? ' active' : ''}" href="/admin" hidden><span class="nav-icon">⚙</span> Quản trị</a>
      </nav>
      <div class="sidebar-bottom"><div class="storage-label"><span>Lưu trữ</span><strong id="storage-percent">0%</strong></div><div class="progress"><span id="storage-progress"></span></div><p id="storage-summary">0 B trong 20 GB</p><a class="user-card" href="#profile"><span class="avatar user-avatar">LB</span><span><strong id="current-user-tag">Đang tải…</strong><small id="current-user-role">Tài khoản</small></span><span class="more">•••</span></a></div>
    </aside>
    <main class="content" id="${collectionPage ? 'collections-page' : 'overview'}">
      <header class="topbar"><button class="mobile-menu" aria-label="Mở menu">☰</button><div class="breadcrumb">Không gian của bạn <span>/</span> ${adminPage ? 'Quản trị' : sharedPage ? 'Chia sẻ' : recentPage ? 'Gần đây' : collectionPage ? 'Bộ sưu tập' : 'Tổng quan'}</div><div class="top-actions"><button class="icon-button theme-toggle" aria-label="Đổi giao diện">☼</button><button class="notification" aria-label="Thông báo">♧<i></i></button><button class="secondary-button logout-button" id="logout-button" type="button"><span class="logout-icon">↪</span><span class="logout-label">Đăng xuất</span><span class="button-spinner" aria-hidden="true"></span></button><span class="top-avatar avatar user-avatar">LB</span></div></header>
      <section class="hero" data-overview-section><div><p class="eyebrow">THỨ BA, 20 THÁNG 10, 2026</p><h1>Xin chào, <span id="current-user-name">bạn</span> <span>✦</span></h1><p class="hero-copy">Lưu giữ những khoảnh khắc làm nên câu chuyện của bạn.</p></div><button class="primary-button" id="upload-button"><span>＋</span> Thêm ảnh mới</button></section>



       <section class="stats" aria-label="Thống kê thư viện" data-overview-section><div class="stat-card"><span class="stat-icon purple">▧</span><div><strong id="overview-image-count">0</strong><small>Tổng số ảnh</small></div><em>— <small>tháng này</small></em></div><div class="stat-card"><span class="stat-icon orange">▦</span><div><strong id="overview-album-count">0</strong><small>Bộ sưu tập</small></div><em>— <small>mới tạo</small></em></div><div class="stat-card"><span class="stat-icon blue">↗</span><div><strong id="overview-shared-count">0</strong><small>Ảnh đã chia sẻ</small></div><em>— <small>tương tác</small></em></div></section>
      <section class="section-heading" id="collections" data-overview-section><div><p class="eyebrow">KHÔNG GIAN CỦA BẠN</p><h2>Bộ sưu tập nổi bật</h2></div><a href="/collections">Xem tất cả <span>→</span></a></section>
      <section class="collection-grid" id="overview-albums" data-overview-section><p class="page-copy">Đang tải album…</p></section>
      <section class="recent-section" id="recent" data-overview-section><div class="section-heading"><div><p class="eyebrow">HOẠT ĐỘNG MỚI NHẤT</p><h2>Ảnh gần đây</h2></div><div class="view-controls"><button class="active" aria-label="Xem dạng lưới">▦</button><button aria-label="Xem dạng danh sách">☷</button></div></div><div class="recent-grid" id="recent-grid-overview"></div></section>

       <section class="collections-page collection-view" id="collections-page" data-view-section="collections"${collectionPage ? '' : ' hidden'}><div class="collection-view-header"><div><p class="eyebrow">THƯ VIỆN CỦA BẠN</p><h1>Tất cả bộ sưu tập</h1><p class="page-copy">Khám phá và quản lý toàn bộ album ảnh trong không gian của bạn.</p></div><div class="collection-header-actions"><button class="secondary-button" type="button" id="upload-collections-button"><span>↑</span> Tải ảnh lên</button><button class="primary-button" type="button" id="new-collection-button"><span>＋</span> Tạo bộ sưu tập</button></div></div><div class="collection-view-toolbar"><strong>Đang tải…</strong><span>Sắp xếp: Mới cập nhật</span></div><div class="collection-grid collection-grid-full"></div></section>
       <section class="collection-view admin-view" id="admin-page" data-view-section="admin" hidden><div class="collection-view-header"><div><p class="eyebrow">VẬN HÀNH AN TOÀN</p><h1>Quản trị hệ thống</h1><p class="page-copy">Chỉ quản lý tài khoản, thống kê và metadata. Tài khoản mới mặc định là khách; chỉ admin cố định có quyền quản trị.</p></div></div><div class="stats admin-stats"><div class="stat-card"><span class="stat-icon purple">♙</span><div><strong id="admin-user-count">—</strong><small>Người dùng</small></div></div><div class="stat-card"><span class="stat-icon orange">▦</span><div><strong id="admin-album-count">—</strong><small>Album</small></div></div><div class="stat-card"><span class="stat-icon blue">▧</span><div><strong id="admin-image-count">—</strong><small>Ảnh metadata</small></div></div><div class="stat-card"><span class="stat-icon purple">◌</span><div><strong id="admin-storage">—</strong><small>Dung lượng</small></div></div></div><div class="admin-grid"><section class="shared-panel"><div class="section-heading"><div><p class="eyebrow">TÀI KHOẢN</p><h2>Người dùng</h2></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Tài khoản</th><th>Album</th><th>Ảnh</th><th>Dung lượng upload</th><th></th></tr></thead><tbody id="admin-users"></tbody></table></div></section><section class="shared-panel"><div class="section-heading"><div><p class="eyebrow">METADATA</p><h2>Album gần đây</h2></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Album</th><th>Chủ sở hữu</th><th>Hiển thị</th><th>Ảnh</th></tr></thead><tbody id="admin-albums"></tbody></table></div></section></div></section>
       <div id="new-collection-dialog" class="upload-dialog" hidden><div class="upload-dialog-card" role="dialog" aria-modal="true" aria-labelledby="new-collection-title"><button class="upload-dialog-close" id="new-collection-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">THƯ VIỆN CỦA BẠN</p><h2 id="new-collection-title">Tạo album mới</h2><form id="new-collection-form"><label for="new-collection-name">Tên album</label><input id="new-collection-name" name="name" maxlength="120" minlength="2" required placeholder="Ví dụ: Kỳ nghỉ Đà Nẵng"><label for="new-collection-description">Mô tả</label><textarea id="new-collection-description" name="description" maxlength="5000" rows="3" placeholder="Mô tả ngắn về album"></textarea><label>Chọn nền album</label><div class="album-theme-picker"><label><input type="radio" name="cover_theme" value="default" checked><span class="theme-preview theme-default">Mặc định</span></label><label><input type="radio" name="cover_theme" value="sunset"><span class="theme-preview theme-sunset">Hoàng hôn</span></label><label><input type="radio" name="cover_theme" value="ocean"><span class="theme-preview theme-ocean">Đại dương</span></label><label><input type="radio" name="cover_theme" value="forest"><span class="theme-preview theme-forest">Thiên nhiên</span></label><label><input type="radio" name="cover_theme" value="lavender"><span class="theme-preview theme-lavender">Tím mộng mơ</span></label><label><input type="radio" name="cover_theme" value="mono"><span class="theme-preview theme-mono">Tối giản</span></label></div><label for="cover-image">Hoặc dùng ảnh bên ngoài làm khung album <small>(JPG, PNG, GIF, WebP; tối đa 10 MB)</small></label><input id="cover-image" name="cover_image" type="file" accept="image/jpeg,image/png,image/gif,image/webp"><label for="new-collection-visibility">Quyền hiển thị</label><select id="new-collection-visibility" name="visibility"><option value="private">Riêng tư</option><option value="link">Có liên kết</option><option value="public">Công khai</option></select><p id="new-collection-message" class="upload-progress" role="status"></p><div class="upload-dialog-actions"><button class="secondary-button" id="new-collection-cancel-action" type="button">Huỷ</button><button class="primary-button" id="new-collection-submit" type="submit"><span class="button-label">Tạo album</span><span class="button-spinner" aria-hidden="true"></span></button></div></form></div></div>


      <section class="recent-page recent-view" id="recent-page" data-page-section="recent"${recentPage ? '' : ' hidden'}><div class="recent-view-header"><div><p class="eyebrow">HOẠT ĐỘNG MỚI NHẤT</p><h1>Gần đây</h1><p class="page-copy">Những ảnh mới được thêm vào thư viện của bạn.</p></div></div><div class="collection-view-toolbar"><strong id="recent-count">Đang tải ảnh…</strong><span>Sắp xếp: Mới nhất</span></div><div class="recent-grid recent-grid-page" id="recent-grid"></div></section>


       <section class="shared-page shared-view" id="shared-page" data-page-section="shared"${sharedPage ? '' : ' hidden'}><div class="shared-view-header"><div><p class="eyebrow">KHÔNG GIAN CỦA BẠN</p><h1>Chia sẻ</h1><p class="page-copy">Quản lý album được chia sẻ với bạn và các liên kết ảnh bạn đã tạo.</p></div><a class="primary-button shared-create-button" href="/collections"><span>＋</span> Chia sẻ album của tôi</a></div><div class="share-tabs"><button class="share-tab active" data-share-tab="albums" type="button">Album được chia sẻ</button><button class="share-tab" data-share-tab="images" type="button">Ảnh đã chia sẻ</button></div><section id="shared-albums-panel"><div class="collection-view-toolbar"><strong id="shared-count">Đang tải…</strong><span>Album được chia sẻ</span></div><div class="collection-grid" id="shared-grid"></div></section><section id="shared-images-panel" hidden><div class="collection-view-toolbar"><strong id="shared-image-count">Đang tải…</strong><span>Liên kết ảnh</span></div><div id="shared-images-list" class="share-list"></div></section></section>



  <div id="bulk-image-share-dialog" class="upload-dialog" hidden><div class="upload-dialog-card" role="dialog" aria-modal="true" aria-labelledby="bulk-image-share-title"><button class="upload-dialog-close" id="bulk-image-share-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">CHIA SẺ NHIỀU ẢNH</p><h2 id="bulk-image-share-title">Chia sẻ ảnh trong album</h2><p id="bulk-image-share-name" class="page-copy"></p><form id="bulk-image-share-form"><label for="bulk-image-share-username">Người nhận</label><input id="bulk-image-share-username" name="username" placeholder="Ví dụ: minh_gallery#4821" required><label>Chọn ảnh</label><div id="bulk-image-share-list" class="bulk-image-share-list"></div><div class="upload-dialog-actions"><button class="secondary-button" id="bulk-image-share-cancel-action" type="button">Huỷ</button><button class="primary-button" type="submit">Chia sẻ ảnh đã chọn</button></div></form><p id="bulk-image-share-message" class="upload-progress" role="status"></p></div></div>

  <div id="image-share-dialog" class="upload-dialog" hidden><div class="upload-dialog-card" role="dialog" aria-modal="true"><button class="upload-dialog-close" id="image-share-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">CHIA SẺ ẢNH RIÊNG</p><h2>Chia sẻ ảnh cho người khác</h2><p id="image-share-name" class="page-copy"></p><form id="image-share-form"><label for="image-share-username">Mã người dùng</label><input id="image-share-username" name="username" placeholder="Ví dụ: minh_gallery#4821" autocomplete="off" required><div class="upload-dialog-actions"><button class="primary-button" type="submit">Chia sẻ ảnh</button></div></form><p id="image-share-message" class="upload-progress" role="status"></p><h3>Đã chia sẻ với</h3><div id="image-share-list" class="share-list"></div><hr><button class="secondary-button" id="image-share-create" type="button">Tạo link công khai</button></div></div>


       <div id="album-dialog" class="upload-dialog" hidden><div class="upload-dialog-card album-dialog-card" role="dialog" aria-modal="true" aria-labelledby="album-dialog-title"><button class="upload-dialog-close" id="album-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">ALBUM</p><div class="album-dialog-heading"><div><h2 id="album-dialog-title"></h2><p id="album-dialog-copy" class="page-copy">Mỗi ảnh có thể đổi tên và chia sẻ riêng.</p></div><button class="primary-button album-dialog-share-button" id="album-dialog-share" type="button" hidden>Chia sẻ album</button></div><label for="album-category-filter">Lọc theo danh mục</label><select id="album-category-filter"><option value="">Tất cả danh mục</option></select><div id="album-images" class="album-images"></div></div></div>
       <div id="image-viewer" class="image-viewer" hidden><button id="image-viewer-close" class="image-viewer-close" type="button" aria-label="Đóng ảnh">×</button><img id="image-viewer-image" src="" alt=""></div>
      <footer><span>© 2026 Frame Gallery</span><span><a href="/health">Hệ thống</a><a href="/metrics">Metrics</a></span></footer>
    </main>
  </div>
  <div id="app-toast" class="app-toast" role="status" aria-live="polite" hidden></div>
  <div id="share-dialog" class="upload-dialog" hidden><div class="upload-dialog-card share-dialog-card" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title"><button class="upload-dialog-close" id="share-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">QUẢN LÝ QUYỀN TRUY CẬP</p><h2 id="share-dialog-title">Chia sẻ album</h2><p id="share-album-name" class="page-copy"></p><form id="share-form"><label for="share-username">Mã người dùng</label><input id="share-username" name="username" placeholder="Ví dụ: minh_gallery#4821" autocomplete="off" required><label for="share-role">Quyền truy cập</label><select id="share-role" name="role"><option value="viewer">Viewer — chỉ xem</option><option value="editor">Editor — được tải ảnh</option></select><div class="upload-dialog-actions"><button class="primary-button" type="submit">Chia sẻ</button></div></form><p id="share-message" class="upload-progress" role="status"></p><h3>Đang được chia sẻ với</h3><div id="share-list" class="share-list"></div></div></div>

  <div id="upload-dialog" class="upload-dialog" hidden><div class="upload-dialog-card" role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title"><button class="upload-dialog-close" id="upload-cancel" type="button" aria-label="Đóng">×</button><p class="eyebrow">THƯ VIỆN CỦA BẠN</p><h2 id="upload-dialog-title">Chọn album để tải ảnh</h2><p id="upload-file-summary" class="upload-file-summary"></p><label for="upload-album">Album</label><select id="upload-album"></select><label for="upload-category">Danh mục</label><select id="upload-category"></select><button class="text-button" id="upload-create-album" type="button">＋ Tạo album mới</button><p id="upload-progress" class="upload-progress" role="status" aria-live="polite"></p><div class="upload-dialog-actions"><button class="secondary-button" id="upload-cancel-action" type="button">Huỷ</button><button class="primary-button" id="upload-submit" type="button"><span class="button-label">Tải ảnh lên</span><span class="button-spinner" aria-hidden="true"></span></button></div></div></div>

  <script src="/js/app.js"></script>
</body>
</html>`);
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'application_started', port }));
});
