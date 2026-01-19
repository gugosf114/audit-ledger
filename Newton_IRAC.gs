/**
 * ───────────────────────────────────────────────
 *  IRAC : LEGAL RESEARCH FOLDER CREATION
 * ───────────────────────────────────────────────
 *
 *  Creates cryptographically-fingerprinted Drive folders
 *  for legal research (Issue, Rule, Application, Conclusion).
 *
 * ───────────────────────────────────────────────
 */

// ==========================
// CONSTANTS
// ==========================

const IRAC_SHEET_NAME = 'IRAC Cases';
const IRAC_HEADERS = ['case_id','case_name','created_date','folder_url','folder_hash','status','linked_record_id'];
const IRAC_STATUS = Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED', FAILED: 'FAILED' });


// ==========================
// UTIL: Backoff / Retry
// ==========================

function _retry(fn, label, tries = 5, baseMs = 250) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return fn(); } catch (e) {
      lastErr = e;
      Utilities.sleep(baseMs * Math.pow(2, i));
    }
  }
  logSystemEvent('ERROR', 'RETRY', `Exhausted retries: ${label}`, lastErr && lastErr.message);
  throw lastErr || new Error(`Failed after ${tries} retries: ${label}`);
}


// ==========================
// DETERMINISTIC HASHING
// ==========================

function _collectTreeEntries(rootFolder, rootName) {
  const entries = [];

  function walk(folder, pathSoFar) {
    entries.push({
      type: 'FOLDER',
      path: pathSoFar,
      id: folder.getId(),
      name: folder.getName(),
      size: 0,
      mtime: folder.getLastUpdated() ? folder.getLastUpdated().toISOString() : ''
    });

    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = (f.getName() || '').replace(/\|/g, ' ');
      const p = pathSoFar + '/' + name;
      entries.push({
        type: 'FILE',
        path: p,
        id: f.getId(),
        name,
        size: f.getSize() || 0,
        mtime: f.getLastUpdated() ? f.getLastUpdated().toISOString() : ''
      });
    }

    const subs = folder.getFolders();
    const subList = [];
    while (subs.hasNext()) subList.push(subs.next());
    subList.sort((a,b) => {
      const n = (a.getName()||'').localeCompare(b.getName()||'');
      return n !== 0 ? n : a.getId().localeCompare(b.getId());
    });
    subList.forEach(sub => {
      const subName = (sub.getName() || '').replace(/\|/g, ' ');
      walk(sub, pathSoFar + '/' + subName);
    });
  }

  walk(rootFolder, '/' + (rootName || rootFolder.getName()).replace(/\|/g, ' '));
  entries.sort((a,b) => {
    const p = a.path.localeCompare(b.path);
    return p !== 0 ? p : a.id.localeCompare(b.id);
  });
  return entries;
}

function computeFolderHashDeterministic(folder) {
  const rootName = folder.getName();
  const entries = _collectTreeEntries(folder, rootName);

  const metaHexes = entries.map(e => {
    const canonical = [
      e.type, e.path, e.id, e.name, String(e.size), e.mtime
    ].join('|');
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical);
    return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  });

  const joined = metaHexes.join('|');
  const folderHash = sha(joined);

  return { folderHash, tree: entries, metaHexes };
}


// ==========================
// COPY HELPERS
// ==========================

function _copyFileToFolder(file, targetFolder) {
  return _retry(() => file.makeCopy(file.getName(), targetFolder), 'copyFile:' + file.getId());
}

function _createSubfolder(parent, name) {
  return _retry(() => parent.createFolder(name), 'createFolder:' + name);
}

function copyFolderContentsSafe(source, target) {
  const files = [];
  const it = source.getFiles();
  while (it.hasNext()) files.push(it.next());
  for (const f of files) _copyFileToFolder(f, target);

  const subs = [];
  const sit = source.getFolders();
  while (sit.hasNext()) subs.push(sit.next());
  subs.sort((a,b) => {
    const n = (a.getName()||'').localeCompare(b.getName()||'');
    return n !== 0 ? n : a.getId().localeCompare(b.getId());
  });
  for (const sub of subs) {
    const newSub = _createSubfolder(target, sub.getName());
    copyFolderContentsSafe(sub, newSub);
  }
}


// ==========================
// IRAC SHEET WRITE
// ==========================

function _getOrCreateIRACSheet(ss) {
  let sh = ss.getSheetByName(IRAC_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(IRAC_SHEET_NAME);
    sh.getRange(1,1,1,IRAC_HEADERS.length).setValues([IRAC_HEADERS])
      .setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    const existing = sh.getRange(1,1,1,IRAC_HEADERS.length).getValues()[0];
    const ok = IRAC_HEADERS.every((h,i) => String(existing[i]).trim() === h);
    if (!ok) {
      logSystemEvent('ERROR','SCHEMA','IRAC sheet header mismatch; refusing write',{expected: IRAC_HEADERS, got: existing});
      throw new Error('IRAC Cases header mismatch. Fix headers before proceeding.');
    }
  }
  return sh;
}

function _writeIRACCaseEntry(ss, folder, folderName, folderHash, status) {
  const recordId = Utilities.getUuid();
  const tsUtc = new Date().toISOString();

  const irac = _getOrCreateIRACSheet(ss);
  const row = [recordId, folderName, tsUtc, folder.getUrl(), folderHash, status, recordId];
  irac.getRange(irac.getLastRow()+1, 1, 1, IRAC_HEADERS.length).setValues([row]);

  logSystemEvent('SUCCESS','IRAC','IRAC Case logged', {recordId, status});
  return recordId;
}


// ==========================
// CREATE IRAC
// ==========================

