#!/bin/bash
set -euo pipefail

# ==============================================================================
# Bakers Agent — Infrastructure Setup
#
# Creates: GCS bucket, Firestore DB, Pub/Sub topics, Secret Manager secret,
#          two least-privilege service accounts (brain + poster), IAM bindings.
#
# Usage:
#   export GCP_PROJECT_ID="your-project-id"
#   bash infra/setup.sh
# ==============================================================================

# --- CONFIGURATION ---
export PROJECT_ID="${GCP_PROJECT_ID:?ERROR: Set GCP_PROJECT_ID environment variable}"
export REGION="${GCP_REGION:-us-central1}"
export BUCKET_NAME="bakers-agent-input-${PROJECT_ID}"
export FIRESTORE_DB="bakers-agent-db"
export PUBSUB_TOPIC="bakers-agent-topic"
export PUBSUB_DLQ_TOPIC="bakers-agent-dlq"
export SECRET_NAME="gbp-oauth-secret"

# Two separate service accounts — least privilege
export BRAIN_SA_NAME="bakers-brain-sa"
export BRAIN_SA_EMAIL="${BRAIN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
export POSTER_SA_NAME="bakers-poster-sa"
export POSTER_SA_EMAIL="${POSTER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=== Bakers Agent Infrastructure Setup ==="
echo "Project:   ${PROJECT_ID}"
echo "Region:    ${REGION}"
echo "Brain SA:  ${BRAIN_SA_EMAIL}"
echo "Poster SA: ${POSTER_SA_EMAIL}"
echo ""

gcloud config set project "$PROJECT_ID"

# --- 1. ENABLE APIs ---
echo "[1/8] Enabling APIs..."
gcloud services enable \
    cloudfunctions.googleapis.com \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    aiplatform.googleapis.com \
    storage.googleapis.com \
    eventarc.googleapis.com \
    pubsub.googleapis.com \
    firestore.googleapis.com \
    secretmanager.googleapis.com \
    logging.googleapis.com \
    monitoring.googleapis.com \
    mybusinessbusinessinformation.googleapis.com

# --- 2. CREATE RESOURCES ---
echo "[2/8] Creating resources..."

# GCS Bucket — uniform access, 7-day lifecycle
if ! gsutil ls -b "gs://${BUCKET_NAME}" > /dev/null 2>&1; then
    gsutil mb -l "$REGION" -b on "gs://${BUCKET_NAME}"
    gsutil lifecycle set /dev/stdin "gs://${BUCKET_NAME}" <<'EOF'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 7}}]}
EOF
    echo "  Created bucket: ${BUCKET_NAME}"
else
    echo "  Exists: ${BUCKET_NAME}"
fi

# Firestore
if ! gcloud firestore databases describe --database="$FIRESTORE_DB" > /dev/null 2>&1; then
    gcloud firestore databases create --database="$FIRESTORE_DB" --location="$REGION"
    echo "  Created Firestore DB: ${FIRESTORE_DB}"
else
    echo "  Exists: ${FIRESTORE_DB}"
fi

# Pub/Sub Topics (main + DLQ)
for topic in "$PUBSUB_TOPIC" "$PUBSUB_DLQ_TOPIC"; do
    if ! gcloud pubsub topics describe "$topic" > /dev/null 2>&1; then
        gcloud pubsub topics create "$topic"
        echo "  Created topic: ${topic}"
    else
        echo "  Exists: ${topic}"
    fi
done

# DLQ Subscription
DLQ_SUB="${PUBSUB_DLQ_TOPIC}-sub"
if ! gcloud pubsub subscriptions describe "$DLQ_SUB" > /dev/null 2>&1; then
    gcloud pubsub subscriptions create "$DLQ_SUB" \
        --topic="$PUBSUB_DLQ_TOPIC" \
        --message-retention-duration=7d
    echo "  Created DLQ sub: ${DLQ_SUB}"
else
    echo "  Exists: ${DLQ_SUB}"
fi

# Secret Manager — placeholder with correct schema
if ! gcloud secrets describe "$SECRET_NAME" > /dev/null 2>&1; then
    cat <<'SECRETEOF' | gcloud secrets create "$SECRET_NAME" --data-file=-
{
    "client_id": "REPLACE_WITH_OAUTH_CLIENT_ID",
    "client_secret": "REPLACE_WITH_OAUTH_CLIENT_SECRET",
    "refresh_token": "REPLACE_WITH_REFRESH_TOKEN",
    "access_token": "",
    "token_uri": "https://oauth2.googleapis.com/token"
}
SECRETEOF
    echo "  Created secret: ${SECRET_NAME} (UPDATE WITH REAL CREDENTIALS)"
else
    echo "  Exists: ${SECRET_NAME}"
fi

# --- 3. SERVICE ACCOUNTS ---
echo "[3/8] Creating service accounts..."

# Brain SA
if ! gcloud iam service-accounts describe "$BRAIN_SA_EMAIL" > /dev/null 2>&1; then
    gcloud iam service-accounts create "$BRAIN_SA_NAME" \
        --display-name="Bakers Brain Agent (Generator)"
    echo "  Created: ${BRAIN_SA_EMAIL}"
