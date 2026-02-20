#!/bin/bash
# StraySense setup script
# Run this from inside your straysense project folder:
#   bash setup.sh

echo "🐾 StraySense Setup"
echo "==================="

# 1. Create backend folder
mkdir -p backend

# 2. Write app.py into backend/
cat > backend/app.py << 'PYEOF'
# backend/app.py - StraySense FastAPI backend
# Run: uvicorn app:app --reload (from inside /backend)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Optional, List, Any

app = FastAPI(title="StraySense Triage API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://*.vercel.app", "*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

BEHAVIOR_PHRASES = {
    "limping": "Observed locomotion asymmetry consistent with limb pain or structural injury.",
    "lethargic": "Subject displays marked reduction in activity and responsiveness; possible systemic illness or severe pain.",
    "aggressive": "Defensive aggression noted; may indicate pain-induced reactivity or neurological involvement.",
    "avoids_contact": "Contact avoidance behavior observed; consistent with fear response, pain sensitization, or prior trauma.",
    "excessive_licking": "Repetitive licking behavior noted at unspecified site; indicative of localized irritation, wound, or anxiety.",
}

VISUAL_PHRASES = {
    "body_thin": "Body condition score assessed as below-normal; visible prominence of ribs and/or spine suggesting suboptimal nutritional status.",
    "body_severely_thin": "Severe cachexia observed; marked muscle wasting, prominent bony prominences, and critically low body condition score.",
    "open_wound": "Visible integumentary breach observed. Open wound presents infection risk and requires prompt evaluation.",
    "infection_risk": "Signs consistent with infection risk: erythema, discharge, or tissue breakdown observed at wound site.",
    "abnormal_posture": "Postural abnormality detected; guarded stance or spinal deviation may indicate musculoskeletal or neurological compromise.",
    "limb_asymmetry": "Limb asymmetry or unequal weight distribution observed; consistent with fracture, dislocation, or soft tissue injury.",
}

WOUND_LOCATION_PHRASES = {
    "head": "Cranial or facial region.",
    "neck": "Cervical region.",
    "torso": "Thoracic or abdominal region.",
    "forelimb": "Forelimb; possible impact on gait and limb function.",
    "hindlimb": "Hindlimb; gait compromise likely.",
    "tail": "Caudal region.",
}

NLP_SYMPTOMS = {
    "critical": ["heavy bleeding", "unconscious", "seizure", "hit by car", "cannot walk", "convulsing"],
    "high":     ["vomiting", "not eating", "diarrhea", "open sore", "discharge", "swollen", "crying in pain"],
    "medium":   ["scratching", "coughing", "sneezing", "labored breathing", "itching"],
    "low":      ["thirsty", "hungry", "friendly", "curious", "alert"],
}
SCORE_MAP = {"critical": 3, "high": 2, "medium": 1, "low": 0}

class AnalysisRequest(BaseModel):
    visualSignals: Dict[str, Any]
    behaviorSignals: Dict[str, bool]
    description: Optional[str] = ""

def run_nlp(description: str):
    if not description:
        return [], 0, []
    lower = description.lower()
    matched, score_boost, nlp_obs = [], 0, []
    for level, phrases in NLP_SYMPTOMS.items():
        for phrase in phrases:
            if phrase in lower:
                matched.append(phrase)
                score_boost += SCORE_MAP[level]
                nlp_obs.append(f'Free-text NLP detected "{phrase}" — classified as {level}-priority indicator.')
    return matched, score_boost, nlp_obs

def build_actions(urgency: str, flags: set) -> List[str]:
    actions = []
    if urgency == "HIGH":
        actions.append("Immediate veterinary assessment required. Do not delay triage.")
        actions.append("Isolate animal from other animals and minimize handling stress.")
        actions.append("🇲🇩 Contact: Societatea Zoologică din Moldova (+373 22 28 34 56) or Clinica Veterinară Vet-Pro Chișinău (+373 22 940 940).")
    if urgency == "MEDIUM":
        actions.append("Schedule veterinary evaluation within 24–48 hours.")
        actions.append("Monitor for deterioration; isolate if behavior is reactive.")
        actions.append("🇲🇩 Contact: Adăpostul pentru Animale Chișinău (+373 22 49 96 82) or local vet in Cricova.")
    if urgency == "LOW":
        actions.append("Routine intake evaluation recommended.")
        actions.append("Monitor for changes in condition or behavior.")
        actions.append("🇲🇩 Contact: Animal Rescue Chișinău volunteers or Cricova Community Vet Outreach.")
    if "infection_risk" in flags:
        actions.append("Wound should be cleaned and assessed for debridement or antibiotic intervention.")
    if "nutritional" in flags:
        actions.append("Initiate gradual refeeding protocol; avoid refeeding syndrome in severely malnourished animals.")
    if "trauma" in flags:
        actions.append("Radiographic imaging recommended to assess for fractures or internal injuries.")
    actions.append("Document all findings with timestamped photos for shelter records.")
    return actions

@app.post("/analyze")
def analyze(request: AnalysisRequest):
    flags, physical_obs, behavioral_obs, urgency_score = set(), [], [], 0
    vs, bs = request.visualSignals, request.behaviorSignals

    if vs.get("bodyCondition") == "thin":
        physical_obs.append(VISUAL_PHRASES["body_thin"]); flags.add("nutritional"); urgency_score += 1
    if vs.get("bodyCondition") == "severely_thin":
        physical_obs.append(VISUAL_PHRASES["body_severely_thin"]); flags.add("nutritional"); urgency_score += 3
    if vs.get("openWound"):
        physical_obs.append(VISUAL_PHRASES["open_wound"]); flags.add("trauma"); urgency_score += 2
        wl = vs.get("woundLocation")
        if wl and wl in WOUND_LOCATION_PHRASES:
            physical_obs.append(f"Wound location: {WOUND_LOCATION_PHRASES[wl]}")
    if vs.get("infectionRisk"):
        physical_obs.append(VISUAL_PHRASES["infection_risk"]); flags.add("infection_risk"); urgency_score += 2
    if vs.get("abnormalPosture"):
        physical_obs.append(VISUAL_PHRASES["abnormal_posture"]); flags.add("pain_distress"); urgency_score += 1
    if vs.get("limbAsymmetry"):
        physical_obs.append(VISUAL_PHRASES["limb_asymmetry"]); flags.add("trauma"); urgency_score += 2

    if bs.get("limping"):
        behavioral_obs.append(BEHAVIOR_PHRASES["limping"]); flags.add("trauma"); flags.add("pain_distress"); urgency_score += 2
    if bs.get("lethargic"):
        behavioral_obs.append(BEHAVIOR_PHRASES["lethargic"]); flags.add("pain_distress"); urgency_score += 2
    if bs.get("aggressive"):
        behavioral_obs.append(BEHAVIOR_PHRASES["aggressive"]); flags.add("pain_distress"); urgency_score += 1
    if bs.get("avoids_contact"):
        behavioral_obs.append(BEHAVIOR_PHRASES["avoids_contact"]); urgency_score += 1
    if bs.get("excessive_licking"):
        behavioral_obs.append(BEHAVIOR_PHRASES["excessive_licking"]); flags.add("infection_risk"); urgency_score += 1

    matched, score_boost, nlp_obs = run_nlp(request.description or "")
    urgency_score += score_boost
    urgency = "HIGH" if urgency_score >= 4 else "MEDIUM" if urgency_score >= 2 else "LOW"

    concern_summary = []
    if "trauma" in flags:         concern_summary.append("Physical trauma / structural injury")
    if "infection_risk" in flags: concern_summary.append("Infection risk / wound contamination")
    if "nutritional" in flags:    concern_summary.append("Nutritional deficiency / cachexia")
    if "pain_distress" in flags:  concern_summary.append("Pain and/or systemic distress")

    return {
        "urgency": urgency,
        "urgencyScore": urgency_score,
        "physicalObservations": physical_obs,
        "behavioralObservations": behavioral_obs,
        "nlpObservations": nlp_obs,
        "nlpMatched": matched,
        "concernFlags": list(flags),
        "concernSummary": concern_summary,
        "actions": build_actions(urgency, flags),
        "disclaimer": "NOT a veterinary diagnosis. Consult a licensed veterinarian.",
    }

@app.get("/health")
def health():
    return {"status": "ok", "version": "0.2.0"}
PYEOF

echo "✅ Created backend/app.py"

# 3. Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
pip install fastapi uvicorn --quiet
echo "✅ Python deps installed"

# 4. Install frontend dependencies (in case not done yet)
echo ""
echo "📦 Installing frontend dependencies..."
npm install --silent
echo "✅ Frontend deps installed"

echo ""
echo "🎉 Setup complete! Now run these two commands in separate terminals:"
echo ""
echo "  Terminal 1 (frontend):  npm run dev"
echo "  Terminal 2 (backend):   cd backend && uvicorn app:app --reload"
echo ""
echo "Then open http://localhost:5173 in your browser."
