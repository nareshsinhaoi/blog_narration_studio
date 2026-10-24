"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  textInput: $("textInput"), counts: $("counts"), estimate: $("estimate"), clearBtn: $("clearBtn"),
  limitHint: $("limitHint"), engineSelect: $("engineSelect"), engineBadge: $("engineBadge"),
  voiceList: $("voiceList"), rateSlider: $("rateSlider"), rateLabel: $("rateLabel"),
  previewBtn: $("previewBtn"), previewStatus: $("previewStatus"),
  generateBtn: $("generateBtn"), progressWrap: $("progressWrap"),
  progressFill: $("progressFill"), progressText: $("progressText"),
  playerCard: $("playerCard"), playerMeta: $("playerMeta"), audio: $("audio"),
  playBtn: $("playBtn"), stopBtn: $("stopBtn"), backBtn: $("backBtn"), fwdBtn: $("fwdBtn"),
  seekBar: $("seekBar"), curTime: $("curTime"), durTime: $("durTime"),
  volSlider: $("volSlider"), muteBtn: $("muteBtn"), downloadBtn: $("downloadBtn"),
  toastWrap: $("toastWrap"), previewAudio: $("previewAudio"),
};

const state = {
  engine: "edge",
  language: document.querySelector(".lang-tab.active")?.dataset.lang || "en-IN",
  voices: [],
  selectedVoiceId: null,
  rate: 1.0,
  config: null,
  generatePoll: null,
  previewPoll: null,
  clientId: new URLSearchParams(window.location.search).get("client") || "290001909",
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

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  els.toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

function pollJob(jobId, intervalMs, onUpdate) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await api(`/api/tts/jobs/${jobId}`);
        onUpdate(job);
        if (job.status === "completed") { clearInterval(timer); resolve(job); }
        else if (job.status === "failed" || job.status === "cancelled") {
          clearInterval(timer);
          reject(new Error(job.error || "The job did not complete."));
        }
      } catch (e) {
        clearInterval(timer);
        reject(e);
      }
    };
    const timer = setInterval(tick, intervalMs);
  });
}

/* --------------------------- editor metrics --------------------------- */

function updateEditorMetrics() {
  const text = els.textInput.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  els.counts.textContent = `${words.toLocaleString()} words · ${chars.toLocaleString()} characters`;
  const max = state.config ? state.config.max_input_chars : 20000;
  els.limitHint.textContent =
    `Limit ${max.toLocaleString()} characters per request. Long articles are processed in chunks ` +
    `and stitched into a single seamless MP3.`;
  if (words === 0) {
    els.estimate.textContent = "Estimated audio duration: —";
    return;
  }
  const wpm = state.config ? state.config.estimate_words_per_minute : 140;
  const seconds = (words / wpm) * 60 / state.rate;
  els.estimate.textContent = `Estimated audio duration: ≈ ${fmtTime(seconds)}`;
}

/* ------------------------------ voices ------------------------------ */

async function loadVoices() {
  state.selectedVoiceId = null;
  els.voiceList.innerHTML = `<p class="muted small">Loading voices…</p>`;
  try {
    state.voices = await api(
      `/api/voices?engine=${state.engine}&language=${state.language}&client=${encodeURIComponent(state.clientId)}`
    );
  } catch (e) {
    state.voices = [];
    els.voiceList.innerHTML = `<p class="muted small">${e.message}</p>`;
    toast(e.message, "error");
    return;
  }
  if (!state.voices.length) {
    els.voiceList.innerHTML = `<p class="muted small">No voices available for this selection.</p>`;
    state.selectedVoiceId = null;
    return;
  }
  const preferred = state.language === "hi-IN"
    ? state.config.default_voice_hi : state.config.default_voice_en;
  state.selectedVoiceId = state.voices.some((v) => v.id === preferred)
    ? preferred : state.voices[0].id;
  renderVoices();
}

function renderVoices() {
  els.voiceList.innerHTML = "";
  state.voices.forEach((v) => {
    const item = document.createElement("div");
    item.className = "voice-item" + (v.id === state.selectedVoiceId ? " selected" : "");
    item.setAttribute("role", "radio");
    item.setAttribute("aria-checked", v.id === state.selectedVoiceId ? "true" : "false");
    item.tabIndex = 0;
    item.innerHTML = `
      <span class="voice-avatar" aria-hidden="true">${v.name.charAt(0)}</span>
      <span class="voice-info">
        <span class="voice-name">${v.name}</span><br>
        <span class="voice-lang">${v.language_label} · ${v.id}</span>
      </span>
      <span class="gender-chip ${v.gender.toLowerCase()}">${v.gender}</span>`;
    const select = () => {
      state.selectedVoiceId = v.id;
      renderVoices();
    };
    item.addEventListener("click", select);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
    els.voiceList.appendChild(item);
  });
}

function setEngineBadge() {
  els.engineBadge.textContent = state.engine === "edge"
    ? "Engine: Microsoft Edge neural (free)"
    : "Engine: Google Cloud TTS (premium)";
}

/* --------------------------- audio player --------------------------- */

