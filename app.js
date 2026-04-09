// =============================================================
// app.js — CAFm  |  IndexedDB (Dexie) + SQL sync
// =============================================================

console.log('App.js loaded');

// ── Global state ──────────────────────────────────────────────
let currentUser = null;
let currentUserName = null;
let currentRole = null;
let authToken = null;
const AUTH_TOKEN_KEY = 'cafmAuthToken';

// ── Dexie DB ──────────────────────────────────────────────────
const db = new Dexie('animal_pwa');
db.version(1).stores({
  projects: 'id,name,pi,students,animals,status',
  tasks:    '++id,task,type,assignedTo,dueDate,status',
  animals:  'id,species,age,gender,project,status,details',
  breeding: 'id,species,male,female,startDate,expected,status',
  reports:  '++id,type,project,approval,validUntil,status',
  meta:     'key'
});
db.version(2).stores({
  projects: 'id,name,pi,students,animals,status',
  tasks:    '++id,task,type,assignedTo,dueDate,status',
  animals:  'id,species,age,gender,project,status,details',
  breeding: 'id,species,male,female,startDate,expected,status',
  reports:  '++id,type,project,approval,validUntil,status',
  meta:     'key',
  users:    '++id,email,name,role,status,pi'
});
db.version(3).stores({
  projects: 'id,name,pi,students,animals,status',
  tasks:    '++id,task,type,priority,assignedTo,dueDate,status',
  animals:  'id,species,age,gender,project,status,details',
  breeding: 'id,species,male,female,cageId,startDate,expected,status,litterSize,litterIds',
  reports:  '++id,type,project,approval,dateOfApproval,validUntil,status',
  meta:     'key',
  users:    '++id,email,name,role,status,pi'
});
db.version(4).stores({
  projects: 'id,name,pi,students,animals,status',
  tasks:    '++id,task,type,priority,assignedTo,dueDate,status',
  animals:  'id,species,age,gender,project,status,details',
  breeding: 'id,species,male,female,cageId,startDate,expected,status,litterSize,litterIds',
  reports:  '++id,type,project,approval,dateOfApproval,validUntil,status',
  meta:     'key',
  users:    '++id,email,name,role,status,pi'
});

const API_BASE = '';

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = authToken || localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function saveSession(token, user, name, role) {
  authToken = token;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem('cafmCurrentUser', user);
  localStorage.setItem('cafmCurrentUserName', name);
  localStorage.setItem('cafmCurrentRole', role);
}

async function restoreSession() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const user = localStorage.getItem('cafmCurrentUser');
  const name = localStorage.getItem('cafmCurrentUserName');
  const role = localStorage.getItem('cafmCurrentRole');
  authToken = token;
  return { token, user, name, role };
}

async function clearSession() {
  authToken = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem('cafmCurrentUser');
  localStorage.removeItem('cafmCurrentUserName');
  localStorage.removeItem('cafmCurrentRole');
}

async function apiFetch(path, options = {}) {
  const opts = { headers: getAuthHeaders(), ...options };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(API_BASE + path, opts);
}

// ── Page navigation helpers ───────────────────────────────────
function showLoginPage() {
  document.getElementById('adminSetupPage').style.display = 'none';
  document.getElementById('signupPage').style.display     = 'none';
  document.getElementById('recoveryPage').style.display   = 'none';
  document.getElementById('loginPage').style.display      = 'flex';
}
function showSignupPage() {
  document.getElementById('loginPage').style.display    = 'none';
  document.getElementById('recoveryPage').style.display = 'none';
  document.getElementById('resetPasswordPage').style.display = 'none';
  document.getElementById('signupPage').style.display   = 'flex';
}
function showRecoveryPage() {
  document.getElementById('loginPage').style.display    = 'none';
  document.getElementById('signupPage').style.display   = 'none';
  document.getElementById('resetPasswordPage').style.display = 'none';
  document.getElementById('recoveryPage').style.display = 'flex';
}
function showResetPasswordPage() {
  document.getElementById('loginPage').style.display        = 'none';
  document.getElementById('signupPage').style.display       = 'none';
  document.getElementById('recoveryPage').style.display     = 'none';
  document.getElementById('resetPasswordPage').style.display = 'flex';
}

// ── Toast Notifications ───────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark',
                  warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Timestamp helper ──────────────────────────────────────────
function nowISO() { return new Date().toISOString(); }
function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

const SPECIES_PREFIX = {
  'Rat':        'RAT',
  'Mouse':      'MUS',
  'Guinea Pig': 'GP',
  'Rabbit':     'RBT',
  'Hamster':    'HAM',
  'Zebrafish':  'ZBF',
  'Frog':       'FRG',
};

async function generateAnimalId() {
  // Assign sequential 6-digit numeric IDs (000001, 000002, ...)
  const existing = await db.animals.toArray();
  const maxNum = existing.reduce((max, a) => {
    const n = parseInt(String(a.id).replace(/^0+/, ''), 10);
    if (Number.isFinite(n) && !Number.isNaN(n)) {
      return Math.max(max, n);
    }
    return max;
  }, 0);
  return String(maxNum + 1).padStart(6, '0');
}

// ── Seed ──────────────────────────────────────────────────────
async function seedIfEmpty(initial) {
  const [c1, c2, c3, c4, c5] = await Promise.all([
    db.projects.count(), db.tasks.count(), db.animals.count(),
    db.breeding.count(), db.reports.count()
  ]);
  if ([c1, c2, c3, c4, c5].every(c => c === 0)) {
    const ts = nowISO();
    const stamp = arr => arr.map(r => ({ ...r, createdAt: ts, updatedAt: ts }));
    await db.transaction('rw', db.projects, db.tasks, db.animals, db.breeding, db.reports, async () => {
      await db.projects.bulkAdd(stamp(initial.projects));
      await db.tasks.bulkAdd(stamp(initial.tasks));
      await db.animals.bulkAdd(stamp(initial.animals));
      await db.breeding.bulkAdd(stamp(initial.breeding));
      await db.reports.bulkAdd(stamp(initial.reports));
    });
  }
}

// ── Session ───────────────────────────────────────────────────
async function saveSession(token, user, name, role) {
  await saveSessionData(token, user, name, role);
}
async function saveSessionData(token, user, name, role) {
  authToken = token;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem('cafmCurrentUser', user);
  localStorage.setItem('cafmCurrentUserName', name);
  localStorage.setItem('cafmCurrentRole', role);
}
async function restoreSession() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const user = localStorage.getItem('cafmCurrentUser');
  const name = localStorage.getItem('cafmCurrentUserName');
  const role = localStorage.getItem('cafmCurrentRole');
  authToken = token;
  return { token, user, name, role };
}

