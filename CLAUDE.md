# CLAUDE.md - Audit Ledger (CA Residency Defense)

## Project Context
- **Repo**: audit-ledger (GitHub Pages subdirectory)
- **Live URL**: gugosf114.github.io/audit-ledger
- **API Backend**: Cloud Run at baycomply.com
- **Owner**: George Abrahamyants (Legal Technologist)
- **Focus**: California FTB residency audit defense

## THE LEGAL FRAMEWORK (Know This Cold)

### 19 Bragg Factors (*Appeal of Bragg*, 2003)
The FTB uses these factors to determine domicile. Weight matters:
- **Highest**: Real property, family location, children's school, principal residence, voter registration, professional licenses, vehicle registration
- **Moderate**: Driver's license, bank accounts, financial transaction origin, professional service providers, organization memberships, investment property
- **Least**: Mailing address, phone number, mail receipt location
- **Corroborative**: Pet licenses, newspaper subscriptions, time spent in CA vs elsewhere

### Safe Harbor (R&TC 17014(d))
Conclusive presumption of nonresidency requires ALL THREE:
1. 546+ consecutive days outside California
2. ≤45 days in California during that period
3. <$200,000 California-source income

### Key Sources
- FTB RSTM 1030 (Domicile)
- FTB RSTM 1040 (Statutory Residency / 183-day rule)
- R&TC 17014 (Residency definitions)

## TECHNICAL ARCHITECTURE

### Frontend (index.html)
- Single-page app deployed to GitHub Pages
- localStorage for workflow state persistence
- SHA-256 hash chain verification in browser
- All features in one file (~5000+ lines)

### Backend (Cloud Run)
- API at baycomply.com
- Hash-chained entry storage
- Multi-tenant isolation

### Key Modules in index.html
| Module | Purpose |
|--------|---------|
| Day Counter | 183-day statutory residency tracking |
| Safe Harbor | 546-day, 45-day CA limit, $200K income tracking |
| Roadmap | 5-phase residency change timeline (18 tasks) |
| Bragg Grid | 19 factors with weight and evidence status |
| Address Timeline | Chronological residence history |
| Evidence Repository | Documents linked to Bragg factors |
| Realization Events | CA-source income event tracking |
| Third-Party Requests | Subpoenas, document demands |

## IRON LAWS

1. **Hash Chain Integrity**: Every entry must chain to the previous. Never break the chain.
2. **Confidence First**: Use Rumsfeld Protocol - declare confidence BEFORE logging content (KNOWN_KNOWN, KNOWN_UNKNOWN, UNKNOWN_UNKNOWN).
3. **Bragg Factor Mapping**: Every piece of evidence should link to one or more of the 19 factors.
4. **No Guessing Dates**: Timestamps matter for audit defense. Use actual dates, not approximations.
5. **Proactive Validation**: Run validation before declaring tasks done.

## WORKING WITH GEORGE

- **Communication**: Blunt, direct, zero corporate fluff.
- **Voice-to-Text**: Ignore speech patterns/typos; focus on core intent.
- **Push Back**: If George rabbit-holes on low-priority items, redirect to primary goal.
- **Session End**: Listen for "George out" or "Over and out."

## FILESYSTEM SCOPE
- Primary: `C:\Users\georg\Documents\GitHub\audit-ledger\`
- Related: `C:\Users\georg\Documents\GitHub\gugosf114.github.io\` (parent Pages repo)

## PRIORITY STACK

1. **Audit Defense First**: Features should make FTB audits survivable
2. **Evidence > UI Polish**: Functional evidence collection beats pretty dashboards
3. **Hash Chain > Everything**: Tamper-evidence is the core value proposition
4. **Practitioner Credibility**: UI should signal "we know Bragg, we know Safe Harbor"
