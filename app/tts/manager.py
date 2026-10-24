"""Text chunking, background job processing, and MP3 stitching."""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import subprocess
import threading
import uuid

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import get_settings
from ..database import SessionLocal
from ..models import JobRecord
from .base import SAMPLE_TEXTS
from .edge_engine import EdgeTTSEngine
from .google_engine import GoogleTTSEngine

log = logging.getLogger("tts.manager")

_SENTENCE_RE = re.compile(r"[^.!?।\n]+[.!?।]*[\s]*", re.UNICODE)
_PARA_SPLIT_RE = re.compile(r"\n+")

def split_into_chunks(text: str, max_chars: int = 1500) -> list[str]:
    """Split long text on paragraph / sentence boundaries (supports Hindi danda '।')."""
    chunks: list[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current.strip():
            chunks.append(current.strip())
        current = ""

    for para in _PARA_SPLIT_RE.split(text):
        para = para.strip()
        if not para:
            continue
        sentences = [s.strip() for s in _SENTENCE_RE.findall(para) if s.strip()] or [para]
        for sentence in sentences:
            if len(sentence) > max_chars:
                flush()
                for i in range(0, len(sentence), max_chars):
                    part = sentence[i:i + max_chars].strip()
                    if part:
                        chunks.append(part)
                continue
            if len(current) + len(sentence) + 1 > max_chars:
                flush()
            current = f"{current} {sentence}".strip()
        flush()
    flush()
    return chunks


def _strip_id3v2(data: bytes) -> bytes:
    """Remove an ID3v2 tag from the start of an MP3 byte stream (if present)."""
    if len(data) > 10 and data[:3] == b"ID3":
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        return data[10 + size:]
    return data


def estimate_duration_seconds(text: str, rate: float = 1.0, words_per_minute: int = 140) -> float:
    words = len(text.split())
    return round((words / words_per_minute * 60) / max(rate, 0.1), 1)


@dataclass
class Job:
    id: str
    text: str
    voice_id: str
    engine: str
    rate: float
    is_preview: bool = False
    status: str = "queued"  # queued | processing | completed | failed | cancelled
    progress: float = 0.0
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    audio_path: str | None = None
    total_chunks: int = 0
    done_chunks: int = 0

    def public(self) -> dict:
        completed = self.status == "completed" and bool(self.audio_path)
        return {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 4),
            "error": self.error,
            "is_preview": self.is_preview,
            "voice_id": self.voice_id,
            "engine": self.engine,
            "rate": self.rate,
            "total_chunks": self.total_chunks,
            "done_chunks": self.done_chunks,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "audio_url": f"/api/tts/jobs/{self.id}/audio" if completed else None,
            "estimated_seconds": estimate_duration_seconds(self.text, self.rate),
        }


