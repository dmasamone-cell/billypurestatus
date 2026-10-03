const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      return { tokens: [] };
    }
  }
  return { tokens: [] };
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function run(sql, params) {
  const data = loadDB();
  const [token, file_url, file_name, file_size, media_type, created_at, expires_at] = params;
  data.tokens.push({
    id: data.tokens.length + 1,
    token,
    file_url,
    file_name,
    file_size,
    media_type,
    created_at,
    expires_at,
    status: 'pending'
  });
  saveDB(data);
}

function get(sql, params) {
  const data = loadDB();
  const token = params[0];
  return data.tokens.find(t => t.token === token) || null;
}

function updateTokenStatus(token, status) {
  const data = loadDB();
  const t = data.tokens.find(t => t.token === token);
  if (t) {
    t.status = status;
    saveDB(data);
  }
}

async function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    saveDB({ tokens: [] });
  }
  return true;
}

module.exports = { initDB, run, get, updateTokenStatus };
