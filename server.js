const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cafm_dev_secret';
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(express.static('.'));

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'yourgmail@gmail.com',
    pass: process.env.EMAIL_PASS || 'yourpassword'
  }
});

// Database setup
const db = new sqlite3.Database('./caf.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    createTables();
  }
});

function hashPassword(password, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${derived}`;
}

function verifyPassword(password, hashed) {
  if (!hashed || !hashed.includes(':')) return false;
  const [salt, stored] = hashed.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(derived, 'hex'));
}

function randomToken(length = 48) {
  return crypto.randomBytes(length).toString('hex');
}

function createTables() {
  const schemas = {
    Projects: `CREATE TABLE IF NOT EXISTS Projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      pi TEXT,
      students TEXT,
      animals TEXT,
      status TEXT,
      startDate TEXT,
      duration TEXT,
      description TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      ModifiedBy TEXT,
      Timestamp TEXT
    )`,
    Animals: `CREATE TABLE IF NOT EXISTS Animals (
      id TEXT PRIMARY KEY,
      species TEXT,
      age TEXT,
      gender TEXT,
      project TEXT,
      status TEXT,
      details TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      ModifiedBy TEXT,
      Timestamp TEXT
    )`,
    Tasks: `CREATE TABLE IF NOT EXISTS Tasks (
      id TEXT PRIMARY KEY,
      task TEXT,
      type TEXT,
      priority TEXT,
      assignedTo TEXT,
      dueDate TEXT,
      status TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      ModifiedBy TEXT,
      Timestamp TEXT
    )`,
    Breeding: `CREATE TABLE IF NOT EXISTS Breeding (
      id TEXT PRIMARY KEY,
      species TEXT,
      male TEXT,
      female TEXT,
      cageId TEXT,
      startDate TEXT,
      expected TEXT,
      status TEXT,
      litterSize TEXT,
      litterIds TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      ModifiedBy TEXT,
      Timestamp TEXT
    )`,
    Reports: `CREATE TABLE IF NOT EXISTS Reports (
      id TEXT PRIMARY KEY,
      type TEXT,
      project TEXT,
      approval TEXT,
      dateOfApproval TEXT,
      validUntil TEXT,
      approvedAnimals TEXT,
      status TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      ModifiedBy TEXT,
      Timestamp TEXT
    )`,
    Users: `CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      name TEXT,
      role TEXT,
      status TEXT,
      passwordHash TEXT,
      pi TEXT,
      resetToken TEXT,
      resetExpires TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )`,
    Sessions: `CREATE TABLE IF NOT EXISTS Sessions (
      token TEXT PRIMARY KEY,
      email TEXT,
      role TEXT,
      createdAt TEXT,
      expiresAt TEXT
    )`
  };

  Object.values(schemas).forEach(sql => {
    db.run(sql, (err) => {
      if (err) console.error('Error creating table:', err.message);
    });
  });

  db.run(`ALTER TABLE Reports ADD COLUMN approvedAnimals TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) {
      console.error('Error adding approvedAnimals column:', err.message);
    }
  });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Missing authorization token.' });
  }
  const token = authHeader.split(' ')[1];
  const now = new Date().toISOString();
  db.get('SELECT token, email, role, expiresAt FROM Sessions WHERE token = ?', [token], (err, session) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (!session) return res.status(401).json({ status: 'error', message: 'Invalid session token.' });
    if (!session.expiresAt || session.expiresAt < now) {
      db.run('DELETE FROM Sessions WHERE token = ?', [token]);
      return res.status(401).json({ status: 'error', message: 'Session expired.' });
    }
    req.user = { email: session.email, role: session.role, token };
    next();
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

app.get('/auth/admin-exists', async (req, res) => {
  try {
    const admin = await getQuery('SELECT id FROM Users WHERE role = ? LIMIT 1', ['admin']);
    return res.json({ hasAdmin: !!admin });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/setup', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ status: 'error', message: 'Missing setup fields.' });
  }
  try {
    const adminExists = await getQuery('SELECT id FROM Users WHERE role = ? LIMIT 1', ['admin']);
    if (adminExists) {
      return res.status(400).json({ status: 'error', message: 'Admin already exists.' });
    }
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();
    await runQuery('INSERT INTO Users (email, name, role, status, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)', [email.toLowerCase(), name, 'admin', 'approved', passwordHash, now, now]);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ status: 'error', message: 'Missing login fields.' });
  }
  try {
    const user = await getQuery('SELECT id, email, name, role, status, passwordHash FROM Users WHERE email = ? AND role = ? LIMIT 1', [email.toLowerCase(), role]);
    if (!user) return res.status(401).json({ status: 'error', message: 'Invalid credentials.' });
    if (user.status === 'pending') return res.status(403).json({ status: 'error', message: 'Account awaiting approval.' });
    if (user.status === 'rejected') return res.status(403).json({ status: 'error', message: 'Account rejected.' });
    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials.' });
    }
    const token = randomToken(24);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await runQuery('INSERT OR REPLACE INTO Sessions (token, email, role, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)', [token, user.email, user.role, now, expiresAt]);
    return res.json({ status: 'ok', token, email: user.email, role: user.role, name: user.name });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    await runQuery('DELETE FROM Sessions WHERE token = ?', [req.user.token]);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/signup', async (req, res) => {
  const { email, name, role, password, pi } = req.body;
  if (!email || !name || !role || !password) {
    return res.status(400).json({ status: 'error', message: 'Missing signup fields.' });
  }
  try {
    const existing = await getQuery('SELECT id FROM Users WHERE email = ?', [email.toLowerCase()]);
    if (existing) {
      return res.status(400).json({ status: 'error', message: 'An account already exists with this email.' });
    }
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();
    await runQuery('INSERT INTO Users (email, name, role, status, passwordHash, pi, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [email.toLowerCase(), name, role, 'pending', passwordHash, pi || null, now, now]);

    const admin = await getQuery('SELECT email FROM Users WHERE role = ? LIMIT 1', ['admin']);
    if (admin?.email) {
      await sendEmail(admin.email, 'New CAFm signup request', `A new ${role} account request has been submitted by ${name} (${email}).`);
    }
    if (role === 'student' && pi) {
      const piUser = await getQuery('SELECT email FROM Users WHERE name = ? LIMIT 1', [pi]);
      if (piUser?.email) {
        await sendEmail(piUser.email, 'New student signup request', `A new student, ${name} (${email}), is requesting to join your group. Admin approval is pending.`);
      }
    }

    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/auth/public-users', async (req, res) => {
  const { role } = req.query;
  if (!role) {
    return res.status(400).json({ status: 'error', message: 'Missing role parameter.' });
  }
  try {
    const users = await allQuery('SELECT id, email, name, role, pi FROM Users WHERE role = ? AND status = ?', [role, 'approved']);
    return res.json({ status: 'ok', users });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/auth/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin only.' });
  }
  const { role } = req.query;
  try {
    const params = [];
    let sql = 'SELECT id, email, name, role, status, pi, createdAt, updatedAt FROM Users';
    if (role) {
      sql += ' WHERE role = ?';
      params.push(role);
    }
    const users = await allQuery(sql, params);
    return res.json({ status: 'ok', users });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/users/:id/approve', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin only.' });
  }
  const { id } = req.params;
  try {
    await runQuery('UPDATE Users SET status = ?, updatedAt = ? WHERE id = ?', ['approved', new Date().toISOString(), id]);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/users/:id/reject', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin only.' });
  }
  const { id } = req.params;
  try {
    await runQuery('UPDATE Users SET status = ?, updatedAt = ? WHERE id = ?', ['rejected', new Date().toISOString(), id]);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/users/:id/delete', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin only.' });
  }
  const { id } = req.params;
  try {
    await runQuery('DELETE FROM Users WHERE id = ?', [id]);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/recover', async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ status: 'error', message: 'Missing recovery fields.' });
  }
  try {
    const user = await getQuery('SELECT id, name FROM Users WHERE email = ? AND role = ? LIMIT 1', [email.toLowerCase(), role]);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'No account found for that email and role.' });
    }
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    await runQuery('UPDATE Users SET resetToken = ?, resetExpires = ?, updatedAt = ? WHERE id = ?', [token, expiresAt, new Date().toISOString(), user.id]);
    const resetLink = `${req.protocol}://${req.get('host')}/?resetToken=${token}`;
    await sendEmail(email, 'CAFm password reset', `Hello ${user.name},\n\nUse this link to reset your password:\n${resetLink}\n\nThe link expires in 1 hour.`);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/auth/reset', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ status: 'error', message: 'Missing reset fields.' });
  }
  try {
    const user = await getQuery('SELECT id, resetExpires FROM Users WHERE resetToken = ? LIMIT 1', [token]);
    if (!user) return res.status(400).json({ status: 'error', message: 'Invalid or expired reset token.' });
    if (!user.resetExpires || user.resetExpires < new Date().toISOString()) {
      return res.status(400).json({ status: 'error', message: 'Reset token expired.' });
    }
    const passwordHash = hashPassword(password);
    await runQuery('UPDATE Users SET passwordHash = ?, resetToken = NULL, resetExpires = NULL, updatedAt = ? WHERE id = ?', [passwordHash, new Date().toISOString(), user.id]);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/auth/me', authenticateToken, async (req, res) => {
  return res.json({ status: 'ok', user: req.user });
});

