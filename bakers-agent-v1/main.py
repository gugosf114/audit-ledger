"""
Bakers Agent v1 — Brain (Generator + Sentinel + Memory)

Triggered by GCS upload via Eventarc.
Generates a GBP caption using Gemini 2.5 Pro, validates via structured output,
stores in Firestore, publishes doc_id to Pub/Sub for the Poster agent.

Architecture (merged):
  - Doc-centric: SHA-256 doc_id from bucket:name:generation for idempotency
  - Pub/Sub pointer: message carries only doc_id, poster reads state from Firestore
  - Structured output: response_schema enforced at model level, not post-hoc regex
  - ReAct loop: generate → validate → critic feedback → retry (3 rounds)

Model: gemini-2.5-pro (GA on Vertex AI)
       - gemini-1.5-flash-001 is retired (April 2025)
       - gemini-2.0-flash shuts down March 2026
       - gemini-2.5-pro is current stable for structured output + vision

SDK Note: Using vertexai SDK. Google recommends migrating to google-genai SDK
          before June 2026. The vertexai SDK will stop receiving Gemini updates
          after that date.
"""

import functions_framework
import hashlib
import re
import vertexai
from vertexai.generative_models import (
    GenerativeModel, Part, GenerationConfig,
    HarmCategory, HarmBlockThreshold,
)
from google.cloud import firestore, pubsub_v1, storage
import logging
import os
import json
import mimetypes
import datetime

# --- CONFIG ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bakers-agent")

PROJECT_ID = os.environ.get("GCP_PROJECT")
LOCATION = os.environ.get("VERTEX_LOCATION", "us-central1")
FIRESTORE_DB = os.environ.get("FIRESTORE_DB", "bakers-agent-db")
PUBSUB_TOPIC = os.environ.get("PUBSUB_TOPIC", "bakers-agent-topic")
PUBSUB_DLQ_TOPIC = os.environ.get("PUBSUB_DLQ_TOPIC", "bakers-agent-dlq")

# Firestore collection name
COLLECTION = "captions"

# Signed URL expiry (1 hour — GBP needs time to fetch the image)
SIGNED_URL_EXPIRY_MINUTES = 60

# Max ReAct retry rounds
MAX_REACT_ROUNDS = 3

# --- INITIALIZE CLIENTS ---
vertexai.init(project=PROJECT_ID, location=LOCATION)
db = firestore.Client(project=PROJECT_ID, database=FIRESTORE_DB)
publisher = pubsub_v1.PublisherClient()
storage_client = storage.Client(project=PROJECT_ID)
topic_path = publisher.topic_path(PROJECT_ID, PUBSUB_TOPIC)
dlq_topic_path = publisher.topic_path(PROJECT_ID, PUBSUB_DLQ_TOPIC)

# --- GEMINI 2.5 PRO ---
# Structured output schema — enforced at the model level, not post-hoc regex.
# The model returns JSON matching this schema, and the sentinel validates it.
CAPTION_SCHEMA = {
    "type": "object",
    "properties": {
        "caption": {
            "type": "string",
            "description": (
                "A social media caption for a bakery post. "
                "Must be under 40 words. Use sensory language about texture, "
                "aroma, and appearance. No prices, dollar amounts, or percentages. "
                "No words like: delightful, scrumptious, yummy, tummy, game changer. "
                "Direct, confident, professional tone."
            ),
        },
        "word_count": {
            "type": "integer",
            "description": "The exact number of words in the caption.",
        },
        "contains_price": {
            "type": "boolean",
            "description": (
                "True if the caption contains any price, dollar sign, "
                "dollar amount, percentage, or discount language."
            ),
        },
    },
    "required": ["caption", "word_count", "contains_price"],
}

model = GenerativeModel(
    "gemini-2.5-pro",
    generation_config=GenerationConfig(
        response_mime_type="application/json",
        response_schema=CAPTION_SCHEMA,
        temperature=0.8,       # Slightly creative but controlled
        max_output_tokens=256, # Captions are short — no need for long output
    ),
    safety_settings={
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
)

# Allowed image MIME types
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
}


# --- 1. DOC-CENTRIC IDENTITY ---

def make_doc_id(bucket: str, name: str, generation: str) -> str:
    """
    Deterministic document ID from bucket:name:generation.
    SHA-256 ensures uniqueness without exposing file paths.
    The GCS generation number guarantees a new upload of the same
    filename (overwrite) gets a new doc_id.
    """
    raw = f"{bucket}:{name}:{generation}"
    return hashlib.sha256(raw.encode()).hexdigest()


# --- 2. IDEMPOTENCY (Transactional) ---

