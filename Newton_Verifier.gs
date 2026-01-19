/**
 * ───────────────────────────────────────────────
 *  VERIFIER : DOCUMENT VERIFICATION
 * ───────────────────────────────────────────────
 *
 *  Verifies uploaded documents match claimed sources
 *  using Gemini API.
 *
 * ───────────────────────────────────────────────
 */

const GEMINI_MODEL = "gemini-2.0-flash";

/**
 * Entry point for UI: verifies one uploaded file.
 */
function verifySourceText() {
  const ui = SpreadsheetApp.getUi();

  const filePrompt = ui.prompt("Verify Source", "Enter Google Drive file ID or URL:", ui.ButtonSet.OK_CANCEL);
  if (filePrompt.getSelectedButton() !== ui.Button.OK) return;
  const raw = filePrompt.getResponseText().trim();
  const fileId = _normalizeFileId(raw);

  const titlePrompt = ui.prompt("Claimed Source Title", "e.g., 'NY City Unincorporated Business Tax § 11-501'", ui.ButtonSet.OK_CANCEL);
  if (titlePrompt.getSelectedButton() !== ui.Button.OK) return;
  const claimedTitle = titlePrompt.getResponseText().trim();

  try {
    const file = DriveApp.getFileById(fileId);
    const text = file.getBlob().getDataAsString();
    const snippet = text.slice(0, 3000);

    const result = _callGeminiVerifier(snippet, claimedTitle);
    _logVerification(file, claimedTitle, result);

    const verdict = result.is_valid ? "✅ VALID" : "⚠️ WARNING";
    const msg =
      verdict + "\n\n" +
      "Claimed: " + claimedTitle + "\n" +
      "Detected: " + (result.detected_citation || "—") + "\n" +
      "Confidence: " + result.confidence + "\n" +
      (result.error ? ("\n" + result.error) : "");
    ui.alert("Verification Result", msg, ui.ButtonSet.OK);

  } catch (e) {
    let msg = e.message;
    if (msg.includes("Invalid file")) msg = "Could not find the file. Check the ID or sharing settings.";
    else if (msg.includes("API key")) msg = "Gemini key missing or invalid.";
    SpreadsheetApp.getUi().alert("Verification failed:\n\n" + msg);
    logSystemEvent("ERROR", "VERIFIER", "Verification failed", msg);
  }
}

/**
 * Calls Gemini with the text snippet.
 */
function _callGeminiVerifier(snippet, claimedTitle) {
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("Missing GEMINI_API_KEY in Script Properties.");

  const prompt = `
You are a document verifier.
The user claims the following source title: "${claimedTitle}".

Uploaded Text Snippet:
${snippet}

Determine if this text appears to match the claimed source.
Respond ONLY in JSON:
{
  "is_valid": true|false,
  "confidence": "high"|"medium"|"low",
  "detected_citation": "string",
  "error": "string (optional warning)"
}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }]}]
  };

  const response = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + key,
    {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    }
  );

  const raw = response.getContentText();
  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

  try {
    return JSON.parse(text);
  } catch (_) {
    return { is_valid: false, confidence: "low", detected_citation: "", error: "Unparseable response" };
  }
}

/**
 * Normalizes Google Drive URL to ID.
 */
function _normalizeFileId(input) {
  const m = input.match(/[-\w]{25,}/);
  if (!m) throw new Error("Invalid file ID or URL.");
  return m[0];
}

/**
 * Ensures Verifier Log sheet exists.
 */
function _ensureVerifierLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("Verifier Log");
  if (!sh) {
    sh = ss.insertSheet("Verifier Log");
    const headers = [
      "Timestamp","File Name","File ID","Claimed Title",
      "Detected Citation","Confidence","Is Valid","Error Msg","Raw JSON"
    ];
    sh.getRange(1,1,1,headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#4a4a4a").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Records verification result to Verifier Log sheet AND creates immutable ledger entry.
 */
function _logVerification(file, claimedTitle, result) {
  const sh = _ensureVerifierLog();
  const ts = new Date().toISOString();
  const row = [
    ts,
    file.getName(),
    file.getId(),
    claimedTitle,
    result.detected_citation || "",
    result.confidence || "",
    result.is_valid ? "TRUE" : "FALSE",
    result.error || "",
    JSON.stringify(result)
  ];
  sh.appendRow(row);

  // Write immutable ledger entry for verification result
  const verdict = result.is_valid ? "VALID" : "INVALID";
  const ledgerText = [
    `VERIFICATION: ${verdict}`,
    `FILE: ${file.getName()}`,
    `FILE_ID: ${file.getId()}`,
    `CLAIMED: ${claimedTitle}`,
    `DETECTED: ${result.detected_citation || "none"}`,
    `CONFIDENCE: ${result.confidence || "unknown"}`,
    result.error ? `ERROR: ${result.error}` : null
  ].filter(Boolean).join(' | ');

  try {
    if (typeof safeNewEntry === 'function') {
      safeNewEntry('System', 'DOCUMENT_VERIFIED', ledgerText, '', 'FINAL');
    }
  } catch (ledgerErr) {
    logSystemEvent("ERROR", "VERIFIER", "Failed to write verification ledger entry", {
      error: ledgerErr.message,
      fileId: file.getId()
    });
  }

  logSystemEvent("INFO","VERIFIER","Verification logged",{file:file.getName(),result:result});
}

/**
 * Test Gemini connection.
 */
function testGemini() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey;

  const body = {
    contents: [
      { parts: [{ text: "Say hello from Audit Ledger." }] }
    ]
  };

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  Logger.log(res.getResponseCode());
  Logger.log(res.getContentText());
}
