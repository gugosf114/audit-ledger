/**
 * ───────────────────────────────────────────────
 *  NEWTON MULTI-TENANT : SAAS CUSTOMER MANAGEMENT
 * ───────────────────────────────────────────────
 *
 *  Multi-tenant support for Newton AI Proxy.
 *  Enables billing-ready SaaS operations:
 *
 *  - Generate Newton API keys for customers
 *  - Validate keys on every request
 *  - Track usage per customer
 *  - Generate billing reports
 *
 *  One-line integration for customers:
 *  - Python: response = newton.complete(prompt)
 *  - Curl: curl -X POST ... -d '{"newtonKey": "..."}'
 *
 * ───────────────────────────────────────────────
 */


// ==========================
// CONFIGURATION
// ==========================

const MULTITENANT_CONFIG = {
  CUSTOMERS_SHEET: 'Newton_Customers',
  KEY_PREFIX: 'nk_',
  KEY_LENGTH: 32,

  // Customer status
  STATUS: {
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    TRIAL: 'TRIAL',
    CANCELLED: 'CANCELLED'
  },

  // Rate limits per status (requests per day)
  RATE_LIMITS: {
    TRIAL: 100,
    ACTIVE: 10000,
    SUSPENDED: 0,
    CANCELLED: 0
  },

  // Markup percentage on AI costs (your profit margin)
  MARKUP_PERCENT: 20
};

// Customer sheet columns
const CUSTOMER_COLUMNS = {
  API_KEY: 1,
  CUSTOMER_ID: 2,
  CUSTOMER_NAME: 3,
  EMAIL: 4,
  CREATED_AT: 5,
  STATUS: 6,
  PLAN: 7,
  RATE_LIMIT: 8,
  TOTAL_REQUESTS: 9,
  TOTAL_TOKENS: 10,
  TOTAL_COST: 11,
  LAST_REQUEST: 12,
  NOTES: 13
};


// ==========================
// CUSTOMER SHEET SETUP
// ==========================

/**
 * Create or get the Newton_Customers sheet
 */
function _getCustomersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(MULTITENANT_CONFIG.CUSTOMERS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(MULTITENANT_CONFIG.CUSTOMERS_SHEET);
    setupCustomersSheet(sheet);
  }

  return sheet;
}

/**
 * Setup customers sheet with headers
 */
function setupCustomersSheet(sheet) {
  if (!sheet) sheet = _getCustomersSheet();

  const headers = [
    'API Key', 'Customer ID', 'Customer Name', 'Email',
    'Created At', 'Status', 'Plan', 'Rate Limit',
    'Total Requests', 'Total Tokens', 'Total Cost ($)',
    'Last Request', 'Notes'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#4a4a4a')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Set column widths
  sheet.setColumnWidth(1, 280); // API Key
  sheet.setColumnWidth(2, 120); // Customer ID
  sheet.setColumnWidth(3, 180); // Name
  sheet.setColumnWidth(4, 200); // Email
  sheet.setColumnWidth(13, 250); // Notes

  // Protect the sheet
  try {
    const protection = sheet.protect();
    protection.setDescription('Newton Customers - Protected');
  } catch (e) {
    // Ignore protection errors
  }

  logSystemEvent('SUCCESS', 'MULTITENANT', 'Customers sheet created', {});
}


// ==========================
// API KEY GENERATION
// ==========================

/**
 * Generate a new Newton API key for a customer
 *
 * @param {string} customerName - Customer/company name
 * @param {string} email - Customer email
 * @param {string} plan - Plan type (TRIAL, ACTIVE)
 * @param {string} notes - Optional notes
 * @returns {Object} - New customer record with API key
 */
function generateNewtonAPIKey(customerName, email, plan, notes) {
  if (!customerName || !email) {
    throw new Error('Customer name and email are required');
  }

  const sheet = _getCustomersSheet();

  // Check if email already exists
  const existingCustomer = findCustomerByEmail(email);
  if (existingCustomer) {
    throw new Error(`Customer with email ${email} already exists. Customer ID: ${existingCustomer.customerId}`);
  }

  // Generate unique API key
  const apiKey = generateSecureKey();

  // Generate customer ID
  const customerId = 'cust_' + Utilities.getUuid().substring(0, 8);

  // Determine rate limit based on plan
  const status = plan || MULTITENANT_CONFIG.STATUS.TRIAL;
  const rateLimit = MULTITENANT_CONFIG.RATE_LIMITS[status] || 100;

  const timestamp = new Date().toISOString();

  // Add to sheet
  const newRow = [
    apiKey,
    customerId,
    customerName,
    email,
    timestamp,
    status,
    plan || 'TRIAL',
    rateLimit,
    0,  // Total requests
    0,  // Total tokens
    0,  // Total cost
    '', // Last request
    notes || ''
  ];

  sheet.appendRow(newRow);

  // Log to audit ledger
  safeNewEntry(
    'Admin',
    'CUSTOMER_CREATED',
    `[NEW CUSTOMER]\nID: ${customerId}\nName: ${customerName}\nEmail: ${email}\nPlan: ${status}\nRate Limit: ${rateLimit}/day`,
    '',
    'VERIFIED'
  );

  logSystemEvent('SUCCESS', 'MULTITENANT', 'Customer created', {
    customerId,
    customerName,
    email
  });

  return {
    success: true,
    apiKey: apiKey,
    customerId: customerId,
    customerName: customerName,
    email: email,
    status: status,
    rateLimit: rateLimit,
    message: 'API key generated successfully. Share this key with the customer securely.'
  };
}

/**
 * Generate a secure random API key
 */
function generateSecureKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = MULTITENANT_CONFIG.KEY_PREFIX;

  for (let i = 0; i < MULTITENANT_CONFIG.KEY_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    key += chars[randomIndex];
  }

  return key;
}