def claim_document(doc_id: str, bucket: str, filename: str) -> bool:
    """
    Atomically claim this doc_id in Firestore.
    Returns True if we created it (first processor wins).
    Returns False if it already exists (duplicate — skip).

    Uses a transaction to prevent race conditions between
    concurrent Cloud Function invocations for the same upload.
    """
    doc_ref = db.collection(COLLECTION).document(doc_id)

    @firestore.transactional
    def _claim(transaction):
        snap = doc_ref.get(transaction=transaction)
        if snap.exists:
            return False
        transaction.set(doc_ref, {
            "doc_id": doc_id,
            "bucket": bucket,
            "filename": filename,
            "status": "RECEIVED",
            "created_at": firestore.SERVER_TIMESTAMP,
        })
        return True

    try:
        return _claim(db.transaction())
    except Exception as e:
        logger.error(f"Claim transaction failed for {doc_id}: {e}")
        return False


def update_status(doc_id: str, status: str, **extra_fields):
    """Update the Firestore doc status + any extra fields."""
    try:
        update = {"status": status, "updated_at": firestore.SERVER_TIMESTAMP}
        update.update(extra_fields)
        db.collection(COLLECTION).document(doc_id).update(update)
        logger.info(f"Status: {doc_id[:12]}... → {status}")
    except Exception as e:
        logger.error(f"Status update failed for {doc_id}: {e}")


# --- 3. SENTINEL (Structured Output Validation) ---

def sentinel_check(parsed: dict) -> tuple[bool, str]:
    """
    Validates Gemini's structured output.

    Two layers:
    1. Trust the model's self-reported fields (contains_price, word_count)
    2. Verify independently (actual word count, hard-block phrases)

    Returns (passed: bool, reason: str).
    """
    caption = parsed.get("caption", "").strip()
    contains_price = parsed.get("contains_price", False)

    # Empty
    if not caption:
        return False, "EMPTY_CAPTION"

    # Model self-reported price
    if contains_price:
        return False, "PRICE_SELF_REPORTED"

    # Independent word count check (don't blindly trust the model)
    actual_words = len(caption.split())
    if actual_words > 40:
        return False, f"TOO_LONG ({actual_words} words)"

    if actual_words < 5:
        return False, f"TOO_SHORT ({actual_words} words)"

    # Hard-block: price patterns via regex (catches $10, $5.99, 20%, etc.)
    caption_lower = caption.lower()
    price_pattern = re.compile(
        r"\$\s*\d+|\d+\s*%|percent\s+off|discount|sale\s+price"
        r"|free\s+delivery|promo|coupon"
    )
    price_match = price_pattern.search(caption_lower)
    if price_match:
        return False, f"PRICE_DETECTED: '{price_match.group()}'"

    return True, "APPROVED"


# --- 4. MEMORY ---

def retrieve_memory() -> str:
    """
    Fetch last 3 successful captions for style matching.
    Gives the model context to maintain consistent voice.
    """
    try:
        docs = (
            db.collection(COLLECTION)
            .where("status", "in", ["QUEUED", "POSTED"])
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(3)
            .stream()
        )
        history = [d.to_dict().get("draft", "") for d in docs]
        result = "\n---\n".join(h for h in history if h)
        return result if result else "No previous posts yet."
    except Exception as e:
        logger.error(f"Memory retrieval failed: {e}")
        return "No previous posts yet."


# --- 5. SIGNED URL ---

def generate_signed_url(bucket_name: str, filename: str) -> str:
    """
    Generate a V4 signed URL for GBP to fetch the image.
    Requires iam.serviceAccountTokenCreator on the Brain SA.
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(filename)
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=SIGNED_URL_EXPIRY_MINUTES),
        method="GET",
    )


# --- 6. MIME TYPE ---

def get_mime_type(filename: str) -> str | None:
    """Detect MIME type from filename. Returns None if not a supported image."""
    mime_type, _ = mimetypes.guess_type(filename.lower())
    if mime_type and mime_type in ALLOWED_MIME_TYPES:
        return mime_type
    return None


# --- 7. REACT GENERATOR ---

def generate_with_react(bucket: str, filename: str) -> str | None:
    """
    3-round ReAct loop:
      1. Generate caption from image
      2. Validate with sentinel
      3. If rejected, append critic feedback and retry

    Returns approved caption string or None if all rounds fail.
    """
    mime_type = get_mime_type(filename)
    if not mime_type:
        logger.error(f"Unsupported file type: {filename}")
        return None

    uri = f"gs://{bucket}/{filename}"
    image_part = Part.from_uri(uri, mime_type=mime_type)
    memory = retrieve_memory()

    prompt = f"""You are the social media manager for 'My Baking Creations', a bakery.
Write a Google Business Profile update for the attached product photo.

RULES — follow these exactly:
1. Under 40 words, minimum 5 words
2. Describe what you SEE: texture, color, layers, glaze, crumb structure
3. Evoke what the customer will SMELL and TASTE
4. No prices, dollar amounts, percentages, or discount language
5. No words: delightful, scrumptious, yummy, tummy, game changer, amazing
6. Confident, direct tone — you're a craftsperson, not a marketer
7. Do NOT repeat or closely paraphrase previous captions

