// =============================================================
// app.js — CAFm  |  IndexedDB (Dexie) + Google Sheets sync
// =============================================================

// ── Global state ──────────────────────────────────────────────
let currentUser = null;
let currentRole = null;

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
  users:    '++id,email,name,role,status,passwordHash'
});
db.version(3).stores({
  projects: 'id,name,pi,students,animals,status',
  tasks:    '++id,task,type,priority,assignedTo,dueDate,status',
  animals:  'id,species,age,gender,project,status,details',
  breeding: 'id,species,male,female,cageId,startDate,expected,status,litterSize,litterIds',
  reports:  '++id,type,project,approval,dateOfApproval,validUntil,status',
  meta:     'key',
  users:    '++id,email,name,role,status,passwordHash'
});

// ── Password hashing (SHA-256 via SubtleCrypto) ───────────────
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Page navigation helpers ───────────────────────────────────
function showLoginPage() {
  document.getElementById('adminSetupPage').style.display = 'none';
  document.getElementById('signupPage').style.display     = 'none';
  document.getElementById('loginPage').style.display      = 'flex';
}
function showSignupPage() {
  document.getElementById('loginPage').style.display  = 'none';
  document.getElementById('signupPage').style.display = 'flex';
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
async function saveSession(user, role) {
  await db.meta.put({ key: 'currentUser', value: user });
  await db.meta.put({ key: 'currentRole', value: role });
}
async function restoreSession() {
  const [u, r] = await Promise.all([db.meta.get('currentUser'), db.meta.get('currentRole')]);
  return { user: u?.value || null, role: r?.value || null };
}

// ── Init ──────────────────────────────────────────────────────
(async function initApp() {
  await seedIfEmpty(sampleData);
  SHEETS_SYNC.init();

  const adminCount = await db.users.where('role').equals('admin').count();
  if (adminCount === 0) {
    document.getElementById('adminSetupPage').style.display = 'flex';
    return;
  }

  const { user, role } = await restoreSession();
  if (user && role) {
    currentUser = user;
    currentRole = role;
    _showDashboard(user, role);
    await loadDashboard();
  } else {
    document.getElementById('loginPage').style.display = 'flex';
  }
})();

function _showDashboard(user, role) {
  document.getElementById('loginPage').style.display      = 'none';
  document.getElementById('signupPage').style.display     = 'none';
  document.getElementById('adminSetupPage').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  document.getElementById('userDisplay').textContent = `${role.toUpperCase()}: ${user}`;
  const umItem = document.getElementById('userMgmtSidebarItem');
  if (umItem) umItem.style.display = role === 'admin' ? 'flex' : 'none';
}

async function createAdminAccount(email, name, password) {
  const passwordHash = await hashPassword(password);
  await db.users.add({
    email: email.toLowerCase(),
    name,
    role: 'admin',
    status: 'approved',
    passwordHash,
    createdAt: nowISO(),
    requestedAt: nowISO()
  });
}

async function addSignupRequest(email, name, role, password) {
  const passwordHash = await hashPassword(password);
  await db.users.add({
    email: email.toLowerCase(),
    name,
    role,
    status: 'pending',
    passwordHash,
    createdAt: nowISO(),
    requestedAt: nowISO()
  });
  await sendSignupNotificationEmails(email, name, role);
}

async function sendSignupNotificationEmails(userEmail, userName, role) {
  const admin = await db.users.where('role').equals('admin').first();
  if (!admin?.email) return;
  const subject = encodeURIComponent('CAFm signup request received');
  const body = encodeURIComponent(`Hello ${userName},\n\nYour signup request for CAFm as ${role} has been received and is pending admin approval. You will be notified once it is approved.\n\nThis message is sent from no-reply@niper.ac.in. Please do not reply to this email.\n\nBest regards,\nCAFm Team`);
  const mailto = `mailto:${admin.email}?cc=${encodeURIComponent(userEmail)}&subject=${subject}&body=${body}&from=no-reply@niper.ac.in`;
  window.open(mailto, '_blank');
}

async function loadUserManagement() {
  const tbody = document.querySelector('#userManagementTable tbody');
  if (!tbody) return;

  const allUsers = await db.users.toArray();
  tbody.innerHTML = '';
  allUsers.forEach(u => {
    tbody.innerHTML += `
      <tr>
        <td>${u.email}</td>
        <td>${u.name || '—'}</td>
        <td>${u.role}</td>
        <td><span class="badge badge-${u.status === 'approved' ? 'alive' : u.status === 'pending' ? 'experiment' : 'terminated'}">${u.status}</span></td>
        <td>${fmtTs(u.requestedAt)}</td>
        <td>
          ${u.status === 'pending' ? `<button class="btn-small" onclick="approveUser(${u.id})"><i class="fa-solid fa-check"></i> Approve</button> <button class="btn-small btn-danger" onclick="rejectUser(${u.id})"><i class="fa-solid fa-xmark"></i> Reject</button>` : ''}
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
  await db.users.update(id, { status: 'approved' });
  showToast('User approved.', 'success');
  await loadUserManagement();
};

window.rejectUser = async function (id) {
  await db.users.update(id, { status: 'rejected' });
  showToast('User rejected.', 'warning');
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

  const user = await db.users.where({ email, role }).first();
  if (!user) {
    showToast('No account found for these credentials.', 'error');
    return;
  }

  if (user.status === 'pending') {
    showToast('Account awaiting admin approval.', 'warning');
    return;
  }

  if (user.status === 'rejected') {
    showToast('Your request was rejected. Contact admin.', 'error');
    return;
  }

  const passwordHash = await hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    showToast('Invalid credentials. Please try again.', 'error');
    return;
  }

  currentUser = user.email;
  currentRole = user.role;
  await saveSession(currentUser, currentRole);
  _showDashboard(user.email, user.role);
  updateLoginUIAfterAuth();
  await loadDashboard();
});

// Signup + Admin setup handlers
document.getElementById('showSignupLink').addEventListener('click', (e) => {
  e.preventDefault();
  showSignupPage();
});

document.getElementById('backToLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
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

  const existing = await db.users.where('email').equals(email).first();
  if (existing) {
    showToast('An account already exists with this email.', 'error');
    return;
  }

  await createAdminAccount(email, name, password);
  showToast('Admin account created. Please login.', 'success');
  document.getElementById('adminSetupForm').reset();
  showLoginPage();
});

document.getElementById('signupForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const email           = document.getElementById('signupEmail').value.trim().toLowerCase();
  const name            = document.getElementById('signupName').value.trim();
  const role            = document.getElementById('signupRole').value;
  const password        = document.getElementById('signupPassword').value;
  const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

  if (!email || !name || !role || !password || !passwordConfirm) {
    showToast('Fill all fields.', 'warning');
    return;
  }
  if (password !== passwordConfirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  const existing = await db.users.where('email').equals(email).first();
  if (existing) {
    showToast('An account already exists with this email.', 'error');
    return;
  }

  await addSignupRequest(email, name, role, password);
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
  currentUser = null;
  currentRole = null;
  await db.meta.delete('currentUser');
  await db.meta.delete('currentRole');
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
function filterByRole(arr) {
  if (currentRole === 'admin') return arr;
  if (currentRole === 'pi')
    return arr.filter(item => item.pi === currentUser || item.pi?.includes(currentUser));
  if (currentRole === 'student')
    return arr.filter(item => item.students && item.students.includes(currentUser));
  return arr;
}

// ── Dashboard loader ──────────────────────────────────────────
async function loadDashboard() {
  const [projects, animals, tasks, breeding, reports] = await Promise.all([
    db.projects.toArray(), db.animals.toArray(), db.tasks.toArray(),
    db.breeding.toArray(), db.reports.toArray()
  ]);

  document.getElementById('totalProjects').textContent   = projects.length;
  document.getElementById('animalsAssigned').textContent = animals.filter(a => a.project).length;
  document.getElementById('usedAnimals').textContent     = animals.filter(a => ['In Experiment','Terminated','Breeding'].includes(a.status)).length;
  document.getElementById('completedAnimals').textContent= animals.filter(a => a.status === 'Completed').length;

  loadProjectOverview(projects, animals);
  loadTasks(tasks);
  loadAnimals(animals);
  loadBreeding(breeding);
  loadReports(reports);
  populateProjectOptions(projects);
}

// ── Table renderers ───────────────────────────────────────────
function loadProjectOverview(projectsArr, animalsArr) {
  const tbody = document.querySelector('#projectOverviewTable tbody');
  const rows = filterByRole(projectsArr);
  tbody.innerHTML = '';
  rows.forEach(p => {
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
      detailParts.push(`Terminated${a.terminationReason ? `: ${a.terminationReason}` : ''}`);
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
    const cls = r.status === 'Approved' ? 'badge-alive' :
                r.status === 'Submitted' ? 'badge-experiment' : 'badge-pending';
    tbody.innerHTML += `
      <tr>
        <td>${r.type}</td>
        <td>${r.project}</td>
        <td>${r.approval}</td>
        <td>${r.dateOfApproval || '—'}</td>
        <td>${r.validUntil || '—'}</td>
        <td><span class="badge ${cls}">${r.status}</span></td>
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

function openAnimalModal() {
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
    maleAnimals.map(a => `<option value="${a.id}">${a.id} — ${a.species}${a.project ? ` | ${a.project}` : ''}${a.status ? ` | ${a.status}` : ''}</option>`).join('');
  femaleSelect.innerHTML = '<option value="">Select female animal</option>' +
    femaleAnimals.map(a => `<option value="${a.id}">${a.id} — ${a.species}${a.project ? ` | ${a.project}` : ''}${a.status ? ` | ${a.status}` : ''}</option>`).join('');

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
function openReportModal()   { document.getElementById('reportModal').classList.add('active'); }

function openProjectModal() {
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
    const data = Object.fromEntries(new FormData(form).entries());
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
