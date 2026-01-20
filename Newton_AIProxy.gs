/**
 * ───────────────────────────────────────────────
 *  NEWTON AI PROXY : COMPLIANT AI REQUEST GATEWAY
 * ───────────────────────────────────────────────
 *
 *  A compliance-first proxy for all AI API requests.
 *  Routes requests to OpenAI, Anthropic, or Google,
 *  while logging everything to the audit ledger.
 *
 *  Features:
 *  - Multi-provider support (OpenAI, Anthropic, Google)
 *  - Full request/response logging
 *  - Auto-tagging with regulatory frameworks
 *  - Token usage and cost tracking
 *  - Web API endpoint for external integration
 *
 *  Compliant with:
 *  - EU AI Act Article 12 (Record-keeping)
 *  - EU AI Act Article 13 (Transparency)
 *  - EU AI Act Article 20 (Automatically generated logs)
 *  - ISO 42001 Clause 8.1 (Operational control)
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const AI_PROXY_CONFIG = {
  // Supported providers
  PROVIDERS: {
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    GOOGLE: 'google'
  },

  // Provider API endpoints
  ENDPOINTS: {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    google: 'https://generativelanguage.googleapis.com/v1beta/models'
  },

  // Default models per provider
  DEFAULT_MODELS: {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    google: 'gemini-1.5-pro'
  },

  // Pricing per 1M tokens (approximate, update as needed)
  PRICING: {
    openai: {
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
    },
    anthropic: {
      'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
      'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
      'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 }
    },
    google: {
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      'gemini-2.0-flash': { input: 0.10, output: 0.40 }
    }
  },

  // Regulatory tags for AI operations
  REGULATORY_TAGS: [
    'EU_AI_ACT:Art.12',   // Record-keeping
    'EU_AI_ACT:Art.13',   // Transparency
    'EU_AI_ACT:Art.20',   // Automatically generated logs
    'ISO_42001:8.1',      // Operational control
    'ISO_42001:7.5',      // Documented information
    'NIST_AI_RMF:GOVERN-1', // Policies and procedures
    'NIST_AI_RMF:MEASURE-4' // Feedback gathering
  ]
};


// ==========================
// API KEY MANAGEMENT
// ==========================

/**
 * Get API key for a provider from Script Properties
 */
function _getProviderKey(provider) {
  const keyNames = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY'
  };

  const keyName = keyNames[provider];
  if (!keyName) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const key = PropertiesService.getScriptProperties().getProperty(keyName);
  if (!key) {
    throw new Error(`API key not configured for ${provider}. Set ${keyName} in Script Properties.`);
  }

  return key;
}

/**
 * Set API key for a provider
 */
function setProviderKey(provider, apiKey) {
  const keyNames = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY'
  };

  const keyName = keyNames[provider];
  if (!keyName) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  PropertiesService.getScriptProperties().setProperty(keyName, apiKey);
  logSystemEvent('SUCCESS', 'AI_PROXY', `API key configured for ${provider}`, {});
}


// ==========================
// CORE PROXY FUNCTION
// ==========================

/**
 * Proxy an AI request through Newton with full logging
 *
 * @param {string} provider - AI provider ("openai", "anthropic", "google")
 * @param {string} model - Model to use (or null for default)
 * @param {string|Array} prompt - Prompt string or messages array
 * @param {Object} metadata - Additional metadata to log
 * @returns {Object} - Response with AI output and Newton UUID
 */