class JobManager:
    """In-memory job store with background (asyncio) processing."""

    AUDIO_FILE_RETENTION = timedelta(hours=12)

    def __init__(self) -> None:
        self.settings = get_settings()
        self.jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._tasks: set[asyncio.Task] = set()
        self._engines = {"edge": EdgeTTSEngine(), "google": GoogleTTSEngine()}
        
        # FIX: Use the configured data directory (e.g., /app/data/audio) instead of /tmp
        self.audio_dir = Path(self.settings.DATA_DIR) / self.settings.AUDIO_DIR_NAME
        self.audio_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------- voices
    def list_voices(self, engine: str, language: str | None = None):
        eng = self._engines.get(engine)
        if eng is None:
            raise ValueError(f"Unknown engine {engine!r}. Available: {sorted(self._engines)}")
        try:
            return eng.list_voices(language)
        except Exception as exc:
            raise RuntimeError(
                f"Engine {engine!r} is unavailable: {exc}. "
                "For 'google', set GOOGLE_APPLICATION_CREDENTIALS (or use engine='edge', free)."
            ) from exc

    def get_voice(self, engine: str, voice_id: str, lang: str | None = None):
        voices = self.list_voices(engine, lang)
        for v in voices:
            if v.id == voice_id:
                return v
        raise ValueError(f"Voice {voice_id!r} is not available on engine {engine!r} for language {lang!r}.")

    # ------------------------------------------------------------ lifecycle
    def create_job(self, text: str, voice_id: str, engine: str, rate: float, lang: str = "en-IN") -> Job:
        self.get_voice(engine, voice_id, lang) 
        job = Job(id=uuid.uuid4().hex[:12], text=text, voice_id=voice_id, engine=engine, rate=rate)
        with self._lock:
            self.jobs[job.id] = job
        return job

    def create_preview(self, voice_id: str, engine: str, rate: float, lang: str) -> Job:
        voice = self.get_voice(engine, voice_id, lang)
        sample = SAMPLE_TEXTS.get(voice.language) or SAMPLE_TEXTS["en-IN"]
        job = Job(id=uuid.uuid4().hex[:12], text=sample, voice_id=voice_id,
                  engine=engine, rate=rate, is_preview=True)
        with self._lock:
            self.jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def submit(self, job_id: str) -> None:
        job = self.jobs[job_id]
        task = asyncio.create_task(self._run(job))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, job: Job) -> None:
        job.status = "processing"
        engine = self._engines[job.engine]
        try:
            chunks = split_into_chunks(job.text, self.settings.CHUNK_MAX_CHARS)
            if not chunks:
                raise ValueError("Nothing to synthesize.")
            job.total_chunks = len(chunks)
            parts = await asyncio.to_thread(self._synthesize_chunks, engine, job, chunks)
            if job.status == "cancelled":
                return
            
            self._remove_expired_audio_files()
            out_path = self.audio_dir / f"{job.id}.mp3"
            await asyncio.to_thread(self._stitch_to_file, job, parts, out_path)
            job.audio_path = str(out_path)
            job.progress = 1.0
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            self._persist(job)
            log.info("Job %s completed (%d chunks)", job.id, job.total_chunks)
        except Exception as exc:  # surfaced to the user via job.error
            if job.status != "cancelled":
                job.status = "failed"
                job.error = str(exc)[:500]
                log.exception("Job %s failed", job.id)

    def _remove_expired_audio_files(self) -> int:
        cutoff = (datetime.now(timezone.utc) - self.AUDIO_FILE_RETENTION).timestamp()
        removed = 0

        for path in self.audio_dir.iterdir():
            if not path.is_file() or path.stat().st_mtime >= cutoff:
                continue
            try:
                path.unlink()
            except OSError:
                log.exception("Could not remove expired audio file %s", path)
                raise
            removed += 1

        if removed:
            log.info("Removed %d audio files older than 12 hours", removed)
        return removed

    # def _synthesize_chunks(self, engine, job: Job, chunks: list[str]) -> list[bytes]:
    #     parts: list[bytes] = []
    #     for chunk in chunks:
    #         if job.status == "cancelled":
    #             break
    #         result = engine.synthesize(chunk, job.voice_id, rate=job.rate)
    #         parts.append(result.audio)
    #         job.done_chunks += 1
    #         job.progress = job.done_chunks / max(job.total_chunks, 1)
    #         log.info("Job %s: chunk %d/%d", job.id, job.done_chunks, job.total_chunks)
    #     if not parts:
    #         raise RuntimeError("Synthesis produced no audio.")
    #     return parts

    def _synthesize_chunks(self, engine, job: Job, chunks: list[str]) -> list[bytes]:
        parts: list[bytes] = []
        for chunk in chunks:
            if job.status == "cancelled":
                break
            
            # REMOVE or comment out the Danda replacement for now
            # if any('\u0900' <= c <= '\u097F' for c in chunk):
            #     chunk = chunk.replace("।", ".")
                
            result = engine.synthesize(chunk, job.voice_id, rate=job.rate)
            parts.append(result.audio)
            job.done_chunks += 1
            job.progress = job.done_chunks / max(job.total_chunks, 1)
            log.info("Job %s: chunk %d/%d", job.id, job.done_chunks, job.total_chunks)
        if not parts:
            raise RuntimeError("Synthesis produced no audio.")
        return parts

    # ------------------------------------------------------------- stitching
    def _stitch_to_file(self, job: Job, parts: list[bytes], out_path: Path) -> None:
        """Join chunk MP3s into one file.

        Preferred: ffmpeg concat demuxer with stream copy (fast, no generation
        loss, inserts exact silence gaps). Fallback: pure-Python concatenation
        with ID3v2 tags stripped from subsequent parts - playable in all
        browsers and media players even without ffmpeg installed.
        """
        ffmpeg = shutil.which("ffmpeg")
        
        if ffmpeg:
            try:
                self._stitch_ffmpeg(ffmpeg, job, parts, out_path)
                return
            except Exception:  # noqa: BLE001 - degrade gracefully to pure python
                log.warning("ffmpeg stitching failed; falling back to raw concat", exc_info=True)
        self._stitch_python(parts, out_path)

    def _stitch_ffmpeg(self, ffmpeg: str, job: Job, parts: list[bytes], out_path: Path) -> None:
        tmp_dir = self.audio_dir / f".{job.id}.tmp"
        tmp_dir.mkdir(exist_ok=True)
        try:
            chunk_files = []
            for i, part in enumerate(parts):
                p = tmp_dir / f"chunk_{i:04d}.mp3"
                p.write_bytes(part)
                chunk_files.append(p)
            list_file = tmp_dir / "concat.txt"
            list_file.write_text(
                "".join(f"file '{p.as_posix()}'\n" for p in chunk_files), encoding="utf-8"
            )
            completed = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                 "-f", "concat", "-safe", "0", "-i", str(list_file),
                 "-c", "copy", str(out_path)],
                capture_output=True, text=True, timeout=600,
            )
            if completed.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
                raise RuntimeError(f"ffmpeg exited {completed.returncode}: {completed.stderr[:300]}")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    @staticmethod
    def _stitch_python(parts: list[bytes], out_path: Path) -> None:
        data = parts[0] + b"".join(_strip_id3v2(p) for p in parts[1:])
        out_path.write_bytes(data)

    # ------------------------------------------------------------- history
    def _persist(self, job: Job) -> None:
        if not self.settings.PERSIST_HISTORY or job.is_preview:
            return
        try:
            with SessionLocal() as session:
                session.add(JobRecord(
                    id=job.id, voice_id=job.voice_id, engine=job.engine, rate=job.rate,
                    is_preview=job.is_preview, status=job.status, progress=1.0, error=job.error,
                    audio_path=job.audio_path, total_chunks=job.total_chunks,
                    created_at=job.created_at, completed_at=job.completed_at,
                    text_preview=job.text[:200],
                ))
                session.commit()
        except Exception:  # history must never break synthesis
            log.exception("Failed to persist job record %s", job.id)

    def delete(self, job_id: str) -> bool:
        job = self.jobs.pop(job_id, None)
        if job is None:
            return False
        job.status = "cancelled"
        if job.audio_path:
            try:
                Path(job.audio_path).unlink(missing_ok=True)
            except OSError:
                log.warning("Could not delete audio file %s", job.audio_path)
        return True

    def cleanup_expired(self) -> int:
        now = datetime.now(timezone.utc)
        removed = 0
        for job_id, job in list(self.jobs.items()):
            if (now - job.created_at).total_seconds() > self.settings.JOB_TTL_SECONDS:
                self.delete(job_id)
                removed += 1
        return removed