// ── Init ──────────────────────────────────────────────────────
(async function initApp() {
  console.log('initApp started');
  await seedIfEmpty(sampleData);
  SHEETS_SYNC.init();

  // Check for reset token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('resetToken');
  if (resetToken) {
    document.getElementById('resetToken').value = resetToken;
    showResetPasswordPage();
    return;
  }

  let adminExists = true;
  try {
    const resp = await fetch('/auth/admin-exists');
    const json = await resp.json();
    adminExists = json.hasAdmin;
  } catch (err) {
    console.warn('Unable to validate admin existence:', err);
  }

  if (!adminExists) {
    document.getElementById('adminSetupPage').style.display = 'flex';
    return;
  }

  const { token, user, name, role } = await restoreSession();
  if (token && user && role) {
    const authResp = await apiFetch('/auth/me');
    if (authResp.ok) {
      currentUser = user;
      currentUserName = name;
      currentRole = role;
      _showDashboard(user, role);
      await loadDashboard();
      return;
    }
    await clearSession();
  }

  document.getElementById('loginPage').style.display = 'flex';
})();

function _showDashboard(user, role) {
  document.getElementById('loginPage').style.display      = 'none';
  document.getElementById('signupPage').style.display     = 'none';
  document.getElementById('adminSetupPage').style.display = 'none';
  document.getElementById('recoveryPage').style.display   = 'none';
  document.getElementById('dashboard').classList.add('active');
  document.getElementById('userDisplay').textContent = `${role.toUpperCase()}: ${user}`;
  const umItem = document.getElementById('userMgmtSidebarItem');
  if (umItem) umItem.style.display = role === 'admin' ? 'flex' : 'none';
  const addProjectBtn = document.getElementById('addProjectBtn');
  if (addProjectBtn) addProjectBtn.style.display = (role === 'admin' || role === 'pi') ? 'inline-block' : 'none';
  const addReportBtn = document.getElementById('addReportBtn');
  if (addReportBtn) addReportBtn.style.display = (role === 'admin' || role === 'pi') ? 'inline-block' : 'none';
  const addTaskBtn = document.getElementById('addTaskBtn');
  if (addTaskBtn) addTaskBtn.style.display = (role === 'admin' || role === 'pi') ? 'inline-block' : 'none';
  const addBreedingBtn = document.getElementById('addBreedingBtn');
  if (addBreedingBtn) addBreedingBtn.style.display = (role === 'admin' || role === 'pi') ? 'inline-block' : 'none';
}

async function createAdminAccount(email, name, password) {
  await apiFetch('/auth/setup', {
    method: 'POST',
    body: { email: email.toLowerCase(), name, password }
  });
}

async function addSignupRequest(email, name, role, password, pi = null) {
  const resp = await apiFetch('/auth/signup', {
    method: 'POST',
    body: { email: email.toLowerCase(), name, role, password, pi }
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json.message || 'Signup request failed.');
  }
}

async function loadUserManagement() {
  const tbody = document.querySelector('#userManagementTable tbody');
  if (!tbody) return;

  const resp = await apiFetch('/auth/users');
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Unable to load user management.', 'error');
    return;
  }

  tbody.innerHTML = '';
  json.users.forEach(u => {
    const pendingActions = u.status === 'pending'
      ? '<button class="btn-small" onclick="approveUser(' + u.id + ')"><i class="fa-solid fa-check"></i> Approve</button> <button class="btn-small btn-danger" onclick="rejectUser(' + u.id + ')"><i class="fa-solid fa-xmark"></i> Reject</button>'
      : '';
    const deleteAction = u.role !== 'admin'
      ? '<button class="btn-small btn-danger" onclick="deleteUser(' + u.id + ')"><i class="fa-solid fa-trash"></i> Remove</button>'
      : '';

    tbody.innerHTML += `
      <tr>
        <td>${u.email}</td>
        <td>${u.name || '—'}</td>
        <td>${u.role}</td>
        <td><span class="badge badge-${u.status === 'approved' ? 'alive' : u.status === 'pending' ? 'experiment' : 'terminated'}">${u.status}</span></td>
        <td>${fmtTs(u.createdAt)}</td>
        <td>
          ${pendingActions}
          ${deleteAction}
        </td>
      </tr>`;
  });
  buildDropdownFilters('userManagementTable');
  applyTableFilters('userManagementTable');
}

function buildDropdownFilters(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const filterRow = table.querySelector('thead tr.filter-row');
  if (!filterRow) return;

  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const columns = filterRow.querySelectorAll('th');

  columns.forEach((th, colIndex) => {
    th.innerHTML = '';

    // Skip the action column (last column) if it has no filter requirement
    if (colIndex === columns.length - 1) {
      th.textContent = '';
      return;
    }

    const select = document.createElement('select');
    select.className = 'column-filter';
    select.dataset.colIndex = colIndex;

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'All';
    select.appendChild(emptyOpt);

    const values = new Set();
    rows.forEach(row => {
      const cell = row.cells[colIndex];
      if (!cell) return;
      const value = cell.textContent.trim();
      if (value) values.add(value);
    });

    Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach(value => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => applyTableFilters(tableId));
    th.appendChild(select);
  });
}

function applyTableFilters(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const filters = Array.from(table.querySelectorAll('.column-filter'))
    .map(select => ({ index: Number(select.dataset.colIndex), value: select.value.trim().toLowerCase() }))
    .filter(f => f.value !== '');

  const rows = Array.from(table.querySelectorAll('tbody tr'));

  rows.forEach(row => {
    let visible = true;
    filters.forEach(filter => {
      const cell = row.cells[filter.index];
      if (!cell) return;
      const cellText = cell.textContent.trim().toLowerCase();
      if (filter.value && cellText !== filter.value) {
        visible = false;
      }
    });
    row.style.display = visible ? '' : 'none';
  });
}

window.approveUser = async function (id) {
  const resp = await apiFetch(`/auth/users/${id}/approve`, { method: 'POST' });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Approval failed.', 'error');
    return;
  }
  showToast('User approved.', 'success');
  await loadUserManagement();
};

window.rejectUser = async function (id) {
  const resp = await apiFetch(`/auth/users/${id}/reject`, { method: 'POST' });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Reject failed.', 'error');
    return;
  }
  showToast('User rejected.', 'warning');
  await loadUserManagement();
};

window.deleteUser = async function (id) {
  if (!confirm('Remove this user permanently?')) return;
  const resp = await apiFetch(`/auth/users/${id}/delete`, { method: 'POST' });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Delete failed.', 'error');
    return;
  }
  showToast('User removed.', 'success');
  await loadUserManagement();
};

function updateLoginUIAfterAuth() {
  const link = document.getElementById('legacyLoginDemo');
  if (link) link.style.display = 'none';
}