PREVIOUS CAPTIONS (avoid repeating):
{memory}

Return valid JSON matching the schema. Be precise with word_count and contains_price."""

    for attempt in range(MAX_REACT_ROUNDS):
        try:
            response = model.generate_content([prompt, image_part])
            raw = response.text.strip()

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as e:
                logger.warning(f"Round {attempt + 1}: Bad JSON: {e}")
                prompt += (
                    "\n\nCRITIC: Your last response was not valid JSON. "
                    "You MUST return a JSON object with caption, word_count, "
                    "and contains_price fields. Try again."
                )
                continue

            passed, reason = sentinel_check(parsed)

            if passed:
                logger.info(f"Caption approved (round {attempt + 1})")
                return parsed["caption"]

            logger.info(f"Round {attempt + 1} rejected: {reason}")
            prompt += (
                f"\n\nCRITIC: Your draft was rejected. Reason: {reason}. "
                f"The rejected draft was: \"{parsed.get('caption', '')}\" "
                f"Fix the issue and generate a new caption."
            )

        except Exception as e:
            logger.error(f"Round {attempt + 1} generation error: {e}")
            # Don't append to prompt on infrastructure errors

    return None


# --- 8. DEAD LETTER QUEUE ---

def send_to_dlq(filename: str, doc_id: str, reason: str):
    """Publish failure info to DLQ topic for monitoring/alerting."""
    try:
        msg = json.dumps({
            "doc_id": doc_id,
            "filename": filename,
            "reason": reason,
            "source": "bakers-agent-v1",
            "timestamp": datetime.datetime.utcnow().isoformat(),
        })
        publisher.publish(dlq_topic_path, data=msg.encode("utf-8"))
        logger.info(f"DLQ: {filename} — {reason}")
    except Exception as e:
        logger.error(f"DLQ publish failed (message lost): {e}")


# --- 9. MAIN TRIGGER ---

@functions_framework.cloud_event
def process_upload(cloud_event):
    """
    Entry point. Triggered by GCS object finalize via Eventarc.

    Flow:
    1. Compute deterministic doc_id (SHA-256 of bucket:name:generation)
    2. Atomically claim the doc in Firestore (idempotency gate)
    3. Validate file is a supported image
    4. Generate caption via ReAct loop (Gemini 2.5 Pro)
    5. Generate signed URL
    6. Store draft + signed URL in Firestore doc
    7. Publish doc_id pointer to Pub/Sub for the Poster agent
    """
    data = cloud_event.data
    bucket = data["bucket"]
    filename = data["name"]
    generation = str(data.get("generation", "0"))

    logger.info(f"Triggered: gs://{bucket}/{filename} (gen={generation})")

    # Gate: image files only
    if not get_mime_type(filename):
        logger.info(f"Skipping non-image: {filename}")
        return

    # Deterministic doc_id
    doc_id = make_doc_id(bucket, filename, generation)
    logger.info(f"doc_id: {doc_id[:12]}...")

    # Gate: idempotency — atomic claim
    if not claim_document(doc_id, bucket, filename):
        logger.info(f"Already claimed: {doc_id[:12]}... — skipping")
        return

    # Mark: GENERATING
    update_status(doc_id, "GENERATING")

    try:
        draft = generate_with_react(bucket, filename)

        if not draft:
            update_status(doc_id, "FAILED", failure_reason="SENTINEL_BLOCKED_ALL_ATTEMPTS")
            send_to_dlq(filename, doc_id, "SENTINEL_BLOCKED_ALL_ATTEMPTS")
            return

        # Generate signed URL BEFORE storing — if this fails, don't create
        # a record that can't be posted
        signed_url = generate_signed_url(bucket, filename)

        # Update Firestore doc with draft + signed URL (doc already exists from claim)
        update_status(
            doc_id, "QUEUED",
            draft=draft,
            image_url=signed_url,
            signed_url_expires=datetime.datetime.utcnow()
            + datetime.timedelta(minutes=SIGNED_URL_EXPIRY_MINUTES),
        )

        # Publish ONLY doc_id to Pub/Sub — poster reads full state from Firestore
        # This is the pointer pattern: keeps messages small, state lives in Firestore
        publisher.publish(
            topic_path,
            data=doc_id.encode("utf-8"),
            doc_id=doc_id,  # attribute for filtering/debugging
        )
        logger.info(f"Queued for posting: {filename} ({doc_id[:12]}...)")

    except Exception as e:
        logger.error(f"Failed: {filename}: {e}")
        update_status(doc_id, "FAILED", failure_reason=str(e))
        send_to_dlq(filename, doc_id, f"EXCEPTION: {e}")
