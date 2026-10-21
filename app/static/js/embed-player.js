"use strict";

/* VaniTTS embed player (inside the iframe on /embed).
   Receives article text from the parent page via postMessage:
     parent -> iframe : {type: "vanitts:setText", text, voice?}
   Reports back:
     iframe -> parent : {type: "vanitts:ready"}                 (safe to send text)
     iframe -> parent : {type: "vanitts:height", height}        (auto-resize)
*/

const $ = (id) => document.getElementById(id);

const els = {
  widget: $("widget"), audio: $("audio"), voiceBar: $("voiceBar"),
  boxPlayBtn: $("boxPlayBtn"), boxIcon: $("boxIcon"),
  backBtn: $("backBtn"), playBtn: $("playBtn"), fwdBtn: $("fwdBtn"),
  seekBar: $("seekBar"), timeLabel: $("timeLabel"), statusText: $("statusText"),
  genProgress: $("genProgress"), genProgressFill: $("genProgressFill"),
};

const params = new URLSearchParams(location.search);

const state = {
  config: null,
  voices: [],
  text: params.get("text") || "",
  voiceId: null,
  userVoice: params.get("voice") || null,
  jobPoll: null,
  generating: false,
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
    throw new Error(detail);
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
}

function setGenerationUI(on, progress = 0) {
  els.widget.classList.toggle("generating", on);
  els.boxPlayBtn.classList.toggle("loading", on);
  els.genProgress.hidden = !on;
  els.genProgressFill.style.width = `${Math.round(progress * 100)}%`;
}

/* --------------------- parent-page communication --------------------- */

function postToParent(message) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function reportHeight() {
  postToParent({ type: "vanitts:height", height: document.body.scrollHeight });
}

/* ------------------------- voice agent switcher ------------------------- */

const GENDER_TAG = { Female: "F", Male: "M" };

async function loadVoices() {
  try {
    const voices = await api(`/api/voices?engine=${state.config.widget_engine}&language=en-IN`);
    const seen = new Set();
    state.voices = voices
      .filter((v) => v.language === "en-IN" && !seen.has(v.id) && seen.add(v.id))
      .sort((a, b) => (a.gender === b.gender ? a.name.localeCompare(b.name)
                                             : a.gender === "Female" ? -1 : 1));
  } catch {
    state.voices = [];
  }
  renderVoiceBar();
}

function currentDefaultVoice() {
  if (state.userVoice && state.voices.some((v) => v.id === state.userVoice)) return state.userVoice;
  if (state.voices.some((v) => v.id === state.config.widget_voice)) return state.config.widget_voice;
  return state.voices.length ? state.voices[0].id : state.config.widget_voice;
}

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
    btn.title = v.id;
    const tag = GENDER_TAG[v.gender] || "?";
    const cls = v.gender === "Male" ? "m" : "f";
    btn.innerHTML = `<span>${v.name}</span><span class="ta-tag ${cls}">(${tag})</span>`;
    btn.addEventListener("click", () => selectVoice(v.id));
    els.voiceBar.appendChild(btn);
  });
}

function selectVoice(voiceId) {
  if (voiceId === state.voiceId && !state.generating) return;
  state.userVoice = voiceId;
  state._retried = false;
  renderVoiceBar();
  setStatus("Switching voice agent…");
  startGeneration();
}

/* ---------------------------- generation ---------------------------- */

async function tryCreateJob(text, voiceId) {
  return api("/api/tts/jobs", {
    method: "POST",
    body: JSON.stringify({
      text, voice_id: voiceId, engine: state.config.widget_engine, rate: 1.0,
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
    try {
      await els.audio.play();
      setStatus("Playing…");
    } catch {
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
    els.audio.currentTime = Math.max(0, els.audio.currentTime - 10);
  });
  els.fwdBtn.addEventListener("click", () => {
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
    if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
      els.audio.currentTime = (els.seekBar.value / 1000) * els.audio.duration;
    }
  });
}

function updateTime() {
  els.timeLabel.textContent = `${fmtTime(els.audio.currentTime)} / ${fmtTime(els.audio.duration)}`;
}

/* -------------------------------- init -------------------------------- */

async function init() {
  wirePlayer();

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "vanitts:setText") {
      if (typeof data.text === "string" && data.text.trim()) {
        state.text = data.text;
        if (data.voice) { state.userVoice = data.voice; renderVoiceBar(); }
        state._retried = false;
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

  // Text already provided via ?text= -> generate right away.
  // Otherwise announce readiness and wait for the parent's postMessage.
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

document.addEventListener("DOMContentLoaded", init);