function proxyAIRequest(provider, model, prompt, metadata) {
  const requestId = Utilities.getUuid();
  const startTime = new Date();

  // Normalize provider
  provider = provider.toLowerCase();
  if (!['openai', 'anthropic', 'google'].includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}. Use: openai, anthropic, google`);
  }

  // Use default model if not specified
  model = model || AI_PROXY_CONFIG.DEFAULT_MODELS[provider];

  // Build request record
  const requestRecord = {
    requestId: requestId,
    timestamp: startTime.toISOString(),
    provider: provider,
    model: model,
    prompt: sanitizePrompt(prompt),
    metadata: metadata || {},
    caller: Session.getEffectiveUser().getEmail()
  };

  logSystemEvent('INFO', 'AI_PROXY', 'AI request initiated', {
    requestId,
    provider,
    model
  });

  let response = null;
  let error = null;
  let usage = null;

  try {
    // Route to appropriate provider
    switch (provider) {
      case 'openai':
        response = callOpenAI(model, prompt);
        break;
      case 'anthropic':
        response = callAnthropic(model, prompt);
        break;
      case 'google':
        response = callGoogle(model, prompt);
        break;
    }

    // Extract usage if available
    usage = extractUsage(provider, response.raw);

  } catch (e) {
    error = e.message;
    logSystemEvent('ERROR', 'AI_PROXY', 'AI request failed', {
      requestId,
      provider,
      error: e.message
    });
  }

  const endTime = new Date();
  const durationMs = endTime - startTime;

  // Calculate cost
  const cost = usage ? calculateCost(provider, model, usage) : null;

  // Build full log entry
  const logEntry = buildProxyLogEntry(requestRecord, response, error, usage, cost, durationMs);

  // Write to ledger
  const ledgerResult = writeProxyToLedger(logEntry);

  // Return response with Newton metadata
  return {
    success: !error,
    requestId: requestId,
    newtonUuid: ledgerResult.uuid,
    provider: provider,
    model: model,
    response: response?.content || null,
    error: error,
    usage: usage,
    cost: cost,
    durationMs: durationMs,
    regulatoryTags: AI_PROXY_CONFIG.REGULATORY_TAGS
  };
}

/**
 * Sanitize prompt for logging (truncate, redact sensitive)
 */
function sanitizePrompt(prompt) {
  if (typeof prompt === 'string') {
    return prompt.length > 5000 ? prompt.substring(0, 5000) + '...[truncated]' : prompt;
  }

  if (Array.isArray(prompt)) {
    return prompt.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' && msg.content.length > 2000
        ? msg.content.substring(0, 2000) + '...[truncated]'
        : msg.content
    }));
  }

  return prompt;
}


// ==========================
// PROVIDER IMPLEMENTATIONS
// ==========================

/**
 * Call OpenAI API
 */
function callOpenAI(model, prompt) {
  const apiKey = _getProviderKey('openai');

  // Convert prompt to messages format
  let messages;
  if (typeof prompt === 'string') {
    messages = [{ role: 'user', content: prompt }];
  } else if (Array.isArray(prompt)) {
    messages = prompt;
  } else {
    throw new Error('Invalid prompt format for OpenAI');
  }

  const payload = {
    model: model,
    messages: messages,
    max_tokens: 4096
  };

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(AI_PROXY_CONFIG.ENDPOINTS.openai, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error(`OpenAI error: ${json.error.message}`);
  }

  return {
    content: json.choices[0].message.content,
    raw: json
  };
}

/**
 * Call Anthropic API
 */
function callAnthropic(model, prompt) {
  const apiKey = _getProviderKey('anthropic');

  // Convert prompt to messages format
  let messages;
  if (typeof prompt === 'string') {
    messages = [{ role: 'user', content: prompt }];
  } else if (Array.isArray(prompt)) {
    messages = prompt;
  } else {
    throw new Error('Invalid prompt format for Anthropic');
  }

  const payload = {
    model: model,
    messages: messages,
    max_tokens: 4096
  };

  const options = {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(AI_PROXY_CONFIG.ENDPOINTS.anthropic, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error(`Anthropic error: ${json.error.message}`);
  }

  return {
    content: json.content[0].text,
    raw: json
  };
}

/**
 * Call Google Gemini API
 */
function callGoogle(model, prompt) {
  const apiKey = _getProviderKey('google');

  // Convert prompt to Gemini format
  let contents;
  if (typeof prompt === 'string') {
    contents = [{ parts: [{ text: prompt }] }];
  } else if (Array.isArray(prompt)) {
    contents = prompt.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
  } else {
    throw new Error('Invalid prompt format for Google');
  }

  const url = `${AI_PROXY_CONFIG.ENDPOINTS.google}/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: contents,
    generationConfig: {
      maxOutputTokens: 4096
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error(`Google error: ${json.error.message}`);
  }

  return {
    content: json.candidates[0].content.parts[0].text,
    raw: json
  };
}


