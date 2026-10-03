const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// === Generate token BILLY-XXXX ===
function generateToken() {
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return 'BILLY-' + randomDigits;
}

// === Status bot (cek proses) ===
app.get('/api/status', (req, res) => {
  let botOnline = false;
  try {
    const output = execSync('ps aux | grep "node bot.js" | grep -v grep').toString();
    botOnline = output.length > 0;
  } catch (e) {
    botOnline = false;
  }
  res.json({
    status: botOnline ? 'online' : 'offline',
    timestamp: Date.now()
  });
});

// === Upload ===
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;
    
    let token;
    let attempts = 0;
    do {
      token = generateToken();
      attempts++;
    } while (db.get('SELECT * FROM tokens WHERE token = ?', [token]) && attempts < 10);
    
    const expiresAt = Date.now() + (60 * 60 * 1000);
    const mediaType = req.file.mimetype.startsWith('image') ? 'image' : 
                     req.file.mimetype.startsWith('video') ? 'video' : 'file';
    
    db.run(
      'INSERT INTO tokens (token, file_url, file_name, file_size, media_type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [token, fileUrl, req.file.originalname, req.file.size, mediaType, Date.now(), expiresAt]
    );
    
    res.json({ 
      success: true, 
      token, 
      url: fileUrl, 
      expiresAt, 
      mediaType, 
      fileName: req.file.originalname, 
      fileSize: req.file.size 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Cek token ===
app.get('/api/token/:token', (req, res) => {
  const token = db.get('SELECT * FROM tokens WHERE token = ?', [req.params.token]);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  if (Date.now() > token.expires_at) {
    db.updateTokenStatus(req.params.token, 'expired');
    return res.status(410).json({ error: 'Token expired' });
  }
  res.json({ success: true, data: token });
});

// === List token ===
app.get('/api/tokens', (req, res) => {
  const data = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
  res.json({ success: true, tokens: data.tokens.slice(-20).reverse() });
});

(async () => {
  await db.initDB();
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
})();
