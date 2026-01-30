"""
Bakers Poster v1 — Hand (GBP API Poster)

Triggered by Pub/Sub message from the Brain agent.
Reads doc state from Firestore, posts caption + image to Google Business Profile.

Architecture (merged):
  - Pub/Sub pointer: message carries only doc_id, full state lives in Firestore
  - Transactional posting lock: UUID token prevents double-posting on Pub/Sub retry
  - DRY_RUN mode: validates everything without touching GBP (set DRY_RUN=true)
  - Direct REST: mybusiness.googleapis.com/v4 (no discovery client)
  - OAuth refresh: auto-refresh + persist back to Secret Manager

API: mybusiness.googleapis.com/v4/accounts/*/locations/*/localPosts
     (NOT deprecated — only reportInsights was sunset 2023-02-20)
Scope: https://www.googleapis.com/auth/business.manage

Ref: https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create
"""

import functions_framework
import json
import logging
import os
import base64
import uuid
import requests as http_requests
from google.cloud import secretmanager, firestore, pubsub_v1
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bakers-poster")

PROJECT_ID = os.environ.get("GCP_PROJECT")
SECRET_NAME = os.environ.get("SECRET_NAME", "gbp-oauth-secret")
FIRESTORE_DB = os.environ.get("FIRESTORE_DB", "bakers-agent-db")
PUBSUB_DLQ_TOPIC = os.environ.get("PUBSUB_DLQ_TOPIC", "bakers-agent-dlq")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

# Firestore collection name — must match brain agent
COLLECTION = "captions"

# Posting lock TTL — prevents stale locks from blocking forever
# If a poster crashes mid-post, the lock expires after this many seconds
LOCK_TTL_SECONDS = 120

# States that mean "don't touch this document"
TERMINAL_STATUSES = frozenset({"POSTED", "FAILED"})

# Firestore + DLQ clients (lazy-init to reduce cold-start penalty)
_db = None
_publisher = None


def _get_db():
    global _db
    if _db is None:
        _db = firestore.Client(project=PROJECT_ID, database=FIRESTORE_DB)
    return _db


def _get_publisher():
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


# Format: accounts/{account_id}/locations/{location_id}
LOCATION_ID = os.environ.get("GBP_LOCATION_ID")

# CTA URL — where the "Order" button links to
CTA_URL = os.environ.get("GBP_CTA_URL", "https://mybakingcreations.com/order")

# OAuth scope required for GBP posting
GBP_SCOPE = "https://www.googleapis.com/auth/business.manage"

# GBP API base
GBP_API_BASE = "https://mybusiness.googleapis.com/v4"


# --- 1. OAUTH CREDENTIAL MANAGEMENT ---

def get_credentials() -> Credentials:
    """
    Fetch OAuth credentials from Secret Manager.
    Refreshes expired tokens automatically using the refresh token.
    Persists the refreshed token back to Secret Manager so the next
    cold-start invocation doesn't need to refresh again.

    Secret format expected:
    {
        "client_id": "...",
        "client_secret": "...",
        "refresh_token": "...",
        "access_token": "...",       (optional — will be refreshed)
        "token_uri": "https://oauth2.googleapis.com/token"
    }
    """
    sm_client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{PROJECT_ID}/secrets/{SECRET_NAME}/versions/latest"
    response = sm_client.access_secret_version(request={"name": name})
    creds_data = json.loads(response.payload.data.decode("UTF-8"))

    creds = Credentials(
        token=creds_data.get("access_token"),
        refresh_token=creds_data.get("refresh_token"),
        token_uri=creds_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=creds_data.get("client_id"),
        client_secret=creds_data.get("client_secret"),
        scopes=[GBP_SCOPE],
    )

    # Always refresh — Cloud Functions cold starts mean the token
    # from Secret Manager is often stale.
    if not creds.valid:
        if not creds.refresh_token:
            raise RuntimeError(
                "OAuth token expired and no refresh_token in secret. "
                "Re-run the OAuth consent flow and update the secret."
            )
        creds.refresh(Request())
        logger.info("OAuth token refreshed")
        _persist_refreshed_token(sm_client, creds, creds_data)

    return creds


