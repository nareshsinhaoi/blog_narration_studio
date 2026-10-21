"use strict";

/* Phase 2 - TrinityAudio-style auto-generating article player.
   Phase 3 - voice-agent switcher inside the player: agent buttons with
   Male/Female icons; clicking one regenerates the audio in that voice. */

const $ = (id) => document.getElementById(id);

const els = {
  articleText: $("articleText"), voiceLine: $("voiceLine"),
  widget: $("widget"), audio: $("audio"),
  voiceBar: $("voiceBar"),
  boxPlayBtn: $("boxPlayBtn"), boxIcon: $("boxIcon"),
  backBtn: $("backBtn"), playBtn: $("playBtn"), fwdBtn: $("fwdBtn"),
  seekBar: $("seekBar"), timeLabel: $("timeLabel"),
  statusText: $("statusText"),
  genProgress: $("genProgress"), genProgressFill: $("genProgressFill"),
};

const state = {
  config: null,
  voices: [],              // en-IN agents from the API
  voiceId: null,          // voice actually in use
  userVoice: null,        // voice explicitly picked by the user (sticky)
  jobPoll: null,
  generating: false,
  regenTimer: null,
  wantRegen: false,
  lastText: "",
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

function pollJob(jobId) {
  return new Promise((resolve, reject) => {
    clearInterval(state.jobPoll);
    state.jobPoll = setInterval(async () => {
      try {
        const job = await api(`/api/tts/jobs/${jobId}`);
        if (job.status === "processing") {
          setGenerationUI(true, Math.max(0.05, job.progress));
          setStatus(`Generating… ${Math.round(job.progress * 100)}%`);
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

/* ------------------------- voice agent switcher ------------------------- */

const GENDER_TAG = { Female: "F", Male: "M" };

// async function loadVoices222() {
//   try {
//     const voices = await api(`/api/voices?engine=${state.config.widget_engine}&language=en-IN`);
//     // English (India) only, de-duplicated, female first for a tidy bar
//     const seen = new Set();
//     state.voices = voices
//       .filter((v) => v.language === "en-IN" && !seen.has(v.id) && seen.add(v.id))
//       .sort((a, b) => (a.gender === b.gender ? a.name.localeCompare(b.name)
//                                              : a.gender === "Female" ? -1 : 1));
//   } catch {
//     state.voices = [];
//   }
//   renderVoiceBar();
// }
async function loadVoices() {
  try {
    const voices = await api(
      `/api/voices?engine=${state.config.widget_engine}`
    );

    // Filter all Indian voices, remove duplicates, and show females first
    const seen = new Set();

    state.voices = voices
      .filter((v) => {
        const language = v.language || v.id;

        return (
          /-IN(?:-|$)/i.test(language) &&
          !seen.has(v.id) &&
          seen.add(v.id)
        );
      })
      .sort((a, b) =>
        a.gender === b.gender
          ? a.name.localeCompare(b.name)
          : a.gender === "Female"
            ? -1
            : 1
      );

    console.log("Total voices returned:", voices.length);
    console.log("Indian voices filtered:", state.voices.length);
  } catch (error) {
    console.error("Failed to load voices:", error);
    state.voices = [];
  }

  renderVoiceBar();
}

function currentDefaultVoice() {
  // User's explicit pick wins; otherwise the configured widget voice, else first agent
  if (state.userVoice && state.voices.some((v) => v.id === state.userVoice)) {
    return state.userVoice;
  }
  if (state.voices.some((v) => v.id === state.config.widget_voice)) {
    return state.config.widget_voice;
  }
  return state.voices.length ? state.voices[0].id : state.config.widget_voice;
}

function renderVoiceBar() {
  els.voiceBar.innerHTML = "";
  if (!state.voices.length) {
    els.voiceBar.hidden = true;
    return;
  }
  els.voiceBar.hidden = false;
  const activeId = state.voiceId || currentDefaultVoice();
  state.voices.forEach((v) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ta-voice" + (v.id === activeId ? " active" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", v.id === activeId ? "true" : "false");
    btn.title = `${v.name} · ${v.id}`;
    const tag = GENDER_TAG[v.gender] || "?";
    const cls = v.gender === "Male" ? "m" : "f";
    btn.innerHTML =
      `<span>${v.name}</span>` +
      `<span class="ta-tag ${cls}">(${tag})</span>`;
    btn.addEventListener("click", () => selectVoice(v.id));
    els.voiceBar.appendChild(btn);
  });
}

function selectVoice(voiceId) {
  if (voiceId === state.voiceId && !state.generating) return;   // already active
  state.userVoice = voiceId;                                    // sticky user choice
  state._retried = false;
  renderVoiceBar();
  setStatus("Switching voice agent…");
  startGeneration();
}

/* --------------------------- auto generation --------------------------- */

async function tryCreateJob(text, voiceId) {
  return api("/api/tts/jobs", {
    method: "POST",
    body: JSON.stringify({
      text, voice_id: voiceId, engine: state.config.widget_engine, rate: 1.0,
    }),
  });
}

function voiceCandidates() {
  // Deduplicated fallback chain: user pick -> widget default -> dashboard default -> safe
  return [...new Set([
    currentDefaultVoice(),
    state.config.widget_voice,
    state.config.default_voice_en,
    "en-IN-NeerjaNeural",
  ])];
}

async function startGeneration() {
  const text = els.articleText.value;
  if (!text.trim()) { setStatus("Article is empty.", true); return; }
  if (state.generating) { state.wantRegen = true; return; }

  state.generating = true;
  state.lastText = text;
  setGenerationUI(true, 0.03);
  setStatus("Generating audio…");

  // Cancel any previous job's audio on a best-effort basis
  const previousJobId = state.currentJobId;
  state.currentJobId = null;
  if (previousJobId) {
    api(`/api/tts/jobs/${previousJobId}`, { method: "DELETE" }).catch(() => {});
  }

  let job = null;
  for (const voiceId of voiceCandidates()) {
    try {
      job = await tryCreateJob(text, voiceId);
      state.voiceId = voiceId;
      break;
    } catch (e) {
      // Voice/engine validation failure -> try the next candidate voice
      if (/not available|unavailable|Unknown/i.test(e.message)) continue;
      // Real error (e.g. text too long) -> surface it
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

  renderVoiceBar();   // reflect the voice actually being generated

  try {
    const done = await pollJob(job.id);
    state.currentJobId = done.id;
    els.audio.src = done.audio_url;
    setGenerationUI(false);
    const agent = state.voices.find((v) => v.id === state.voiceId);
    setStatus(`Ready · ${agent ? agent.name : state.voiceId}`);
    els.voiceLine.innerHTML =
      `🔊 Narrated by <strong>${state.voiceId}</strong> · Engine: ${state.config.widget_engine}` +
      ` · <a href="${done.audio_url}" download="vanitts_article.mp3">Download MP3</a>`;
    try {
      await els.audio.play();   // may be blocked until first user gesture
      setStatus("Playing…");
    } catch {
      setStatus("Tap ▶ to play");
    }
  } catch (e) {
    // If the preferred voice failed at synthesis time, retry once with plain Neerja
    if (state.voiceId !== "en-IN-NeerjaNeural" && !state._retried) {
      state._retried = true;
      state.generating = false;
      setStatus("Voice unavailable, switching…");
      els.voiceLine.textContent = "Trying fallback voice en-IN-NeerjaNeural…";
      await startGeneration();
      return;
    }
    setStatus(`Failed: ${e.message}`, true);
    setGenerationUI(false);
  } finally {
    state.generating = false;
    if (state.wantRegen && els.articleText.value !== state.lastText) {
      state.wantRegen = false;
      startGeneration();
    } else {
      state.wantRegen = false;
    }
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
  els.audio.addEventListener("error", () => setStatus("Audio failed to load.", true));

  els.seekBar.addEventListener("input", () => {
    if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
      els.audio.currentTime = (els.seekBar.value / 1000) * els.audio.duration;
    }
  });
}

function updateTime() {
  els.timeLabel.textContent =
    `${fmtTime(els.audio.currentTime)} / ${fmtTime(els.audio.duration)}`;
}

/* -------------------------------- init -------------------------------- */

function bindEditor() {
  els.articleText.addEventListener("input", () => {
    clearTimeout(state.regenTimer);
    state.regenTimer = setTimeout(() => {
      state._retried = false;
      startGeneration();
    }, 2000);   // regenerate 2 s after the user stops editing
  });
}

async function init() {
  wirePlayer();
  bindEditor();
  try {
    state.config = await api("/api/config");
  } catch {
    state.config = {
      widget_engine: "edge", widget_voice: "en-IN-NeerjaExpressiveNeural",
      default_voice_en: "en-IN-NeerjaNeural",
    };
  }
  setStatus("Generating audio…");
  els.voiceLine.textContent =
    `🔊 Voice: ${state.config.widget_voice} · Engine: ${state.config.widget_engine}`;
  await loadVoices();       // Phase 3: fetch the en-IN voice agents
  await startGeneration();  // <-- the "Generate Audio" button, retired
}

document.addEventListener("DOMContentLoaded", init);