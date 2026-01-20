/**
 * ───────────────────────────────────────────────
 *  AUDIT LEDGER : CORE MODULE
 * ───────────────────────────────────────────────
 *
 *  Tamper-evident audit log using SHA-256 hash chains.
 *  Each entry links to the previous via cryptographic hash.
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIG & SECURITY
// ==========================

/** Securely get a Script Property. */
function _getProp(key, fallback) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return v != null ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

/** Securely set multiple Script Properties. */
function _setProps(obj) {
  PropertiesService.getScriptProperties().setProperties(obj);
}

/** UI availability guard (avoids trigger-context exceptions). */
function _inUi() {
  try {
    SpreadsheetApp.getUi();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Securely retrieve the ledger secret; fatal if missing.
 */
function _getLedgerSecret() {
  const secret = _getProp('LEDGER_SECRET', null);
  if (!secret) {
    const msg = 'FATAL ERROR: LEDGER_SECRET is missing. Run "Admin > Setup Ledger Secret".';
    try {
      logSystemEvent('FATAL', 'CONFIG', msg, 'Chain integrity cannot be guaranteed without a secret.');
      if (_inUi()) SpreadsheetApp.getUi().alert(msg);
    } catch (e) {
      Logger.log(msg);
    }
    throw new Error(msg);
  }
  return secret;
}

/**
 * Hash helper (SHA-256) with UTF-8 normalization; secret is always prepended.
 */
function sha(s) {
  if (s == null) s = '';
  const LEDGER_SECRET = _getLedgerSecret();
  const normalized = String(s).normalize('NFKD');
  const dataWithSecret = LEDGER_SECRET + normalized;
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, dataWithSecret)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}

/**
 * Script-level lock with explicit timeout handling.
 */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    logSystemEvent('ERROR', 'LOCK', 'Could not obtain script lock', e && e.message);
    throw new Error('Ledger locked by another process.');
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }
}


// ==========================
// SYSTEM LOGGING
// ==========================

function logSystemEvent(level, category, message, details = '') {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('System Log');
    if (!logSheet) {
      logSheet = ss.insertSheet('System Log');
      const headers = ['Timestamp', 'Level', 'Category', 'Message', 'Details'];
      logSheet.getRange(1, 1, 1, 5).setValues([headers]);
      logSheet.getRange(1, 1, 1, 5).setFontWeight('bold');
      logSheet.setFrozenRows(1);
      logSheet.getRange(1, 1, 1, 5).setBackground('#4a4a4a').setFontColor('#ffffff');
    }
    const ts = new Date().toISOString();
    const lastRow = logSheet.getLastRow() + 1;
    logSheet.getRange(lastRow, 1, 1, 5).setValues([
      [ts, level, category, message, JSON.stringify(details)]
    ]);
  } catch (e) {
    Logger.log('Failed logSystemEvent: ' + e.message);
  }
}

function viewSystemLog() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('System Log');
  if (sheet) {
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  } else if (_inUi()) {
    SpreadsheetApp.getUi().alert('System Log sheet not found. It will be created on the next event.');
  }
}


// ==========================
// SHEET & HEADER SETUP
// ==========================

const LEDGER_SHEET_NAME = 'Audit Ledger';
const LEDGER_HEADERS = [
  'UUID','Timestamp','Actor','Event Type','Text','Gift', // 1-6
  'Prev Hash','Record Hash','Status',                    // 7-9
  'Provision IDs','Provision Titles','Provision Snippets','Provision URLs', // 10-13
  'Citation Hash' // 14
];

function _getLedgerSheet() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) {
    const msg = `Sheet "${LEDGER_SHEET_NAME}" not found. Run "Admin > Setup Sheet".`;
    logSystemEvent('ERROR', 'SHEET', msg);
    if (_inUi()) SpreadsheetApp.getUi().alert(msg);
    throw new Error(msg);
  }
  return sh;
}

/** Validate header row exactly matches 14-column schema. */
function _validateLedgerSchemaOrThrow(sh) {
  const width = LEDGER_HEADERS.length;
  const headers = sh.getRange(1,1,1,width).getValues()[0];
  const ok = headers.length === width && LEDGER_HEADERS.every((h, i) => String(headers[i]).trim() === h);
  if (!ok) {
    const msg = `Ledger schema mismatch. Expected ${width} headers. Run "Admin > Setup Sheet (14-Column)".`;
    logSystemEvent('ERROR', 'SCHEMA', msg, {expected: LEDGER_HEADERS, got: headers});
    if (_inUi()) SpreadsheetApp.getUi().alert(msg);
    throw new Error(msg);
  }
}