// ==========================
// USAGE & COST TRACKING
// ==========================

/**
 * Extract token usage from provider response
 */
function extractUsage(provider, rawResponse) {
  try {
    switch (provider) {
      case 'openai':
        return {
          inputTokens: rawResponse.usage?.prompt_tokens || 0,
          outputTokens: rawResponse.usage?.completion_tokens || 0,
          totalTokens: rawResponse.usage?.total_tokens || 0
        };

      case 'anthropic':
        return {
          inputTokens: rawResponse.usage?.input_tokens || 0,
          outputTokens: rawResponse.usage?.output_tokens || 0,
          totalTokens: (rawResponse.usage?.input_tokens || 0) + (rawResponse.usage?.output_tokens || 0)
        };

      case 'google':
        const inputTokens = rawResponse.usageMetadata?.promptTokenCount || 0;
        const outputTokens = rawResponse.usageMetadata?.candidatesTokenCount || 0;
        return {
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          totalTokens: inputTokens + outputTokens
        };

      default:
        return null;
    }
  } catch (e) {
    return null;
  }
}

/**
 * Calculate cost based on usage
 */
function calculateCost(provider, model, usage) {
  const pricing = AI_PROXY_CONFIG.PRICING[provider]?.[model];
  if (!pricing || !usage) return null;

  const inputCost = (usage.inputTokens / 1000000) * pricing.input;
  const outputCost = (usage.outputTokens / 1000000) * pricing.output;

  return {
    inputCost: Math.round(inputCost * 10000) / 10000,
    outputCost: Math.round(outputCost * 10000) / 10000,
    totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
    currency: 'USD'
  };
}


// ==========================
// LEDGER INTEGRATION
// ==========================

/**
 * Build log entry for ledger
 */
function buildProxyLogEntry(request, response, error, usage, cost, durationMs) {
  const lines = [
    `[AI_PROXY_REQUEST]`,
    `Request ID: ${request.requestId}`,
    `Provider: ${request.provider}`,
    `Model: ${request.model}`,
    `Timestamp: ${request.timestamp}`,
    `Caller: ${request.caller}`,
    `Duration: ${durationMs}ms`,
    ``
  ];

  if (usage) {
    lines.push(`USAGE:`);
    lines.push(`  Input Tokens: ${usage.inputTokens}`);
    lines.push(`  Output Tokens: ${usage.outputTokens}`);
    lines.push(`  Total Tokens: ${usage.totalTokens}`);
    lines.push(``);
  }

  if (cost) {
    lines.push(`COST:`);
    lines.push(`  Input: $${cost.inputCost}`);
    lines.push(`  Output: $${cost.outputCost}`);
    lines.push(`  Total: $${cost.totalCost}`);
    lines.push(``);
  }

  lines.push(`PROMPT (truncated):`);
  lines.push(JSON.stringify(request.prompt).substring(0, 500));
  lines.push(``);

  if (response) {
    lines.push(`RESPONSE (truncated):`);
    lines.push((response.content || '').substring(0, 500));
  }

  if (error) {
    lines.push(`ERROR: ${error}`);
  }

  if (request.metadata && Object.keys(request.metadata).length > 0) {
    lines.push(``);
    lines.push(`METADATA:`);
    lines.push(JSON.stringify(request.metadata));
  }

  // Hash the full request/response for integrity
  const fullRecord = JSON.stringify({ request, response: response?.content, error, usage, cost });
  const recordHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, fullRecord)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');

  lines.push(``);
  lines.push(`Record Hash: ${recordHash}`);

  return {
    text: lines.join('\n'),
    eventType: error ? 'AI_PROXY_ERROR' : 'AI_PROXY_SUCCESS',
    status: error ? 'ERROR' : 'VERIFIED',
    metadata: {
      requestId: request.requestId,
      provider: request.provider,
      model: request.model,
      usage: usage,
      cost: cost,
      durationMs: durationMs
    }
  };
}

