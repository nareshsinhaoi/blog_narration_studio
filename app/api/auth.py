import json
import logging
import os
from datetime import datetime
from fastapi import HTTPException

log = logging.getLogger("tts.api.auth")
CLIENTS_FILE = os.path.join(os.path.dirname(__file__), "..", "clients.json")

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