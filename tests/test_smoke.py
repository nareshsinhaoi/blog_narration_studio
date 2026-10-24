"""Offline smoke tests (no network / no TTS engine calls).

Run with:  pytest tests/ -v
"""
import os
import sys
import time

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.tts.base import SynthesisResult  # noqa: E402
from app.tts.manager import (  # noqa: E402
    _strip_id3v2, estimate_duration_seconds, split_into_chunks,
)
from app.api.routes import manager  # noqa: E402
from app.tts import manager as manager_mod  # noqa: E402

client = TestClient(app)
CLIENT_ID = "290001909"


# ---------------------------------------------------------------- unit tests
def test_split_into_chunks_respects_boundaries_and_limit():
    text = (
        "यह पहला अनुच्छेद है। यह भी उसी में है!\n\n"
        "Second paragraph. With two sentences. " + ("word " * 600)
    )
    chunks = split_into_chunks(text, max_chars=1500)
    assert len(chunks) > 1
    assert all(len(c) <= 1500 for c in chunks)
    assert any("पहला" in c for c in chunks)  # Hindi preserved
    joined = " ".join(chunks)
    assert "Second paragraph" in joined


def test_estimate_duration_scales_with_rate():
    text = "one " * 140  # 140 words -> ~60 s at 1.0x
    assert 55 <= estimate_duration_seconds(text, 1.0) <= 65
    assert estimate_duration_seconds(text, 2.0) < estimate_duration_seconds(text, 1.0)


def test_strip_id3v2():
    payload = b"\xff\xfb\x90\x64" + b"x" * 100
    # ID3v2 header claiming 127 bytes of tag payload (synchsafe size)
    tag = b"ID3\x04\x00\x00" + b"\x00\x00\x00\x7f" + b"\x00" * 127
    assert _strip_id3v2(tag + payload) == payload
    assert _strip_id3v2(payload) == payload  # no tag -> untouched


def test_remove_expired_audio_files_only_removes_files_older_than_12_hours(tmp_path, monkeypatch):
    old_file = tmp_path / "old.mp3"
    recent_file = tmp_path / "recent.mp3"
    nested_dir = tmp_path / "temp"
    nested_dir.mkdir()
    nested_file = nested_dir / "chunk.mp3"
    old_file.write_bytes(b"old")
    recent_file.write_bytes(b"recent")
    nested_file.write_bytes(b"nested")

    now = time.time()
    os.utime(old_file, (now - 13 * 60 * 60, now - 13 * 60 * 60))
    os.utime(nested_dir, (now - 13 * 60 * 60, now - 13 * 60 * 60))
    monkeypatch.setattr(manager, "audio_dir", tmp_path)

    assert manager._remove_expired_audio_files() == 1
    assert not old_file.exists()
    assert recent_file.exists()
    assert nested_file.exists()


# ------------------------------------------------------------- endpoint tests
def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_config():
    r = client.get("/api/config")
    assert r.status_code == 200
    assert r.json()["max_input_chars"] > 0


def test_config_returns_client_ad_image():
    business = client.get("/api/config", params={"client": "290001911"})
    assert business.status_code == 200
    assert business.json()["ad_image"] == (
        "https://img-2.outlookindia.com/outlookindia/banners/2026/10/21/mobile-320x100.jpg"
    )
    assert business.json()["ad_link"] == "http://anywebsite.com"

    india = client.get("/api/config", params={"client": "290001912"})
    assert india.status_code == 200
    assert india.json()["ad_image"] == (
        "https://img-2.outlookindia.com/outlookindia/banners/2026/10/23/grt-banner-320x100.jpg"
    )
    assert india.json()["ad_link"] == "http://anywebsite.com"

    no_ad = client.get("/api/config", params={"client": "290001909"})
    assert no_ad.status_code == 200
    assert no_ad.json()["ad_image"] == (
        "https://upload.wikimedia.org/wikipedia/commons/5/52/Spacer.gif"
    )
    assert no_ad.json()["ad_link"] == "http://anywebsite.com"

    expired = client.get("/api/config", params={"client": "290001910"})
    assert expired.status_code == 403

    invalid = client.get("/api/config", params={"client": "unknown"})
    assert invalid.status_code == 403


def test_edge_voices_listed(monkeypatch):
    # Force the offline static catalog so the test needs no network
    from app.tts import edge_engine as edge_mod

    monkeypatch.setattr(edge_mod, "_fetch_voice_catalog", lambda: [])
    engine = manager._engines["edge"]
    engine._catalog = None
    engine._catalog_fetched_at = 0.0
    r = client.get("/api/voices", params={"engine": "edge", "client": CLIENT_ID})
    assert r.status_code == 200
    ids = {v["id"] for v in r.json()}
    assert {"hi-IN-SwaraNeural", "hi-IN-MadhurNeural",
            "en-IN-NeerjaNeural", "en-IN-PrabhatNeural"} <= ids


def test_voices_filter_by_language():
    r = client.get("/api/voices", params={
        "engine": "edge", "language": "hi-IN", "client": CLIENT_ID,
    })
    assert r.status_code == 200
    assert all(v["language"] == "hi-IN" for v in r.json())


