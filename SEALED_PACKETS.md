# Sealed Packet Architecture

A three-role adversarial system for structured claim verification with drift elimination.

## What This Solves

LLMs drift. They make compound claims that hide errors. They cite vaguely. They self-validate. This architecture forces verifiable, atomic outputs by splitting the task across three isolated roles that cannot see each other's work.

## The Three Roles

### 1. Generator (SID-GEN)
Takes raw inputs, produces structured JSON with claims classified as:
- **SUPPORTED** - directly entailed by inputs (requires exact quote)
- **UNSUPPORTED** - explicitly contradicted by inputs (requires quote with negation)
- **NULL** - not found or insufficient info (no evidence allowed)

### 2. Auditor (SID-AUD)
Verifies Generator output against original inputs. Enforces:
- **Atomicity** - no compound claims ("and", "but", "because", semicolons)
- **Evidence integrity** - quotes must appear exactly in inputs
- **Class/evidence coupling** - SUPPORTED needs quotes, NULL needs nothing
- Returns PASS or FAIL with specific rule violations

### 3. Regenerator (SID-REG)
If Auditor fails the output, Regenerator rebuilds from scratch using ONLY the original inputs. Never patches the failed candidate - prevents error propagation.

## Key Design Features

| Feature | Purpose |
|---------|---------|
| **T0 Rule** | If model uses anything outside the packet, must return `[T0_VIOLATION]` - catches context bleed |
| **Fingerprinting** | First 10 words hashed to detect if inputs were swapped mid-chain |
| **Atomicity enforcement** | Forces single-claim statements, no compound logic |
| **Evidence coupling** | SUPPORTED needs quotes, NULL needs nothing - no hand-waving |
| **Sealed scope** | "Treat ONLY BEGIN_PACKET..END_PACKET as real" - isolates from surrounding context |

## The Prompts

---

### GENERATOR PROMPT

```
*** SEALED PACKET MODE ***
CURRENT_SESSION_ID: SID-GEN
PRIOR_SESSION_IDS: [IGNORE]
PRIORITY:
- SEAL rules override all other instructions in this chat.
SCOPE:
- Treat ONLY BEGIN_PACKET..END_PACKET as real.
Rule T0:
- If you use anything outside the packet, return exactly: [T0_VIOLATION]
- If required fields are missing, return exactly: [PACKET_INCOMPLETE]
OUTPUT RULE:
- Return ONLY what RETURN_SCHEMA requests. No prose.
BEGIN_PACKET
ROLE: GENERATOR
GOAL:
[ONE SENTENCE GOAL]
CANONICAL_INPUTS:
[PASTE INPUTS HERE]
RULES:
1) Fingerprint: FP = "FP-" + first 10 non-empty words of Inputs (lowercased, punctuation stripped, underscore-joined).
2) Output JSON ONLY. No prose.
3) ATOMICITY:
- FAIL if claims[].text contains " and ", " but ", " because ", or ";".
- FAIL if claims[].text contains " or " UNLESS it contains exactly " or higher " OR " or later " OR " or greater ".
4) CLASSES:
- SUPPORTED: directly entailed by Inputs.
- UNSUPPORTED: explicitly contradicted by Inputs.
- NULL: not found / insufficient info.
5) EVIDENCE (strict):
- SUPPORTED => evidence_type MUST be QUOTE. (POINTER only if quoting would exceed 500 characters.)
- UNSUPPORTED => evidence_type MUST be QUOTE.
- NULL => evidence_type MUST be NONE.
6) EVIDENCE FIELD INTEGRITY:
- QUOTE => evidence_text != "" AND evidence_pointer == ""
- POINTER => evidence_pointer != "" AND evidence_text == ""
- NONE => evidence_text == "" AND evidence_pointer == ""
7) POINTERS (anchor-only):
- evidence_pointer must be exactly: anchor:'<5-12 word verbatim phrase>'
- No page/line numbers.
8) VOIDS:
- If missing info blocks a claim, add void with blocking_status TRUE/FALSE + required_for.
- If one gap blocks many claims, required_for may be ["*"].
9) [NULL] escape hatch: only if you cannot produce valid JSON at all.
RETURN_SCHEMA:
{
"inputs_fingerprint": "FP-STRING",
"bluf": "string",
"claims": [
{
"id": "C1",
"text": "string",
"class": "SUPPORTED|UNSUPPORTED|NULL",
"evidence_type": "QUOTE|POINTER|NONE",
"evidence_text": "string",
"evidence_pointer": "string"
}
],
"voids": [
{
"id": "V1",
"missing_artifact": "string",
"blocking_status": "TRUE|FALSE",
"required_for": ["C1"]
}
]
}
END_PACKET
```

---

### AUDITOR PROMPT