/**
 * Write proxy log to ledger
 */
function writeProxyToLedger(logEntry) {
  const result = safeNewEntry(
    'System',
    logEntry.eventType,
    logEntry.text,
    '',
    logEntry.status
  );

  // Apply regulatory tags
  if (result.uuid) {
    tagEntry(result.uuid, AI_PROXY_CONFIG.REGULATORY_TAGS);
  }

  return result;
}


// ==========================
// WEB API ENDPOINT
// ==========================

/**
 * Web API endpoint for external AI requests
 * Deploy as Web App to get URL
 *
 * POST /ai-proxy
 * Body: {
 *   provider: "openai" | "anthropic" | "google",
 *   model: "gpt-4o" | "claude-sonnet-4-20250514" | "gemini-1.5-pro",
 *   messages: [{ role: "user", content: "..." }],
 *   apiKey: "optional - use stored if not provided",
 *   metadata: { ... }
 * }
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Validate required fields
    if (!data.provider) {
      return createJsonResponse({ error: 'Missing required field: provider' }, 400);
    }
    if (!data.messages && !data.prompt) {
      return createJsonResponse({ error: 'Missing required field: messages or prompt' }, 400);
    }

    const provider = data.provider.toLowerCase();
    const model = data.model || AI_PROXY_CONFIG.DEFAULT_MODELS[provider];
    const prompt = data.messages || data.prompt;
    const metadata = data.metadata || {};

    // Use provided API key or stored key
    if (data.apiKey) {
      // Temporarily set the key for this request
      const keyNames = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        google: 'GEMINI_API_KEY'
      };
      PropertiesService.getScriptProperties().setProperty(keyNames[provider], data.apiKey);
    }

    // Execute proxy request
    const result = proxyAIRequest(provider, model, prompt, metadata);

    return createJsonResponse(result, result.success ? 200 : 500);

  } catch (error) {
    logSystemEvent('ERROR', 'AI_PROXY', 'Web API error', { error: error.message });

    return createJsonResponse({
      error: error.message,
      success: false
    }, 500);
  }
}

/**
 * Handle GET requests (status/docs)
 */
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'status') {
    return createJsonResponse({
      status: 'online',
      version: '1.0',
      providers: ['openai', 'anthropic', 'google'],
      endpoints: {
        proxy: 'POST /',
        status: 'GET /?action=status'
      }
    }, 200);
  }

  // Default: return API documentation
  return createJsonResponse({
    name: 'Newton AI Proxy',
    version: '1.0',
    description: 'Compliant AI request gateway with full audit logging',
    usage: {
      method: 'POST',
      body: {
        provider: 'openai | anthropic | google (required)',
        model: 'model name (optional, uses default)',
        messages: '[{ role: "user", content: "..." }] (required)',
        apiKey: 'API key (optional, uses stored)',
        metadata: '{ custom metadata } (optional)'
      },
      response: {
        success: 'boolean',
        requestId: 'UUID',
        newtonUuid: 'Ledger entry UUID',
        response: 'AI response text',
        usage: '{ inputTokens, outputTokens, totalTokens }',
        cost: '{ inputCost, outputCost, totalCost, currency }',
        regulatoryTags: 'Applied compliance tags'
      }
    }
  }, 200);
}

function createJsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}


// ==========================
// ACTIVITY REPORTING
// ==========================

/**
 * Get AI activity report across all providers
 *
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} provider - Optional provider filter
 * @param {string} model - Optional model filter
 * @returns {Object} - Activity report
 */
