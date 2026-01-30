/**
 * ───────────────────────────────────────────────
 *  API ENDPOINT : WEB APP FOR EXTERNAL WRITES
 * ───────────────────────────────────────────────
 *
 *  Accepts POST requests to write ledger entries.
 *  Secured via API_SECRET in Script Properties.
 *
 * ───────────────────────────────────────────────
 */

function doPost(e) {
  try {
    if (!e || !e.postData) {
      return _apiResponse({ error: 'No data received' }, 400);
    }

    const data = JSON.parse(e.postData.contents);
    const { key, actor, eventType, text, gift, status, provisionIds, provisionTitles, provisionSnippets, provisionUrls, citationHash } = data;

    const apiSecret = _getProp('API_SECRET', null);
    if (!apiSecret) return _apiResponse({ error: 'Server misconfigured: API_SECRET not set' }, 500);
    if (key !== apiSecret) {
      logSystemEvent('WARN', 'API', 'Unauthorized API request', {});
      return _apiResponse({ error: 'Unauthorized' }, 401);
    }

    if (!actor || !['User', 'Admin', 'System'].includes(actor)) {
      return _apiResponse({ error: 'Invalid actor. Must be User, Admin, or System.' }, 400);
    }
    if (!eventType || !text) {
      return _apiResponse({ error: 'Missing required fields: eventType, text' }, 400);
    }

    let result;
    if (citationHash && provisionIds) {
      result = safeNewEntryWithCitations(
        actor, eventType, text, gift || '', status || 'DRAFT',
        provisionIds, provisionTitles || '', provisionSnippets || '', provisionUrls || '', citationHash
      );
    } else {
      result = safeNewEntry(actor, eventType, text, gift || '', status || 'DRAFT');
    }

    logSystemEvent('SUCCESS', 'API', 'Entry created via API', { uuid: result.uuid, eventType, actor });

    return _apiResponse({
      success: true,
      uuid: result.uuid,
      timestamp: result.ts,
      recordHash: result.recordHash
    }, 200);

  } catch (err) {
    logSystemEvent('ERROR', 'API', 'API request failed', { error: err.message });
    return _apiResponse({ error: err.message || 'Internal server error' }, 500);
  }
}

function _apiResponse(data, statusCode) {
  data.statusCode = statusCode;
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function testApiEndpoint() {
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        key: _getProp('API_SECRET', ''),
        actor: 'System',
        eventType: 'API_TEST',
        text: 'Test entry from API endpoint',
        gift: 'Testing is caring',
        status: 'DRAFT'
      })
    },
    parameter: {}
  };
  const response = doPost(mockEvent);
  Logger.log(response.getContent());
}