// ==========================
// API KEY VALIDATION
// ==========================

/**
 * Validate a Newton API key and return customer info
 *
 * @param {string} newtonKey - The API key to validate
 * @returns {Object} - Customer info or error
 */
function validateNewtonKey(newtonKey) {
  if (!newtonKey) {
    return { valid: false, error: 'Missing Newton API key' };
  }

  if (!newtonKey.startsWith(MULTITENANT_CONFIG.KEY_PREFIX)) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const sheet = _getCustomersSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { valid: false, error: 'No customers registered' };
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === newtonKey) {
      const status = data[i][5];

      // Check if account is active
      if (status === MULTITENANT_CONFIG.STATUS.SUSPENDED) {
        return { valid: false, error: 'Account suspended. Contact support.' };
      }
      if (status === MULTITENANT_CONFIG.STATUS.CANCELLED) {
        return { valid: false, error: 'Account cancelled.' };
      }

      // Check rate limit
      const rateLimit = data[i][7] || 100;
      const todayRequests = getTodayRequestCount(data[i][1]); // customerId

      if (todayRequests >= rateLimit) {
        return {
          valid: false,
          error: `Rate limit exceeded. ${rateLimit} requests/day allowed.`,
          customerId: data[i][1]
        };
      }

      return {
        valid: true,
        customerId: data[i][1],
        customerName: data[i][2],
        email: data[i][3],
        status: status,
        plan: data[i][6],
        rateLimit: rateLimit,
        todayRequests: todayRequests,
        rowIndex: i + 2 // For updating stats
      };
    }
  }

  return { valid: false, error: 'Invalid API key' };
}

/**
 * Get today's request count for a customer
 */
function getTodayRequestCount(customerId) {
  const today = new Date().toISOString().substring(0, 10);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return 0;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  // This is a simple approach - for production, you'd want a separate usage tracking sheet
  const data = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  let count = 0;

  for (const row of data) {
    const timestamp = row[1].toString();
    const text = row[4] || '';

    if (timestamp.startsWith(today) &&
        text.includes('AI_PROXY') &&
        text.includes(customerId)) {
      count++;
    }
  }

  return count;
}


// ==========================
// CUSTOMER LOOKUP
// ==========================

/**
 * Find customer by email
 */
function findCustomerByEmail(email) {
  const sheet = _getCustomersSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  for (const row of data) {
    if (row[3] === email) {
      return {
        apiKey: row[0],
        customerId: row[1],
        customerName: row[2],
        email: row[3],
        status: row[5],
        plan: row[6]
      };
    }
  }

  return null;
}

/**
 * Find customer by ID
 */
function findCustomerById(customerId) {
  const sheet = _getCustomersSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === customerId) {
      return {
        apiKey: data[i][0],
        customerId: data[i][1],
        customerName: data[i][2],
        email: data[i][3],
        status: data[i][5],
        plan: data[i][6],
        rateLimit: data[i][7],
        totalRequests: data[i][8],
        totalTokens: data[i][9],
        totalCost: data[i][10],
        rowIndex: i + 2
      };
    }
  }

  return null;
}


