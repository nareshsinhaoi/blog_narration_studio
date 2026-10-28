"use strict";
(async () => {
  try { const res = await fetch("/api/auth/session"); if (res.ok) location.replace("/dashboard"); } catch (_) {}
})();

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("formError");
const button = document.getElementById("loginButton");
form.addEventListener("submit", async (event) => {
  event.preventEventDefault?.(); event.preventDefault();
  errorBox.hidden = true; button.disabled = true; button.textContent = "Signing in…";
  try {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: document.getElementById("username").value, password: document.getElementById("password").value }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Invalid credentials.");
    location.replace("/dashboard");
  } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
  finally { button.disabled = false; button.textContent = "Sign in"; }
});