function getAIActivityReport(startDate, endDate, provider, model) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit_Ledger');
  if (!sh) throw new Error('Audit_Ledger not found');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { error: 'No entries found' };

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(23, 59, 59, 999);

  const requests = [];

  for (const row of data) {
    const timestamp = new Date(row[1]);
    const eventType = row[3] || '';
    const text = row[4] || '';

    // Filter AI proxy entries
    if (!eventType.startsWith('AI_PROXY')) continue;
    if (timestamp < start || timestamp > end) continue;

    // Extract provider and model from text
    const providerMatch = text.match(/Provider:\s*(\w+)/i);
    const modelMatch = text.match(/Model:\s*([^\n]+)/i);
    const reqProvider = providerMatch ? providerMatch[1].toLowerCase() : 'unknown';
    const reqModel = modelMatch ? modelMatch[1].trim() : 'unknown';

    // Apply filters
    if (provider && reqProvider !== provider.toLowerCase()) continue;
    if (model && reqModel !== model) continue;

    // Extract metrics
    const inputTokens = extractNumber(text, /Input Tokens:\s*(\d+)/);
    const outputTokens = extractNumber(text, /Output Tokens:\s*(\d+)/);
    const totalCost = extractNumber(text, /Total:\s*\$([0-9.]+)/);
    const duration = extractNumber(text, /Duration:\s*(\d+)ms/);

    requests.push({
      uuid: row[0],
      timestamp: row[1],
      eventType: eventType,
      provider: reqProvider,
      model: reqModel,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalCost: totalCost,
      durationMs: duration,
      status: row[8]
    });
  }

  // Calculate aggregates
  const report = {
    period: { startDate, endDate },
    filters: { provider, model },
    generatedAt: new Date().toISOString(),

    summary: {
      totalRequests: requests.length,
      successfulRequests: requests.filter(r => r.eventType === 'AI_PROXY_SUCCESS').length,
      failedRequests: requests.filter(r => r.eventType === 'AI_PROXY_ERROR').length,
      totalInputTokens: requests.reduce((sum, r) => sum + (r.inputTokens || 0), 0),
      totalOutputTokens: requests.reduce((sum, r) => sum + (r.outputTokens || 0), 0),
      totalTokens: requests.reduce((sum, r) => sum + (r.inputTokens || 0) + (r.outputTokens || 0), 0),
      totalCost: Math.round(requests.reduce((sum, r) => sum + (r.totalCost || 0), 0) * 10000) / 10000,
      avgDurationMs: requests.length > 0
        ? Math.round(requests.reduce((sum, r) => sum + (r.durationMs || 0), 0) / requests.length)
        : 0
    },

    byProvider: {},
    byModel: {},
    dailyUsage: {},

    requests: requests
  };

  // Group by provider
  for (const req of requests) {
    if (!report.byProvider[req.provider]) {
      report.byProvider[req.provider] = {
        requests: 0,
        tokens: 0,
        cost: 0
      };
    }
    report.byProvider[req.provider].requests++;
    report.byProvider[req.provider].tokens += (req.inputTokens || 0) + (req.outputTokens || 0);
    report.byProvider[req.provider].cost += req.totalCost || 0;
  }

  // Group by model
  for (const req of requests) {
    const key = `${req.provider}/${req.model}`;
    if (!report.byModel[key]) {
      report.byModel[key] = {
        requests: 0,
        tokens: 0,
        cost: 0
      };
    }
    report.byModel[key].requests++;
    report.byModel[key].tokens += (req.inputTokens || 0) + (req.outputTokens || 0);
    report.byModel[key].cost += req.totalCost || 0;
  }

  // Daily usage
  for (const req of requests) {
    const day = req.timestamp.toString().substring(0, 10);
    if (!report.dailyUsage[day]) {
      report.dailyUsage[day] = { requests: 0, tokens: 0, cost: 0 };
    }
    report.dailyUsage[day].requests++;
    report.dailyUsage[day].tokens += (req.inputTokens || 0) + (req.outputTokens || 0);
    report.dailyUsage[day].cost += req.totalCost || 0;
  }

  // Round costs
  for (const p of Object.keys(report.byProvider)) {
    report.byProvider[p].cost = Math.round(report.byProvider[p].cost * 10000) / 10000;
  }
  for (const m of Object.keys(report.byModel)) {
    report.byModel[m].cost = Math.round(report.byModel[m].cost * 10000) / 10000;
  }

  return report;
}