/** Create/repair sheet with correct headers and optional protection. */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(LEDGER_SHEET_NAME);

  const width = LEDGER_HEADERS.length;
  sh.getRange(1,1,1,width).setValues([LEDGER_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(1,1,1,width).setBackground('#4a4a4a').setFontColor('#ffffff');
  for (let i = 1; i <= width; i++) sh.autoResizeColumn(i);
  sh.setColumnWidth(5, 300);  // Text
  sh.setColumnWidth(12, 300); // Snippets

  // Basic protection (optional but recommended)
  try {
    const protection = sh.protect();
    protection.setDescription('Audit Ledger Protection');
    protection.removeEditors(protection.getEditors());
  } catch (e) {
    logSystemEvent('WARN','SECURITY','Sheet protection not applied', e.message);
  }

  logSystemEvent('SUCCESS','SYSTEM','Ledger sheet setup completed',{columns: width});
  if (_inUi()) SpreadsheetApp.getUi().alert('Audit Ledger sheet is ready! (14 Columns)');
}


// ==========================
// PREWRITE CHECKS
// ==========================

/** Ensure sheet, schema, and prior hash state are sane before writing. */
function _preflightOrThrow() {
  const sh = _getLedgerSheet();
  _validateLedgerSchemaOrThrow(sh);

  const last = sh.getLastRow();
  if (last > 1) {
    const prevRecordHash = sh.getRange(last, 8).getValue();
    const prevUuid = sh.getRange(last, 1).getValue();
    if (!prevRecordHash || String(prevRecordHash).trim() === '') {
      const msg = 'Preflight failed: last row has empty Record Hash.';
      logSystemEvent('ERROR', 'ENTRY', msg, {last, prevUuid});
      throw new Error(msg);
    }
  }

  // Require effective user email for unambiguous attribution
  const email = _getEffectiveEmail();
  if (!email) {
    const msg = 'Cannot write entry: no effective user email (attribution required).';
    logSystemEvent('ERROR', 'ENTRY', msg);
    if (_inUi()) SpreadsheetApp.getUi().alert(msg);
    throw new Error(msg);
  }
  return sh;
}

function _getEffectiveEmail() {
  try {
    const em = Session.getEffectiveUser().getEmail();
    return em && em.trim() ? em.trim() : '';
  } catch (e) {
    return '';
  }
}


// ==========================
// CORE LEDGER I/O
// ==========================

/**
 * Simple entry (no citations). Status defaults to DRAFT.
 * Hash blob canonical form:
 *   uuid|ts|actor|eventType|text|gift|prevHash|status|provisionIds|provisionTitles|provisionSnippets|provisionUrls|citationHash
 */
function newEntry(actor, eventType, text, gift, status = 'DRAFT') {
  return withLock(() => {
    try {
      if (!['User','Admin','System'].includes(actor)) {
        logSystemEvent('ERROR','ENTRY','Unauthorized actor',{actor});
        throw new Error('Unauthorized actor: ' + actor);
      }
      const sh = _preflightOrThrow();
      const last = sh.getLastRow();
      const prevHash = (last > 1) ? (sh.getRange(last, 8).getValue() || '') : '';
      const uuid = Utilities.getUuid();
      const ts = new Date().toISOString();

      const provisionIds = '';
      const provisionTitles = '';
      const provisionSnippets = '';
      const provisionUrls = '';
      const citationHash = 'no_citations';

      const blob = [
        uuid, ts, actor, eventType, text, gift, prevHash, status,
        provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash
      ].join('|');
      const recordHash = sha(blob);

      sh.getRange(last + 1, 1, 1, 14).setValues([[
        uuid, ts, actor, eventType, text, gift, prevHash, recordHash, status,
        provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash
      ]]);

      logSystemEvent('INFO','ENTRY','New entry created',{
        eventType, status, actorEmail: _getEffectiveEmail(), uuid
      });
      return { uuid, ts, recordHash };
    } catch (e) {
      logSystemEvent('ERROR','ENTRY','Failed to create entry',{err: e.message, eventType, actor});
      throw e;
    }
  });
}

/** Thread-safe wrapper kept for API parity. */
function safeNewEntry(a,b,c,d,e){ return newEntry(a,b,c,d,e); }

/** Complex entry with citations. */
function newEntryWithCitations(actor, eventType, text, gift, status,
  provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash) {
  return withLock(() => {
    try {
      if (!['User','Admin','System'].includes(actor)) {
        logSystemEvent('ERROR','ENTRY','Unauthorized actor',{actor});
        throw new Error('Unauthorized actor: ' + actor);
      }
      const sh = _preflightOrThrow();
      const last = sh.getLastRow();
      const prevHash = (last > 1) ? (sh.getRange(last, 8).getValue() || '') : '';
      const uuid = Utilities.getUuid();
      const ts = new Date().toISOString();

      const blob = [
        uuid, ts, actor, eventType, text, gift, prevHash, status,
        provisionIds || '', provisionTitles || '', provisionSnippets || '', provisionUrls || '', citationHash || 'no_citations'
      ].join('|');
      const recordHash = sha(blob);

      sh.getRange(last + 1, 1, 1, 14).setValues([[
        uuid, ts, actor, eventType, text, gift, prevHash, recordHash, status,
        provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash
      ]]);

      logSystemEvent('INFO','ENTRY','New entry with citations created',{
        eventType, status, citationHash, actorEmail: _getEffectiveEmail(), uuid
      });
      return { uuid, ts, recordHash };
    } catch (e) {
      logSystemEvent('ERROR','ENTRY','Failed to create citation entry',{err: e.message, eventType, actor});
      throw e;
    }
  });
}

function safeNewEntryWithCitations(a,b,c,d,e,f,g,h,i,j){
  const actor = a || "System";
  return newEntryWithCitations(actor,b,c,d,e,f,g,h,i,j);
}


// ==========================
// AUDIT & VERIFICATION
// ==========================

function auditLedger() {
  try {
    const sh = _getLedgerSheet();
    _validateLedgerSchemaOrThrow(sh);

    const last = sh.getLastRow();
    const broken = [];
    const mismatches = [];

    logSystemEvent('INFO','AUDIT','Audit started',{rows: Math.max(0,last-1)});

    for (let r = 2; r <= last; r++) {
      const row = sh.getRange(r,1,1,14).getValues()[0];
      const [uuid, ts, actor, eventType, text, gift, prevHash, recordHash, status,
        provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash] = row;

      // Expected prev is prior row's recordHash (or '' for row 2)
      const priorRecordHash = (r === 2) ? '' : (sh.getRange(r-1,8).getValue() || '');
      if ((prevHash || '') !== priorRecordHash) {
        broken.push(r);
        logSystemEvent('ERROR','AUDIT','Hash chain break detected',{
          row:r, uuid, prevHash, expected: priorRecordHash
        });
      }

      const blob = [
        uuid, ts, actor, eventType, text, gift, prevHash || '', status || '',
        provisionIds || '', provisionTitles || '', provisionSnippets || '', provisionUrls || '',
        citationHash || 'no_citations'
      ].join('|');
      const computed = sha(blob);

      if ((recordHash || '') !== computed) {
        mismatches.push(r);
        logSystemEvent('ERROR','AUDIT','Hash mismatch detected (tampering)',{
          row:r, uuid, recordHash, computed
        });
      }
    }

    let msg = '';
    if (!broken.length && !mismatches.length) {
      msg = '✅ Ledger intact. All hashes verified.';
      logSystemEvent('SUCCESS','AUDIT','Ledger verified',{rows: last-1});
    } else {
      if (broken.length) msg += '⚠ HASH CHAIN BROKEN at rows: ' + broken.join(', ') + '\n';
      if (mismatches.length) msg += '⚠ DATA TAMPERING DETECTED at rows: ' + mismatches.join(', ');
    }

    if (_inUi()) SpreadsheetApp.getUi().alert('Audit Results', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    logSystemEvent('ERROR','AUDIT','Audit failed',{err: e.message});
    throw e;
  }
}

/**
 * Verify a single entry by UUID (spot-check).
 */
function verifyEntry(targetUuid) {
  const sh = _getLedgerSheet();
  const last = sh.getLastRow();

  for (let r = 2; r <= last; r++) {
    const row = sh.getRange(r,1,1,14).getValues()[0];
    const [uuid, ts, actor, eventType, text, gift, prevHash, recordHash, status,
      provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash] = row;

    if (uuid === targetUuid) {
      const blob = [
        uuid, ts, actor, eventType, text, gift, prevHash || '', status || '',
        provisionIds || '', provisionTitles || '', provisionSnippets || '', provisionUrls || '',
        citationHash || 'no_citations'
      ].join('|');
      const computed = sha(blob);
      const valid = (recordHash || '') === computed;

      return {
        row: r,
        uuid,
        valid,
        recordHash,
        computed,
        match: valid ? 'VERIFIED' : 'TAMPERED'
      };
    }
  }
  return { error: 'UUID not found', uuid: targetUuid };
}

function checkLastEntry() {
  const sh = _getLedgerSheet();
  if (sh.getLastRow() < 2) {
    if (_inUi()) SpreadsheetApp.getUi().alert('No entries yet.');
    return;
  }
  const entry = sh.getRange(sh.getLastRow(), 1, 1, 14).getValues()[0];
  const msg =
    "MOST RECENT ENTRY:\n\n" +
    "Timestamp: " + entry[1] + "\n" +
    "Actor: " + entry[2] + "\n" +
    "Event Type: " + entry[3] + "\n" +
    "Status: " + entry[8] + "\n" +
    "Citation Hash: " + (entry[13] || 'N/A');
  if (_inUi()) SpreadsheetApp.getUi().alert(msg);
}


// ==========================
// QUICK ENTRIES
// ==========================

function getDailyGift() {
  const gifts = [
    'Tip: Save receipts for 7 years.',
    'Tip: Log expenses immediately.',
    'Tip: Document decisions as you make them.',
  ];
  return gifts[Math.floor(Math.random() * gifts.length)];
}

function addReasoningEntry() {
  const ui = SpreadsheetApp.getUi();
  const t1 = ui.prompt('Event Type?', 'e.g., DECISION, REVIEW, NOTE', ui.ButtonSet.OK_CANCEL);
  if (t1.getSelectedButton() !== ui.Button.OK) return;
  const eventType = t1.getResponseText();

  const t2 = ui.prompt('Describe the reasoning/action', 'Write your What/Why/How/Confidence/Follow-ups', ui.ButtonSet.OK_CANCEL);
  if (t2.getSelectedButton() !== ui.Button.OK) return;
  const text = t2.getResponseText();

  safeNewEntry('User', eventType, text, getDailyGift(), 'DRAFT');
  ui.alert('Entry added to Audit Ledger.');
}

function testLedgerBoot() {
  safeNewEntry("System", "BOOT", "Ledger verified", "", "FINAL");
}


// ==========================
// EXPORT, BACKUP, & EMAIL
// ==========================

/**
 * Export only the Audit Ledger sheet to PDF.
 */
function exportToPDF() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = _getLedgerSheet();

    const temp = SpreadsheetApp.create('AuditLedgerExportTemp');
    const tempId = temp.getId();
    const copied = sheet.copyTo(temp).setName(LEDGER_SHEET_NAME);

    temp.getSheets().forEach(s => { if (s.getSheetId() !== copied.getSheetId()) temp.deleteSheet(s); });

    const pdfBlob = DriveApp.getFileById(tempId).getAs('application/pdf');
    const filename = 'Audit_Ledger_Export_' + new Date().toISOString().slice(0,10) + '.pdf';

    const exportFolderId = _getProp('EXPORTS_FOLDER_ID', null);
    let file;
    if (exportFolderId) {
      const folder = DriveApp.getFolderById(exportFolderId);
      file = folder.createFile(pdfBlob).setName(filename);
    } else {
      file = DriveApp.createFile(pdfBlob).setName(filename);
    }

    DriveApp.getFileById(tempId).setTrashed(true);

    logSystemEvent('SUCCESS','EXPORT','PDF export created',{fileId:file.getId(), fileName:filename});
    if (_inUi()) SpreadsheetApp.getUi().alert('Export Complete\nSaved as: ' + filename + '\n(See Exports folder if configured)');
  } catch (e) {
    logSystemEvent('ERROR','EXPORT','PDF export failed',{err:e.message});
    if (_inUi()) SpreadsheetApp.getUi().alert('Error creating PDF: ' + e.message);
  }
}