def _persist_refreshed_token(sm_client, creds: Credentials, original_data: dict):
    """
    Write refreshed access_token back to Secret Manager so the next
    cold-start invocation doesn't need to refresh again.
    Non-fatal if it fails — next invocation just refreshes again.
    """
    try:
        updated = {**original_data, "access_token": creds.token}
        parent = f"projects/{PROJECT_ID}/secrets/{SECRET_NAME}"
        sm_client.add_secret_version(
            request={
                "parent": parent,
                "payload": {"data": json.dumps(updated).encode("UTF-8")},
            }
        )
        logger.info("Persisted refreshed token to Secret Manager")
    except Exception as e:
        logger.warning(f"Could not persist refreshed token (non-fatal): {e}")


# --- 2. TRANSACTIONAL POSTING LOCK ---

def acquire_posting_lock(doc_id: str) -> str | None:
    """
    Atomically transition QUEUED → POSTING with a UUID lock token.
    Returns the lock token if acquired, None if someone else has it
    or the document is in a terminal/unexpected state.

    This prevents double-posting when Pub/Sub retries the same message
    to multiple Cloud Function instances.

    The lock includes a TTL — if the poster crashes mid-post,
    a future invocation can reclaim the lock after TTL expires.
    """
    db = _get_db()
    doc_ref = db.collection(COLLECTION).document(doc_id)
    lock_token = str(uuid.uuid4())
    import datetime
    now = datetime.datetime.utcnow()

    @firestore.transactional
    def _acquire(transaction):
        snap = doc_ref.get(transaction=transaction)

        if not snap.exists:
            logger.error(f"Doc {doc_id[:12]}... not found in Firestore")
            return None

        data = snap.to_dict()
        status = data.get("status")

        # Already done — skip
        if status in TERMINAL_STATUSES:
            logger.info(f"Doc {doc_id[:12]}... already {status} — skipping")
            return None

        # Already being posted by someone else — check TTL
        if status == "POSTING":
            locked_at = data.get("locked_at")
            if locked_at:
                # locked_at might be a Firestore Timestamp or datetime
                if hasattr(locked_at, "timestamp"):
                    lock_age = now.timestamp() - locked_at.timestamp()
                else:
                    lock_age = (now - locked_at).total_seconds()

                if lock_age < LOCK_TTL_SECONDS:
                    logger.info(
                        f"Doc {doc_id[:12]}... locked by another poster "
                        f"({lock_age:.0f}s ago) — skipping"
                    )
                    return None
                else:
                    logger.warning(
                        f"Doc {doc_id[:12]}... stale lock ({lock_age:.0f}s) "
                        f"— reclaiming"
                    )
            # Fall through to reclaim stale lock

        # Must be QUEUED (or stale POSTING) — claim it
        if status not in ("QUEUED", "POSTING"):
            logger.warning(
                f"Doc {doc_id[:12]}... unexpected status '{status}' — skipping"
            )
            return None

        transaction.update(doc_ref, {
            "status": "POSTING",
            "lock_token": lock_token,
            "locked_at": now,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        return lock_token

    try:
        return _acquire(db.transaction())
    except Exception as e:
        logger.error(f"Lock acquisition failed for {doc_id[:12]}...: {e}")
        return None


def release_lock_success(doc_id: str, lock_token: str, post_name: str):
    """
    Mark posting as successful. Verifies lock token to prevent
    a stale poster from overwriting a newer poster's result.
    """
    db = _get_db()
    doc_ref = db.collection(COLLECTION).document(doc_id)

    @firestore.transactional
    def _release(transaction):
        snap = doc_ref.get(transaction=transaction)
        if not snap.exists:
            return False
        data = snap.to_dict()
        if data.get("lock_token") != lock_token:
            logger.warning(
                f"Lock token mismatch for {doc_id[:12]}... — "
                f"another poster took over"
            )
            return False
        transaction.update(doc_ref, {
            "status": "POSTED",
            "gbp_post_name": post_name,
            "posted_at": firestore.SERVER_TIMESTAMP,
            "lock_token": firestore.DELETE_FIELD,
            "locked_at": firestore.DELETE_FIELD,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        return True

    try:
        return _release(db.transaction())
    except Exception as e:
        logger.error(f"Release (success) failed for {doc_id[:12]}...: {e}")
        return False


def release_lock_failure(doc_id: str, lock_token: str, reason: str):
    """
    Mark posting as permanently failed. Verifies lock token.
    """
    db = _get_db()
    doc_ref = db.collection(COLLECTION).document(doc_id)

    @firestore.transactional
    def _release(transaction):
        snap = doc_ref.get(transaction=transaction)
        if not snap.exists:
            return False
        data = snap.to_dict()
        if data.get("lock_token") != lock_token:
            logger.warning(
                f"Lock token mismatch for {doc_id[:12]}... — "
                f"another poster took over"
            )
            return False
        transaction.update(doc_ref, {
            "status": "FAILED",
            "failure_reason": reason,
            "lock_token": firestore.DELETE_FIELD,
            "locked_at": firestore.DELETE_FIELD,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        return True

    try:
        return _release(db.transaction())
    except Exception as e:
        logger.error(f"Release (failure) failed for {doc_id[:12]}...: {e}")
        return False


# --- 3. GBP API VALIDATION ---

def validate_config() -> list[str]:
    """
    Pre-flight checks before attempting to post.
    Returns list of errors (empty = good to go).
    """
    errors = []
    if not PROJECT_ID:
        errors.append("GCP_PROJECT env var not set")
    if not LOCATION_ID:
        errors.append("GBP_LOCATION_ID env var not set")
    elif not LOCATION_ID.startswith("accounts/"):
        errors.append(
            f"GBP_LOCATION_ID must be 'accounts/X/locations/Y', got: {LOCATION_ID}"
        )
    return errors


def verify_location_access(creds: Credentials) -> bool:
    """
    Verify we can actually reach the GBP location before posting.
    Catches bad location IDs and permission issues early.
    """
    url = f"{GBP_API_BASE}/{LOCATION_ID}"
    headers = {"Authorization": f"Bearer {creds.token}"}

    try:
        resp = http_requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            location_data = resp.json()
            logger.info(
                f"Verified location: {location_data.get('locationName', LOCATION_ID)}"
            )
            return True
        else:
            logger.error(
                f"Location verification failed ({resp.status_code}): {resp.text}"
            )
            return False
    except Exception as e:
        logger.error(f"Location verification request failed: {e}")
        return False


# --- 4. GBP POSTING ---

def post_to_gbp(draft: str, image_url: str) -> dict:
    """
    Create a local post on Google Business Profile.

    POST https://mybusiness.googleapis.com/v4/{parent}/localPosts

    Returns:
        {"success": True, "post_name": "accounts/.../localPosts/..."}
        {"success": False, "error": "...", "status_code": 403, "retryable": False}
    """
    # Pre-flight
    config_errors = validate_config()
    if config_errors:
        return {
            "success": False,
            "error": f"Config errors: {'; '.join(config_errors)}",
            "status_code": 0,
            "retryable": False,
        }

    # Get valid credentials
    creds = get_credentials()

    # Build request
    url = f"{GBP_API_BASE}/{LOCATION_ID}/localPosts"
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }

    # LocalPost body per:
    # https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts
    body = {
        "languageCode": "en-US",
        "topicType": "STANDARD",
        "summary": draft,
        "callToAction": {
            "actionType": "ORDER",
            "url": CTA_URL,
        },
        "media": [
            {
                "mediaFormat": "PHOTO",
                "sourceUrl": image_url,
            }
        ],
    }

    logger.info(f"POST {url}")
    logger.info(f"Caption: {draft[:80]}...")

    try:
        resp = http_requests.post(url, headers=headers, json=body, timeout=60)
    except http_requests.exceptions.Timeout:
        return {
            "success": False,
            "error": "GBP API request timed out (60s)",
            "status_code": 0,
            "retryable": True,
        }
    except http_requests.exceptions.ConnectionError as e:
        return {
            "success": False,
            "error": f"Connection error: {e}",
            "status_code": 0,
            "retryable": True,
        }

    # Parse response
    if resp.status_code == 200:
        result = resp.json()
        post_name = result.get("name", "unknown")
        logger.info(f"Posted successfully: {post_name}")
        return {"success": True, "post_name": post_name}

    # Error classification
    retryable = resp.status_code in (429, 500, 502, 503, 504)
    error_body = resp.text[:500]

    # Log full context for debugging
    logger.error(
        f"GBP API error: status={resp.status_code} "
        f"retryable={retryable} body={error_body}"
    )

    # Special handling for common errors
    if resp.status_code == 401:
        logger.error(
            "401 Unauthorized — OAuth token may be revoked. "
            "Re-run consent flow and update Secret Manager."
        )
    elif resp.status_code == 403:
        logger.error(
            "403 Forbidden — Check: (1) GBP API enabled in console, "
            "(2) OAuth scope includes business.manage, "
            "(3) User owns/manages this location."
        )
    elif resp.status_code == 404:
        logger.error(
            f"404 Not Found — Location ID may be wrong: {LOCATION_ID}"
        )

    return {
        "success": False,
        "error": error_body,
        "status_code": resp.status_code,
        "retryable": retryable,
    }


# --- 5. DRY RUN ---

def dry_run_post(doc_id: str, draft: str, image_url: str) -> dict:
    """
    Simulate posting without touching GBP.
    Validates config, credentials, and location access.
    Returns what would have happened.
    """
    logger.info(f"[DRY_RUN] Simulating post for {doc_id[:12]}...")

    result = {
        "dry_run": True,
        "doc_id": doc_id,
        "draft_preview": draft[:100],
        "checks": {},
    }

    # Config check
    config_errors = validate_config()
    result["checks"]["config"] = "PASS" if not config_errors else f"FAIL: {config_errors}"

    # Credential check
    try:
        creds = get_credentials()
        result["checks"]["oauth"] = "PASS"

        # Location check
        if verify_location_access(creds):
            result["checks"]["location_access"] = "PASS"
        else:
            result["checks"]["location_access"] = "FAIL"
    except Exception as e:
        result["checks"]["oauth"] = f"FAIL: {e}"
        result["checks"]["location_access"] = "SKIPPED (no creds)"

    # Image URL check
    result["checks"]["image_url"] = "PRESENT" if image_url else "MISSING"

    all_pass = all(
        v == "PASS" or v == "PRESENT"
        for v in result["checks"].values()
    )
    result["would_post"] = all_pass

    logger.info(f"[DRY_RUN] Result: {json.dumps(result, indent=2)}")
    return result


# --- 6. DEAD LETTER QUEUE ---

def send_to_dlq(doc_id: str, filename: str, reason: str):
    """Forward permanent failures to DLQ for monitoring."""
    try:
        import datetime
        pub = _get_publisher()
        topic_path = pub.topic_path(PROJECT_ID, PUBSUB_DLQ_TOPIC)
        msg = json.dumps({
            "doc_id": doc_id,
            "filename": filename,
            "reason": reason,
            "source": "bakers-poster-v1",
            "timestamp": datetime.datetime.utcnow().isoformat(),
        })
        pub.publish(topic_path, data=msg.encode("utf-8"))
        logger.info(f"DLQ: {doc_id[:12]}... — {reason}")
    except Exception as e:
        logger.error(f"DLQ publish failed: {e}")


# --- 7. ERROR CLASSIFICATION ---

def classify_error(error: Exception) -> str:
    """
    Classify exceptions as TRANSIENT (Pub/Sub should retry)
    or PERMANENT (ack and stop retrying).
    """
    error_str = str(error).lower()

    permanent_markers = [
        "invalid_grant",        # OAuth permanently revoked
        "unauthorized",         # Bad credentials
        "permission_denied",    # No API access
        "not_found",           # Location ID wrong
        "invalid_argument",    # Bad request schema
        "no refresh_token",    # Can't refresh — need re-auth
    ]

    for marker in permanent_markers:
        if marker in error_str:
            return "PERMANENT"

    return "TRANSIENT"


# --- 8. MAIN TRIGGER ---

@functions_framework.cloud_event
def process_post_queue(cloud_event):
    """
    Triggered by Pub/Sub message from the Brain agent.

    Flow:
    1. Decode doc_id from Pub/Sub message (pointer pattern)
    2. Read full document state from Firestore
    3. Acquire transactional posting lock (QUEUED → POSTING)
    4. Post to GBP (or DRY_RUN simulate)
    5. Release lock with success/failure status

    Message format: raw doc_id string (SHA-256 hex)
    """
    # --- Unwrap Pub/Sub envelope ---
    pubsub_data = cloud_event.data.get("message", {}).get("data", "")
    if not pubsub_data:
        logger.error("Empty Pub/Sub message — acking to prevent infinite retry")
        return

    try:
        doc_id = base64.b64decode(pubsub_data).decode("utf-8").strip()
    except (UnicodeDecodeError, Exception) as e:
        logger.error(f"Malformed Pub/Sub message: {e}")
        return  # Ack — can't fix bad data with retries

    if not doc_id:
        logger.error("Empty doc_id in Pub/Sub message")
        return

    logger.info(f"Received doc_id: {doc_id[:12]}...")

    # --- Read document state from Firestore ---
    db = _get_db()
    doc_ref = db.collection(COLLECTION).document(doc_id)
    snap = doc_ref.get()

    if not snap.exists:
        logger.error(f"Doc {doc_id[:12]}... not found in Firestore — acking")
        return

    doc_data = snap.to_dict()
    draft = doc_data.get("draft", "")
    image_url = doc_data.get("image_url", "")
    filename = doc_data.get("filename", "unknown")
    status = doc_data.get("status", "UNKNOWN")

    logger.info(
        f"Doc state: {doc_id[:12]}... status={status} "
        f"file={filename} draft={'yes' if draft else 'no'}"
    )

    # --- Validate we have something to post ---
    if not draft or not image_url:
        logger.error(
            f"Incomplete doc {doc_id[:12]}...: "
            f"draft={'present' if draft else 'MISSING'}, "
            f"image_url={'present' if image_url else 'MISSING'}"
        )
        # Don't retry — data won't magically appear
        send_to_dlq(doc_id, filename, "INCOMPLETE_DOCUMENT")
        return

    # --- Acquire posting lock ---
    lock_token = acquire_posting_lock(doc_id)
    if not lock_token:
        # Either terminal, locked by another poster, or unexpected state
        # All cases: ack the message silently
        return

    logger.info(f"Lock acquired: {doc_id[:12]}... (token={lock_token[:8]}...)")

    # --- DRY RUN mode ---
    if DRY_RUN:
        dry_result = dry_run_post(doc_id, draft, image_url)
        # In dry run, mark as POSTED so the doc doesn't get re-processed
        release_lock_success(doc_id, lock_token, "DRY_RUN")
        logger.info(f"[DRY_RUN] Complete: would_post={dry_result.get('would_post')}")
        return

    # --- Post to GBP ---
    try:
        result = post_to_gbp(draft, image_url)

        if result["success"]:
            post_name = result.get("post_name", "unknown")
            logger.info(f"SUCCESS: {doc_id[:12]}... → {post_name}")
            release_lock_success(doc_id, lock_token, post_name)

        elif result.get("retryable"):
            # Transient error — raise to trigger Pub/Sub retry
            # DON'T release the lock — it will expire via TTL,
            # allowing the retry to re-acquire it
            raise RuntimeError(
                f"Retryable GBP error ({result.get('status_code')}): "
                f"{result.get('error', 'unknown')}"
            )
        else:
            # Permanent error — release lock as failed, forward to DLQ
            error_msg = result.get("error", "unknown")
            logger.error(f"PERMANENT failure: {doc_id[:12]}... — {error_msg}")
            release_lock_failure(doc_id, lock_token, f"GBP_PERMANENT: {error_msg}")
            send_to_dlq(doc_id, filename, f"GBP_PERMANENT: {error_msg}")

    except RuntimeError:
        # Re-raise retryable errors (Pub/Sub will retry)
        raise
    except Exception as e:
        error_type = classify_error(e)
        logger.error(f"Unhandled exception ({error_type}): {e}")

        if error_type == "TRANSIENT":
            # Let lock expire via TTL, Pub/Sub will retry
            raise
        else:
            release_lock_failure(doc_id, lock_token, f"EXCEPTION: {e}")
            send_to_dlq(doc_id, filename, f"EXCEPTION: {e}")