else
    echo "  Exists: ${BRAIN_SA_EMAIL}"
fi

# Poster SA
if ! gcloud iam service-accounts describe "$POSTER_SA_EMAIL" > /dev/null 2>&1; then
    gcloud iam service-accounts create "$POSTER_SA_NAME" \
        --display-name="Bakers Poster Agent (GBP)"
    echo "  Created: ${POSTER_SA_EMAIL}"
else
    echo "  Exists: ${POSTER_SA_EMAIL}"
fi

# --- 4. IAM — LEAST PRIVILEGE ---
echo "[4/8] Configuring IAM (least-privilege)..."

# Brain SA roles:
#   - Read images from GCS
#   - Generate signed URLs (objectViewer + iam.serviceAccountTokenCreator on self)
#   - Call Vertex AI (Gemini)
#   - Read/write Firestore (captions collection)
#   - Publish to Pub/Sub (main topic + DLQ)
#   - Write logs and metrics
#   - Receive Eventarc events
BRAIN_ROLES=(
    "roles/storage.objectViewer"
    "roles/aiplatform.user"
    "roles/datastore.user"
    "roles/pubsub.publisher"
    "roles/logging.logWriter"
    "roles/monitoring.metricWriter"
    "roles/eventarc.eventReceiver"
    "roles/run.invoker"
    "roles/artifactregistry.reader"
)

for role in "${BRAIN_ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${BRAIN_SA_EMAIL}" \
        --role="$role" \
        --condition=None \
        --quiet > /dev/null 2>&1
done

# Brain SA needs to sign URLs — grant token creator on itself
gcloud iam service-accounts add-iam-policy-binding "$BRAIN_SA_EMAIL" \
    --member="serviceAccount:${BRAIN_SA_EMAIL}" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --quiet > /dev/null 2>&1

echo "  Brain SA: ${#BRAIN_ROLES[@]} project roles + token creator"

# Poster SA roles:
#   - Read secrets from Secret Manager (OAuth creds)
#   - Add secret versions (persist refreshed token)
#   - Subscribe to Pub/Sub (triggered by topic)
#   - Publish to Pub/Sub (DLQ forwarding)
#   - Read/write Firestore (update caption status QUEUED -> POSTED/FAILED)
#   - Write logs and metrics
#   - NO storage access (doesn't need it)
#   - NO Vertex AI access (doesn't need it)
POSTER_ROLES=(
    "roles/secretmanager.secretAccessor"
    "roles/secretmanager.secretVersionAdder"
    "roles/pubsub.subscriber"
    "roles/pubsub.publisher"
    "roles/datastore.user"
    "roles/logging.logWriter"
    "roles/monitoring.metricWriter"
    "roles/run.invoker"
    "roles/artifactregistry.reader"
)

for role in "${POSTER_ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${POSTER_SA_EMAIL}" \
        --role="$role" \
        --condition=None \
        --quiet > /dev/null 2>&1
done
echo "  Poster SA: ${#POSTER_ROLES[@]} project roles"

# GCS Service Agent needs Pub/Sub publisher for Eventarc triggers
GCS_SA="$(gsutil kms serviceaccount -p "$PROJECT_ID")"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${GCS_SA}" \
    --role="roles/pubsub.publisher" \
    --quiet > /dev/null 2>&1
echo "  GCS service agent: pubsub.publisher (Eventarc)"

# --- 5. FIRESTORE INDEXES ---
echo "[5/8] Creating Firestore composite indexes..."

# The memory query in the brain agent uses: WHERE status IN [...] ORDER BY created_at DESC
# This requires a composite index on (status, created_at).
# Firestore will auto-create simple indexes, but composite ones need explicit creation.
INDEXES_JSON=$(cat <<'INDEXEOF'
{
  "indexes": [
    {
      "collectionGroup": "captions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "created_at", "order": "DESCENDING" }
      ]
    }
  ]
}
INDEXEOF
)

INDEX_FILE=$(mktemp)
echo "$INDEXES_JSON" > "$INDEX_FILE"

if gcloud firestore indexes composite list --database="$FIRESTORE_DB" 2>/dev/null | grep -q "captions"; then
    echo "  Exists: composite index on captions(status, created_at)"
else
    gcloud firestore indexes composite create \
        --database="$FIRESTORE_DB" \
        --collection-group="captions" \
        --field-config="field-path=status,order=ascending" \
        --field-config="field-path=created_at,order=descending" \
        2>/dev/null \
        && echo "  Created: composite index on captions(status, created_at)" \
        || echo "  Skipped index (create manually in Firebase Console if needed)"
fi
rm -f "$INDEX_FILE"

# --- 6. MONITORING ALERTS ---
echo "[6/8] Creating monitoring alerts..."

# Function error rate alert
ALERT_POLICY_JSON=$(cat <<'ALERTEOF'
{
  "displayName": "Bakers Agent - Function Errors",
  "conditions": [{
    "displayName": "Cloud Function error rate > 0",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status=\"error\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "300s",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_RATE"
      }]
    }
  }],
  "combiner": "OR",
  "enabled": true
}
ALERTEOF
)

