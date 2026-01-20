# Audit Ledger

Tamper-evident compliance verification using SHA-256 hash chains and adversarial AI prompts.

## The Problem

Regulated industries run on checklists. SEC filings require specific exhibits. FDA submissions need enumerated sections. Loan files demand dozens of documents. Humans miss things. When they do, there's no immutable record of what was checked, when, or what was missing.

## What This Solves

1. **Automated void detection** - Sealed packet prompts analyze documents against required checklists, flagging what's missing
2. **Immutable logging** - Every finding gets recorded in a hash-chained ledger that can't be altered without detection
3. **Cryptographic proof** - Timestamped, verifiable evidence that a gap was identified on a specific date

## How It Works

### Sealed Packet Architecture
A three-role adversarial system prevents AI drift and hallucination:
- **Generator** - Analyzes inputs, produces atomic claims (SUPPORTED/UNSUPPORTED/NULL) with evidence, identifies VOIDs
- **Auditor** - Verifies Generator output against strict rules (atomicity, quote integrity, evidence coupling)
- **Regenerator** - If Auditor fails, rebuilds from scratch (never patches)

### Audit Ledger
A Google Sheets-based hash chain where:
- Each entry links cryptographically to the previous
- Tampering breaks the chain and is detected on audit
- Signal detection processes flags like `[VOID_DETECTED]` or `[ADVERSARIAL_SUSPICION]`

### Target Use Cases

| Industry | Checklist Source | What Gets Verified |
|----------|------------------|-------------------|
| SEC/Finance | Reg S-K Item 601 | 10-K/10-Q exhibits, certifications, MD&A |
| FDA/Pharma | 21 CFR, ICH guidelines | IND/NDA sections, clinical trial protocols |
| Banking | AML/KYC regs, TILA/RESPA | Loan docs, onboarding files, disclosures |
| Insurance | State filing requirements | Claims files, underwriting docs |
| Legal | Discovery obligations | Production completeness, privilege logs |
| Gov Contracting | FAR/DFARS | Cost accounting, subcontractor certs |
| Real Estate | Closing checklists | Title docs, surveys, estoppels |

## Core Features

- **Hash-chained entries** - SHA-256 chain links each record to the previous one
- **Tamper detection** - Audit function verifies chain integrity and flags modifications
- **Signal detection** - Scans entries for flags like `[VOID_DETECTED]` or `[ADVERSARIAL_SUSPICION]`
- **Document verification** - Uses Gemini API to verify uploaded documents match claimed sources
- **IRAC case folders** - Creates fingerprinted Google Drive folders for legal research
- **API endpoint** - External systems can write entries via POST request

## File structure

```
/
├── Code.gs                  # Main ledger logic (entries, hashing, audit)
├── Newton_SealedPacket.gs   # Compliance verification engine (Generator/Auditor/Regenerator)
├── Newton_Sentinel.gs       # Signal detection and processing
├── Newton_IRAC.gs           # Legal research folder creation
├── Newton_Verifier.gs       # Document verification via Gemini
├── Newton_API_Endpoint.gs   # Web app API for external writes
├── SEALED_PACKETS.md        # Prompt templates documentation
├── appsscript.json          # Apps Script manifest
└── README.md
```

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

## The Value Proposition

**For Compliance Teams**: Automated first-pass verification with immutable audit trail. When regulators ask "did you check?", you have cryptographic proof.

**For Legal/Risk**: Timestamped evidence of when gaps were identified. CYA in writing, before problems escalate.

**For Operations**: Scale checklist verification across thousands of filings without adding headcount.

**For Auditors**: Verifiable, non-repudiable record of what was present or missing at any point in time.

## License

MIT

## Author

George Abrahamyants
[LinkedIn](https://www.linkedin.com/in/gabrahamyants/)
