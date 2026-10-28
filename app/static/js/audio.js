"use strict";
const grid = document.getElementById("audioGrid");
const toastWrap = document.getElementById("toastWrap");

function toast(message, type = "info") {
  const el = document.createElement("div"); el.className = `toast toast-${type}`; el.textContent = message; toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show")); setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 4000);
}
function formatTime(seconds) { if (!Number.isFinite(seconds)) return "—"; const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "—"; }
async function api(path, options = {}) {
  const res = await fetch(path, options); if (res.status === 401) { location.replace("/login"); return; }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`); return data;
}
loadAudio();
async function loadAudio() {
  grid.innerHTML = `<p class="muted">Loading audio files…</p>`;
  try {
    const items = await api("/api/tts/history?limit=200");
    if (!items || items.length === 0) { grid.innerHTML = `<div class="empty-state"><strong>No audio files found</strong><span class="muted">Generated audio will appear here.</span></div>`; return; }
    grid.innerHTML = "";
    items.forEach(item => {
      const card = document.createElement("article"); card.className = "audio-card";
      card.innerHTML = `<div class="audio-card-main"><div class="audio-title">${escapeHtml(item.title)}</div><div class="audio-file-name">${escapeHtml(item.file_name || "—")}</div><div class="audio-meta"><span>Duration: ${formatTime(item.duration_seconds)}</span><span>Uploaded: ${formatDate(item.created_at)}</span><span>${item.file_size ? `${Math.max(1, Math.round(item.file_size / 1024))} KB` : ""}</span></div><audio controls preload="metadata" src="${item.audio_url || ""}"></audio></div><button class="btn danger delete-audio" type="button">Delete Audio</button>`;
      card.querySelector(".delete-audio").addEventListener("click", () => deleteAudio(item, card)); grid.appendChild(card);
    });
  } catch (error) { grid.innerHTML = `<div class="empty-state"><strong>Unable to load audio</strong><span class="muted">${escapeHtml(error.message)}</span></div>`; toast(error.message, "error"); }
}
async function deleteAudio(item, card) {
  if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
  const button = card.querySelector(".delete-audio"); button.disabled = true; button.textContent = "Deleting…";
  try { await api(`/api/tts/jobs/${encodeURIComponent(item.id)}`, { method: "DELETE" }); card.remove(); toast("Audio deleted successfully.", "success"); if (!grid.children.length) grid.innerHTML = `<div class="empty-state"><strong>No audio files found</strong><span class="muted">Generated audio will appear here.</span></div>`; }
  catch (error) { toast(error.message || "Unable to delete audio.", "error"); button.disabled = false; button.textContent = "Delete Audio"; }
}
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value == null ? "" : String(value); return div.innerHTML; }
document.getElementById("refreshBtn").addEventListener("click", loadAudio);
document.getElementById("logoutBtn").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); location.replace("/login"); });