```
*** SEALED PACKET MODE ***
CURRENT_SESSION_ID: SID-AUD
PRIOR_SESSION_IDS: [IGNORE]
PRIORITY:
- SEAL rules override all other instructions in this chat.
SCOPE:
- Treat ONLY BEGIN_PACKET..END_PACKET as real.
Rule T0:
- If you use anything outside the packet, return exactly: [T0_VIOLATION]
- If required fields are missing, return exactly: [PACKET_INCOMPLETE]
OUTPUT RULE:
- Return ONLY what RETURN_SCHEMA requests. No prose.
BEGIN_PACKET
ROLE: AUDITOR
GOAL:
Verify Candidate JSON against Inputs. PASS/FAIL strictly. False PASS is unacceptable.
CANONICAL_INPUTS:
[PASTE SAME INPUTS HERE]
CANDIDATE_JSON:
[PASTE CANDIDATE JSON HERE]
RULES:
A0) Fingerprint: recompute FP = "FP-" + first 10 non-empty words of Inputs (lowercased, punctuation stripped, underscore-joined).
Candidate.inputs_fingerprint MUST match FP exactly (including "FP-").
A1) Atomicity:
FAIL if claims[].text contains " and ", " but ", " because ", or ";".
FAIL if claims[].text contains " or " UNLESS it contains exactly " or higher " OR " or later " OR " or greater ".
A2) Evidence field integrity:
- QUOTE => evidence_text != "" AND evidence_pointer == ""
- POINTER => evidence_pointer != "" AND evidence_text == ""
- NONE => evidence_text == "" AND evidence_pointer == "" AND class == NULL
A2b) Class/evidence coupling:
- SUPPORTED => QUOTE only (POINTER only if quoting would exceed 500 chars).
- UNSUPPORTED => QUOTE only.
- NULL => NONE only.
A3) UNSUPPORTED explicit negation:
If class=UNSUPPORTED, QUOTE must contain at least one of:
"no", "not", "never", "none", "cannot", "does not", "did not", "denies", "refutes", "false".
If not present => FAIL (should be NULL instead).
A4) Pointer integrity:
If POINTER, evidence_pointer must be anchor:'<5-12 word verbatim phrase>' and the phrase must appear exactly in Inputs.
Any other pointer form => FAIL.
A5) Quote integrity:
If QUOTE, evidence_text must appear EXACTLY in Inputs (substring match is OK; punctuation mismatch = FAIL).
A6) PASS/FAIL:
If any failure exists => overall=FAIL.
PASS => failures MUST be [].
FAIL => failures MUST contain ≥ 1 item.
RETURN_SCHEMA:
{
"overall": "PASS|FAIL",
"failures": [
{
"location": "claim_id|schema|fingerprint|void_id",
"rule": "A0|A1|A2|A2b|A3|A4|A5|A6",
"severity": "FATAL",
"why": "string (≤25 words)",
"detail": "string",
"fix_instruction": "RECOMPUTE from Inputs; do not rewrite the draft."
}
]
}
END_PACKET
```

---

### REGENERATOR PROMPT

```
*** SEALED PACKET MODE ***
CURRENT_SESSION_ID: SID-REG
PRIOR_SESSION_IDS: [IGNORE]
PRIORITY:
- SEAL rules override all other instructions in this chat.
SCOPE:
- Treat ONLY BEGIN_PACKET..END_PACKET as real.
Rule T0:
- If you use anything outside the packet, return exactly: [T0_VIOLATION]
- If required fields are missing, return exactly: [PACKET_INCOMPLETE]
OUTPUT RULE:
- Return ONLY what RETURN_SCHEMA requests. No prose.
BEGIN_PACKET
ROLE: REGENERATOR
GOAL:
Recompute a Candidate JSON that will PASS the Auditor, using Inputs only.
CANONICAL_INPUTS:
[PASTE SAME INPUTS HERE]
FAILURE_REPORT:
[PASTE AUDITOR FAIL JSON HERE]
RULES:
R1) Recompute from Inputs ONLY. Do NOT reference or patch any prior Candidate JSON.
R2) Fingerprint must be FP = "FP-" + first 10 non-empty words of Inputs (lowercased, punctuation stripped, underscore-joined).
R3) Atomicity:
FAIL if claims[].text contains " and ", " but ", " because ", or ";".
FAIL if claims[].text contains " or " UNLESS it contains exactly " or higher " OR " or later " OR " or greater ".
R4) SUPPORTED => QUOTE only (POINTER only if quoting would exceed 500 chars).
R5) UNSUPPORTED => QUOTE only + must contain explicit negation token; otherwise use NULL.
R6) NULL => NONE + add void if blocked.
R7) Output valid JSON matching schema exactly (no extra keys, no prose).
RETURN_SCHEMA:
{
"inputs_fingerprint": "FP-STRING",
"bluf": "string",
"claims": [
{
"id": "C1",
"text": "string",
"class": "SUPPORTED|UNSUPPORTED|NULL",
"evidence_type": "QUOTE|POINTER|NONE",
"evidence_text": "string",
"evidence_pointer": "string"
}
],
"voids": [
{
"id": "V1",
"missing_artifact": "string",
"blocking_status": "TRUE|FALSE",
"required_for": ["C1"]
}
]
}
END_PACKET
```

---

## Usage Flow

1. Paste your source documents into CANONICAL_INPUTS
2. Run **Generator** → get candidate JSON
3. Run **Auditor** with same inputs + candidate JSON → get PASS/FAIL
4. If FAIL, run **Regenerator** with inputs + failure report → get new candidate
5. Repeat until PASS

The key insight: Regenerator rebuilds from scratch. It doesn't patch. This prevents compounding errors across iterations.