/**
 * Backup: duplicates current ledger data into a new sheet and (optionally) CSV in Drive.
 */
function backupLedger() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = _getLedgerSheet();
    _validateLedgerSchemaOrThrow(sheet);

    // Prevent sheet explosion
    if (ss.getSheets().length > 190) {
      const old = ss.getSheets().filter(s => s.getName().startsWith('Backup_'));
      if (old.length) ss.deleteSheet(old[0]);
    }

    const data = sheet.getDataRange().getValues();
    const name = 'Backup_' + new Date().toISOString().slice(0,10);

    const backupSheet = ss.insertSheet(name);
    backupSheet.getRange(1,1,data.length,data[0].length).setValues(data);
    backupSheet.getRange(1,1,1,data[0].length).setFontWeight('bold');
    backupSheet.setFrozenRows(1);
    for (let i=1; i<=data[0].length; i++) backupSheet.autoResizeColumn(i);

    const backupsFolderId = _getProp('BACKUPS_FOLDER_ID', null);
    if (backupsFolderId) {
      const csv = data.map(row => row.map(v => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g,'""') + '"' : s;
      }).join(',')).join('\n');
      const file = DriveApp.getFolderById(backupsFolderId).createFile(name + '.csv', csv, MimeType.CSV);
      logSystemEvent('SUCCESS','BACKUP','Backup sheet + CSV exported',{fileId:file.getId()});
    } else {
      logSystemEvent('SUCCESS','BACKUP','Backup sheet created (no Drive CSV)','');
    }

    if (_inUi()) SpreadsheetApp.getUi().alert('Backup created: ' + name);
  } catch (e) {
    logSystemEvent('ERROR','BACKUP','Backup failed',{err:e.message});
    if (_inUi()) SpreadsheetApp.getUi().alert('Error creating backup: ' + e.message);
  }
}

