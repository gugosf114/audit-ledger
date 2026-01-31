# Audit Ledger

Tamper-evident California residency audit defense platform using SHA-256 hash chains, the 19 Bragg factors framework, and FTB-compliant documentation workflows.

**Live Dashboard**: [gugosf114.github.io/audit-ledger](https://gugosf114.github.io/audit-ledger)
**API Backend**: Cloud Run (baycomply.com)

## The Problem

When the California Franchise Tax Board (FTB) audits a residency change, they apply the 19 factors from *Appeal of Bragg* (2003). Most taxpayers discover this framework only after receiving an audit notice - by then, critical evidence windows have closed.

The FTB has years to reconstruct your life. You have weeks to respond. Without contemporaneous, hash-chained documentation, it becomes your word against their reconstruction.

## What This Solves

| Problem | Solution |
|---------|----------|
| No proof of when evidence was collected | SHA-256 hash chain - every entry timestamped and tamper-evident |
| Unclear what the FTB actually looks for | 19 Bragg factors mapped with weights (Highest/Moderate/Least/Corroborative) |
| Missing the 546-day Safe Harbor window | Day counter with automatic CA day tracking and threshold alerts |
| Scattered evidence across systems | Centralized evidence repository linked to specific Bragg factors |
| Reactive instead of proactive | Residency Change Roadmap with 18 tasks across 5 phases |
| No confidence tracking | Rumsfeld Protocol - declare confidence BEFORE logging content |

## Feature Map

| Feature | What It Does |
|---------|--------------|
| **183-Day Counter** | Tracks days in/out of California against statutory presumption threshold |
| **Safe Harbor Tracker** | Monitors 546-day period, 45-day CA limit, and $200K income threshold per R&TC 17014(d) |
| **Residency Roadmap** | 5-phase timeline (Before Move → Move Week → After → Ongoing → Annual) with 18 tasks |
| **19 Bragg Factors Grid** | Visual display of all factors with weight classifications and evidence status |
| **Address Timeline** | Chronological record of all addresses with date ranges and evidence links |
| **Evidence Repository** | Document storage linked to specific Bragg factors with hash verification |
| **Realization Events** | Tracks California-source income events that could trigger tax liability |
| **Third-Party Requests** | Logs subpoenas, document requests, and information demands |
| **Hash-Chained Ledger** | Tamper-evident audit trail - modifications break the chain |
| **Confidence Declaration** | Rumsfeld Protocol forces confidence level BEFORE content is logged |

## The 19 Bragg Factors

Based on *Appeal of Bragg* (2003) and FTB RSTM 1030/1040:

### Highest Weight
1. Location of all residential real property
2. State of spouse/RDP and children's residence
3. State where children attend school
4. Location of principal residence (owned or rented)
5. State of voter registration and voting history
6. State of professional licenses
7. State of vehicle registration

### Moderate Weight
8. State of driver's license
9. State of bank accounts (especially checking)
10. Origination point of financial transactions
11. Location of physicians, dentists, accountants, attorneys
12. State of social, religious, and professional organization memberships
13. Location of real property investments

### Least Weight
14. State address used for tax returns and other documents
15. State of telephone number
16. Location where mail is received

### Corroborative
17. Location of pet licenses
18. Location of newspaper subscriptions
19. Time spent in California vs. other states

## Safe Harbor Rules (R&TC 17014(d))

To qualify for Safe Harbor (conclusive presumption of nonresidency):

| Requirement | Threshold |
|-------------|-----------|
| Days outside California | 546+ consecutive days |
| Days in California | ≤45 during the 546-day period |
| California-source income | <$200,000 during the period |

The dashboard tracks all three requirements and calculates eligibility automatically.

## Residency Change Roadmap

### Phase 1: Before Move (60-90 Days Prior)
- Purchase/lease home in new state
- List California home for sale
- Schedule movers, set move date

### Phase 2: Move Week
- Physical relocation of belongings
- Move family members (spouse, children, pets)
- Surrender California residence keys

### Phase 3: Immediately After (First 30 Days)
- File homeowner's exemption with county assessor
- Open new state bank accounts
- Obtain new state driver's license
- Register vehicles in new state
- Register to vote in new state

### Phase 4: Ongoing (First 12 Months)
- Maintain day counting discipline
- Establish new state medical providers
- Join local social organizations
- Establish religious community ties

### Phase 5: Annual Maintenance
- File Form 540NR (nonresident return)
- Monitor California-source income
- Manage any remaining California property

## Technical Architecture

### Frontend (GitHub Pages)
- Single-page application (`index.html`)
- localStorage for workflow state
- Real-time hash chain verification
- Responsive design for mobile/desktop

### Backend (Cloud Run)
- RESTful API at baycomply.com
- SHA-256 hash chain storage
- Multi-tenant isolation
- Regulatory framework mapping

### Hash Chain Mechanics

Each entry contains:
- UUID, timestamp, actor, event type, content
- Previous entry's record hash
- Current entry's record hash (SHA-256 of all fields)

Tampering breaks the chain. Verification detects any modification.

### Confidence Declaration (Rumsfeld Protocol)

Before logging content, declare confidence:

| Level | Meaning |
|-------|---------|
| KNOWN_KNOWN | High confidence, direct evidence |
| KNOWN_UNKNOWN | Identified gap, specific uncertainty |
| UNKNOWN_UNKNOWN | Speculation, no direct evidence |

Both entries are hashed. Confidence cannot be retroactively softened.

## Bakers-Agent Integration (Agentic Support)

Bakers-Agent can supplement Audit Ledger by operating against the existing API and ledger model (no UI changes required):

- **Hash-chained ledger writes**: create entries with actor attribution so every agent action is immutably chained.
- **Bragg factor coverage checks**: read factor statuses and flag missing evidence for priority collection.
- **Safe Harbor monitoring**: watch 546-day/45-day counters and log threshold warnings as confidence-declared events.
- **Gap analysis/voids**: scan timelines and evidence gaps, logging KNOWN_UNKNOWN items into the ledger.
- **Sealed packets**: assemble evidence snapshots into sealed packets for external review without altering source records.
- **Agent logging/monitoring**: route all agent activity through existing agent logs for auditability.

## Legal Framework References

| Source | What It Covers |
|--------|----------------|
| *Appeal of Bragg* (2003) | Origin of the 19-factor test |
| FTB RSTM 1030 | Domicile determination rules |
| FTB RSTM 1040 | Statutory residency (183-day rule) |
| R&TC 17014 | Residency definitions |
| R&TC 17014(d) | Safe Harbor provisions |

## Use Cases

| Scenario | How Audit Ledger Helps |
|----------|------------------------|
| Pre-move planning | Roadmap shows exactly what to do and when |
| Active relocation | Day counter tracks Safe Harbor eligibility |
| Post-move documentation | Evidence repository links docs to Bragg factors |
| FTB audit response | Hash-chained timeline proves when evidence was collected |
| Professional advisors | Dashboard demonstrates client's systematic approach |

## Setup

1. Visit [gugosf114.github.io/audit-ledger](https://gugosf114.github.io/audit-ledger)
2. Create a new workflow for your residency change
3. Set move date and origin/destination states
4. Follow the Roadmap phases
5. Log evidence as you collect it
6. Export audit package when needed

## Files

```
/
├── index.html          # Main dashboard (all features)
├── README.md           # This file
└── .github/
    └── scripts/
        └── validate-site.js  # Site validation
```

## Author

George Abrahamyants
[LinkedIn](https://www.linkedin.com/in/gabrahamyants/)

## License

MIT
