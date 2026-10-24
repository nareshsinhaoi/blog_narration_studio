"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  widget: $("widget"), audio: $("audio"), voiceBar: $("voiceBar"),
  boxPlayBtn: $("boxPlayBtn"), boxIcon: $("boxIcon"),
  backBtn: $("backBtn"), playBtn: $("playBtn"), fwdBtn: $("fwdBtn"),
  seekBar: $("seekBar"), timeLabel: $("timeLabel"), statusText: $("statusText"),
  genProgress: $("genProgress"), genProgressFill: $("genProgressFill"),
  adSlot: $("adSlot"),
  
  // Speed UI
  speedToggleBtn: $("speedToggleBtn"), speedToggleLabel: $("speedToggleLabel"),
  speedDrawer: $("speedDrawer"), speedSlider: $("speedSlider"), closeSpeedBtn: $("closeSpeedBtn"),
};

const params = new URLSearchParams(location.search);
const SPACER_IMAGE = "/static/spacer.gif";
const DEFAULT_AD_LINK = "http://anywebsite.com";

// NEW: Custom display names for voices
const VOICE_DISPLAY_NAMES = {
  "en-IN-NeerjaExpressiveNeural": "Neerja (Expressive)",
  "en-IN-NeerjaNeural": "Neerja",
  "en-IN-PrabhatNeural": "Prabhat",
  "hi-IN-MadhurNeural": "Madhur",
  "hi-IN-SwaraNeural": "Swara",
  "en-IN-AaravNeural": "Aarav",
  "en-IN-AditiNeural": "Aditi",
  "en-IN-RiyaNeural": "Riya",
  "en-IN-SaanviNeural": "Saanvi",
  
};

const state = {
  config: null,
  voices: [],
  text: params.get("text") || "",
  voiceId: null,
  userVoice: params.get("voice") || null,
  lang: params.get("lang") || "en-IN",   // NEW: default to en-IN
  clientId: params.get("client") || null, // NEW
  jobPoll: null,
  generating: false,
  currentJobId: null,
  rate: 1.0,               
  userInteracted: false,   
  autoPlayed: false,       
  _retried: false,
  adImageAvailable: false,
};

/* ------------------------------ helpers ------------------------------ */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let detail = data.detail || `Request failed (${res.status})`;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join(", ");
    //throw new Error(detail);
    // Create an error object so we can check the status code later
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }
  return data;
}

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

function setStatus(text, isError = false) {
  els.statusText.textContent = text;
  els.statusText.classList.toggle("error", isError);
  
  const waiting = !isError && text === "Waiting for article…";
  els.adSlot.hidden = !(waiting && !state.userInteracted && state.adImageAvailable);
  
  reportHeight();
}

function markInteraction() {
  state.userInteracted = true;
  els.adSlot.hidden = true;
}

function setGenerationUI(on, progress = 0) {
  els.widget.classList.toggle("generating", on);
  els.boxPlayBtn.classList.toggle("loading", on);
  els.genProgress.hidden = !on;
  els.genProgressFill.style.width = `${Math.round(progress * 100)}%`;
}

function postToParent(message) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function reportHeight() {
  postToParent({ type: "vanitts:height", height: document.body.scrollHeight });
}

function setAdImage(imageUrl) {
  const adImg = $("adImg");
  const image = typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
    ? imageUrl
    : SPACER_IMAGE;
  state.adImageAvailable = true;
  adImg.src = image;
}

function setAdLink(linkUrl) {
  const adLink = $("adLink");
  adLink.href = typeof linkUrl === "string" && /^https?:\/\//i.test(linkUrl)
    ? linkUrl
    : DEFAULT_AD_LINK;
  adLink.target = "_blank";
  adLink.rel = "noopener noreferrer";
}

/* ------------------------- Speed Bar Control ------------------------- */

