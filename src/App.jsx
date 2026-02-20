import { useState, useRef, useCallback, useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";

// ============================================================
// ANALYSIS ENGINE
// ============================================================

const BEHAVIOR_PHRASES = {
  limping: "Observed locomotion asymmetry consistent with limb pain or structural injury.",
  lethargic: "Subject displays marked reduction in activity and responsiveness; possible systemic illness or severe pain.",
  aggressive: "Defensive aggression noted; may indicate pain-induced reactivity or neurological involvement.",
  avoids_contact: "Contact avoidance behavior observed; consistent with fear response, pain sensitization, or prior trauma.",
  excessive_licking: "Repetitive licking behavior noted at unspecified site; indicative of localized irritation, wound, or anxiety.",
};
const VISUAL_PHRASES = {
  body_thin: "Body condition score assessed as below-normal; visible prominence of ribs and/or spine suggesting suboptimal nutritional status.",
  body_severely_thin: "Severe cachexia observed; marked muscle wasting, prominent bony prominences, and critically low body condition score.",
  open_wound: "Visible integumentary breach observed. Open wound presents infection risk and requires prompt evaluation.",
  infection_risk: "Signs consistent with infection risk: erythema, discharge, or tissue breakdown observed at wound site.",
  abnormal_posture: "Postural abnormality detected; guarded stance or spinal deviation may indicate musculoskeletal or neurological compromise.",
  limb_asymmetry: "Limb asymmetry or unequal weight distribution observed; consistent with fracture, dislocation, or soft tissue injury.",
};
const WOUND_LOCATION_PHRASES = {
  head:"Cranial or facial region.",neck:"Cervical region.",torso:"Thoracic or abdominal region.",
  forelimb:"Forelimb; possible impact on gait and limb function.",hindlimb:"Hindlimb; gait compromise likely.",tail:"Caudal region.",
};
const NLP_SYMPTOMS = {
  critical:["heavy bleeding","unconscious","seizure","hit by car","cannot walk","convulsing"],
  high:["vomiting","not eating","diarrhea","open sore","discharge","swollen","crying in pain"],
  medium:["scratching","coughing","sneezing","labored breathing","itching"],
  low:["thirsty","hungry","friendly","curious","alert"],
};
function runNLP(description) {
  if (!description?.trim()) return { matched:[], scoreBoost:0, nlpObservations:[] };
  const lower = description.toLowerCase(), matched=[], nlpObservations=[];
  let scoreBoost=0;
  const scoreMap={critical:3,high:2,medium:1,low:0};
  for (const [level,phrases] of Object.entries(NLP_SYMPTOMS))
    for (const phrase of phrases)
      if (lower.includes(phrase)) { matched.push(phrase); scoreBoost+=scoreMap[level]; nlpObservations.push(`Free-text NLP detected "${phrase}" — classified as ${level}-priority indicator.`); }
  return {matched,scoreBoost,nlpObservations};
}
function analyzeSignals(vs,bs,description="") {
  const flags=new Set(), phys=[];
  let score=0;
  if(vs.bodyCondition==="thin"){phys.push(VISUAL_PHRASES.body_thin);flags.add("nutritional");score+=1;}
  if(vs.bodyCondition==="severely_thin"){phys.push(VISUAL_PHRASES.body_severely_thin);flags.add("nutritional");score+=3;}
  if(vs.openWound){phys.push(VISUAL_PHRASES.open_wound);flags.add("trauma");score+=2;if(vs.woundLocation&&WOUND_LOCATION_PHRASES[vs.woundLocation])phys.push("Wound location: "+WOUND_LOCATION_PHRASES[vs.woundLocation]);}
  if(vs.infectionRisk){phys.push(VISUAL_PHRASES.infection_risk);flags.add("infection_risk");score+=2;}
  if(vs.abnormalPosture){phys.push(VISUAL_PHRASES.abnormal_posture);flags.add("pain_distress");score+=1;}
  if(vs.limbAsymmetry){phys.push(VISUAL_PHRASES.limb_asymmetry);flags.add("trauma");score+=2;}
  const beh=[];
  if(bs.limping){beh.push(BEHAVIOR_PHRASES.limping);flags.add("trauma");flags.add("pain_distress");score+=2;}
  if(bs.lethargic){beh.push(BEHAVIOR_PHRASES.lethargic);flags.add("pain_distress");score+=2;}
  if(bs.aggressive){beh.push(BEHAVIOR_PHRASES.aggressive);flags.add("pain_distress");score+=1;}
  if(bs.avoids_contact){beh.push(BEHAVIOR_PHRASES.avoids_contact);score+=1;}
  if(bs.excessive_licking){beh.push(BEHAVIOR_PHRASES.excessive_licking);flags.add("infection_risk");score+=1;}
  const {scoreBoost,nlpObservations}=runNLP(description);
  score+=scoreBoost;
  const urgency=score>=4?"HIGH":score>=2?"MEDIUM":"LOW";
  const cs=[];
  if(flags.has("trauma"))cs.push("Physical trauma / structural injury");
  if(flags.has("infection_risk"))cs.push("Infection risk / wound contamination");
  if(flags.has("nutritional"))cs.push("Nutritional deficiency / cachexia");
  if(flags.has("pain_distress"))cs.push("Pain and/or systemic distress");
  return {physicalObservations:phys,behavioralObservations:beh,nlpObservations,concernFlags:[...flags],concernSummary:cs,urgency,urgencyScore:score,actions:buildActions(urgency,flags)};
}
function buildActions(urgency,flags) {
  const a=[];
  if(urgency==="HIGH"){a.push("Immediate veterinary assessment required. Do not delay triage.");a.push("Isolate animal and minimize handling stress.");a.push("Contact: Societatea Zoologica din Moldova (+373 22 28 34 56) or Clinica Veterinara Vet-Pro Chisinau (+373 22 940 940).");}
  if(urgency==="MEDIUM"){a.push("Schedule veterinary evaluation within 24-48 hours.");a.push("Monitor for deterioration; isolate if reactive.");a.push("Contact: Adapostul pentru Animale Chisinau (+373 22 49 96 82) or local vet in Cricova.");}
  if(urgency==="LOW"){a.push("Routine intake evaluation recommended.");a.push("Monitor for changes in condition or behavior.");a.push("Contact: Animal Rescue Chisinau volunteers or Cricova Community Vet Outreach.");}
  if(flags.has("infection_risk"))a.push("Wound should be cleaned and assessed for debridement or antibiotic intervention.");
  if(flags.has("nutritional"))a.push("Initiate gradual refeeding protocol; avoid refeeding syndrome.");
  if(flags.has("trauma"))a.push("Radiographic imaging recommended to assess for fractures or internal injuries.");
  a.push("Document all findings with timestamped photos for shelter records.");
  return a;
}
async function extractVisualSignalsFromImage(base64Image,mimeType) {
  const prompt=`You are a veterinary triage AI analyzing a stray animal photo for StraySense. NOT a diagnosis tool.
Return ONLY valid JSON (no markdown):
{"bodyCondition":"normal"|"thin"|"severely_thin","openWound":boolean,"woundLocation":"head"|"neck"|"torso"|"forelimb"|"hindlimb"|"tail"|null,"infectionRisk":boolean,"abnormalPosture":boolean,"limbAsymmetry":boolean,"confidence":"low"|"medium"|"high","imageQualityNote":"string"}
Be conservative. Default false/normal if unclear.`;
  const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mimeType,data:base64Image}},{type:"text",text:prompt}]}]})});
  const data=await response.json();
  const text=data.content?.map(b=>b.text||"").join("")||"";
  try{return JSON.parse(text.replace(/```json|```/g,"").trim());}catch{return null;}
}

