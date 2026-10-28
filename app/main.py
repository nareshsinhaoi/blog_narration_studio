"""FastAPI application entrypoint: uvicorn app.main:app --reload"""
import asyncio
import contextlib
import logging

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import manager, router
from .config import get_settings
from .database import init_db
from .api.auth import require_session

log = logging.getLogger("tts.main")
settings = get_settings()
STATIC_DIR = "app/static"


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    stop = asyncio.Event()

    async def cleaner() -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=300)
            except asyncio.TimeoutError:
                removed = manager.cleanup_expired()
                if removed:
                    log.info("Cleaned up %d expired jobs", removed)

    task = asyncio.create_task(cleaner())
    yield
    stop.set()
    task.cancel()


app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan)
app.include_router(router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/login", include_in_schema=False)
def login_page() -> FileResponse:
    return FileResponse(f"{STATIC_DIR}/login.html")


@app.get("/dashboard", include_in_schema=False)
def dashboard(request: Request) -> Response:
    try:
        require_session(request)
    except Exception:
        return RedirectResponse("/login", status_code=302)
    return FileResponse(f"{STATIC_DIR}/index.html")


@app.get("/audio", include_in_schema=False)
def audio_listing(request: Request) -> Response:
    try:
        require_session(request)
    except Exception:
        return RedirectResponse("/login", status_code=302)
    return FileResponse(f"{STATIC_DIR}/audio.html")


@app.get("/", include_in_schema=False)
def index(request: Request) -> Response:
    try:
        require_session(request)
    except Exception:
        return RedirectResponse("/login", status_code=302)
    return FileResponse(f"{STATIC_DIR}/index.html")


@app.get("/player", include_in_schema=False)
def player(request: Request) -> Response:
    """Phase 2: TrinityAudio-style auto-generating article player."""
    try:
        require_session(request)
    except Exception:
        return RedirectResponse("/login", status_code=302)
    return FileResponse(f"{STATIC_DIR}/widget.html")

@app.get("/embed", include_in_schema=False)
def embed() -> FileResponse:
    """Phase 4: compact embeddable player for cross-site iframes."""
    return FileResponse(f"{STATIC_DIR}/embed.html")