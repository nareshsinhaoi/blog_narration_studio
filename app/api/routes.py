"""REST API endpoints."""
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
# from fastapi.responses import RedirectResponse

from ..config import get_settings
from ..database import SessionLocal
from ..models import JobRecord
from ..schemas import JobCreate, PreviewRequest, VoiceOut
from ..tts.manager import JobManager
from pydantic import BaseModel
from .auth import validate_client, verify_static_login, create_session, require_session, end_session

log = logging.getLogger("tts.api")
router = APIRouter(prefix="/api", tags=["tts"])
settings = get_settings()
manager = JobManager()


def _voice_out(v) -> VoiceOut:
    return VoiceOut(id=v.id, name=v.name, language=v.language,
                    language_label=v.language_label, gender=v.gender, engine=v.engine)


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(payload: LoginRequest, response: Response) -> dict:
    if not verify_static_login(payload.username.strip(), payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    create_session(response)
    return {"status": "ok", "username": payload.username.strip()}


@router.post("/auth/logout")
def logout(request: Request, response: Response) -> dict:
    end_session(request, response)
    return {"status": "ok"}


@router.get("/auth/session")
def auth_session(request: Request) -> dict:
    require_session(request)
    return {"authenticated": True}


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}


@router.get("/config")
def config(client: str | None = Query(None)) -> dict:
    client_config = validate_client(client) if client else None
    response = {
        "app_name": settings.APP_NAME,
        "max_input_chars": settings.MAX_INPUT_CHARS,
        "default_engine": settings.DEFAULT_ENGINE,
        "default_voice_hi": settings.DEFAULT_VOICE_HI,
        "default_voice_en": settings.DEFAULT_VOICE_EN,
        "engines": ["edge", "google"],
        "widget_engine": settings.WIDGET_ENGINE,
        "widget_voice": settings.WIDGET_VOICE,
        "auto_generate_on_load": True,
        "estimate_words_per_minute": 140,
    }
    if client_config is not None:
        response["ad_image"] = client_config.get("ad_image")
        response["ad_link"] = client_config.get("ad_link")
    return response


# @router.get("/voices")
# def voices(
#     engine: str = "edge", 
#     language: str | None = None,
#     client: str = Query(None) # Add client validation here
#     ) -> list[VoiceOut]:
#     validate_client(client) # This will now throw a 403 if expired
#     try:
#         return [_voice_out(v) for v in manager.list_voices(engine, language)]
#     except ValueError as exc:
#         raise HTTPException(status_code=400, detail=str(exc))
#     except RuntimeError as exc:
#         raise HTTPException(status_code=502, detail=str(exc))

@router.get("/voices")
def voices(
    engine: str = "edge", 
    language: str | None = None,
    client: str | None = Query(None)
) -> list[VoiceOut]:
    # 1. Validate FIRST so a 403/401 is thrown before anything else
    validate_client(client) 
    
    try:
        # 2. Fetch voices
        return [_voice_out(v) for v in manager.list_voices(engine, language)]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception:
        log.exception("Failed to load voices")
        raise HTTPException(status_code=500, detail="Unable to load voices.")


@router.post("/tts/jobs", status_code=202)
async def create_job(payload: JobCreate) -> dict:
    validate_client(payload.client) # NEW: Validate before processing
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text is required.")
    if len(payload.text) > settings.MAX_INPUT_CHARS:
        raise HTTPException(status_code=413,
                            detail=f"Text exceeds the {settings.MAX_INPUT_CHARS:,} character limit.")
    try:
        job = manager.create_job(text, payload.voice_id, payload.engine, payload.rate, payload.lang)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    manager.submit(job.id)
    return job.public()


@router.post("/tts/preview", status_code=202)
async def preview(payload: PreviewRequest) -> dict:
    validate_client(payload.client) # NEW: Validate before processing   
    try:
        job = manager.create_preview(payload.voice_id, payload.engine, payload.rate, payload.lang)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    manager.submit(job.id)
    return job.public()


@router.get("/tts/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.public()


@router.get("/tts/jobs/{job_id}/audio")
def job_audio(job_id: str, request: Request) -> FileResponse:
    require_session(request)
    job = manager.get(job_id)
    if job is not None:
        if job.status != "completed" or not job.audio_path:
            raise HTTPException(status_code=404, detail="Audio not found or not ready.")
        audio_path = job.audio_path
    else:
        with SessionLocal() as session:
            record = session.query(JobRecord).filter(JobRecord.id == job_id).first()
        if not record or record.status != "completed" or not record.audio_path:
            raise HTTPException(status_code=404, detail="Audio not found or not ready.")
        audio_path = record.audio_path
    if not Path(audio_path).is_file():
        raise HTTPException(status_code=404, detail="Audio file is missing.")
    return FileResponse(audio_path, media_type="audio/mpeg",
                        filename=f"vanitts-{job_id[:8]}.mp3")

# @router.get("/tts/jobs/{job_id}/audio")
# def job_audio(job_id: str):
#     job = manager.get(job_id)
#     if job is None or job.status != "completed" or not job.audio_path:
#         raise HTTPException(status_code=404, detail="Audio not found or not ready.")
    
#     # If audio_path is a remote URL, redirect to it
#     if job.audio_path.startswith("http"):
#         return RedirectResponse(url=job.audio_path)
    
#     # Fallback for local dev
#     return FileResponse(job.audio_path, media_type="audio/mpeg")

@router.delete("/tts/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, request: Request) -> None:
    require_session(request)
    if not manager.delete(job_id):
        raise HTTPException(status_code=404, detail="Job not found.")


@router.get("/tts/history")
def history(request: Request, limit: int = 50) -> list[dict]:
    require_session(request)
    if not settings.PERSIST_HISTORY:
        return []
    limit = max(1, min(limit, 200))
    with SessionLocal() as session:
        rows = (session.query(JobRecord)
                .order_by(JobRecord.created_at.desc())
                .limit(limit).all())
    result = []
    for r in rows:
        audio_exists = bool(r.audio_path and Path(r.audio_path).is_file())
        if r.status == "completed" and r.audio_path and not audio_exists:
            continue
        result.append({
            "id": r.id, "voice_id": r.voice_id, "engine": r.engine, "rate": r.rate,
            "status": r.status,
            "title": (r.text_preview or "Generated audio")[:80].replace("\n", " "),
            "file_name": Path(r.audio_path).name if r.audio_path else None,
            "duration_seconds": round((len(r.text_preview or "") / 840) * 60 / max(r.rate or 1, 0.1), 1) if r.text_preview else None,
            "file_size": Path(r.audio_path).stat().st_size if audio_exists else None,
            "audio_url": f"/api/tts/jobs/{r.id}/audio" if r.status == "completed" and audio_exists else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "text_preview": r.text_preview,
        })
    return result