// ── Auth ──────────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const role     = document.getElementById('role').value;
  const email    = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  if (!role || !email || !password) {
    showToast('Please fill all login fields.', 'warning');
    return;
  }

  const resp = await apiFetch('/auth/login', {
    method: 'POST',
    body: { email, password, role }
  });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Invalid credentials.', 'error');
    return;
  }

  currentUser = json.email;
  currentUserName = json.name;
  currentRole = json.role;
  await saveSession(json.token, currentUser, currentUserName, currentRole);
  _showDashboard(currentUser, currentRole);
  updateLoginUIAfterAuth();
  await loadDashboard();
});

// Signup + Admin setup handlers
document.getElementById('showSignupLink').addEventListener('click', (e) => {
  e.preventDefault();
  showSignupPage();
});

document.getElementById('showRecoveryLink').addEventListener('click', (e) => {
  e.preventDefault();
  showRecoveryPage();
});

document.getElementById('backToLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
  showLoginPage();
});

document.getElementById('backToLoginFromRecoveryLink').addEventListener('click', (e) => {
  e.preventDefault();
  showLoginPage();
});

document.getElementById('backToLoginFromResetLink').addEventListener('click', (e) => {
  e.preventDefault();
  showLoginPage();
});

document.getElementById('passwordRecoveryForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const role  = document.getElementById('recoveryRole').value;
  const email = document.getElementById('recoveryEmail').value.trim().toLowerCase();
  if (!role || !email) {
    showToast('Please select your role and enter your email.', 'warning');
    return;
  }

  const resp = await apiFetch('/auth/recover', {
    method: 'POST',
    body: { email, role }
  });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Recovery request failed.', 'error');
    return;
  }

  showToast('Password reset link sent. Check your inbox.', 'success');
  document.getElementById('passwordRecoveryForm').reset();
  showLoginPage();
});

document.getElementById('resetPasswordForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const token = document.getElementById('resetToken').value;
  const password = document.getElementById('resetPassword').value;
  const passwordConfirm = document.getElementById('resetPasswordConfirm').value;
  if (!token || !password || !passwordConfirm) {
    showToast('Please enter and confirm your new password.', 'warning');
    return;
  }
  if (password !== passwordConfirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  const resp = await apiFetch('/auth/reset', {
    method: 'POST',
    body: { token, password }
  });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Password reset failed.', 'error');
    return;
  }

  showToast('Password has been reset. Please login.', 'success');
  document.getElementById('resetPasswordForm').reset();
  showLoginPage();
});

document.getElementById('adminSetupForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const email           = document.getElementById('adminEmail').value.trim().toLowerCase();
  const name            = document.getElementById('adminName').value.trim();
  const password        = document.getElementById('adminPassword').value;
  const passwordConfirm = document.getElementById('adminPasswordConfirm').value;

  if (!email || !name || !password || !passwordConfirm) {
    showToast('Fill all fields to create admin account.', 'warning');
    return;
  }
  if (password !== passwordConfirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  const resp = await apiFetch('/auth/setup', {
    method: 'POST',
    body: { email, name, password }
  });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Unable to create admin account.', 'error');
    return;
  }

  showToast('Admin account created. Please login.', 'success');
  document.getElementById('adminSetupForm').reset();
  showLoginPage();
});

document.getElementById('signupRole').addEventListener('change', function() {
  const role = this.value;
  const piGroup = document.getElementById('piGroup');
  if (role === 'student') {
    populateSignupPI();
    piGroup.style.display = 'block';
  } else {
    piGroup.style.display = 'none';
  }
});

async function populateSignupPI() {
  const resp = await fetch('/auth/public-users?role=pi');
  const json = await resp.json();
  const pis = json.users || [];
  const piSelect = document.getElementById('signupPI');
  piSelect.innerHTML = '<option value="">Select PI</option>' + pis.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
}

document.getElementById('signupForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const email           = document.getElementById('signupEmail').value.trim().toLowerCase();
  const name            = document.getElementById('signupName').value.trim();
  const role            = document.getElementById('signupRole').value;
  const password        = document.getElementById('signupPassword').value;
  const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

  let pi = null;
  if (role === 'student') {
    pi = document.getElementById('signupPI').value;
    if (!pi) {
      showToast('Please select an associated PI.', 'warning');
      return;
    }
  }

  if (!email || !name || !role || !password || !passwordConfirm) {
    showToast('Fill all fields.', 'warning');
    return;
  }
  if (password !== passwordConfirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  const resp = await apiFetch('/auth/signup', {
    method: 'POST',
    body: { email, name, role, password, pi }
  });
  const json = await resp.json();
  if (!resp.ok) {
    showToast(json.message || 'Signup request failed.', 'error');
    return;
  }

  showToast('Signup request submitted. Await admin approval.', 'success');
  document.getElementById('signupForm').reset();
  showLoginPage();
});

// Ensure pending admin user sees user management data when tab is selected
window.showTab = (function (orig) {
  return function (tabName, el) {
    orig(tabName, el);
    if (tabName === 'userManagement') {
      loadUserManagement();
    }
  };
})(showTab);


async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  currentUser = null;
  currentUserName = null;
  currentRole = null;
  await clearSession();
  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginForm').reset();
}

async function resetBrowser() {
  if (!confirm('This will delete ALL local data (projects, animals, tasks, breeding, reports, users) and reload the app. Are you sure?')) return;
  try {
    await db.delete();
    localStorage.clear();
    sessionStorage.clear();
    showToast('All local data cleared. Reloading…', 'info', 1500);
    setTimeout(() => location.reload(), 1600);
  } catch (err) {
    console.error(err);
    showToast('Reset failed. Check console.', 'error');
  }
}

// ── Navigation ────────────────────────────────────────────────
function showTab(tabName, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  if (el) el.classList.add('active');
}

// ── Role filtering ────────────────────────────────────────────
function matchCurrentUser(value) {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  const email = String(currentUser || '').toLowerCase();
  const name = String(currentUserName || '').toLowerCase();
  return normalized === email || normalized === name || normalized.includes(email) || (name && normalized.includes(name));
}

function matchesAnyCurrentUser(values) {
  if (!values) return false;
  return values.split(',').some(v => matchCurrentUser(v.trim()));
}

function filterProjectsByRole(projects) {
  if (currentRole === 'admin') return projects;
  if (currentRole === 'pi') {
    return projects.filter(p => matchCurrentUser(p.pi));
  }
  if (currentRole === 'student') {
    return projects.filter(p => matchesAnyCurrentUser(p.students));
  }
  return projects;
}