// ==========================
// USAGE TRACKING
// ==========================

/**
 * Update customer usage stats after a request
 */
function updateCustomerUsage(customerId, tokens, cost) {
  const customer = findCustomerById(customerId);
  if (!customer) return;

  const sheet = _getCustomersSheet();

  // Update totals
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.TOTAL_REQUESTS).setValue(customer.totalRequests + 1);
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.TOTAL_TOKENS).setValue(customer.totalTokens + tokens);
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.TOTAL_COST).setValue(
    Math.round((customer.totalCost + cost) * 10000) / 10000
  );
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.LAST_REQUEST).setValue(new Date().toISOString());
}


// ==========================
// CUSTOMER USAGE REPORT
// ==========================

/**
 * Get usage report for a specific customer
 *
 * @param {string} newtonKey - Customer's Newton API key
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object} - Usage report for billing
 */
function getCustomerUsageReport(newtonKey, startDate, endDate) {
  // Validate the key first
  const validation = validateNewtonKey(newtonKey);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const customerId = validation.customerId;
  const customer = findCustomerById(customerId);

  if (!customer) {
    return { error: 'Customer not found' };
  }

  // Get all AI proxy entries for this customer
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit Ledger');
  if (!sh) return { error: 'Audit Ledger not found' };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { requests: [], summary: {} };

  const data = sh.getRange(2, 1, lastRow - 1, 15).getValues();
  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(23, 59, 59, 999);

  const requests = [];

  for (const row of data) {
    const timestamp = new Date(row[1]);
    const eventType = row[3] || '';
    const text = row[4] || '';

    // Filter: AI proxy entries for this customer
    if (!eventType.startsWith('AI_PROXY')) continue;
    if (!text.includes(customerId)) continue;
    if (timestamp < start || timestamp > end) continue;

    // Extract metrics from text
    const providerMatch = text.match(/Provider:\s*(\w+)/i);
    const modelMatch = text.match(/Model:\s*([^\n]+)/i);
    const inputTokens = extractNumberFromText(text, /Input Tokens:\s*(\d+)/);
    const outputTokens = extractNumberFromText(text, /Output Tokens:\s*(\d+)/);
    const totalCost = extractNumberFromText(text, /Total:\s*\$([0-9.]+)/);
    const duration = extractNumberFromText(text, /Duration:\s*(\d+)ms/);

    requests.push({
      uuid: row[0],
      timestamp: timestamp.toISOString(),
      provider: providerMatch ? providerMatch[1] : 'unknown',
      model: modelMatch ? modelMatch[1].trim() : 'unknown',
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      baseCost: totalCost,
      durationMs: duration,
      success: eventType === 'AI_PROXY_SUCCESS'
    });
  }

  // Calculate billing
  const totalInputTokens = requests.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutputTokens = requests.reduce((sum, r) => sum + r.outputTokens, 0);
  const baseCost = requests.reduce((sum, r) => sum + r.baseCost, 0);
  const markup = baseCost * (MULTITENANT_CONFIG.MARKUP_PERCENT / 100);
  const billedAmount = baseCost + markup;

  const report = {
    customer: {
      customerId: customer.customerId,
      customerName: customer.customerName,
      email: customer.email,
      plan: customer.plan,
      status: customer.status
    },

    period: {
      startDate: startDate || 'All time',
      endDate: endDate || 'Now'
    },

    summary: {
      totalRequests: requests.length,
      successfulRequests: requests.filter(r => r.success).length,
      failedRequests: requests.filter(r => !r.success).length,
      totalInputTokens: totalInputTokens,
      totalOutputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens
    },

    billing: {
      baseCost: Math.round(baseCost * 10000) / 10000,
      markupPercent: MULTITENANT_CONFIG.MARKUP_PERCENT,
      markupAmount: Math.round(markup * 10000) / 10000,
      billedAmount: Math.round(billedAmount * 10000) / 10000,
      currency: 'USD'
    },

    byProvider: {},
    byModel: {},
    dailyUsage: {},

    requests: requests
  };

  // Group by provider
  for (const req of requests) {
    if (!report.byProvider[req.provider]) {
      report.byProvider[req.provider] = { requests: 0, tokens: 0, cost: 0 };
    }
    report.byProvider[req.provider].requests++;
    report.byProvider[req.provider].tokens += req.inputTokens + req.outputTokens;
    report.byProvider[req.provider].cost += req.baseCost;
  }

  // Group by model
  for (const req of requests) {
    const key = `${req.provider}/${req.model}`;
    if (!report.byModel[key]) {
      report.byModel[key] = { requests: 0, tokens: 0, cost: 0 };
    }
    report.byModel[key].requests++;
    report.byModel[key].tokens += req.inputTokens + req.outputTokens;
    report.byModel[key].cost += req.baseCost;
  }

  // Daily usage
  for (const req of requests) {
    const day = req.timestamp.substring(0, 10);
    if (!report.dailyUsage[day]) {
      report.dailyUsage[day] = { requests: 0, tokens: 0, cost: 0 };
    }
    report.dailyUsage[day].requests++;
    report.dailyUsage[day].tokens += req.inputTokens + req.outputTokens;
    report.dailyUsage[day].cost += req.baseCost;
  }

  return report;
}

