"""REST API endpoints."""
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
# from fastapi.responses import RedirectResponse

from ..config import get_settings
from ..database import SessionLocal
from ..models import JobRecord
from ..schemas import JobCreate, PreviewRequest, VoiceOut
from ..tts.manager import JobManager

log = logging.getLogger("tts.api")
router = APIRouter(prefix="/api", tags=["tts"])
settings = get_settings()
manager = JobManager()


def _voice_out(v) -> VoiceOut:
    return VoiceOut(id=v.id, name=v.name, language=v.language,
                    language_label=v.language_label, gender=v.gender, engine=v.engine)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}


@router.get("/config")
def config() -> dict:
    return {
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


@router.get("/voices")
def voices(engine: str = "edge", language: str | None = None) -> list[VoiceOut]:
    try:
        return [_voice_out(v) for v in manager.list_voices(engine, language)]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/tts/jobs", status_code=202)
async def create_job(payload: JobCreate) -> dict:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text is required.")
    if len(payload.text) > settings.MAX_INPUT_CHARS:
        raise HTTPException(status_code=413,
                            detail=f"Text exceeds the {settings.MAX_INPUT_CHARS:,} character limit.")
    try:
        job = manager.create_job(text, payload.voice_id, payload.engine, payload.rate)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    manager.submit(job.id)
    return job.public()


@router.post("/tts/preview", status_code=202)
async def preview(payload: PreviewRequest) -> dict:
    try:
        job = manager.create_preview(payload.voice_id, payload.engine, payload.rate)
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
def job_audio(job_id: str) -> FileResponse:
    job = manager.get(job_id)
    if job is None or job.status != "completed" or not job.audio_path:
        raise HTTPException(status_code=404, detail="Audio not found or not ready.")
    return FileResponse(job.audio_path, media_type="audio/mpeg",
                        filename=f"vanitts-{job.id[:8]}.mp3")

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
def delete_job(job_id: str) -> None:
    if not manager.delete(job_id):
        raise HTTPException(status_code=404, detail="Job not found.")


@router.get("/tts/history")
def history(limit: int = 50) -> list[dict]:
    if not settings.PERSIST_HISTORY:
        return []
    limit = max(1, min(limit, 200))
    with SessionLocal() as session:
        rows = (session.query(JobRecord)
                .order_by(JobRecord.created_at.desc())
                .limit(limit).all())
    return [{
        "id": r.id, "voice_id": r.voice_id, "engine": r.engine, "rate": r.rate,
        "status": r.status,
        "audio_url": f"/api/tts/jobs/{r.id}/audio" if r.status == "completed" and r.audio_path else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "text_preview": r.text_preview,
    } for r in rows]