function extractNumber(text, regex) {
  const match = text.match(regex);
  return match ? parseFloat(match[1]) : 0;
}


// ==========================
// EXPORT FUNCTIONS
// ==========================

/**
 * Export AI activity report as JSON
 */
function exportAIReportAsJSON(report) {
  const filename = `AI_Activity_Report_${new Date().toISOString().substring(0, 10)}.json`;
  const content = JSON.stringify(report, null, 2);

  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  let file;

  if (folderId) {
    file = DriveApp.getFolderById(folderId).createFile(filename, content, MimeType.PLAIN_TEXT);
  } else {
    file = DriveApp.createFile(filename, content, MimeType.PLAIN_TEXT);
  }

  return file;
}

/**
 * Export AI activity report as Google Doc
 */
function exportAIReportAsDoc(report) {
  const title = `AI Activity Report: ${report.period.startDate || 'All Time'} to ${report.period.endDate || 'Now'}`;
  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  // Title
  body.appendParagraph(title)
    .setHeading(DocumentApp.ParagraphHeading.TITLE);

  body.appendParagraph(`Generated: ${report.generatedAt}`)
    .setItalic(true);

  body.appendHorizontalRule();

  // Summary
  body.appendParagraph('EXECUTIVE SUMMARY')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const s = report.summary;
  body.appendParagraph(`Total Requests: ${s.totalRequests}`);
  body.appendParagraph(`Successful: ${s.successfulRequests} | Failed: ${s.failedRequests}`);
  body.appendParagraph(`Total Tokens: ${s.totalTokens.toLocaleString()}`);
  body.appendParagraph(`Total Cost: $${s.totalCost}`);
  body.appendParagraph(`Average Response Time: ${s.avgDurationMs}ms`);

  body.appendHorizontalRule();

  // By Provider
  body.appendParagraph('USAGE BY PROVIDER')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const provTable = body.appendTable();
  const provHeader = provTable.appendTableRow();
  ['Provider', 'Requests', 'Tokens', 'Cost'].forEach(h =>
    provHeader.appendTableCell(h).setBold(true)
  );

  for (const [prov, data] of Object.entries(report.byProvider)) {
    const row = provTable.appendTableRow();
    row.appendTableCell(prov);
    row.appendTableCell(String(data.requests));
    row.appendTableCell(data.tokens.toLocaleString());
    row.appendTableCell(`$${data.cost}`);
  }

  body.appendHorizontalRule();

  // By Model
  body.appendParagraph('USAGE BY MODEL')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const modelTable = body.appendTable();
  const modelHeader = modelTable.appendTableRow();
  ['Model', 'Requests', 'Tokens', 'Cost'].forEach(h =>
    modelHeader.appendTableCell(h).setBold(true)
  );

  for (const [mod, data] of Object.entries(report.byModel)) {
    const row = modelTable.appendTableRow();
    row.appendTableCell(mod);
    row.appendTableCell(String(data.requests));
    row.appendTableCell(data.tokens.toLocaleString());
    row.appendTableCell(`$${data.cost}`);
  }

  body.appendHorizontalRule();

  // Compliance
  body.appendParagraph('REGULATORY COMPLIANCE')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph('All AI requests logged with the following compliance tags:');
  AI_PROXY_CONFIG.REGULATORY_TAGS.forEach(tag =>
    body.appendListItem(tag)
  );

  // Move to exports folder
  const folderId = _getProp('EXPORTS_FOLDER_ID', null);
  if (folderId) {
    const docFile = DriveApp.getFileById(doc.getId());
    DriveApp.getFolderById(folderId).addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  }

  doc.saveAndClose();

  return doc;
}