function extractNumberFromText(text, regex) {
  const match = text.match(regex);
  return match ? parseFloat(match[1]) : 0;
}


// ==========================
// CUSTOMER MANAGEMENT
// ==========================

/**
 * Update customer status
 */
function updateCustomerStatus(customerId, newStatus) {
  const customer = findCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found: ' + customerId);
  }

  if (!Object.values(MULTITENANT_CONFIG.STATUS).includes(newStatus)) {
    throw new Error('Invalid status: ' + newStatus);
  }

  const sheet = _getCustomersSheet();
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.STATUS).setValue(newStatus);

  // Update rate limit based on status
  const newRateLimit = MULTITENANT_CONFIG.RATE_LIMITS[newStatus] || 0;
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.RATE_LIMIT).setValue(newRateLimit);

  safeNewEntry(
    'Admin',
    'CUSTOMER_STATUS_CHANGED',
    `[STATUS CHANGE]\nCustomer: ${customer.customerId}\nOld: ${customer.status}\nNew: ${newStatus}`,
    '',
    'VERIFIED'
  );

  return { success: true, customerId, oldStatus: customer.status, newStatus };
}

/**
 * Regenerate API key for a customer
 */
function regenerateCustomerKey(customerId) {
  const customer = findCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found: ' + customerId);
  }

  const newKey = generateSecureKey();
  const sheet = _getCustomersSheet();
  sheet.getRange(customer.rowIndex, CUSTOMER_COLUMNS.API_KEY).setValue(newKey);

  safeNewEntry(
    'Admin',
    'CUSTOMER_KEY_REGENERATED',
    `[KEY REGENERATED]\nCustomer: ${customerId}\nOld key revoked`,
    '',
    'VERIFIED'
  );

  return {
    success: true,
    customerId: customerId,
    newApiKey: newKey,
    message: 'Old key revoked. Share new key with customer securely.'
  };
}


// ==========================
// MODIFIED PROXY FOR MULTI-TENANT
// ==========================

/**
 * Multi-tenant AI proxy request
 * This wraps the original proxyAIRequest with customer validation
 */
function proxyAIRequestMultiTenant(newtonKey, provider, model, prompt, metadata) {
  // Validate customer
  const validation = validateNewtonKey(newtonKey);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      code: 'INVALID_KEY'
    };
  }

  // Add customer info to metadata
  const enrichedMetadata = {
    ...metadata,
    customerId: validation.customerId,
    customerName: validation.customerName,
    plan: validation.plan
  };

  // Call the original proxy
  const result = proxyAIRequest(provider, model, prompt, enrichedMetadata);

  // Update customer usage stats
  if (result.success && result.usage) {
    updateCustomerUsage(
      validation.customerId,
      result.usage.totalTokens || 0,
      result.cost?.totalCost || 0
    );
  }

  // Add customer info to response
  result.customerId = validation.customerId;
  result.remainingRequests = validation.rateLimit - validation.todayRequests - 1;

  return result;
}


// ==========================
// UPDATED WEB API ENDPOINT
// ==========================

/**
 * Updated doPost that validates Newton API key
 * NOTE: This should replace the original doPost in Newton_AIProxy.gs
 */
function doPostMultiTenant(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Require Newton API key
    if (!data.newtonKey) {
      return createJsonResponse({
        error: 'Missing required field: newtonKey',
        code: 'MISSING_KEY',
        docs: 'Include your Newton API key in the request body'
      }, 401);
    }

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

    // Execute multi-tenant proxy request
    const result = proxyAIRequestMultiTenant(data.newtonKey, provider, model, prompt, metadata);

    if (!result.success && result.code === 'INVALID_KEY') {
      return createJsonResponse(result, 401);
    }

    return createJsonResponse(result, result.success ? 200 : 500);

  } catch (error) {
    logSystemEvent('ERROR', 'AI_PROXY', 'Multi-tenant API error', { error: error.message });

    return createJsonResponse({
      error: error.message,
      success: false
    }, 500);
  }
}