function wirePlayer() {
  const audio = els.audio;

  els.playBtn.addEventListener("click", () => {
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => toast("Playback was blocked by the browser.", "error"));
    else audio.pause();
  });
  els.stopBtn.addEventListener("click", () => {
    audio.pause();
    audio.currentTime = 0;
    els.playBtn.textContent = "▶";
  });
  els.backBtn.addEventListener("click", () => {
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
  els.fwdBtn.addEventListener("click", () => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    }
  });

  audio.addEventListener("play", () => { els.playBtn.textContent = "❚❚"; });
  audio.addEventListener("pause", () => { els.playBtn.textContent = "▶"; });
  audio.addEventListener("ended", () => { els.playBtn.textContent = "▶"; audio.currentTime = 0; });
  audio.addEventListener("loadedmetadata", () => { els.durTime.textContent = fmtTime(audio.duration); });
  audio.addEventListener("timeupdate", () => {
    els.curTime.textContent = fmtTime(audio.currentTime);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      els.seekBar.value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
  });
  audio.addEventListener("error", () => toast("Audio failed to load.", "error"));

  els.seekBar.addEventListener("input", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (els.seekBar.value / 1000) * audio.duration;
    }
  });

  els.volSlider.addEventListener("input", () => {
    audio.volume = els.volSlider.value / 100;
    audio.muted = false;
    els.muteBtn.textContent = audio.volume === 0 ? "🔇" : "🔊";
  });
  els.muteBtn.addEventListener("click", () => {
    audio.muted = !audio.muted;
    els.muteBtn.textContent = audio.muted ? "🔇" : "🔊";
  });
}

function showGeneratedAudio(job) {
  const voice = state.voices.find((v) => v.id === state.selectedVoiceId);
  els.playerCard.hidden = false;
  els.playerMeta.textContent = voice
    ? `${voice.language_label} · ${voice.name} (${voice.gender}) · ${state.rate.toFixed(2)}×`
    : "";
  els.audio.src = job.audio_url;
  els.downloadBtn.href = job.audio_url;
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = (voice ? `${voice.language_label}-${voice.name}` : "audio").replace(/[^\w\-]+/g, "_");
  els.downloadBtn.download = `vanitts_${safe}_${stamp}.mp3`;
  els.curTime.textContent = "0:00";
  els.seekBar.value = 0;
  els.playerCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* --------------------------- generate & preview --------------------------- */

function setProgress(value, text) {
  els.progressFill.style.width = `${Math.round(value * 100)}%`;
  els.progressText.textContent = text;
}

async function generate() {
  const text = els.textInput.value;
  if (!text.trim()) { toast("Please paste your article text first.", "error"); return; }
  if (!state.selectedVoiceId) { toast("Please select a voice first.", "error"); return; }

  els.generateBtn.disabled = true;
  els.progressWrap.hidden = false;
  setProgress(0.03, "Submitting…");
  clearInterval(state.generatePoll);

  try {
    const job = await api("/api/tts/jobs", {
      method: "POST",
      body: JSON.stringify({
        text,
        voice_id: state.selectedVoiceId,
        engine: state.engine,
        rate: state.rate,
        client: state.clientId,
        lang: state.language,
      }),
    });
    const done = await pollJob(job.id, 900, (j) => {
      if (j.status === "processing") {
        setProgress(Math.max(0.05, j.progress),
          `Synthesizing chunk ${j.done_chunks}/${j.total_chunks}…`);
      }
    });
    setProgress(1, "Done");
    showGeneratedAudio(done);
    toast("Audio generated successfully. Ready to play or download.", "success");
  } catch (e) {
    toast(`Generation failed: ${e.message}`, "error");
    setProgress(0, "Failed");
  } finally {
    els.generateBtn.disabled = false;
    // Text stays untouched on failure, per UX requirement.
    setTimeout(() => { els.progressWrap.hidden = true; }, 1600);
  }
}

async function previewVoice() {
  if (!state.selectedVoiceId) { toast("Select a voice first.", "error"); return; }
  els.previewBtn.disabled = true;
  els.previewStatus.textContent = "Generating sample…";
  clearInterval(state.previewPoll);
  try {
    const job = await api("/api/tts/preview", {
      method: "POST",
      body: JSON.stringify({
        voice_id: state.selectedVoiceId,
        engine: state.engine,
        rate: state.rate,
        client: state.clientId,
        lang: state.language,
      }),
    });
    const done = await pollJob(job.id, 600, () => {});
    els.previewAudio.src = done.audio_url;
    await els.previewAudio.play();
    els.previewStatus.textContent = "Playing preview…";
    els.previewAudio.onended = () => { els.previewStatus.textContent = ""; };
  } catch (e) {
    toast(`Preview failed: ${e.message}`, "error");
    els.previewStatus.textContent = "";
  } finally {
    els.previewBtn.disabled = false;
  }
}

/* -------------------------------- init -------------------------------- */

function bindEvents() {
  els.textInput.addEventListener("input", updateEditorMetrics);
  els.clearBtn.addEventListener("click", () => {
    els.textInput.value = "";
    updateEditorMetrics();
    els.textInput.focus();
  });

  document.querySelectorAll(".lang-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".lang-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.language = tab.dataset.lang;
      loadVoices();
    });
  });

  els.engineSelect.addEventListener("change", () => {
    state.engine = els.engineSelect.value;
    setEngineBadge();
    loadVoices();
  });

  els.rateSlider.addEventListener("input", () => {
    state.rate = parseFloat(els.rateSlider.value);
    els.rateLabel.textContent = `${state.rate.toFixed(2)}×`;
    updateEditorMetrics();
  });

  els.generateBtn.addEventListener("click", generate);
  els.previewBtn.addEventListener("click", previewVoice);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });
}

async function init() {
  bindEvents();
  wirePlayer();
  try {
    state.config = await api("/api/config");
  } catch (e) {
    toast("Could not load server configuration.", "error");
    state.config = { max_input_chars: 20000, default_voice_hi: "hi-IN-SwaraNeural", default_voice_en: "en-IN-NeerjaNeural", estimate_words_per_minute: 140 };
  }
  updateEditorMetrics();
  await loadVoices();
}

document.addEventListener("DOMContentLoaded", init);