function buildSpeedBar() {
  const barsContainer = els.speedSlider.querySelector(".bars");
  const valuesContainer = els.speedSlider.querySelector(".values");
  barsContainer.innerHTML = "";
  valuesContainer.innerHTML = "";

  const steps = [];
  for (let i = 5; i <= 20; i++) {
    steps.push(i / 10);
  }

  steps.forEach((val, index) => {
    const btn = document.createElement("button");
    btn.className = "bar";
    btn.setAttribute("data-value", val);
    btn.setAttribute("data-index", index);
    btn.innerHTML = `<span class="bar-pipe"></span>`;
    
    if (Math.abs(val - state.rate) < 0.01) btn.classList.add("active");
    
    btn.addEventListener("click", () => {
      markInteraction();
      changeSpeed(val, index);
    });
    barsContainer.appendChild(btn);

    const lbl = document.createElement("span");
    lbl.className = "value";
    lbl.setAttribute("data-index", index);
    lbl.textContent = val.toFixed(1);
    if (val === 0.5 || val === 1.0 || val === 1.5 || val === 2.0) {
      lbl.classList.add("visible");
    }
    valuesContainer.appendChild(lbl);
  });
}

function changeSpeed(newRate, index) {
  state.rate = newRate;
  state.autoPlayed = false; 
  
  els.speedToggleLabel.textContent = `${newRate.toFixed(1)}×`;
  
  els.speedSlider.querySelectorAll(".bar").forEach(b => b.classList.remove("active"));
  els.speedSlider.querySelectorAll(`.bar[data-index="${index}"]`).forEach(b => b.classList.add("active"));
  
  els.speedSlider.querySelectorAll(".value").forEach(v => v.classList.remove("active-label"));
  const nearestLabelIdx = Math.floor(index / 5) * 5;
  const nearestLbl = els.speedSlider.querySelector(`.value[data-index="${nearestLabelIdx}"]`);
  if (nearestLbl) nearestLbl.classList.add("active-label");

  els.speedDrawer.hidden = true;

  if (state.text && state.text.trim()) {
    haltPlayback();
    state._retried = false;
    setStatus("Applying speed…");
    startGeneration();
  }
}

/* ------------------------- voice agent switcher ------------------------- */

// NEW: Refined loadVoices
// async function loadVoices() {
//   if (!state.clientId) {
//     showBlockedUI("Client ID missing. Please contact support.");
//     return;
//   }
//   try {
//     //const voices = await api(`/api/voices?engine=${state.config.widget_engine}&language=en-IN`);
//     // Fetch voices dynamically for the requested language
//     const voices = await api(`/api/voices?engine=${state.config.widget_engine}&language=${state.lang}&client=${state.clientId}`);
//     const seen = new Set();
//     state.voices = voices
//       .filter((v) => v.language === "en-IN" && !seen.has(v.id) && seen.add(v.id))
//       .map((v) => {
//         // Apply custom display names if they exist in our map
//         if (VOICE_DISPLAY_NAMES[v.id]) {
//           v.name = VOICE_DISPLAY_NAMES[v.id];
//         } else if (v.name.endsWith("Neural")) {
//           // Fallback cleanup for other voices: "en-IN-SomeNameNeural" -> "SomeName"
//           v.name = v.name.replace("Neural", "").replace("en-IN-", "");
//         }
//         return v;
//       })
//       .sort((a, b) => (a.gender === b.gender ? a.name.localeCompare(b.name)
//                                              : a.gender === "Female" ? -1 : 1));
//   } catch {
//     state.voices = [];
//   }
//   renderVoiceBar();
// }

async function loadVoices() {
  if (!state.clientId) {
    showBlockedUI("Client ID missing. Please contact support.");
    return false;
  }

  try {
    // This API call will trigger the backend expiry check
    const voices = await api(`/api/voices?engine=${state.config.widget_engine}&language=${state.lang}&client=${encodeURIComponent(state.clientId)}`);
    
    const seen = new Set();
    state.voices = voices
      .filter((v) => !seen.has(v.id) && seen.add(v.id))
      .map((v) => {
        if (VOICE_DISPLAY_NAMES[v.id]) {
          v.name = VOICE_DISPLAY_NAMES[v.id];
        } else if (v.name.endsWith("Neural")) {
          v.name = v.name.replace("Neural", "").replace(`${state.lang}-`, "");
        }
        return v;
      })
      .sort((a, b) => (a.gender === b.gender ? a.name.localeCompare(b.name)
                                             : a.gender === "Female" ? -1 : 1));
    return true;
  } catch (e) {
    // Intercept 403 (Forbidden/Expired) and 401 (Unauthorized) errors
    if (e.status === 403 || e.status === 401) {
      showBlockedUI("Your subscription has expired or is invalid.<br><br><strong>Please contact our support team to restore access.</strong>");
      return false;
    }
    
    // Generic error for other issues
    els.voiceBar.innerHTML = `<span class="ta-status error">Error loading voices</span>`;
    state.voices = [];
    return false;
  }
}

