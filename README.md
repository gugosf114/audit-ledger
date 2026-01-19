# audit-ledger

Tamper-evident audit log for Google Sheets using SHA-256 hash chains. Includes signal detection, document verification, and API endpoint.

## What it does

A Google Apps Script system that creates an immutable record of events in a spreadsheet. Each row contains a cryptographic hash of its contents plus the previous row's hash, forming a chain. If anyone modifies a past entry, the audit function detects it.

### Core features

- **Hash-chained entries** - SHA-256 chain links each record to the previous one
- **Tamper detection** - Audit function verifies chain integrity and flags modifications
- **Signal detection** - Scans entries for flags like `[VOID_DETECTED]` or `[ADVERSARIAL_SUSPICION]`
- **Document verification** - Uses Gemini API to verify uploaded documents match claimed sources
- **IRAC case folders** - Creates fingerprinted Google Drive folders for legal research
- **API endpoint** - External systems can write entries via POST request

## File structure

/
├── Code.gs # Main ledger logic (entries, hashing, audit)
├── Newton_Sentinel.gs # Signal detection and processing
├── Newton_IRAC.gs # Legal research folder creation
├── Newton_Verifier.gs # Document verification via Gemini
├── Newton_API_Endpoint.gs # Web app API for external writes
├── appsscript.json # Apps Script manifest
└── README.md

## Setup

1. Create a new Google Sheet
2. Open Extensions → Apps Script
3. Copy each `.gs` file into the project
4. Run `setupSheet()` to create the ledger structure
5. Run `setupLedgerSecret()` to set your hash secret (minimum 32 characters)
6. Optional: Set `GEMINI_API_KEY` in Script Properties for document verification
7. Optional: Deploy as web app for API access

## How the hash chain works

Each entry contains:
- UUID, timestamp, actor, event type, text content
- Previous row's record hash
- Current row's record hash (SHA-256 of all fields + secret)

To verify integrity, the system recomputes each hash and compares. Any modification breaks the chain.

## Schema (14 columns)

| Column | Field |
|--------|-------|
| 1 | UUID |
| 2 | Timestamp |
| 3 | Actor |
| 4 | Event Type |
| 5 | Text |
| 6 | Gift |
| 7 | Prev Hash |
| 8 | Record Hash |
| 9 | Status |
| 10-13 | Citation fields |
| 14 | Citation Hash |

## License

MIT

## Author

George Abrahamyants  
[LinkedIn](https://www.linkedin.com/in/gabrahamyants/)