function sendEmailAlert(subject, body) {
  try {
    const email = _getProp('ALERT_EMAIL', null);
    if (!email) {
      logSystemEvent('WARN','SYSTEM','Email alert skipped (no ALERT_EMAIL set)');
      return;
    }
    MailApp.sendEmail(email, subject, body);
    logSystemEvent('INFO','SYSTEM','Email alert sent',{to: email});
  } catch (e) {
    logSystemEvent('ERROR','SYSTEM','Email alert failed',{err:e.message});
  }
}


// ==========================
// ADMIN & HELP
// ==========================

function setupLedgerSecret() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('🔐 SET UP LEDGER SECRET',
    'Paste your long, unique, secret key here. THIS CANNOT BE CHANGED OR LOST.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Setup cancelled. The Ledger will not function until the secret is set.');
    return;
  }
  const secret = (res.getResponseText() || '').trim();
  if (secret.length < 32) {
    ui.alert('Secret must be at least 32 characters. Please try again.');
    return;
  }
  _setProps({'LEDGER_SECRET': secret});
  ui.alert('✅ LEDGER_SECRET set in Script Properties. Ledger secured.');
}

function setupLedgerConfig() {
  const ui = SpreadsheetApp.getUi();
  const emailRes = ui.prompt('Ledger Config','Alert email (optional):', ui.ButtonSet.OK_CANCEL);
  if (emailRes.getSelectedButton() !== ui.Button.OK) return;
  const email = (emailRes.getResponseText() || '').trim();

  const exportsRes = ui.prompt('Ledger Config','Exports folder ID or URL (optional):', ui.ButtonSet.OK_CANCEL);
  if (exportsRes.getSelectedButton() !== ui.Button.OK) return;
  const exportsId = _normalizeFolderId((exportsRes.getResponseText() || '').trim());

  const backupsRes = ui.prompt('Ledger Config','Backups folder ID or URL (optional):', ui.ButtonSet.OK_CANCEL);
  if (backupsRes.getSelectedButton() !== ui.Button.OK) return;
  const backupsId = _normalizeFolderId((backupsRes.getResponseText() || '').trim());

  // Validate folder IDs if present
  let errorMsg = '';
  if (exportsId) { try { DriveApp.getFolderById(exportsId); } catch (e) { errorMsg += 'Exports Folder ID appears invalid.\n'; } }
  if (backupsId) { try { DriveApp.getFolderById(backupsId); } catch (e) { errorMsg += 'Backups Folder ID appears invalid.\n'; } }
  if (errorMsg) { ui.alert('Config NOT saved. Errors:\n\n' + errorMsg + 'Please try again.'); return; }

  const props = {};
  if (email) props['ALERT_EMAIL'] = email;
  if (exportsId) props['EXPORTS_FOLDER_ID'] = exportsId;
  if (backupsId) props['BACKUPS_FOLDER_ID'] = backupsId;
  _setProps(props);

  logSystemEvent('SUCCESS','ADMIN','Ledger config saved',{hasEmail: !!email, hasExports: !!exportsId, hasBackups: !!backupsId});
  ui.alert('Ledger config saved.');
}