function currentDefaultVoice() {
  if (state.userVoice && state.voices.some((v) => v.id === state.userVoice)) return state.userVoice;
  if (state.voices.some((v) => v.id === state.config.widget_voice)) return state.config.widget_voice;
  return state.voices.length ? state.voices[0].id : state.config.widget_voice;
}

// NEW: Refined renderVoiceBar
function renderVoiceBar() {
  els.voiceBar.innerHTML = "";
  if (!state.voices.length) { els.voiceBar.hidden = true; return; }
  els.voiceBar.hidden = false;
  const activeId = state.voiceId || currentDefaultVoice();
  
  state.voices.forEach((v) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ta-voice" + (v.id === activeId ? " active" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", v.id === activeId ? "true" : "false");
    btn.title = v.id; // Show full ID on hover
    
    // Use symbols instead of (F) / (M)
    const icon = v.gender === "Male" ? "♂" : "♀";
    const cls = v.gender === "Male" ? "m" : "f";
    
    btn.innerHTML = `<span>${v.name}</span><span class="ta-tag-icon ${cls}">${icon}</span>`;
    btn.addEventListener("click", () => selectVoice(v.id));
    els.voiceBar.appendChild(btn);
  });
}

function haltPlayback() {
  try {
    els.audio.pause();
    els.audio.removeAttribute("src");
    els.audio.load();
  } catch { /* ignore */ }
  setPlayIcons(false);
  els.seekBar.value = 0;
  els.timeLabel.textContent = "0:00 / 0:00";
}

function selectVoice(voiceId) {
  if (voiceId === state.voiceId && !state.generating) return;
  markInteraction();

  haltPlayback();
  state.autoPlayed = false; 

  state.userVoice = voiceId;
  state._retried = false;
  renderVoiceBar();
  setStatus("Switching voice agent…");
  startGeneration();
}

/* ---------------------------- generation ---------------------------- */

// async function tryCreateJob(text, voiceId) {
//   return api("/api/tts/jobs", {
//     method: "POST",
//     body: JSON.stringify({
//       text, voice_id: voiceId, engine: state.config.widget_engine, rate: state.rate,
//     }),
//   });
// }

async function tryCreateJob(text, voiceId) {
  return api("/api/tts/jobs", {
    method: "POST",
    body: JSON.stringify({
      text, 
      voice_id: voiceId, 
      engine: state.config.widget_engine, 
      rate: state.rate,
      client: state.clientId,  // MUST BE HERE
      lang: state.lang         // MUST BE HERE
    }),
  });
}

function voiceCandidates() {
  return [...new Set([
    currentDefaultVoice(),
    state.config.widget_voice,
    state.config.default_voice_en,
    "en-IN-NeerjaNeural",
  ])];
}

function pollJob(jobId) {
  return new Promise((resolve, reject) => {
    clearInterval(state.jobPoll);
    state.jobPoll = setInterval(async () => {
      try {
        const job = await api(`/api/tts/jobs/${jobId}`);
        if (job.status === "processing") {
          setGenerationUI(true, Math.max(0.05, job.progress));
          setStatus(`Generating… ${Math.round(job.progress * 100)}%`);
          reportHeight();
        } else if (job.status === "completed") {
          clearInterval(state.jobPoll);
          resolve(job);
        } else if (job.status === "failed" || job.status === "cancelled") {
          clearInterval(state.jobPoll);
          reject(new Error(job.error || "Generation did not complete."));
        }
      } catch (e) {
        clearInterval(state.jobPoll);
        reject(e);
      }
    }, 900);
  });
}