app.post('/sync', authenticateToken, (req, res) => {
  const { sheet, action, data, user, timestamp } = req.body;
  const serverTs = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  try {
    if (action === 'insert') {
      insertRow(sheet, data, user, serverTs, res);
    } else if (action === 'update') {
      updateRow(sheet, data, user, serverTs, res);
    } else if (action === 'delete') {
      deleteRow(sheet, data.id, res);
    } else {
      res.json({ status: 'error', message: 'Unknown action: ' + action });
    }
  } catch (err) {
    res.json({ status: 'error', message: err.message });
  }
});

app.post('/send-email', authenticateToken, async (req, res) => {
  const { to, subject, text } = req.body;
  try {
    await sendEmail(to, subject, text);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

function sendEmail(to, subject, text) {
  return new Promise((resolve, reject) => {
    transporter.sendMail({
      from: process.env.EMAIL_USER || 'yourgmail@gmail.com',
      to,
      subject,
      text
    }, (err, info) => {
      if (err) {
        console.error('Error sending email:', err);
        return reject(err);
      }
      console.log('Email sent:', info.response);
      resolve(info);
    });
  });
}

function insertRow(sheet, data, user, serverTs, res) {
  const columns = getColumns(sheet);
  const values = columns.map(col => {
    if (col === 'Timestamp') return serverTs;
    if (col === 'ModifiedBy') return user || '';
    return data[col] !== undefined && data[col] !== null ? String(data[col]) : '';
  });

  const placeholders = columns.map(() => '?').join(',');
  const sql = `INSERT INTO ${sheet} (${columns.join(',')}) VALUES (${placeholders})`;

  db.run(sql, values, function(err) {
    if (err) {
      res.json({ status: 'error', message: err.message });
    } else {
      res.json({ status: 'ok', sheet, action: 'insert', serverTs });
    }
  });
}

function updateRow(sheet, data, user, serverTs, res) {
  const columns = getColumns(sheet);
  const setClause = columns.map(col => `${col} = ?`).join(', ');
  const values = columns.map(col => {
    if (col === 'Timestamp') return serverTs;
    if (col === 'ModifiedBy') return user || '';
    return data[col] !== undefined && data[col] !== null ? String(data[col]) : '';
  });
  values.push(data.id);

  const sql = `UPDATE ${sheet} SET ${setClause} WHERE id = ?`;
  db.run(sql, values, function(err) {
    if (err) {
      res.json({ status: 'error', message: err.message });
    } else if (this.changes === 0) {
      insertRow(sheet, data, user, serverTs, res);
    } else {
      res.json({ status: 'ok', sheet, action: 'update', serverTs });
    }
  });
}

function deleteRow(sheet, id, res) {
  const sql = `DELETE FROM ${sheet} WHERE id = ?`;
  db.run(sql, [id], function(err) {
    if (err) {
      res.json({ status: 'error', message: err.message });
    } else {
      res.json({ status: 'ok', sheet, action: 'delete' });
    }
  });
}

function getColumns(sheet) {
  const schema = {
    Projects: ['id','name','pi','students','animals','status','startDate','duration','description','createdAt','updatedAt','ModifiedBy','Timestamp'],
    Animals:  ['id','species','age','gender','project','status','details','createdAt','updatedAt','ModifiedBy','Timestamp'],
    Tasks:    ['id','task','type','priority','assignedTo','dueDate','status','createdAt','updatedAt','ModifiedBy','Timestamp'],
    Breeding: ['id','species','male','female','cageId','startDate','expected','status','litterSize','litterIds','createdAt','updatedAt','ModifiedBy','Timestamp'],
    Reports:  ['id','type','project','approval','dateOfApproval','validUntil','approvedAnimals','status','createdAt','updatedAt','ModifiedBy','Timestamp']
  };
  return schema[sheet] || [];
}

const useHttps = process.env.HTTPS_KEY && process.env.HTTPS_CERT;
if (useHttps) {
  const options = {
    key: fs.readFileSync(process.env.HTTPS_KEY),
    cert: fs.readFileSync(process.env.HTTPS_CERT)
  };
  https.createServer(options, app).listen(PORT, () => {
    console.log(`Server running securely on https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