function filterTasksByRole(tasks, projects) {
  if (currentRole === 'admin') return tasks;
  if (currentRole === 'pi') {
    // PI sees tasks assigned to themselves or their students
    const piProjects = filterProjectsByRole(projects);
    const students = new Set();
    piProjects.forEach(p => {
      if (p.students) p.students.split(',').forEach(s => students.add(s.trim()));
    });
    return tasks.filter(t => t.assignedTo === currentUser || students.has(t.assignedTo));
  }
  if (currentRole === 'student') return tasks.filter(t => t.assignedTo === currentUser);
  return tasks;
}

function filterAnimalsByRole(animals, projects) {
  const allowedProjects = filterProjectsByRole(projects).map(p => p.id);
  return animals.filter(a => allowedProjects.includes(a.project));
}

function filterBreedingByRole(breeding, animals, projects) {
  const allowedAnimals = filterAnimalsByRole(animals, projects).map(a => a.id);
  return breeding.filter(b => allowedAnimals.includes(b.male) || allowedAnimals.includes(b.female));
}

function filterReportsByRole(reports) {
  // All can see, but add permission for adding
  return reports;
}

// ── Dashboard loader ──────────────────────────────────────────
async function loadDashboard() {
  const [projects, animals, tasks, breeding, reports] = await Promise.all([
    db.projects.toArray(), db.animals.toArray(), db.tasks.toArray(),
    db.breeding.toArray(), db.reports.toArray()
  ]);

  // Apply role-based filtering
  const filteredProjects = filterProjectsByRole(projects);
  const filteredAnimals = filterAnimalsByRole(animals, projects);
  const filteredTasks = filterTasksByRole(tasks, projects);
  const filteredBreeding = filterBreedingByRole(breeding, animals, projects);
  const filteredReports = filterReportsByRole(reports);

  // Update dashboard stats based on filtered data
  document.getElementById('totalProjects').textContent   = filteredProjects.length;
  document.getElementById('animalsAssigned').textContent = filteredAnimals.filter(a => a.project).length;
  document.getElementById('usedAnimals').textContent     = filteredAnimals.filter(a => ['In Experiment','Terminated','Breeding'].includes(a.status)).length;
  document.getElementById('completedAnimals').textContent= filteredAnimals.filter(a => a.status === 'Completed').length;

  loadProjectOverview(filteredProjects, filteredAnimals);
  loadTasks(filteredTasks);
  loadAnimals(filteredAnimals);
  loadBreeding(filteredBreeding);
  loadReports(filteredReports);
  populateProjectOptions(filteredProjects);
}

// ── Table renderers ───────────────────────────────────────────
function loadProjectOverview(projectsArr, animalsArr) {
  const tbody = document.querySelector('#projectOverviewTable tbody');
  tbody.innerHTML = '';
  projectsArr.forEach(p => {
    const assigned = animalsArr.filter(a => a.project === p.id).length;
    const inUse = animalsArr.filter(a => a.project === p.id && (a.status === 'In Experiment' || a.status === 'Terminated')).length;
    tbody.innerHTML += `
      <tr>
        <td>${p.id}</td>
        <td>${p.name}</td>
        <td>${p.pi}</td>
        <td>${p.students}</td>
        <td>${assigned}</td>
        <td>${inUse}</td>
        <td><span class="badge badge-${p.status === 'Active' ? 'alive' : 'completed'}">${p.status}</span></td>
      </tr>`;
  });
  buildDropdownFilters('projectOverviewTable');
  applyTableFilters('projectOverviewTable');
}

function loadTasks(tasksArr) {
  const statusOrder = { 'Pending': 0, 'In Progress': 1, 'Completed': 2 };
  const sorted = [...tasksArr].sort((a, b) => {
    const ao = statusOrder[a.status] ?? 99;
    const bo = statusOrder[b.status] ?? 99;
    if (ao !== bo) return ao - bo;
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });
  const tbody = document.querySelector('#tasksTable tbody');
  tbody.innerHTML = '';
  sorted.forEach(t => {
    const isDone  = t.status === 'Completed';
    const badgeCls= isDone ? 'badge-completed' : 'badge-experiment';
    tbody.innerHTML += `
      <tr>
        <td>${t.task}</td>
        <td>${t.type}</td>
        <td><span class="badge badge-priority-${(t.priority || 'Medium').toLowerCase()}">${t.priority || 'Medium'}</span></td>
        <td>${t.assignedTo}</td>
        <td>${t.dueDate}</td>
        <td><span class="badge ${badgeCls}">${t.status}</span></td>
        <td class="ts-cell">${fmtTs(t.updatedAt || t.createdAt)}</td>
        <td>
          <button class="btn-small${isDone ? ' btn-done' : ''}"
            onclick="completeTask(this, ${t.id})"
            ${isDone ? 'disabled' : ''}>
            ${isDone ? '<i class="fa-solid fa-check"></i> Done' : '<i class="fa-solid fa-circle-check"></i> Complete'}
          </button>
        </td>
      </tr>`;
  });
  buildDropdownFilters('tasksTable');
  applyTableFilters('tasksTable');
}

function loadAnimals(animalsArr) {
  const tbody = document.querySelector('#animalsTable tbody');
  tbody.innerHTML = '';
  animalsArr.forEach(a => {
    const statusValue = a.status === 'Alive' ? 'Acclimatization' : a.status;
    const badgeMap = {
      'Acclimatization':'badge-alive',
      'In Experiment':'badge-experiment',
      'Breeding':'badge-active',
      'Terminated':'badge-terminated',
      'Completed':'badge-completed'
    };
    const cls = badgeMap[statusValue] || 'badge-pending';
    const detailParts = [];
    if (statusValue === 'Terminated') {
      detailParts.push(`Terminated${a.terminationReason ? ': ' + a.terminationReason : ''}`);
      if (a.terminatedAt) detailParts.push(`on ${a.terminatedAt.slice(0, 10)}`);
    }
    if (statusValue === 'Completed') {
      detailParts.push(`Completed on ${a.completedAt ? a.completedAt.slice(0, 10) : a.updatedAt.slice(0, 10)}`);
    }
    if (a.category) detailParts.push(`Category: ${a.category}`);
    if (a.genotypeVerified) detailParts.push(`Genotype: ${a.genotypeVerified}`);
    if (a.bloodCollected) detailParts.push('Blood');
    if (a.tissueCollected) detailParts.push('Tissue');
    if (a.histopathology) detailParts.push('Histology');
    if (a.biochemicalData) detailParts.push('Biochemical');
    if (a.necropsyReport) detailParts.push('Necropsy');
    if (a.details) detailParts.push(a.details);
    const detailsText = detailParts.length ? detailParts.join('; ') : '—';

    tbody.innerHTML += `
      <tr>
        <td>${a.id}</td>
        <td>${a.species}</td>
        <td>${a.age}</td>
        <td>${a.gender}</td>
        <td>${a.project}</td>
        <td>${a.cageId || '—'}</td>
        <td>${a.category || 'Standard'}</td>
        <td>${a.procurementDate || '—'}</td>
        <td>${a.experimentDate || '—'}</td>
        <td><span class="badge ${cls}">${statusValue}</span></td>
        <td>${detailsText}</td>
        <td class="ts-cell">${fmtTs(a.updatedAt || a.createdAt)}</td>
        <td>
          <button class="btn-small" onclick="editAnimal('${a.id}')">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
        </td>
      </tr>`;
  });
  buildDropdownFilters('animalsTable');
  applyTableFilters('animalsTable');
}