/**
 * Updated doGet with customer-specific endpoints
 */
function doGetMultiTenant(e) {
  const action = e.parameter.action;
  const newtonKey = e.parameter.newtonKey;

  // Usage report endpoint
  if (action === 'usage' && newtonKey) {
    const startDate = e.parameter.startDate || null;
    const endDate = e.parameter.endDate || null;

    const report = getCustomerUsageReport(newtonKey, startDate, endDate);
    return createJsonResponse(report, report.error ? 400 : 200);
  }

  // Status check
  if (action === 'status') {
    return createJsonResponse({
      status: 'online',
      version: '2.0-multitenant',
      providers: ['openai', 'anthropic', 'google']
    }, 200);
  }

  // API documentation
  return createJsonResponse({
    name: 'Newton AI Proxy',
    version: '2.0 Multi-Tenant',
    description: 'Compliant AI gateway with per-customer tracking and billing',

    authentication: {
      method: 'Newton API Key',
      header: 'Include newtonKey in request body',
      obtain: 'Contact Newton admin to get your API key'
    },

    endpoints: {
      proxy: {
        method: 'POST',
        path: '/',
        body: {
          newtonKey: 'Your Newton API key (required)',
          provider: 'openai | anthropic | google (required)',
          model: 'model name (optional)',
          messages: '[{ role: "user", content: "..." }] (required)',
          metadata: '{ custom data } (optional)'
        },
        response: {
          success: 'boolean',
          requestId: 'UUID',
          newtonUuid: 'Audit ledger UUID',
          customerId: 'Your customer ID',
          response: 'AI response text',
          usage: '{ inputTokens, outputTokens, totalTokens }',
          cost: '{ inputCost, outputCost, totalCost }',
          remainingRequests: 'Requests left today'
        }
      },

      usage: {
        method: 'GET',
        path: '/?action=usage&newtonKey=YOUR_KEY&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD',
        description: 'Get your usage and billing report'
      }
    },

    integration: {
      python: `
# pip install requests
import requests

NEWTON_KEY = "nk_your_key_here"
NEWTON_URL = "https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec"

def newton_complete(prompt, provider="openai", model="gpt-4o"):
    response = requests.post(NEWTON_URL, json={
        "newtonKey": NEWTON_KEY,
        "provider": provider,
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    })
    return response.json()

# Usage - one line change from direct API:
result = newton_complete("Summarize this document")
print(result["response"])
`,

      curl: `
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec" \\
  -H "Content-Type: application/json" \\
  -d '{
    "newtonKey": "nk_your_key_here",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, Claude!"}]
  }'
`,

      javascript: `
const NEWTON_KEY = "nk_your_key_here";
const NEWTON_URL = "https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec";

async function newtonComplete(prompt, provider = "openai", model = "gpt-4o") {
  const response = await fetch(NEWTON_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newtonKey: NEWTON_KEY,
      provider,
      model,
      messages: [{ role: "user", content: prompt }]
    })
  });
  return response.json();
}

// Usage
const result = await newtonComplete("Analyze this data");
console.log(result.response);
`
    },

    compliance: [
      'EU AI Act Article 12 (Record-keeping)',
      'EU AI Act Article 13 (Transparency)',
      'EU AI Act Article 20 (Auto-generated logs)',
      'ISO 42001 Clause 8.1 (Operational control)',
      'Full audit trail for every request'
    ]
  }, 200);
}


// ==========================
// UI FUNCTIONS
// ==========================

