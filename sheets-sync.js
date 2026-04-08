// =============================================================
// sheets-sync.js — Google Sheets sync via Apps Script Web App
// =============================================================
//
// HOW TO SET UP:
//   1. Deploy your Google Apps Script as a Web App (see appscript.gs)
//   2. Copy the deployed Web App URL
//   3. Paste it below in DEFAULT_SCRIPT_URL, or set it at runtime with SHEETS_SYNC.setUrl(url)
//
// Leave DEFAULT_SCRIPT_URL as empty string '' to run fully offline (no sync).
// =============================================================

const SHEETS_SYNC = (() => {

  // ── CONFIG ─────────────────────────────────────────────────
  const SYNC_URL_KEY = 'cafmSheetsSyncUrl';
  const DEFAULT_SCRIPT_URL = '';
  let scriptUrl = localStorage.getItem(SYNC_URL_KEY) || DEFAULT_SCRIPT_URL;

  // IndexedDB queue key stored via Dexie meta table
  const QUEUE_KEY = 'syncQueue';

  // Sync status indicator DOM refs (set after DOM ready)
  let _statusEl  = null;
  let _statusTxt = null;

  // In-memory retry queue (also persisted via DB meta)
  let _queue = [];
  let _syncing = false;

  // ── PUBLIC API ──────────────────────────────────────────────
  return {

    /** Call once after DOM ready to wire up status indicator */
    init() {
      _statusEl  = document.getElementById('syncStatus');
      _statusTxt = document.getElementById('syncStatusText');
      if (!scriptUrl) {
        _setStatus('disabled');
        return;
      }
      _setStatus('idle');
      _loadQueue().then(() => _flush());
    },

    getUrl() {
      return scriptUrl;
    },

    setUrl(url) {
      scriptUrl = url?.trim() || '';
      if (scriptUrl) {
        localStorage.setItem(SYNC_URL_KEY, scriptUrl);
        _setStatus('idle');
        _loadQueue().then(() => _flush());
      } else {
        localStorage.removeItem(SYNC_URL_KEY);
        _setStatus('disabled');
      }
    },

    /**
     * Queue one record for syncing to Google Sheets.
     * @param {string} sheet   — sheet tab name: 'Projects'|'Animals'|'Tasks'|'Breeding'|'Reports'
     * @param {string} action  — 'insert' | 'update' | 'delete'
     * @param {object} data    — the record payload
     * @param {string} user    — currentUser performing the action
     */
    async push(sheet, action, data, user) {
      if (!scriptUrl) return;
      const entry = {
        sheet,
        action,
        data,
        user,
        timestamp: new Date().toISOString(),
        _id: `${Date.now()}_${Math.random().toString(36).slice(2)}`
      };
      _queue.push(entry);
      await _saveQueue();
      _flush();
    }
  };

  // ── PRIVATE HELPERS ─────────────────────────────────────────

  function _setStatus(state) {
    if (!_statusEl) return;
    _statusEl.className = `sync-status sync-${state}`;
    const labels = {
      disabled: 'Offline',
      idle:     'Synced',
      syncing:  'Syncing…',
      error:    'Sync Error',
      queued:   `${_queue.length} queued`
    };
    if (_statusTxt) _statusTxt.textContent = labels[state] || state;
  }

  async function _flush() {
    if (_syncing || !scriptUrl || _queue.length === 0) return;
    _syncing = true;
    _setStatus('syncing');

    while (_queue.length > 0) {
      const entry = _queue[0];
      const ok = await _send(entry);
      if (ok) {
        _queue.shift();
        await _saveQueue();
      } else {
        break;   // leave remaining in queue; retry later
      }
    }

    _syncing = false;
    _setStatus(_queue.length > 0 ? 'error' : 'idle');
    if (_queue.length > 0) {
      // retry in 30 s
      setTimeout(() => _flush(), 30_000);
    }
  }

  async function _send(entry) {
    try {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },  // avoid CORS preflight
        body: JSON.stringify(entry)
      });
      if (!res.ok) return false;
      const json = await res.json();
      return json.status === 'ok';
    } catch {
      return false;
    }
  }

  async function _saveQueue() {
    try {
      await db.meta.put({ key: QUEUE_KEY, value: JSON.stringify(_queue) });
    } catch { /* db may not be ready yet */ }
    if (_statusTxt && _queue.length > 0) _setStatus('queued');
  }

  async function _loadQueue() {
    try {
      const rec = await db.meta.get(QUEUE_KEY);
      if (rec && rec.value) _queue = JSON.parse(rec.value);
    } catch { _queue = []; }
  }

})();