function _normalizeFolderId(input) {
  if (!input) return '';
  const s = input.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/) || s.match(/\/drive\/folders\/([a-zA-Z0-9-_]+)/);
  return (m && m[1]) ? m[1] : s;
}

function showHelp() {
  const helpText =
    "AUDIT LEDGER - QUICK REFERENCE\n\n" +
    "GETTING STARTED\n" +
    "1. Admin > Setup Ledger Secret\n" +
    "2. Admin > Setup Ledger Config\n" +
    "3. Admin > Setup Sheet (14-Column)\n\n" +
    "CREATING ENTRIES\n" +
    "• Add Reasoning Entry\n\n" +
    "VERIFICATION\n" +
    "• Audit Ledger • View System Log\n\n" +
    "SECURITY\n" +
    "• All 14 columns are included in record hash.";
  if (_inUi()) SpreadsheetApp.getUi().alert(helpText);
}

function showAbout() {
  const aboutText =
    "ABOUT AUDIT LEDGER\n\n" +
    "Sheets-native tamper-evident audit log using a SHA-256 chain.\n" +
    "14-column fixed schema. Hash blob includes all columns.";
  if (_inUi()) SpreadsheetApp.getUi().alert('About Audit Ledger', aboutText, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Status-based formatting (applies to all 14 columns). */
function formatLedger() {
  const sh = _getLedgerSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const numCols = LEDGER_HEADERS.length;
  const statusRange = sh.getRange(2, 9, lastRow - 1, 1);
  const values = statusRange.getValues();
  const backgrounds = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v === 'VERIFIED') backgrounds.push(Array(numCols).fill('#d9ead3'));
    else if (v === 'DRAFT') backgrounds.push(Array(numCols).fill('#fff2cc'));
    else if (v === 'ERROR') backgrounds.push(Array(numCols).fill('#f4cccc'));
    else backgrounds.push(Array(numCols).fill(null));
  }

  sh.getRange(2, 1, lastRow - 1, numCols).setBackgrounds(backgrounds);
  sh.setFrozenRows(1);
  if (_inUi()) SpreadsheetApp.getUi().alert('✅ Formatting applied.');
}

function protectLedgerSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LEDGER_SHEET_NAME);
  if (!sh) throw new Error("Ledger sheet not found.");

  const protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(p => p.remove());

  const protection = sh.protect();
  protection.setDescription("Audit Ledger Protection");
  protection.removeEditors(protection.getEditors());
  Logger.log("Ledger sheet protected.");
  logSystemEvent('SUCCESS','SECURITY','Ledger sheet protected');
}


// ==========================
// MENU
// ==========================

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("Audit Ledger")
    .addItem("Add Reasoning Entry", "addReasoningEntry")
    .addSeparator()
    .addItem("Check Last Entry", "checkLastEntry")
    .addItem("Audit Ledger", "auditLedger")
    .addItem("View System Log", "viewSystemLog")
    .addSeparator()
    .addItem("Export to PDF", "exportToPDF")
    .addItem("Backup Ledger", "backupLedger")
    .addSeparator()
    .addItem("About", "showAbout")
    .addItem("Help", "showHelp")
    .addToUi();

  ui.createMenu("Sentinel")
    .addItem("Scan for Signals", "scanAndReport")
    .addItem("Process Signals", "processAndReport")
    .addSeparator()
    .addItem("View Quarantine", "viewQuarantine")
    .addItem("Show Session Ledger", "showSessionLedger")
    .addSeparator()
    .addItem("Setup Sentinel Columns", "setupSentinelColumns")
    .addToUi();

  ui.createMenu("IRAC")
    .addItem("Create IRAC Folder", "generateIRACFolder")
    .addSeparator()
    .addItem("Setup IRAC Config", "setupIRACConfig")
    .addItem("Setup IRAC Sheet", "setupIRACSheet")
    .addToUi();

  ui.createMenu("Verifier")
    .addItem("Verify Source Document", "verifySourceText")
    .addSeparator()
    .addItem("Test Gemini Connection", "testGemini")
    .addToUi();

  ui.createMenu("Admin")
    .addItem("Setup Ledger Secret", "setupLedgerSecret")
    .addItem("Setup Ledger Config (Email/Folders)", "setupLedgerConfig")
    .addItem("Setup Sheet (14-Column)", "setupSheet")
    .addItem("Format Ledger", "formatLedger")
    .addItem("Protect Ledger Sheet", "protectLedgerSheet")
    .addToUi();

  ui.createMenu("Compliance")
    .addItem("Run Compliance Check", "runComplianceCheckFromUI")
    .addSeparator()
    .addItem("Test SEC 10-K Example", "testSealedPacketFlow")
    .addToUi();
}