function loadBreeding(breedingArr) {
  const tbody = document.querySelector('#breedingTable tbody');
  tbody.innerHTML = '';
  breedingArr.forEach(b => {
    const cls = b.status === 'Active' ? 'badge-alive' : b.status === 'Completed' ? 'badge-completed' : 'badge-terminated';
    tbody.innerHTML += `
      <tr>
        <td>${b.id}</td>
        <td>${b.species}</td>
        <td>${b.male}</td>
        <td>${b.female}</td>
        <td>${b.cageId || '—'}</td>
        <td>${b.startDate}</td>
        <td>${b.expected}</td>
        <td><span class="badge ${cls}">${b.status}</span></td>
        <td class="ts-cell">${fmtTs(b.updatedAt || b.createdAt)}</td>
        <td>
          <button class="btn-small" onclick="viewBreeding('${b.id}')">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      </tr>`;
  });
  buildDropdownFilters('breedingTable');
  applyTableFilters('breedingTable');
}

function loadReports(reportsArr) {
  const tbody = document.querySelector('#reportsTable tbody');
  tbody.innerHTML = '';
  reportsArr.forEach(r => {
    tbody.innerHTML += `
      <tr>
        <td>${r.type}</td>
        <td>${r.project}</td>
        <td>${r.approval}</td>
        <td>${r.dateOfApproval || '—'}</td>
        <td>${r.validUntil || '—'}</td>
        <td class="ts-cell">${fmtTs(r.createdAt)}</td>
      </tr>`;
  });
  buildDropdownFilters('reportsTable');
  applyTableFilters('reportsTable');
}

function populateProjectOptions(projects) {
  const reportSelect = document.getElementById('reportProjectSelect');
  const options = ['<option value="">Select Project</option>'].concat(
    projects.map(p => `<option value="${p.id}">${p.id} — ${p.name}</option>`)
  ).join('');
  if (reportSelect) reportSelect.innerHTML = options;
}