async function startGeneration() {
  const text = state.text;
  if (!text || !text.trim()) { setStatus("Waiting for article…"); return; }
  if (state.generating) return;

  state.generating = true;
  setGenerationUI(true, 0.03);
  setStatus("Generating audio…");
  reportHeight();

  if (state.currentJobId) {
    api(`/api/tts/jobs/${state.currentJobId}`, { method: "DELETE" }).catch(() => {});
    state.currentJobId = null;
  }

  let job = null;
  for (const voiceId of voiceCandidates()) {
    try {
      job = await tryCreateJob(text.trim(), voiceId);
      state.voiceId = voiceId;
      break;
    } catch (e) {
      if (/not available|unavailable|Unknown/i.test(e.message)) continue;
      setStatus(`Error: ${e.message}`, true);
      setGenerationUI(false);
      state.generating = false;
      return;
    }
  }

  if (!job) {
    setStatus("No compatible voice available.", true);
    setGenerationUI(false);
    state.generating = false;
    return;
  }

  renderVoiceBar();

  try {
    const done = await pollJob(job.id);
    state.currentJobId = done.id;
    els.audio.src = done.audio_url;
    setGenerationUI(false);
    const agent = state.voices.find((v) => v.id === state.voiceId);
    setStatus(`Ready · ${agent ? agent.name : state.voiceId}`);

    if (!state.autoPlayed) {
      state.autoPlayed = true;
      try {
        await els.audio.play();
        setStatus("Playing…");
      } catch {
        setStatus("Tap ▶ to play");
      }
    } else {
      setStatus("Tap ▶ to play");
    }
  } catch (e) {
    if (state.voiceId !== "en-IN-NeerjaNeural" && !state._retried) {
      state._retried = true;
      state.generating = false;
      setStatus("Voice unavailable, switching…");
      await startGeneration();
      return;
    }
    setStatus(`Failed: ${e.message}`, true);
    setGenerationUI(false);
  } finally {
    state.generating = false;
  }
}

/* ------------------------------ player ------------------------------ */

function setPlayIcons(playing) {
  const icon = playing ? "❚❚" : "▶";
  els.boxIcon.textContent = icon;
  els.playBtn.textContent = icon;
}

function togglePlay() {
  if (!els.audio.src) return;
  markInteraction(); 
  if (els.audio.paused) {
    els.audio.play().catch(() => setStatus("Playback blocked — tap again.", true));
  } else {
    els.audio.pause();
  }
}

function wirePlayer() {
  els.boxPlayBtn.addEventListener("click", togglePlay);
  els.playBtn.addEventListener("click", togglePlay);
  
  els.backBtn.addEventListener("click", () => {
    markInteraction();
    els.audio.currentTime = Math.max(0, els.audio.currentTime - 10);
  });
  els.fwdBtn.addEventListener("click", () => {
    markInteraction();
    if (Number.isFinite(els.audio.duration)) {
      els.audio.currentTime = Math.min(els.audio.duration, els.audio.currentTime + 10);
    }
  });
  
  els.audio.addEventListener("play", () => { setPlayIcons(true); setStatus("Playing…"); });
  els.audio.addEventListener("pause", () => { setPlayIcons(false); setStatus("Paused"); });
  els.audio.addEventListener("ended", () => {
    setPlayIcons(false);
    els.audio.currentTime = 0;
    setStatus("Finished · tap ▶ to replay");
  });
  
  els.audio.addEventListener("loadedmetadata", updateTime);
  els.audio.addEventListener("timeupdate", () => {
    updateTime();
    if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
      els.seekBar.value = Math.round((els.audio.currentTime / els.audio.duration) * 1000);
    }
  });
  els.seekBar.addEventListener("input", () => {
    markInteraction();
    if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
      els.audio.currentTime = (els.seekBar.value / 1000) * els.audio.duration;
    }
  });

  els.speedToggleBtn.addEventListener("click", () => {
    markInteraction();
    els.speedDrawer.hidden = !els.speedDrawer.hidden;
  });
  els.closeSpeedBtn.addEventListener("click", () => {
    els.speedDrawer.hidden = true;
  });
}

function updateTime() {
  els.timeLabel.textContent = `${fmtTime(els.audio.currentTime)} / ${fmtTime(els.audio.duration)}`;
}