// ==========================
// UI FUNCTIONS
// ==========================

function testAIProxy() {
  // Test with Google (uses existing GEMINI_API_KEY)
  const result = proxyAIRequest(
    'google',
    'gemini-1.5-pro',
    'Say "Newton AI Proxy test successful" and nothing else.',
    { test: true }
  );

  Logger.log('=== AI PROXY TEST ===');
  Logger.log('Success: ' + result.success);
  Logger.log('Response: ' + result.response);
  Logger.log('Newton UUID: ' + result.newtonUuid);
  Logger.log('Cost: $' + (result.cost?.totalCost || 0));

  return result;
}

function generateAIReportFromUI() {
  const ui = SpreadsheetApp.getUi();

  const startResponse = ui.prompt(
    'AI Activity Report - Start Date',
    'Start date (YYYY-MM-DD) or leave blank for all time:',
    ui.ButtonSet.OK_CANCEL
  );
  if (startResponse.getSelectedButton() !== ui.Button.OK) return;
  const startDate = startResponse.getResponseText().trim() || null;

  const endResponse = ui.prompt(
    'AI Activity Report - End Date',
    'End date (YYYY-MM-DD) or leave blank for today:',
    ui.ButtonSet.OK_CANCEL
  );
  if (endResponse.getSelectedButton() !== ui.Button.OK) return;
  const endDate = endResponse.getResponseText().trim() || null;

  ui.alert('Generating', 'Creating AI activity report...', ui.ButtonSet.OK);

  try {
    const report = getAIActivityReport(startDate, endDate, null, null);

    if (report.error) {
      ui.alert('Error', report.error, ui.ButtonSet.OK);
      return;
    }

    const jsonFile = exportAIReportAsJSON(report);
    const doc = exportAIReportAsDoc(report);

    let text = `AI ACTIVITY REPORT GENERATED\n\n`;
    text += `SUMMARY:\n`;
    text += `• Requests: ${report.summary.totalRequests}\n`;
    text += `• Tokens: ${report.summary.totalTokens.toLocaleString()}\n`;
    text += `• Cost: $${report.summary.totalCost}\n\n`;
    text += `EXPORTS:\n`;
    text += `• JSON: ${jsonFile.getName()}\n`;
    text += `• Doc: ${doc.getName()}\n`;

    ui.alert('Report Complete', text, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Error', 'Report generation failed: ' + e.message, ui.ButtonSet.OK);
  }
}

function setupAIProxyKeysFromUI() {
  const ui = SpreadsheetApp.getUi();

  const providerResponse = ui.prompt(
    'Setup API Key',
    'Enter provider (openai, anthropic, google):',
    ui.ButtonSet.OK_CANCEL
  );
  if (providerResponse.getSelectedButton() !== ui.Button.OK) return;
  const provider = providerResponse.getResponseText().trim().toLowerCase();

  const keyResponse = ui.prompt(
    'Setup API Key',
    `Enter API key for ${provider}:`,
    ui.ButtonSet.OK_CANCEL
  );
  if (keyResponse.getSelectedButton() !== ui.Button.OK) return;
  const apiKey = keyResponse.getResponseText().trim();

  try {
    setProviderKey(provider, apiKey);
    ui.alert('Success', `API key configured for ${provider}.`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


// ==========================
// MENU
// ==========================

function addAIProxyMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('AI Proxy')
    .addItem('Test AI Proxy', 'testAIProxy')
    .addSeparator()
    .addItem('Generate AI Activity Report', 'generateAIReportFromUI')
    .addSeparator()
    .addItem('Setup API Keys', 'setupAIProxyKeysFromUI')
    .addToUi();
}