if ! gcloud alpha monitoring policies list --format="value(displayName)" 2>/dev/null | grep -q "Bakers Agent - Function Errors"; then
    echo "$ALERT_POLICY_JSON" | gcloud alpha monitoring policies create --policy-from-file=/dev/stdin 2>/dev/null \
        && echo "  Created alert: Function Errors" \
        || echo "  Skipped alert creation (add notification channel manually in console)"
else
    echo "  Exists: Function Errors alert"
fi

echo "  NOTE: Attach a notification channel (email/SMS) in Cloud Monitoring console"

# --- 7. DEPLOYMENT INSTRUCTIONS ---
echo ""
echo "[7/8] Infrastructure complete."
echo ""
echo "============================================="
echo "  DEPLOYMENT COMMANDS"
echo "============================================="
echo ""
echo "Step 1: Add real OAuth credentials"
echo "  gcloud secrets versions add ${SECRET_NAME} --data-file=creds.json"
echo ""
echo "Step 2: Deploy Brain agent"
echo "  gcloud functions deploy bakers-agent-v1 \\"
echo "    --gen2 --runtime=python312 --region=${REGION} \\"
echo "    --source=./bakers-agent-v1 \\"
echo "    --entry-point=process_upload \\"
echo "    --service-account=${BRAIN_SA_EMAIL} \\"
echo "    --timeout=120s --memory=1Gi \\"
echo "    --ingress-settings=internal-only \\"
echo "    --set-env-vars=VERTEX_LOCATION=${REGION},FIRESTORE_DB=${FIRESTORE_DB},PUBSUB_TOPIC=${PUBSUB_TOPIC},PUBSUB_DLQ_TOPIC=${PUBSUB_DLQ_TOPIC}"
echo ""
echo "Step 3: Wire Eventarc trigger"
echo "  gcloud eventarc triggers create bakers-agent-trigger \\"
echo "    --location=${REGION} \\"
echo "    --event-filters=type=google.cloud.storage.object.v1.finalized \\"
echo "    --event-filters=bucket=${BUCKET_NAME} \\"
echo "    --destination-run-function=bakers-agent-v1 \\"
echo "    --destination-run-region=${REGION} \\"
echo "    --service-account=${BRAIN_SA_EMAIL}"
echo ""
echo "Step 4: Deploy Poster agent"
echo "  gcloud functions deploy bakers-poster-v1 \\"
echo "    --gen2 --runtime=python312 --region=${REGION} \\"
echo "    --source=./bakers-poster-v1 \\"
echo "    --entry-point=process_post_queue \\"
echo "    --service-account=${POSTER_SA_EMAIL} \\"
echo "    --trigger-topic=${PUBSUB_TOPIC} \\"
echo "    --ingress-settings=internal-only \\"
echo "    --set-env-vars=SECRET_NAME=${SECRET_NAME},FIRESTORE_DB=${FIRESTORE_DB},PUBSUB_DLQ_TOPIC=${PUBSUB_DLQ_TOPIC},GBP_LOCATION_ID=accounts/YOUR_ACC_ID/locations/YOUR_LOC_ID,GBP_CTA_URL=https://mybakingcreations.com/order,DRY_RUN=true"
echo ""
echo "  # NOTE: Set DRY_RUN=true for first deploy to validate without posting."
echo "  #        Flip to DRY_RUN=false once config is verified."
echo ""
echo "============================================="

# --- 8. TEARDOWN ---
echo ""
echo "[8/8] Teardown commands (if you need to clean up):"
echo ""
echo "  # Delete functions"
echo "  gcloud functions delete bakers-agent-v1 --region=${REGION} --quiet"
echo "  gcloud functions delete bakers-poster-v1 --region=${REGION} --quiet"
echo ""
echo "  # Delete Eventarc trigger"
echo "  gcloud eventarc triggers delete bakers-agent-trigger --location=${REGION} --quiet"
echo ""
echo "  # Delete Pub/Sub"
echo "  gcloud pubsub subscriptions delete ${DLQ_SUB} --quiet"
echo "  gcloud pubsub topics delete ${PUBSUB_TOPIC} --quiet"
echo "  gcloud pubsub topics delete ${PUBSUB_DLQ_TOPIC} --quiet"
echo ""
echo "  # Delete bucket (DESTRUCTIVE — deletes all images)"
echo "  gsutil rm -r gs://${BUCKET_NAME}"
echo ""
echo "  # Delete Firestore DB"
echo "  gcloud firestore databases delete --database=${FIRESTORE_DB} --quiet"
echo ""
echo "  # Delete secrets"
echo "  gcloud secrets delete ${SECRET_NAME} --quiet"
echo ""
echo "  # Delete service accounts"
echo "  gcloud iam service-accounts delete ${BRAIN_SA_EMAIL} --quiet"
echo "  gcloud iam service-accounts delete ${POSTER_SA_EMAIL} --quiet"
echo ""
echo "============================================="
echo "  DONE"
echo "============================================="