function showBlockedUI(message) {
  // 1. Hide all player controls, speed buttons, and progress bars
  document.querySelector(".ta-top").hidden = true;
  document.querySelector(".ta-bottom").hidden = true;
  els.speedToggleBtn.hidden = true;
  els.speedDrawer.hidden = true;
  setAdImage(SPACER_IMAGE);
  setAdLink(DEFAULT_AD_LINK);
  
  // 2. Clear the voice bar and show the custom message
  els.voiceBar.hidden = false;
  els.voiceBar.innerHTML = `
    <div style="
      width: 100%; 
      padding: 24px 16px; 
      text-align: center; 
      background: #fff5f5; 
      border: 1px solid #fed7d7; 
      border-radius: 8px; 
      color: #c53030;
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <svg style="width: 32px; height: 32px; margin: 0 auto 12px; display: block;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
      <p style="margin: 0; font-size: 14px; line-height: 1.5;">${message}</p>
    </div>
  `;
  
  // 3. Update status and tell parent iframe to resize
  setStatus("Access Restricted", true);
  els.adSlot.hidden = false;
  reportHeight();
}
/* -------------------------------- init -------------------------------- */

async function init_old() {
  wirePlayer();
  buildSpeedBar(); 
  els.speedToggleLabel.textContent = `${state.rate.toFixed(1)}×`;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "vanitts:setText") {
      if (typeof data.text === "string" && data.text.trim()) {
        state.text = data.text;
        if (data.voice) { state.userVoice = data.voice; renderVoiceBar(); }
        state._retried = false;
        state.autoPlayed = false;
        
        markInteraction();
        startGeneration();
      }
    }
  });

  try {
    state.config = await api("/api/config");
  } catch {
    state.config = {
      widget_engine: "edge", widget_voice: "en-IN-NeerjaExpressiveNeural",
      default_voice_en: "en-IN-NeerjaNeural",
    };
  }

  await loadVoices();

  if (state.text.trim()) {
    startGeneration();
  } else {
    setStatus("Waiting for article…"); 
    postToParent({ type: "vanitts:ready" });
  }

  reportHeight();
  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(document.body);
  }
}

async function init() {
  wirePlayer();
  buildSpeedBar(); 
  els.speedToggleLabel.textContent = `${state.rate.toFixed(1)}×`;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "vanitts:setText") {
      if (typeof data.text === "string" && data.text.trim()) {
        state.text = data.text;
        if (data.voice) { 
            state.userVoice = data.voice; 
            renderVoiceBar(); 
        }
        state._retried = false;
        state.autoPlayed = false;
        
        markInteraction();
        startGeneration();
      }
    }
  });

  try {
    const configUrl = state.clientId
      ? `/api/config?client=${encodeURIComponent(state.clientId)}`
      : "/api/config";
    state.config = await api(configUrl);
    const adImg = $("adImg");
    adImg.addEventListener("error", () => {
      if (!adImg.src.endsWith(SPACER_IMAGE)) {
        setAdImage(SPACER_IMAGE);
        return;
      }
      state.adImageAvailable = false;
      els.adSlot.hidden = true;
      reportHeight();
    });
    setAdImage(state.config.ad_image);
    setAdLink(state.config.ad_link);
  } catch {
    state.config = {
      widget_engine: "edge", 
      widget_voice: "en-IN-NeerjaExpressiveNeural",
      default_voice_en: "en-IN-NeerjaNeural",
    };
    $("adImg").addEventListener("error", () => {
      state.adImageAvailable = false;
      els.adSlot.hidden = true;
      reportHeight();
    });
    setAdImage(SPACER_IMAGE);
    setAdLink(DEFAULT_AD_LINK);
  }

  if (state.clientId) {
    const success = await loadVoices();
    
    // If loadVoices returns false, it means the client was blocked. Stop init here.
    if (!success) return;
    
    if (state.userVoice && state.voices.some(v => v.id === state.userVoice)) {
        state.voiceId = state.userVoice;
    } else if (state.voices.length > 0) {
        state.voiceId = state.voices[0].id;
    }

    if (state.text.trim()) {
      startGeneration();
    } else {
      setStatus("Waiting for article…"); 
      postToParent({ type: "vanitts:ready" });
    }
  } else {
    showBlockedUI("Client ID missing. Please contact support.");
  }

  reportHeight();
  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(document.body);
  }
}

document.addEventListener("DOMContentLoaded", init);