def test_voice_list_requires_a_valid_client():
    assert client.get("/api/voices").status_code == 401
    assert client.get("/api/voices", params={"client": "unknown"}).status_code == 403


def test_job_validation_empty_text():
    r = client.post("/api/tts/jobs", json={
        "text": "   ", "voice_id": "hi-IN-SwaraNeural", "engine": "edge", "rate": 1.0,
        "client": CLIENT_ID, "lang": "hi-IN",
    })
    assert r.status_code == 422


def test_job_validation_unknown_voice():
    r = client.post("/api/tts/jobs", json={
        "text": "नमस्ते", "voice_id": "no-such-voice", "engine": "edge", "rate": 1.0,
        "client": CLIENT_ID, "lang": "hi-IN",
    })
    assert r.status_code == 400


def test_google_engine_reports_configuration_error():
    r = client.post("/api/tts/jobs", json={
        "text": "hello", "voice_id": "hi-IN-Standard-A", "engine": "google", "rate": 1.0,
        "client": CLIENT_ID, "lang": "hi-IN",
    })
    # 400 (validation) or 502 (engine unavailable) are both acceptable without credentials
    assert r.status_code in (400, 502)


def test_preview_and_full_generation_with_mock_engine(monkeypatch):
    """End-to-end job lifecycle with a mocked engine (no network, no ffmpeg)."""
    import time

    def fake_synthesize(text, voice_id, rate=1.0):
        frame = b"\xff\xfb\x90\x64" + b"\x00" * 414  # mp3-frame-sync + filler
        return SynthesisResult(audio=frame + text.encode("utf-8")[:64])

    monkeypatch.setattr(manager._engines["edge"], "synthesize", fake_synthesize)
    # Force the pure-Python stitch path so the test never needs ffmpeg
    monkeypatch.setattr(manager_mod.shutil, "which", lambda name: None)

    with TestClient(app) as test_client:
        r = test_client.post("/api/tts/preview", json={
            "voice_id": "hi-IN-SwaraNeural", "engine": "edge", "rate": 1.0,
            "client": CLIENT_ID, "lang": "hi-IN",
        })
        assert r.status_code == 202
        job_id = r.json()["id"]

        status = {}
        for _ in range(50):
            status = test_client.get(f"/api/tts/jobs/{job_id}").json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.1)
        assert status["status"] == "completed", status
        assert status["audio_url"] is not None

        audio = test_client.get(status["audio_url"])
        assert audio.status_code == 200
        assert audio.headers["content-type"] == "audio/mpeg"
        assert len(audio.content) > 0

        cleanup = test_client.delete(f"/api/tts/jobs/{job_id}")
        assert cleanup.status_code == 204

        r = test_client.post("/api/tts/jobs", json={
            "text": "नमस्ते। यह एक परीक्षण है।",
            "voice_id": "hi-IN-SwaraNeural",
            "engine": "edge",
            "rate": 1.0,
            "client": CLIENT_ID,
            "lang": "hi-IN",
        })
        assert r.status_code == 202
        job_id = r.json()["id"]

        for _ in range(50):
            status = test_client.get(f"/api/tts/jobs/{job_id}").json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.1)
        assert status["status"] == "completed", status
        assert status["audio_url"] is not None

        cleanup = test_client.delete(f"/api/tts/jobs/{job_id}")
        assert cleanup.status_code == 204

def test_widget_page_served():
    r = client.get("/player")
    assert r.status_code == 200
    assert "widget.js" in r.text
    assert "articleText" in r.text


def test_config_has_widget_fields():
    r = client.get("/api/config")
    body = r.json()
    assert body["widget_engine"] == "edge"
    assert body["widget_voice"].startswith("en-IN-")
    assert body["auto_generate_on_load"] is True


def test_expressive_voice_in_static_fallback(monkeypatch):
    from app.tts import edge_engine as edge_mod

    monkeypatch.setattr(edge_mod, "_fetch_voice_catalog", lambda: [])
    engine = manager._engines["edge"]
    engine._catalog = None
    engine._catalog_fetched_at = 0.0
    ids = {v.id for v in engine.list_voices()}
    assert "en-IN-NeerjaExpressiveNeural" in ids

def test_embed_page_served():
    r = client.get("/embed")
    assert r.status_code == 200
    assert "embed-player-v2.js" in r.text
    assert '<a id="adLink" href="http://anywebsite.com" target="_blank" rel="noopener noreferrer">' in r.text
    assert '<img id="adImg" alt="Advertisement" />' in r.text
    assert 'id="voiceBar"' in r.text
    assert 'id="seekBar"' in r.text


def test_spacer_gif_is_served_as_one_pixel():
    r = client.get("/static/spacer.gif")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/gif"
    assert r.content[:6] in (b"GIF87a", b"GIF89a")
    assert int.from_bytes(r.content[6:8], "little") == 1
    assert int.from_bytes(r.content[8:10], "little") == 1