function createIRACWithSafeLedger(caseName) {
  return withLock(() => {
    const props = PropertiesService.getScriptProperties();
    const templateId = props.getProperty('IRAC_TEMPLATE_ID');
    const parentId   = props.getProperty('IRAC_MAIN_FOLDER_ID');

    if (!templateId || !parentId) {
      const msg = 'IRAC configuration missing. Run "IRAC > Setup IRAC Config".';
      logSystemEvent('ERROR','IRAC','Missing IRAC folder IDs', '');
      SpreadsheetApp.getUi().alert(msg);
      throw new Error(msg);
    }

    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const template = _retry(() => DriveApp.getFolderById(templateId), 'getTemplate:'+templateId);
    const parent   = _retry(() => DriveApp.getFolderById(parentId),   'getParent:'+parentId);

    const date = new Date().toISOString().slice(0,10);
    const safeName = (caseName || 'Case').replace(/[\\/:*?"<>|]/g,'_');
    const folderName = `IRAC_${date}_${safeName}`;

    let newFolder = null;
    let recordId  = null;
    let folderHash = '';
    let metaSaved = false;

    try {
      newFolder = _createSubfolder(parent, folderName);
      copyFolderContentsSafe(template, newFolder);

      const { folderHash: h, tree } = computeFolderHashDeterministic(newFolder);
      folderHash = h;

      const actorEmail = (function () { try { return Session.getEffectiveUser().getEmail(); } catch(e){ return ''; } })();
      const metadata = {
        version: 'IRAC_v1',
        generatedAt: new Date().toISOString(),
        actorEmail,
        caseName: folderName,
        folderId: newFolder.getId(),
        folderUrl: newFolder.getUrl(),
        folderHash,
        entries: tree.map(e => ({
          type: e.type, path: e.path, id: e.id, name: e.name,
          size: e.size, mtime: e.mtime
        }))
      };
      _retry(() => newFolder.createFile('metadata.json', JSON.stringify(metadata, null, 2), MimeType.PLAIN_TEXT),
             'write:metadata.json');
      metaSaved = true;

      recordId = _writeIRACCaseEntry(ss, newFolder, folderName, folderHash, IRAC_STATUS.OPEN);

      // Write immutable ledger entry for IRAC case creation
      const ledgerText = [
        `IRAC_CREATED: ${folderName}`,
        `RECORD_ID: ${recordId}`,
        `FOLDER_ID: ${newFolder.getId()}`,
        `FOLDER_HASH: ${folderHash}`,
        `STATUS: ${IRAC_STATUS.OPEN}`
      ].join(' | ');

      try {
        if (typeof safeNewEntry === 'function') {
          safeNewEntry('System', 'IRAC_CASE_CREATED', ledgerText, '', 'FINAL');
        }
      } catch (ledgerErr) {
        logSystemEvent('ERROR', 'IRAC', 'Failed to write IRAC ledger entry', {
          error: ledgerErr.message,
          recordId: recordId
        });
      }

      return { recordId, folderUrl: newFolder.getUrl(), folderHash, metadataSaved: metaSaved };

    } catch (e) {
      logSystemEvent('ERROR','IRAC','Create IRAC failed', e && e.message);

      try {
        if (newFolder && !metaSaved) {
          newFolder.createFile('FAILED.txt', 'IRAC creation failed before metadata: ' + (e && e.message));
        }
      } catch (_) {}

      try { if (newFolder) newFolder.setTrashed(true); } catch (_) {}

      SpreadsheetApp.getUi().alert('IRAC creation failed: ' + (e && e.message ? e.message : e));
      throw e;
    }
  });
}


// ==========================
// UI WRAPPERS
// ==========================

function generateIRACFolder() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('IRAC Case Name', 'Enter Case Name (e.g., CaseABC):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) { ui.alert('Cancelled'); return; }
  const caseName = (res.getResponseText() || '').trim();
  if (!caseName) { ui.alert('No case name provided.'); return; }

  try {
    const result = createIRACWithSafeLedger(caseName);
    ui.alert('✅ IRAC Folder Created\n\n' + result.folderUrl + '\n\nHash: ' + result.folderHash);
  } catch (e) {
    // Error already logged and alerted
  }
}

function setupIRACConfig() {
  const ui = SpreadsheetApp.getUi();

  function promptId(title) {
    for (let i=0;i<2;i++) {
      const r = ui.prompt('IRAC Setup', title, ui.ButtonSet.OK_CANCEL);
      if (r.getSelectedButton() !== ui.Button.OK) return null;
      const id = _normalizeFolderId((r.getResponseText() || '').trim());
      if (!id) { ui.alert('Empty. Try again.'); continue; }
      try { DriveApp.getFolderById(id); return id; }
      catch (e) { ui.alert('Invalid ID/URL. Try again.\n\n' + e.message); }
    }
    return null;
  }

  const templateId = promptId('Enter Template Folder ID (or URL):');
  if (!templateId) { ui.alert('Aborted. Template ID not set.'); return; }
  const parentId = promptId('Enter Main IRAC Parent Folder ID (or URL):');
  if (!parentId) { ui.alert('Aborted. Parent ID not set.'); return; }

  PropertiesService.getScriptProperties().setProperties({
    IRAC_TEMPLATE_ID: templateId,
    IRAC_MAIN_FOLDER_ID: parentId
  });
  ui.alert('IRAC configuration saved.');
}

function setupIRACSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let irac = ss.getSheetByName('IRAC Cases');
  if (!irac) {
    irac = ss.insertSheet('IRAC Cases');
    irac.getRange(1,1,1,IRAC_HEADERS.length).setValues([IRAC_HEADERS])
      .setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
    irac.setFrozenRows(1);
  }
  SpreadsheetApp.getUi().alert('IRAC Cases sheet is ready.');
}