function loadProjects(projectsArr) {
  const tbody = document.querySelector('#projectsTable tbody');
  const rows = filterByRole(projectsArr);
  tbody.innerHTML = '';
  rows.forEach(p => {
    const cls = p.status === 'Active' ? 'badge-alive' : 'badge-completed';
    tbody.innerHTML += `
      <tr>
        <td>${p.id}</td>
        <td>${p.name}</td>
        <td>${p.pi}</td>
        <td>${p.students}</td>
        <td>${p.startDate || '—'}</td>
        <td>${p.duration ? p.duration + ' mo.' : '—'}</td>
        <td><span class="badge ${cls}">${p.status}</span></td>
        <td class="ts-cell">${fmtTs(p.updatedAt || p.createdAt)}</td>
        <td>
          <button class="btn-small" onclick="viewProject('${p.id}')">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      </tr>`;
  });
  buildDropdownFilters('projectsTable');
  applyTableFilters('projectsTable');
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[,\"\n\r]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function objectArrayToCsv(dataArray, columns) {
  const header = columns.join(',');
  const rows = dataArray.map(item => columns.map(col => escapeCsvValue(item[col])).join(','));
  return [header, ...rows].join('\n');
}

async function downloadCsv(tableKey) {
  let filename;
  let csv;

  switch (tableKey) {
    case 'projects':
      filename = 'projects.csv';
      csv = objectArrayToCsv(await db.projects.toArray(), ['id','name','pi','students','animals','status','startDate','duration','description','createdAt','updatedAt']);
      break;
    case 'animals':
      filename = 'animals.csv';
      csv = objectArrayToCsv(await db.animals.toArray(), ['id','species','age','gender','project','cageId','category','status','procurementDate','experimentDate','terminatedAt','completedAt','terminationReason','genotypeVerified','bloodCollected','tissueCollected','histopathology','biochemicalData','necropsyReport','details','createdAt','updatedAt']);
      break;
    case 'tasks':
      filename = 'tasks.csv';
      csv = objectArrayToCsv(await db.tasks.toArray(), ['id','task','type','priority','assignedTo','dueDate','status','createdAt','updatedAt']);
      break;
    case 'breeding':
      filename = 'breeding.csv';
      csv = objectArrayToCsv(await db.breeding.toArray(), ['id','species','male','female','startDate','expected','status','createdAt','updatedAt']);
      break;
    case 'reports':
      filename = 'reports.csv';
      csv = objectArrayToCsv(await db.reports.toArray(), ['id','type','project','approval','validUntil','status','createdAt','updatedAt']);
      break;
    case 'all':
      filename = 'cafm_all_data.csv';
      const sections = [];
      sections.push('=== Projects ===');
      sections.push(objectArrayToCsv(await db.projects.toArray(), ['id','name','pi','students','animals','status','startDate','duration','description','createdAt','updatedAt']));
      sections.push('=== Animals ===');
      sections.push(objectArrayToCsv(await db.animals.toArray(), ['id','species','age','gender','project','status','details','createdAt','updatedAt']));
      sections.push('=== Tasks ===');
      sections.push(objectArrayToCsv(await db.tasks.toArray(), ['id','task','type','assignedTo','dueDate','status','createdAt','updatedAt']));
      sections.push('=== Breeding ===');
      sections.push(objectArrayToCsv(await db.breeding.toArray(), ['id','species','male','female','startDate','expected','status','createdAt','updatedAt']));
      sections.push('=== Reports ===');
      sections.push(objectArrayToCsv(await db.reports.toArray(), ['id','type','project','approval','validUntil','status','createdAt','updatedAt']));
      csv = sections.join('\n\n');
      break;
    default:
      showToast('Unknown export target', 'error');
      return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${filename} downloaded successfully.`, 'success');
}

// ── Modal helpers ─────────────────────────────────────────────
function openTaskModal() { document.getElementById('taskModal').classList.add('active'); }

async function openAnimalModal() {
  document.getElementById('animalIdField').value    = '';
  document.getElementById('animalCreatedAt').value  = '';
  document.getElementById('animalModalTitle').innerHTML =
    '<i class="fa-solid fa-paw"></i> Add New Animal';
  document.getElementById('animalSubmitBtn').innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Save Animal';
  document.getElementById('animalForm').reset();
  document.getElementById('experimentDateSection').style.display = 'none';
  document.getElementById('terminationDetails').style.display = 'none';
  document.getElementById('completionDetails').style.display = 'none';
  document.getElementById('animalStatus').disabled = false;
  await populateAnimalProjectOptions();
  document.getElementById('animalModal').classList.add('active');
}

function closeAnimalModal() {
  document.getElementById('animalModal').classList.remove('active');
  document.getElementById('animalForm').reset();
  document.getElementById('animalIdField').value   = '';
  document.getElementById('animalCreatedAt').value = '';
  document.getElementById('experimentDateSection').style.display = 'none';
  document.getElementById('terminationDetails').style.display = 'none';
  document.getElementById('completionDetails').style.display = 'none';
  document.getElementById('animalStatus').disabled = false;
}

async function populateBreedingAnimalOptions() {
  const maleSelect = document.getElementById('breedingMaleSelect');
  const femaleSelect = document.getElementById('breedingFemaleSelect');
  if (!maleSelect || !femaleSelect) return;

  const animals = await db.animals.toArray();
  const maleAnimals = animals.filter(a => a.gender === 'Male');
  const femaleAnimals = animals.filter(a => a.gender === 'Female');

  maleSelect.innerHTML = '<option value="">Select male animal</option>' +
      maleAnimals.map(a => {
        const projectLabel = a.project ? ' | ' + a.project : '';
        const statusLabel = a.status ? ' | ' + a.status : '';
        return `<option value="${a.id}">${a.id} — ${a.species}${projectLabel}${statusLabel}</option>`;
      }).join('');
    femaleSelect.innerHTML = '<option value="">Select female animal</option>' +
      femaleAnimals.map(a => {
        const projectLabel = a.project ? ' | ' + a.project : '';
        const statusLabel = a.status ? ' | ' + a.status : '';
        return `<option value="${a.id}">${a.id} — ${a.species}${projectLabel}${statusLabel}</option>`;
      }).join('');
  if (maleAnimals.length === 0 || femaleAnimals.length === 0) {
    showToast('Please add male and/or female animals in Animal Details before creating a breeding pair.', 'warning');
  }
}

async function syncBreedingSpecies() {
  const speciesSelect = document.querySelector('#breedingForm [name="species"]');
  const maleId = document.getElementById('breedingMaleSelect')?.value;
  const femaleId = document.getElementById('breedingFemaleSelect')?.value;
  if (!speciesSelect) return;

  const male = maleId ? await db.animals.get(maleId) : null;
  const female = femaleId ? await db.animals.get(femaleId) : null;
  if (male && female && male.species === female.species) {
    speciesSelect.value = male.species;
  } else if (male && !female) {
    speciesSelect.value = male.species;
  } else if (female && !male) {
    speciesSelect.value = female.species;
  }
}

async function openBreedingModal() {
  const form = document.getElementById('breedingForm');
  if (form) form.reset();
  await populateBreedingAnimalOptions();
  document.getElementById('breedingModal').classList.add('active');
}
async function openReportModal() {
  await populateReportProjectOptions();
  document.getElementById('reportModal').classList.add('active');
}

async function populateProjectUserOptions() {
  const piSelect = document.getElementById('projectPiSelect');
  const studentsSelect = document.getElementById('projectStudentsSelect');
  if (!piSelect || !studentsSelect) return;

  const piResp = await fetch('/auth/public-users?role=pi');
  const piJson = await piResp.json();
  const pis = piJson.users || [];

  const studentResp = await fetch('/auth/public-users?role=student');
  const studentJson = await studentResp.json();
  let students = studentJson.users || [];

  if (currentRole === 'pi') {
    students = students.filter(s => s.pi === currentUserName || s.pi === currentUser);
  }

  piSelect.innerHTML = ['<option value="">Select PI</option>']
    .concat(pis.map(u => `<option value="${u.name}">${u.name}</option>`))
    .join('');

  studentsSelect.innerHTML = '<option value="" disabled>Select student(s)</option>' + students.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
}

async function populateReportProjectOptions() {
  const projects = await db.projects.toArray();
  const filteredProjects = filterProjectsByRole(projects);
  const select = document.getElementById('reportProjectSelect');
  select.innerHTML = '<option value="">Select Project</option>' + filteredProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

async function populateAnimalProjectOptions() {
  const projects = await db.projects.toArray();
  const filteredProjects = filterProjectsByRole(projects);
  const select = document.getElementById('animalProjectSelect');
  select.innerHTML = '<option value="">Select Project</option>' + filteredProjects.map(p => `<option value="${p.id}">${p.id}</option>`).join('');
}

async function openProjectModal() {
  if (currentRole !== 'admin' && currentRole !== 'pi') {
    showToast('Only Admin and PI can create projects.', 'warning');
    return;
  }
  document.getElementById('projectIdField').value    = '';
  document.getElementById('projectCreatedAt').value  = '';
  document.getElementById('projectModalTitle').innerHTML =
    '<i class="fa-solid fa-diagram-project"></i> Add New Project';
  document.getElementById('projectSubmitBtn').innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Save Project';
  document.getElementById('projectForm').reset();
  await populateProjectUserOptions();
  if (currentRole === 'pi') {
    const piInput = document.getElementById('projectPiSelect');
    if (piInput) piInput.value = currentUserName || currentUser;
  }
  document.getElementById('projectModal').classList.add('active');
}

function closeProjectModal() {
  document.getElementById('projectModal').classList.remove('active');
  document.getElementById('projectForm').reset();
  document.getElementById('projectIdField').value   = '';
  document.getElementById('projectCreatedAt').value = '';
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function toggleCompletionDetails() {
  const status = document.getElementById('animalStatus').value;
  document.getElementById('experimentDateSection').style.display =
    status === 'In Experiment' || status === 'Breeding' ? 'block' : 'none';
  document.getElementById('terminationDetails').style.display =
    status === 'Terminated' ? 'block' : 'none';
  document.getElementById('completionDetails').style.display =
    status === 'Completed' ? 'block' : 'none';
}

function toggleBreedingCompletionFields() {
  const status = document.getElementById('breedingStatusUpdate').value;
  document.getElementById('breedingCompletionFields').style.display =
    status === 'Completed' ? 'block' : 'none';
}

function toggleAnimalCategory() {
  const category = document.getElementById('animalCategory').value;
  const litters = document.getElementById('littersDetails');
  const statusSelect = document.getElementById('animalStatus');
  litters.style.display = category === 'Litters' ? 'block' : 'none';
  if (category === 'Litters') {
    statusSelect.value = 'Acclimatization';
    statusSelect.disabled = true;
  } else {
    statusSelect.disabled = false;
  }
  toggleCompletionDetails();
}

function handleGenotypeVerified() {
  const verified = document.getElementById('genotypeVerified').value;
  const statusSelect = document.getElementById('animalStatus');
  if (verified === 'yes') {
    statusSelect.value = 'Acclimatization';
  } else if (verified === 'no') {
    statusSelect.value = 'Terminated';
  }
  toggleCompletionDetails();
}

// ── Actions ───────────────────────────────────────────────────
async function completeTask(btn, id) {
  if (!id) return;
  const ts = nowISO();
  await db.tasks.update(id, { status: 'Completed', updatedAt: ts });
  await SHEETS_SYNC.push('Tasks', 'update', { id, status: 'Completed', updatedAt: ts }, currentUser);
  showToast('Task marked as completed.', 'success');
  await loadDashboard();
}

// ── Edit Animal ───────────────────────────────────────────────
async function editAnimal(animalId) {
  const animal = await db.animals.get(animalId);
  if (!animal) return;

  const form = document.getElementById('animalForm');
  form.reset();

  await populateAnimalProjectOptions();

  document.getElementById('animalIdField').value   = animal.id;
  document.getElementById('animalCreatedAt').value = animal.createdAt || '';
  document.getElementById('animalModalTitle').innerHTML =
    `<i class="fa-solid fa-pen-to-square"></i> Edit Animal — ${animal.id}`;
  document.getElementById('animalSubmitBtn').innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Update Animal';

  _setSelectVal(form, 'species', animal.species);
  form.querySelector('[name="age"]').value    = animal.age ?? '';
  _setSelectVal(form, 'gender', animal.gender);
  _setSelectVal(form, 'project', animal.project);
  form.querySelector('[name="cageId"]').value = animal.cageId || '';
  _setSelectVal(form, 'category', animal.category || 'Standard');
  const statusValue = animal.status === 'Alive' ? 'Acclimatization' : animal.status;
  _setSelectVal(form, 'status', statusValue);
  form.querySelector('[name="procurementDate"]').value   = animal.procurementDate || '';
  form.querySelector('[name="experimentDate"]').value    = animal.experimentDate || '';
  form.querySelector('[name="terminationReason"]').value = animal.terminationReason || '';
  _setSelectVal(form, 'genotypeVerified', animal.genotypeVerified || '');
  form.querySelector('[name="bloodCollected"]').checked = !!animal.bloodCollected;
  form.querySelector('[name="tissueCollected"]').checked = !!animal.tissueCollected;
  form.querySelector('[name="histopathology"]').checked = !!animal.histopathology;
  form.querySelector('[name="biochemicalData"]').checked = !!animal.biochemicalData;
  form.querySelector('[name="necropsyReport"]').checked = !!animal.necropsyReport;
  form.querySelector('[name="details"]').value = animal.details || '';

  toggleAnimalCategory();
  toggleCompletionDetails();

  document.getElementById('animalModal').classList.add('active');
}

// ── View / Edit Project ───────────────────────────────────────
async function viewProject(projectId) {
  const p = await db.projects.get(projectId);
  if (!p) return;

  if (currentRole !== 'admin' && currentRole !== 'pi') {
    showToast('You do not have permission to edit projects.', 'warning');
    return;
  }

  const form = document.getElementById('projectForm');
  form.reset();

  document.getElementById('projectIdField').value    = p.id;
  document.getElementById('projectCreatedAt').value  = p.createdAt || '';
  document.getElementById('projectModalTitle').innerHTML =
    `<i class="fa-solid fa-pen-to-square"></i> Edit Project — ${p.id}`;
  document.getElementById('projectSubmitBtn').innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Update Project';

  form.querySelector('[name="name"]').value        = p.name || '';
  form.querySelector('[name="pi"]').value          = p.pi || '';
  form.querySelector('[name="students"]').value    = p.students || '';
  form.querySelector('[name="startDate"]').value   = p.startDate || '';
  form.querySelector('[name="duration"]').value    = p.duration || '';
  form.querySelector('[name="description"]').value = p.description || '';
  _setSelectVal(form, 'status', p.status);

  document.getElementById('projectModal').classList.add('active');
}

// ── View Breeding Pair ────────────────────────────────────────
let _currentBreedingId = null;

async function viewBreeding(breedingId) {
  const b = await db.breeding.get(breedingId);
  if (!b) return;

  _currentBreedingId = breedingId;

  const fields = [
    ['Pair ID',        b.id],
    ['Species',        b.species],
    ['Male ID',        b.male],
    ['Female ID',      b.female],
    ['Cage ID',        b.cageId || '—'],
    ['Start Date',     b.startDate],
    ['Expected Litter',b.expected],
    ['Litter Size',    b.litterSize || '—'],
    ['Litter IDs',     b.litterIds || '—'],
    ['Current Status', b.status],
    ['Last Updated',   fmtTs(b.updatedAt || b.createdAt)]
  ];

  document.getElementById('breedingDetailContent').innerHTML = fields.map(([k, v]) => `
    <div class="detail-row">
      <span class="detail-label">${k}</span>
      <span class="detail-value">${v || '—'}</span>
    </div>`).join('');

  const statusSelect = document.getElementById('breedingStatusUpdate');
  _setSelectVal(document.getElementById('breedingDetailModal'), 'breedingStatusUpdate', b.status);
  document.getElementById('breedingLitterSize').value = b.litterSize || '';
  document.getElementById('breedingLitterIds').value = b.litterIds || '';
  toggleBreedingCompletionFields();
  const saveBtn = document.getElementById('breedingSaveStatusBtn');
  if (b.status === 'Completed' || b.status === 'Failed') {
    statusSelect.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
  } else {
    statusSelect.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  }
  document.getElementById('breedingDetailModal').classList.add('active');
}

async function saveBreedingStatus() {
  if (!_currentBreedingId) return;
  const newStatus = document.getElementById('breedingStatusUpdate').value;
  const ts = nowISO();

  const breeding = await db.breeding.get(_currentBreedingId);
  if (!breeding) return;
  if (['Completed','Failed'].includes(breeding.status)) {
    showToast('This breeding pair is already finalized and cannot be changed.', 'warning');
    return;
  }

  const litterSize = Number(document.getElementById('breedingLitterSize').value || 0);
  const litterIds = document.getElementById('breedingLitterIds').value.split(',').map(id => id.trim()).filter(Boolean).join(', ');

  await db.breeding.update(_currentBreedingId, {
    status: newStatus,
    litterSize: litterSize || breeding.litterSize || 0,
    litterIds: litterIds || breeding.litterIds || '',
    updatedAt: ts
  });

  if (newStatus === 'Completed' && litterIds) {
    const animalIds = litterIds.split(',').map(id => id.trim()).filter(Boolean);
    const nowDate = ts.slice(0, 10);
    for (const animalId of animalIds) {
      const data = {
        id: animalId,
        species: breeding.species,
        age: 0,
        gender: 'Unknown',
        project: '',
        cageId: breeding.cageId || '',
        category: 'Litters',
        status: 'Undefined',
        procurementDate: nowDate,
        experimentDate: '',
        terminationReason: '',
        bloodCollected: false,
        tissueCollected: false,
        histopathology: false,
        biochemicalData: false,
        necropsyReport: false,
        details: `Litter from ${breeding.id}`,
        createdAt: ts,
        updatedAt: ts
      };
      await db.animals.put(data);
      await SHEETS_SYNC.push('Animals', data.id ? 'update' : 'insert', data, currentUser);
    }
  }

  await SHEETS_SYNC.push('Breeding', 'update',
    { id: _currentBreedingId, status: newStatus, litterSize, litterIds, updatedAt: ts }, currentUser);

  showToast(`Breeding pair status updated to "${newStatus}".`, 'success');
  closeModal('breedingDetailModal');
  await loadDashboard();
}

// ── Helper: set <select> value ────────────────────────────────
function refreshData() {
  if (!currentUser) {
    showToast('Please login first to refresh data.', 'warning');
    return;
  }
  showToast('Refreshing data…', 'info', 1200);
  loadDashboard().then(() => {
    if (typeof SHEETS_SYNC === 'object' && SHEETS_SYNC?.getUrl) {
      SHEETS_SYNC.init();
    }
    showToast('Data refreshed successfully.', 'success');
  }).catch(err => {
    console.error(err);
    showToast('Unable to refresh data. Check console for details.', 'error');
  });
}

function _setSelectVal(scope, nameOrId, value) {
  let select;
  if (typeof scope === 'string') {
    select = document.getElementById(scope);
  } else {
    select = scope.querySelector(`[name="${nameOrId}"]`) ||
             scope.querySelector(`#${nameOrId}`);
  }
  if (!select || select.tagName !== 'SELECT') return;
  const opt = [...select.options].find(o => o.value === value || o.text === value);
  if (opt) select.value = opt.value;
}

// ── Form handlers ─────────────────────────────────────────────
const formHandlers = {

  taskForm: async (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    data.status    = 'Pending';
    data.createdAt = nowISO();
    data.updatedAt = data.createdAt;
    const id = await db.tasks.add(data);
    await SHEETS_SYNC.push('Tasks', 'insert', { ...data, id }, currentUser);
  },

  animalForm: async (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    data.age       = Number(data.age ?? 0);
    data.bloodCollected    = form.querySelector('[name="bloodCollected"]').checked;
    data.tissueCollected   = form.querySelector('[name="tissueCollected"]').checked;
    data.histopathology    = form.querySelector('[name="histopathology"]').checked;
    data.biochemicalData   = form.querySelector('[name="biochemicalData"]').checked;
    data.necropsyReport   = form.querySelector('[name="necropsyReport"]').checked;
    data.updatedAt = nowISO();
    if (!data.createdAt) data.createdAt = data.updatedAt;
    if (!data.id) data.id = await generateAnimalId();

    if (data.category === 'Litters') {
      if (data.genotypeVerified === 'yes') {
        data.status = 'Acclimatization';
      } else if (data.genotypeVerified === 'no') {
        data.status = 'Terminated';
      }
    }

    if (data.status === 'In Experiment' || data.status === 'Breeding') {
      data.experimentDate = data.experimentDate || data.updatedAt.slice(0, 10);
    } else {
      data.experimentDate = data.experimentDate || '';
    }

    if (data.status === 'Terminated' && !data.terminatedAt) {
      data.terminatedAt = data.updatedAt;
    }
    if (data.status === 'Completed' && !data.completedAt) {
      data.completedAt = data.updatedAt;
    }

    await db.animals.put(data);
    await SHEETS_SYNC.push('Animals', data.id ? 'update' : 'insert', data, currentUser);
  },

  breedingForm: async (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    data.status    = data.status || 'Active';
    data.updatedAt = nowISO();
    if (!data.createdAt) data.createdAt = data.updatedAt;
    if (!data.id) data.id = `BR-${Date.now()}`;
    await db.breeding.put(data);
    await SHEETS_SYNC.push('Breeding', 'insert', data, currentUser);
  },

  reportForm: async (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    data.status         = 'Submitted';
    data.type           = 'Ethical Approval';
    data.dateOfApproval = data.dateOfApproval || '';
    data.createdAt      = nowISO();
    data.updatedAt      = data.createdAt;
    const id = await db.reports.add(data);
    await SHEETS_SYNC.push('Reports', 'insert', { ...data, id }, currentUser);
  },

  projectForm: async (form) => {
    const formData = new FormData(form);
    const data = {};
    for (const [key, value] of formData.entries()) {
      if (key === 'students') {
        data.students = data.students ? [...data.students, value] : [value];
      } else {
        data[key] = value;
      }
    }
    if (Array.isArray(data.students)) {
      data.students = data.students.filter(v => v).join(', ');
    }
    data.animals   = Number(data.animals ?? 0);
    data.status    = data.status || 'Active';
    data.updatedAt = nowISO();
    if (!data.createdAt) data.createdAt = data.updatedAt;
    if (!data.id) data.id = `PRJ-${Date.now()}`;
    await db.projects.put(data);
    await SHEETS_SYNC.push('Projects', 'insert', data, currentUser);
  }
};

['taskForm','animalForm','breedingForm','reportForm','projectForm'].forEach(id => {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await formHandlers[id](form);
      const isEdit = !!(id === 'animalForm'
        ? document.getElementById('animalIdField').value
        : id === 'projectForm'
          ? document.getElementById('projectIdField').value
          : false);
      const label = id.replace('Form', '');
      showToast(`${label.charAt(0).toUpperCase() + label.slice(1)} ${isEdit ? 'updated' : 'saved'} successfully!`, 'success');
      if (id === 'animalForm')   { closeAnimalModal(); }
      else if (id === 'projectForm') { closeProjectModal(); }
      else { closeModal(`${label}Modal`); form.reset(); }
      await loadDashboard();
    } catch (err) {
      console.error(err);
      showToast('Failed to save. Check the console for details.', 'error');
    }
  });
});

// ── Close modal on backdrop click ─────────────────────────────
window.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal')) e.target.classList.remove('active');
});