// ============================================================
// HOME CSS — dark cinematic, real photo background
// ============================================================
const HOME_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,700;0,900;1,300;1,700&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #fff; }

  /* NAV */
  .hn { position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 20px 48px; display: flex; align-items: center; justify-content: space-between; background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%); }
  .hn-logo { display: flex; align-items: center; gap: 10px; font-family: 'Fraunces', serif; font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
  .hn-dot { width: 8px; height: 8px; background: #f97316; border-radius: 50%; }
  .hn-links { display: flex; align-items: center; gap: 28px; }
  .hn-link { color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 400; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: color .2s; }
  .hn-link:hover { color: #fff; }
  .hn-cta { background: #f97316; color: #fff; border: none; padding: 10px 22px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all .2s; letter-spacing: 0.2px; }
  .hn-cta:hover { background: #ea6c0a; transform: translateY(-1px); }

  /* HERO */
  .hh { position: relative; height: 100vh; min-height: 600px; display: flex; align-items: center; overflow: hidden; }
  .hh-bg { position: absolute; inset: 0; background-image: url('https://images.pexels.com/photos/1170986/pexels-photo-1170986.jpeg?auto=compress&cs=tinysrgb&w=1600'); background-size: cover; background-position: center 30%; animation: slowzoom 20s ease-in-out infinite alternate; }
  @keyframes slowzoom { from { transform: scale(1); } to { transform: scale(1.06); } }
  .hh-overlay { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.2) 100%); }
  .hh-grain { position: absolute; inset: 0; opacity: 0.04; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E"); background-size: 200px; }
  .hh-content { position: relative; z-index: 2; max-width: 1100px; margin: 0 auto; padding: 0 48px; }
  .hh-tag { display: inline-flex; align-items: center; gap: 8px; background: rgba(249,115,22,0.15); border: 1px solid rgba(249,115,22,0.4); color: #fb923c; padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; }
  .hh-tag-dot { width: 5px; height: 5px; background: #f97316; border-radius: 50%; animation: blink 2s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .hh-title { font-family: 'Fraunces', serif; font-size: 76px; font-weight: 900; line-height: 0.95; letter-spacing: -3px; color: #fff; margin-bottom: 24px; }
  .hh-title em { font-style: italic; color: #fb923c; }
  .hh-sub { font-size: 18px; color: rgba(255,255,255,0.65); line-height: 1.7; max-width: 520px; margin-bottom: 40px; font-weight: 300; }
  .hh-btns { display: flex; gap: 14px; flex-wrap: wrap; }
  .hh-btn-p { display: flex; align-items: center; gap: 9px; background: #f97316; color: #fff; border: none; padding: 16px 32px; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all .25s; letter-spacing: 0.2px; }
  .hh-btn-p:hover { background: #ea6c0a; transform: translateY(-2px); box-shadow: 0 8px 28px rgba(249,115,22,0.35); }
  .hh-btn-s { display: flex; align-items: center; gap: 9px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); border: 1px solid rgba(255,255,255,0.2); padding: 16px 32px; border-radius: 6px; font-size: 15px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all .25s; backdrop-filter: blur(4px); }
  .hh-btn-s:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.4); }
  .hh-scroll { position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; color: rgba(255,255,255,0.4); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; animation: bounce 2.5s ease-in-out infinite; }
  @keyframes bounce { 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(6px)} }
  .hh-scroll-line { width: 1px; height: 32px; background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.3)); }

  /* HOW IT WORKS */
  .hiw { background: #0f0f0f; padding: 100px 48px; }
  .hiw-inner { max-width: 1100px; margin: 0 auto; }
  .sec-eyebrow { font-size: 11px; font-weight: 600; color: #f97316; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 16px; }
  .sec-title { font-family: 'Fraunces', serif; font-size: 52px; font-weight: 700; letter-spacing: -2px; color: #fff; margin-bottom: 64px; line-height: 1.05; }
  .hiw-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; background: #1a1a1a; border: 1px solid #1a1a1a; border-radius: 12px; overflow: hidden; }
  .hiw-card { background: #0f0f0f; padding: 40px 32px; transition: background .2s; }
  .hiw-card:hover { background: #141414; }
  .hiw-n { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 900; color: #1e1e1e; line-height: 1; margin-bottom: 20px; }
  .hiw-icon { font-size: 28px; margin-bottom: 16px; }
  .hiw-t { font-size: 17px; font-weight: 600; color: #fff; margin-bottom: 10px; }
  .hiw-d { font-size: 14px; color: #666; line-height: 1.7; font-weight: 300; }

  /* PHOTO STRIP */
  .strip { height: 420px; position: relative; overflow: hidden; }
  .strip-bg { position: absolute; inset: 0; background-image: url('https://images.pexels.com/photos/20787/pexels-photo.jpg?auto=compress&cs=tinysrgb&w=1600'); background-size: cover; background-position: center; background-attachment: fixed; }
  .strip-overlay { position: absolute; inset: 0; background: linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.6) 100%); }
  .strip-content { position: relative; z-index: 2; height: 100%; max-width: 1100px; margin: 0 auto; padding: 0 48px; display: flex; align-items: center; }
  .strip-quote { font-family: 'Fraunces', serif; font-size: 38px; font-weight: 300; font-style: italic; color: #fff; line-height: 1.3; max-width: 580px; letter-spacing: -0.5px; }
  .strip-quote span { color: #fb923c; font-weight: 700; font-style: normal; }

  /* CTA */
  .cta { background: #0a0a0a; padding: 100px 48px; text-align: center; border-top: 1px solid #141414; }
  .cta-inner { max-width: 600px; margin: 0 auto; }
  .cta-title { font-family: 'Fraunces', serif; font-size: 52px; font-weight: 700; letter-spacing: -2px; color: #fff; margin-bottom: 16px; }
  .cta-sub { font-size: 16px; color: #555; margin-bottom: 36px; font-weight: 300; }

  /* FOOTER */
  .hfoot { background: #050505; border-top: 1px solid #111; padding: 28px 48px; display: flex; align-items: center; justify-content: space-between; }
  .hfoot-logo { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 700; color: #333; }
  .hfoot-txt { font-size: 12px; color: #333; }

  /* DISC */
  .disc-bar { background: rgba(249,115,22,0.08); border-bottom: 1px solid rgba(249,115,22,0.2); padding: 9px 48px; text-align: center; font-size: 12px; color: rgba(249,115,22,0.7); font-weight: 400; letter-spacing: 0.3px; }

  @media(max-width:768px){
    .hn{padding:16px 20px}
    .hh-content{padding:0 20px}
    .hh-title{font-size:44px;letter-spacing:-2px}
    .hiw{padding:60px 20px}
    .hiw-grid{grid-template-columns:1fr}
    .strip{height:300px}
    .strip-content{padding:0 20px}
    .strip-quote{font-size:26px}
    .cta{padding:60px 20px}
    .cta-title{font-size:36px}
    .hfoot{flex-direction:column;gap:8px;text-align:center;padding:20px}
    .disc-bar{padding:9px 20px}
  }
`;

// ============================================================
// TRIAGE CSS — centered, refined, dark-accent
// ============================================================
const TRIAGE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;0,700;1,300&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f7f6f3; color: #1a1a1a; font-family: 'DM Sans', sans-serif; min-height: 100vh; }

  .t-shell { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 0 20px 80px; }

  /* TOP BAR */
  .t-topbar { width: 100%; max-width: 640px; display: flex; align-items: center; justify-content: space-between; padding: 24px 0 20px; }
  .t-back { display: flex; align-items: center; gap: 6px; background: none; border: 1.5px solid #ddd; color: #555; padding: 8px 16px; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .2s; }
  .t-back:hover { border-color: #f97316; color: #f97316; }
  .t-badge { background: #fff0e6; color: #f97316; border: 1px solid #fcd3a8; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; padding: 4px 10px; border-radius: 4px; letter-spacing: .5px; }

  /* HEADER */
  .t-hdr { width: 100%; max-width: 640px; text-align: center; margin-bottom: 32px; }
  .t-hdr-logo { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 8px; }
  .t-hdr-icon { width: 42px; height: 42px; background: #1a1a1a; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
  .t-hdr-name { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; }
  .t-hdr-name span { color: #f97316; }
  .t-hdr-sub { font-size: 13px; color: #999; font-weight: 300; }

  /* PROGRESS */
  .t-prog { width: 100%; max-width: 640px; margin-bottom: 28px; }
  .t-prog-track { height: 3px; background: #e8e5e0; border-radius: 2px; margin-bottom: 12px; }
  .t-prog-fill { height: 100%; background: #f97316; border-radius: 2px; transition: width .4s cubic-bezier(.4,0,.2,1); }
  .t-prog-labels { display: flex; justify-content: space-between; }
  .t-prog-step { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: #bbb; transition: color .2s; font-family: 'DM Sans', sans-serif; }
  .t-prog-step.active { color: #f97316; }
  .t-prog-step.done { color: #16a34a; }
  .t-prog-dot { width: 6px; height: 6px; border-radius: 50%; background: #ddd; transition: background .2s; }
  .t-prog-step.active .t-prog-dot { background: #f97316; }
  .t-prog-step.done .t-prog-dot { background: #16a34a; }

  /* CARDS */
  .t-card { width: 100%; max-width: 640px; background: #fff; border: 1px solid #ebe8e3; border-radius: 12px; padding: 28px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03); animation: fadeUp .25s ease both; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  .step-slide { animation: slideIn .28s cubic-bezier(.4,0,.2,1) both; }
  @keyframes slideIn { from{opacity:0;transform:translateX(14px)} to{opacity:1;transform:translateX(0)} }
  .t-card-hdr { display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }
  .t-card-ico { width: 32px; height: 32px; border-radius: 8px; background: #fff0e6; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
  .t-card-ttl { font-size: 15px; font-weight: 600; color: #1a1a1a; }
  .t-card-sttl { font-size: 12px; color: #aaa; margin-top: 1px; }

  /* DROPZONE */
  .t-dz { border: 2px dashed #ddd; border-radius: 8px; padding: 48px 20px; text-align: center; cursor: pointer; transition: all .2s; position: relative; background: #fafaf8; }
  .t-dz:hover, .t-dz.over { border-color: #f97316; background: #fff8f3; }
  .t-dz input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .t-dz-ico { font-size: 32px; margin-bottom: 10px; }
  .t-dz-txt { font-size: 14px; color: #555; }
  .t-dz-txt strong { color: #f97316; }
  .t-dz-hint { font-size: 12px; color: #bbb; margin-top: 5px; }
  .t-prev-wrap { position: relative; display: inline-block; max-width: 100%; }
  .t-prev-img { display: block; max-width: 100%; max-height: 260px; border-radius: 8px; border: 1px solid #ebe8e3; }
  .t-prev-rm { position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.92); border: none; border-radius: 5px; padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; color: #555; }

  /* BUTTONS */
  .t-btn { width: 100%; max-width: 640px; padding: 14px 20px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 8px; letter-spacing: 0.2px; }
  .t-btn:hover:not(:disabled) { background: #f97316; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(249,115,22,0.25); }
  .t-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }
  .t-btn-sec { background: #fff; color: #555; border: 1.5px solid #ddd; }
  .t-btn-sec:hover:not(:disabled) { background: #fafaf8; border-color: #ccc; box-shadow: none; transform: none; }
  .t-btn-row { width: 100%; max-width: 640px; display: flex; gap: 10px; margin-top: 20px; }
  .t-btn-row .t-btn { flex: 1; }

  /* STATUS */
  .t-st { margin-top: 10px; padding: 11px 14px; border-radius: 7px; font-size: 13px; display: flex; align-items: flex-start; gap: 9px; line-height: 1.5; }
  .t-st.ok { background: #f0fdf4; border: 1px solid #86efac; color: #16a34a; }
  .t-st.err { background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626; }
  .t-st.loading { background: #fff8f3; border: 1px solid #fcd3a8; color: #f97316; }
  .t-spin { width: 13px; height: 13px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; margin-top: 1px; }
  @keyframes spin { to{transform:rotate(360deg)} }

  /* FIELDS */
  .t-fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media(max-width:500px){.t-fgrid{grid-template-columns:1fr}}
  .t-fg { display: flex; flex-direction: column; gap: 5px; }
  .t-lbl { font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: .6px; }
  .t-sel, .t-inp, .t-txt { background: #fafaf8; border: 1.5px solid #e5e2dd; color: #1a1a1a; padding: 9px 11px; border-radius: 7px; font-size: 13.5px; font-family: 'DM Sans', sans-serif; width: 100%; outline: none; transition: border-color .2s; appearance: none; }
  .t-sel { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23aaa' d='M6 8L0 0h12z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 11px center; padding-right: 30px; }
  .t-sel:focus,.t-inp:focus,.t-txt:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,0.08); }
  .t-sel:disabled { opacity: .35; cursor: not-allowed; }
  .t-txt { resize: vertical; min-height: 90px; line-height: 1.5; }
  .t-hint { font-size: 11px; color: #bbb; margin-top: 3px; }

  /* TOGGLES */
  .t-tgl-list { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; }
  .t-tgl-row { display: flex; align-items: center; justify-content: space-between; padding: 11px 10px; border-radius: 7px; cursor: pointer; transition: background .15s; user-select: none; }
  .t-tgl-row:hover { background: #fafaf8; }
  .t-tgl-lbl { display: flex; align-items: center; gap: 9px; font-size: 13.5px; color: #444; }
  .t-tgl-sw { width: 36px; height: 20px; background: #ddd; border-radius: 10px; position: relative; transition: background .2s; flex-shrink: 0; }
  .t-tgl-sw.on { background: #f97316; }
  .t-tgl-sw::after { content: ''; position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
  .t-tgl-sw.on::after { transform: translateX(16px); }

  /* QUIZ GRID */
  .t-qgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media(max-width:500px){.t-qgrid{grid-template-columns:1fr}}
  .t-qi { display: flex; align-items: center; gap: 10px; padding: 12px 13px; border: 1.5px solid #e5e2dd; border-radius: 7px; cursor: pointer; transition: all .15s; user-select: none; background: #fff; }
  .t-qi:hover { border-color: #f97316; background: #fff8f3; }
  .t-qi.chk { border-color: #f97316; background: #fff8f3; }
  .t-cb { width: 16px; height: 16px; border: 2px solid #ddd; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all .15s; }
  .t-qi.chk .t-cb { background: #f97316; border-color: #f97316; }
  .t-ck { color: #fff; font-size: 9px; font-weight: 700; }
  .t-qlbl { font-size: 13px; font-weight: 500; color: #444; }
  .t-qi.chk .t-qlbl { color: #f97316; }

  /* AUTOTAG */
  .t-autotag { display: inline-flex; align-items: center; gap: 5px; background: #f0fdf4; border: 1px solid #86efac; color: #16a34a; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 20px; margin-bottom: 14px; font-family: 'JetBrains Mono', monospace; }

  /* REPORT */
  .t-rpt { width: 100%; max-width: 640px; animation: fadeUp .3s ease both; margin-top: 28px; }
  .t-rpt-hero { background: #1a1a1a; color: #fff; border-radius: 12px; padding: 28px; margin-bottom: 12px; display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
  .t-rpt-id { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #555; margin-bottom: 5px; letter-spacing: .5px; }
  .t-rpt-name { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; letter-spacing: -.3px; }
  .t-rpt-sp { font-size: 12px; color: #666; margin-top: 3px; }
  .t-rpt-ts { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #555; margin-top: 6px; }
  .t-upill { display: flex; flex-direction: column; align-items: center; padding: 13px 20px; border-radius: 8px; min-width: 90px; }
  .t-upill.LOW { background: #f0fdf4; border: 1.5px solid #86efac; }
  .t-upill.MEDIUM { background: #fffbeb; border: 1.5px solid #fcd34d; }
  .t-upill.HIGH { background: #fef2f2; border: 1.5px solid #fca5a5; }
  .t-ulbl { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; opacity: .6; }
  .t-uval { font-size: 16px; font-weight: 700; margin-top: 3px; font-family: 'JetBrains Mono', monospace; letter-spacing: 1px; }
  .t-upill.LOW .t-ulbl,.t-upill.LOW .t-uval{color:#16a34a}
  .t-upill.MEDIUM .t-ulbl,.t-upill.MEDIUM .t-uval{color:#d97706}
  .t-upill.HIGH .t-ulbl,.t-upill.HIGH .t-uval{color:#dc2626}
  .t-rsec { background: #fff; border: 1px solid #ebe8e3; border-radius: 10px; overflow: hidden; margin-bottom: 10px; }
  .t-rsec-hdr { padding: 13px 20px; border-bottom: 1px solid #ebe8e3; background: #fafaf8; display: flex; align-items: center; gap: 8px; }
  .t-rsec-ico { font-size: 13px; }
  .t-rsec-ttl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .8px; color: #666; }
  .t-rsec-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
  .t-obs { font-size: 13px; color: #444; line-height: 1.65; padding: 9px 12px; background: #fafaf8; border-radius: 6px; border-left: 3px solid #e5e2dd; }
  .t-obs.nlp { border-left-color: #f97316; background: #fff8f3; }
  .t-nobs { font-size: 13px; color: #bbb; font-style: italic; }
  .t-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .t-chip { font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 20px; font-family: 'JetBrains Mono', monospace; }
  .t-chip.trauma{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
  .t-chip.infection_risk{background:#fffbeb;color:#d97706;border:1px solid #fde68a}
  .t-chip.nutritional{background:#faf5ff;color:#7c3aed;border:1px solid #e9d5ff}
  .t-chip.pain_distress{background:#fff7ed;color:#ea580c;border:1px solid #fed7aa}
  .t-act { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; background: #fafaf8; border-radius: 6px; font-size: 13px; color: #444; line-height: 1.6; }
  .t-act-n { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: #f97316; background: #fff0e6; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; margin-top: 2px; }
  .t-disc { background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px; padding: 12px 16px; font-size: 12px; color: #92400e; line-height: 1.6; display: flex; gap: 9px; margin-top: 10px; }
  .t-div { height: 1px; background: #ebe8e3; margin: 7px 0; }
  .t-mt12{margin-top:12px}
`;

// ============================================================
// HOMEPAGE
// ============================================================
function HomePage() {
  const navigate = useNavigate();

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = HOME_CSS;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0a0a0a", minHeight: "100vh" }}>
      <div className="disc-bar">
        StraySense is a triage tool only — not a veterinary diagnosis. Always consult a licensed vet.
      </div>

      {/* NAV */}
      <nav className="hn">
        <div className="hn-logo"><div className="hn-dot" />StreetStray</div>
        <div className="hn-links">
          <button className="hn-link" onClick={() => document.getElementById("hiw")?.scrollIntoView({ behavior: "smooth" })}>How It Works</button>
          <button className="hn-link" onClick={() => document.getElementById("strip")?.scrollIntoView({ behavior: "smooth" })}>About</button>
          <button className="hn-cta" onClick={() => navigate("/triage")}>Try Now</button>
        </div>
      </nav>

      {/* HERO — real photo background */}
      <section className="hh">
        <div className="hh-bg" />
        <div className="hh-overlay" />
        <div className="hh-grain" />
        <div className="hh-content">
          <div className="hh-tag"><div className="hh-tag-dot" />AI Triage · NLP · Photogrammetry</div>
          <h1 className="hh-title">Every stray<br />deserves a<br /><em>fighting chance.</em></h1>
          <p className="hh-sub">Upload a photo of any stray animal. Our AI analyzes health signals in seconds and tells you exactly how urgently they need help.</p>
          <div className="hh-btns">
            <button className="hh-btn-p" onClick={() => navigate("/triage")}>📷 Scan an Animal</button>
            <button className="hh-btn-s" onClick={() => document.getElementById("hiw")?.scrollIntoView({ behavior: "smooth" })}>Learn More</button>
          </div>
        </div>
        <div className="hh-scroll">
          <div className="hh-scroll-line" />
          scroll
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="hiw" id="hiw">
        <div className="hiw-inner">
          <div className="sec-eyebrow">How It Works</div>
          <div className="sec-title">Three steps.<br />One life saved.</div>
          <div className="hiw-grid">
            {[
              { n:"01", icon:"📷", t:"Upload a Photo", d:"Take or upload a photo of the animal. Our AI vision model extracts health signals — body condition, wounds, posture — automatically." },
              { n:"02", icon:"📋", t:"Answer a Few Questions", d:"Select observed behaviors like limping or lethargy. Add a free-text description and NLP detects extra signals automatically." },
              { n:"03", icon:"📄", t:"Get a Triage Report", d:"Receive a structured medical-style report with LOW / MEDIUM / HIGH urgency, concern flags, and Moldova-specific rescue contacts." },
            ].map(s => (
              <div key={s.n} className="hiw-card">
                <div className="hiw-n">{s.n}</div>
                <div className="hiw-icon">{s.icon}</div>
                <div className="hiw-t">{s.t}</div>
                <div className="hiw-d">{s.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PHOTO STRIP — real stray dog photo */}
      <section className="strip" id="strip">
        <div className="strip-bg" />
        <div className="strip-overlay" />
        <div className="strip-content">
          <div className="strip-quote">
            "Built at a hackathon to help <span>rescuers in Moldova</span> and beyond make faster, better decisions for strays in need."
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="cta-inner">
          <div className="cta-title">Ready to help?</div>
          <p className="cta-sub">It takes less than 2 minutes. No account needed.</p>
          <button className="hh-btn-p" style={{ margin: "0 auto" }} onClick={() => navigate("/triage")}>📷 Scan an Animal Now</button>
        </div>
      </section>

      <footer className="hfoot">
        <div className="hfoot-logo">StreetStray</div>
        <div className="hfoot-txt">Not a medical diagnosis · Hackathon project · 2025</div>
      </footer>
    </div>
  );
}

// ============================================================
// TRIAGE PAGE — centered, warm, refined
// ============================================================
function TriagePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [imgPrev, setImgPrev] = useState(null);
  const [imgB64, setImgB64] = useState(null);
  const [imgMime, setImgMime] = useState(null);
  const [drag, setDrag] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiNote, setAiNote] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);
  const [vis, setVis] = useState({ bodyCondition:"normal", openWound:false, woundLocation:null, infectionRisk:false, abnormalPosture:false, limbAsymmetry:false });
  const [beh, setBeh] = useState({ limping:false, lethargic:false, aggressive:false, avoids_contact:false, excessive_licking:false });
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("dog");
  const [description, setDescription] = useState("");
  const [report, setReport] = useState(null);
  const [ts, setTs] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = TRIAGE_CSS;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  const loadFile = useCallback((file) => {
    if (!file?.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = e => { setImgPrev(e.target.result); setImgB64(e.target.result.split(",")[1]); setImgMime(file.type); setAiStatus(null); setAutoFilled(false); setReport(null); };
    r.readAsDataURL(file);
  }, []);

  const runAI = async () => {
    if (!imgB64) return;
    setAnalyzing(true); setAiStatus(null);
    try {
      const res = await extractVisualSignalsFromImage(imgB64, imgMime);
      if (res) { setVis({ bodyCondition:res.bodyCondition||"normal", openWound:!!res.openWound, woundLocation:res.woundLocation||null, infectionRisk:!!res.infectionRisk, abnormalPosture:!!res.abnormalPosture, limbAsymmetry:!!res.limbAsymmetry }); setAiStatus("ok"); setAiNote(res.imageQualityNote||"Signals extracted."); setAutoFilled(true); }
      else { setAiStatus("err"); setAiNote("Could not parse response. Use manual toggles."); }
    } catch { setAiStatus("err"); setAiNote("API error. Use manual toggles."); }
    setAnalyzing(false);
  };

  const genReport = () => {
    const r = analyzeSignals(vis, beh, description);
    setTs(new Date().toISOString().replace("T"," ").slice(0,19)+" UTC");
    setReport({ ...r, animalName:name||"Unknown", animalSpecies:species });
    setTimeout(() => document.querySelector(".t-rpt")?.scrollIntoView({ behavior:"smooth" }), 100);
  };

  const STEPS = [{ n:1, label:"Photo" }, { n:2, label:"Signals" }, { n:3, label:"Report" }];
  const behaviors = [{ k:"limping", l:"Limping / Lameness", e:"🦵" }, { k:"lethargic", l:"Lethargy", e:"😴" }, { k:"aggressive", l:"Aggression", e:"⚠️" }, { k:"avoids_contact", l:"Avoids contact", e:"↩️" }, { k:"excessive_licking", l:"Excessive licking", e:"👅" }];
  const toggles = [{ k:"openWound", l:"Open wound visible", e:"🩹" }, { k:"infectionRisk", l:"Infection signs", e:"🦠" }, { k:"abnormalPosture", l:"Abnormal posture", e:"🐾" }, { k:"limbAsymmetry", l:"Limb asymmetry", e:"📐" }];
  const pct = `${((step-1)/(STEPS.length-1))*100}%`;

  return (
    <div className="t-shell">
      {/* TOP BAR */}
      <div className="t-topbar">
        <button className="t-back" onClick={() => navigate("/")}>← Home</button>
        <div className="t-badge">BETA v0.2</div>
      </div>

      {/* HEADER */}
      <div className="t-hdr">
        <div className="t-hdr-logo">
          <div className="t-hdr-icon">🐾</div>
          <div className="t-hdr-name">Stray<span>Sense</span></div>
        </div>
        <div className="t-hdr-sub">Animal Welfare Triage · Not a medical diagnosis</div>
      </div>

      {/* PROGRESS */}
      <div className="t-prog">
        <div className="t-prog-track"><div className="t-prog-fill" style={{ width: pct }} /></div>
        <div className="t-prog-labels">
          {STEPS.map(s => (
            <div key={s.n} className={`t-prog-step ${step===s.n?"active":step>s.n?"done":""}`}>
              <div className="t-prog-dot" />{s.label}
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="step-slide" style={{ width:"100%", maxWidth:640 }}>
          <div className="t-card">
            <div className="t-card-hdr"><div className="t-card-ico">📷</div><div><div className="t-card-ttl">Photo Upload</div><div className="t-card-sttl">Upload a photo for AI visual signal extraction</div></div></div>
            {!imgPrev ? (
              <div className={`t-dz${drag?" over":""}`} onDrop={e=>{e.preventDefault();setDrag(false);loadFile(e.dataTransfer.files[0]);}} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onClick={()=>fileRef.current?.click()}>
                <input ref={fileRef} type="file" accept="image/*" onChange={e=>loadFile(e.target.files[0])} />
                <div className="t-dz-ico">🖼️</div>
                <div className="t-dz-txt"><strong>Click to upload</strong> or drag & drop</div>
                <div className="t-dz-hint">JPG · PNG · WEBP</div>
              </div>
            ) : (
              <>
                <div className="t-prev-wrap">
                  <img src={imgPrev} alt="Preview" className="t-prev-img" />
                  <button className="t-prev-rm" onClick={()=>{setImgPrev(null);setImgB64(null);setAutoFilled(false);setAiStatus(null);setReport(null);}}>✕ Remove</button>
                </div>
                <div className="t-mt12">
                  <button className="t-btn" onClick={runAI} disabled={analyzing}>
                    {analyzing?<><div className="t-spin"/>Analyzing...</>:<>⚡ Auto-Extract Visual Signals</>}
                  </button>
                </div>
                {analyzing && <div className="t-st loading"><div className="t-spin"/><span>Sending to AI vision model...</span></div>}
                {aiStatus==="ok" && <div className="t-st ok"><span>✓</span><span>{aiNote}</span></div>}
                {aiStatus==="err" && <div className="t-st err"><span>⚠</span><span>{aiNote}</span></div>}
              </>
            )}
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="step-slide" style={{ width:"100%", maxWidth:640 }}>
          <div className="t-card">
            <div className="t-card-hdr"><div className="t-card-ico">🔍</div><div><div className="t-card-ttl">Visual Signal Overrides</div><div className="t-card-sttl">Adjust or manually set detected signals</div></div></div>
            {autoFilled && <div className="t-autotag">✓ AUTO-POPULATED — review & adjust</div>}
            <div className="t-fgrid">
              <div className="t-fg"><div className="t-lbl">Body Condition</div>
                <select className="t-sel" value={vis.bodyCondition} onChange={e=>setVis(v=>({...v,bodyCondition:e.target.value}))}>
                  <option value="normal">Normal</option><option value="thin">Thin</option><option value="severely_thin">Severely Thin</option>
                </select>
              </div>
              <div className="t-fg"><div className="t-lbl">Wound Location</div>
                <select className="t-sel" value={vis.woundLocation||""} onChange={e=>setVis(v=>({...v,woundLocation:e.target.value||null}))} disabled={!vis.openWound}>
                  <option value="">None / N/A</option><option value="head">Head</option><option value="neck">Neck</option><option value="torso">Torso</option><option value="forelimb">Forelimb</option><option value="hindlimb">Hindlimb</option><option value="tail">Tail</option>
                </select>
              </div>
            </div>
            <div className="t-tgl-list">
              {toggles.map(({k,l,e})=>(
                <div key={k} className="t-tgl-row" onClick={()=>setVis(v=>({...v,[k]:!v[k]}))}>
                  <div className="t-tgl-lbl"><span>{e}</span>{l}</div>
                  <div className={`t-tgl-sw${vis[k]?" on":""}`}/>
                </div>
              ))}
            </div>
          </div>
          <div className="t-card">
            <div className="t-card-hdr"><div className="t-card-ico">📋</div><div><div className="t-card-ttl">Behavioral Observations</div><div className="t-card-sttl">Select all observed behaviors</div></div></div>
            <div className="t-qgrid">
              {behaviors.map(({k,l,e})=>(
                <div key={k} className={`t-qi${beh[k]?" chk":""}`} onClick={()=>setBeh(b=>({...b,[k]:!b[k]}))}>
                  <div className="t-cb">{beh[k]&&<span className="t-ck">✓</span>}</div>
                  <span className="t-qlbl">{e} {l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="step-slide" style={{ width:"100%", maxWidth:640 }}>
          <div className="t-card">
            <div className="t-card-hdr"><div className="t-card-ico">🏷️</div><div><div className="t-card-ttl">Animal Profile</div><div className="t-card-sttl">Optional identification for the report</div></div></div>
            <div className="t-fgrid">
              <div className="t-fg"><div className="t-lbl">Identifier</div><input className="t-inp" placeholder="e.g. Stray #42" value={name} onChange={e=>setName(e.target.value)}/></div>
              <div className="t-fg"><div className="t-lbl">Species</div>
                <select className="t-sel" value={species} onChange={e=>setSpecies(e.target.value)}>
                  <option value="dog">Dog</option><option value="cat">Cat</option><option value="rabbit">Rabbit</option><option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>
          <div className="t-card">
            <div className="t-card-hdr"><div className="t-card-ico">💬</div><div><div className="t-card-ttl">Free-Text Description</div><div className="t-card-sttl">NLP extracts additional signals from your description</div></div></div>
            <div className="t-fg">
              <div className="t-lbl">Symptoms / context</div>
              <textarea className="t-txt" placeholder='e.g. "heavy bleeding near hindlimb, cannot walk..."' value={description} onChange={e=>setDescription(e.target.value)}/>
              <div className="t-hint">Keywords like "heavy bleeding", "seizure", "vomiting" affect urgency scoring automatically.</div>
            </div>
          </div>
          <button className="t-btn" onClick={genReport}>📄 Generate Triage Report</button>
        </div>
      )}

      {/* NAV */}
      <div className="t-btn-row">
        {step>1 && <button className="t-btn t-btn-sec" onClick={()=>{setStep(s=>s-1);setReport(null);}}>← Back</button>}
        {step<3 && <button className="t-btn" onClick={()=>setStep(s=>s+1)}>Next →</button>}
      </div>

      {/* REPORT */}
      {report && (
        <div className="t-rpt">
          <div className="t-rpt-hero">
            <div>
              <div className="t-rpt-id">STRAYSENSE · {Math.random().toString(36).slice(2,8).toUpperCase()}</div>
              <div className="t-rpt-name">{report.animalName}</div>
              <div className="t-rpt-sp">{species.charAt(0).toUpperCase()+species.slice(1)}</div>
              <div className="t-rpt-ts">{ts}</div>
            </div>
            <div className={`t-upill ${report.urgency}`}><div className="t-ulbl">Urgency</div><div className="t-uval">{report.urgency}</div></div>
          </div>
          {[
            {ico:"🔬",ttl:"Physical Condition",items:report.physicalObservations,empty:"No significant physical abnormalities observed."},
            {ico:"🧠",ttl:"Behavioral Observations",items:report.behavioralObservations,empty:"No significant behavioral abnormalities reported."},
          ].map(sec=>(
            <div key={sec.ttl} className="t-rsec">
              <div className="t-rsec-hdr"><span className="t-rsec-ico">{sec.ico}</span><span className="t-rsec-ttl">{sec.ttl}</span></div>
              <div className="t-rsec-body">{sec.items.length>0?sec.items.map((o,i)=><div key={i} className="t-obs">{o}</div>):<div className="t-nobs">{sec.empty}</div>}</div>
            </div>
          ))}
          {report.nlpObservations?.length>0&&(
            <div className="t-rsec">
              <div className="t-rsec-hdr"><span className="t-rsec-ico">💬</span><span className="t-rsec-ttl">NLP — Free-Text Signals</span></div>
              <div className="t-rsec-body">{report.nlpObservations.map((o,i)=><div key={i} className="t-obs nlp">{o}</div>)}</div>
            </div>
          )}
          <div className="t-rsec">
            <div className="t-rsec-hdr"><span className="t-rsec-ico">⚑</span><span className="t-rsec-ttl">Concern Flags</span></div>
            <div className="t-rsec-body">
              {report.concernSummary.length>0?(<><div className="t-chips">{report.concernFlags.map(f=><span key={f} className={`t-chip ${f}`}>{f.replace("_"," ")}</span>)}</div><div className="t-div"/>{report.concernSummary.map((s,i)=><div key={i} className="t-obs">{s}</div>)}</>):<div className="t-nobs">No significant concerns flagged.</div>}
            </div>
          </div>
          <div className="t-rsec">
            <div className="t-rsec-hdr"><span className="t-rsec-ico">✅</span><span className="t-rsec-ttl">Recommended Actions</span></div>
            <div className="t-rsec-body">{report.actions.map((a,i)=><div key={i} className="t-act"><span className="t-act-n">{String(i+1).padStart(2,"0")}</span><span>{a}</span></div>)}</div>
          </div>
          <div className="t-disc"><span>⚠️</span><span><strong>Disclaimer:</strong> NOT a veterinary diagnosis. All findings must be confirmed by a licensed veterinarian before any medical intervention.</span></div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ROOT
// ============================================================
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/triage" element={<TriagePage />} />
      </Routes>
    </BrowserRouter>
  );
}
