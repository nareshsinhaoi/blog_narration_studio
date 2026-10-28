import json
import logging
import os
import secrets
import hmac
from datetime import datetime
from fastapi import HTTPException, Request, Response

log = logging.getLogger("tts.api.auth")
CLIENTS_FILE = os.path.join(os.path.dirname(__file__), "..", "clients.json")
SESSION_COOKIE = "vanee_session"
STATIC_USERS = {
    "vanee_admin": { "s/x+csh'.&[7u37u" },
    "naresh" : {"50dft,IcI}-vrm_}"},
    "super_admin": {"SbW'Hj$cA%'VFFM+"},
}
_active_sessions: set[str] = set()


def verify_static_login(username: str, password: str) -> bool:
    expected = STATIC_USERS.get(username)
    return bool(expected and any(hmac.compare_digest(password, candidate) for candidate in expected))


def create_session(response: Response) -> str:
    token = secrets.token_urlsafe(32)
    _active_sessions.add(token)
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=8 * 60 * 60)
    return token


def require_session(request: Request) -> str:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or token not in _active_sessions:
        raise HTTPException(status_code=401, detail="Authentication required. Please log in.")
    return token


def end_session(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        _active_sessions.discard(token)
    response.delete_cookie(SESSION_COOKIE, samesite="lax")

def load_clients():
    try:
        with open(CLIENTS_FILE, "r", encoding="utf-8") as f:
            clients = json.load(f)
        if not isinstance(clients, dict):
            raise ValueError("Client configuration must be a JSON object.")
        return clients
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        log.exception("Unable to load client configuration")
        raise HTTPException(status_code=500, detail="Client configuration is unavailable.") from exc

def validate_client(client_id: str | None):
    if not client_id:
        raise HTTPException(status_code=401, detail="Client ID is missing.")
        
    clients = load_clients()
    client = clients.get(str(client_id))
    
    if not client:
        raise HTTPException(status_code=403, detail="Invalid Client ID.")
        
    # Check Expiry
    try:
        expiry = datetime.strptime(client["expiry_date"], "%Y-%m-%d").date()
    except (KeyError, TypeError, ValueError) as exc:
        log.exception("Invalid client configuration for client %s", client_id)
        raise HTTPException(status_code=500, detail="Client configuration is invalid.") from exc
    if expiry < datetime.now().date():
        # Using 403 Forbidden for expired accounts
        raise HTTPException(status_code=403, detail="Subscription expired. Please contact support.")
        
    return client