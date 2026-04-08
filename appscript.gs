// =============================================================
// appscript.gs — Google Apps Script Web App for CAFm
// =============================================================
//
// SETUP INSTRUCTIONS:
//   1. Go to https://script.google.com  →  New Project
//   2. Paste this entire file into the editor
//   3. Replace SPREADSHEET_ID below with your Google Sheet ID
//      (from the URL: docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit)
//   4. Click  Deploy → New deployment
//      • Type:           Web app
//      • Execute as:     Me
//      • Who has access: Anyone   (or "Anyone with Google Account" if preferred)
//   5. Authorise permissions when prompted
//   6. Copy the Web App URL and paste it into sheets-sync.js → SCRIPT_URL
//
// SHEET STRUCTURE:
//   The script auto-creates these tabs on first run:
//   Projects | Animals | Tasks | Breeding | Reports
//   Each tab has a "Timestamp" and "ModifiedBy" column appended.
// =============================================================

const SPREADSHEET_ID = '1jJMCLi70nN5hG4JZHWUVblOFhkUdqQAFj7sOqmAGukA'; // <-- replace this

// Sheet column definitions (order matches append/update logic)
const SCHEMA = {
  Projects: ['id','name','pi','students','animals','status','startDate','duration','description','createdAt','updatedAt','ModifiedBy','Timestamp'],
  Animals:  ['id','species','age','gender','project','status','details','createdAt','updatedAt','ModifiedBy','Timestamp'],
  Tasks:    ['id','task','type','assignedTo','dueDate','status','createdAt','updatedAt','ModifiedBy','Timestamp'],
  Breeding: ['id','species','male','female','startDate','expected','status','createdAt','updatedAt','ModifiedBy','Timestamp'],
  Reports:  ['id','type','project','approval','validUntil','status','createdAt','updatedAt','ModifiedBy','Timestamp']
};

// ── Entry point ───────────────────────────────────────────────
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse(e.postData.contents);
    const { sheet, action, data, user, timestamp } = payload;

    if (!SCHEMA[sheet]) throw new Error('Unknown sheet: ' + sheet);

    const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tab = _getOrCreateSheet(ss, sheet);

    const serverTs = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    if (action === 'insert') {
      _insertRow(tab, sheet, data, user, serverTs);
    } else if (action === 'update') {
      _updateRow(tab, sheet, data, user, serverTs);
    } else if (action === 'delete') {
      _deleteRow(tab, sheet, data.id);
    } else {
      throw new Error('Unknown action: ' + action);
    }

    output.setContent(JSON.stringify({ status: 'ok', sheet, action, serverTs }));
  } catch (err) {
    output.setContent(JSON.stringify({ status: 'error', message: err.message }));
  }

  return output;
}

// ── Sheet helpers ─────────────────────────────────────────────
function _getOrCreateSheet(ss, name) {
  let tab = ss.getSheetByName(name);
  if (!tab) {
    tab = ss.insertSheet(name);
    // Write header row
    const headers = SCHEMA[name];
    tab.getRange(1, 1, 1, headers.length)
       .setValues([headers])
       .setFontWeight('bold')
       .setBackground('#1e3a5f')
       .setFontColor('#ffffff');
    tab.setFrozenRows(1);
  }
  return tab;
}

function _rowFromData(sheet, data, user, serverTs) {
  return SCHEMA[sheet].map(col => {
    if (col === 'Timestamp')  return serverTs;
    if (col === 'ModifiedBy') return user || '';
    const val = data[col];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function _insertRow(tab, sheet, data, user, serverTs) {
  const row = _rowFromData(sheet, data, user, serverTs);
  tab.appendRow(row);
  _applyRowStyle(tab, tab.getLastRow());
}

function _updateRow(tab, sheet, data, user, serverTs) {
  const idCol = 1;  // 'id' is always the first column
  const idVal = String(data.id);
  const lastRow = tab.getLastRow();

  for (let r = 2; r <= lastRow; r++) {
    const cellId = tab.getRange(r, idCol).getValue();
    if (String(cellId) === idVal) {
      const row = _rowFromData(sheet, data, user, serverTs);
      tab.getRange(r, 1, 1, row.length).setValues([row]);
      _applyRowStyle(tab, r);
      return;
    }
  }
  // Not found → insert as new row
  _insertRow(tab, sheet, data, user, serverTs);
}

function _deleteRow(tab, sheet, id) {
  const idVal   = String(id);
  const lastRow = tab.getLastRow();
  for (let r = lastRow; r >= 2; r--) {
    if (String(tab.getRange(r, 1).getValue()) === idVal) {
      tab.deleteRow(r);
      return;
    }
  }
}

function _applyRowStyle(tab, rowIndex) {
  const numCols = SCHEMA[Object.keys(SCHEMA)[0]].length;  // safe default
  const range   = tab.getRange(rowIndex, 1, 1, tab.getLastColumn());
  range.setBackground(rowIndex % 2 === 0 ? '#f0f4f8' : '#ffffff');
}