function generateCustomerKeyFromUI() {
  const ui = SpreadsheetApp.getUi();

  const nameResponse = ui.prompt(
    'New Customer - Step 1/3',
    'Customer/Company name:',
    ui.ButtonSet.OK_CANCEL
  );
  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;
  const customerName = nameResponse.getResponseText().trim();

  const emailResponse = ui.prompt(
    'New Customer - Step 2/3',
    'Customer email:',
    ui.ButtonSet.OK_CANCEL
  );
  if (emailResponse.getSelectedButton() !== ui.Button.OK) return;
  const email = emailResponse.getResponseText().trim();

  const planResponse = ui.prompt(
    'New Customer - Step 3/3',
    'Plan (TRIAL or ACTIVE):',
    ui.ButtonSet.OK_CANCEL
  );
  if (planResponse.getSelectedButton() !== ui.Button.OK) return;
  const plan = planResponse.getResponseText().trim().toUpperCase() || 'TRIAL';

  try {
    const result = generateNewtonAPIKey(customerName, email, plan, '');

    let text = `CUSTOMER CREATED\n\n`;
    text += `Customer ID: ${result.customerId}\n`;
    text += `Name: ${result.customerName}\n`;
    text += `Email: ${result.email}\n`;
    text += `Plan: ${result.status}\n`;
    text += `Rate Limit: ${result.rateLimit}/day\n\n`;
    text += `API KEY (share securely):\n${result.apiKey}\n\n`;
    text += `⚠️ This key will not be shown again!`;

    ui.alert('Customer Created', text, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}

function viewCustomersFromUI() {
  const sheet = _getCustomersSheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}

function generateCustomerReportFromUI() {
  const ui = SpreadsheetApp.getUi();

  const keyResponse = ui.prompt(
    'Customer Usage Report',
    'Enter customer Newton API key:',
    ui.ButtonSet.OK_CANCEL
  );
  if (keyResponse.getSelectedButton() !== ui.Button.OK) return;
  const newtonKey = keyResponse.getResponseText().trim();

  const startResponse = ui.prompt(
    'Usage Report - Start Date',
    'Start date (YYYY-MM-DD) or blank for all:',
    ui.ButtonSet.OK_CANCEL
  );
  if (startResponse.getSelectedButton() !== ui.Button.OK) return;
  const startDate = startResponse.getResponseText().trim() || null;

  const endResponse = ui.prompt(
    'Usage Report - End Date',
    'End date (YYYY-MM-DD) or blank for today:',
    ui.ButtonSet.OK_CANCEL
  );
  if (endResponse.getSelectedButton() !== ui.Button.OK) return;
  const endDate = endResponse.getResponseText().trim() || null;

  try {
    const report = getCustomerUsageReport(newtonKey, startDate, endDate);

    if (report.error) {
      ui.alert('Error', report.error, ui.ButtonSet.OK);
      return;
    }

    let text = `CUSTOMER USAGE REPORT\n\n`;
    text += `Customer: ${report.customer.customerName}\n`;
    text += `ID: ${report.customer.customerId}\n`;
    text += `Plan: ${report.customer.plan}\n\n`;

    text += `USAGE:\n`;
    text += `• Requests: ${report.summary.totalRequests}\n`;
    text += `• Tokens: ${report.summary.totalTokens.toLocaleString()}\n\n`;

    text += `BILLING:\n`;
    text += `• Base Cost: $${report.billing.baseCost}\n`;
    text += `• Markup (${report.billing.markupPercent}%): $${report.billing.markupAmount}\n`;
    text += `• Total Due: $${report.billing.billedAmount}\n`;

    ui.alert('Customer Report', text, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}

function updateCustomerStatusFromUI() {
  const ui = SpreadsheetApp.getUi();

  const idResponse = ui.prompt(
    'Update Customer Status',
    'Enter customer ID (cust_...):',
    ui.ButtonSet.OK_CANCEL
  );
  if (idResponse.getSelectedButton() !== ui.Button.OK) return;
  const customerId = idResponse.getResponseText().trim();

  const statusResponse = ui.prompt(
    'Update Customer Status',
    'New status (ACTIVE, SUSPENDED, TRIAL, CANCELLED):',
    ui.ButtonSet.OK_CANCEL
  );
  if (statusResponse.getSelectedButton() !== ui.Button.OK) return;
  const newStatus = statusResponse.getResponseText().trim().toUpperCase();

  try {
    const result = updateCustomerStatus(customerId, newStatus);
    ui.alert('Success', `Status changed: ${result.oldStatus} → ${result.newStatus}`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}


// ==========================
// MENU
// ==========================

function addMultiTenantMenu() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Customers')
    .addItem('Generate New API Key', 'generateCustomerKeyFromUI')
    .addItem('View Customers Sheet', 'viewCustomersFromUI')
    .addSeparator()
    .addItem('Customer Usage Report', 'generateCustomerReportFromUI')
    .addItem('Update Customer Status', 'updateCustomerStatusFromUI')
    .addSeparator()
    .addItem('Setup Customers Sheet', 'setupCustomersSheet')
    .addToUi();
}
