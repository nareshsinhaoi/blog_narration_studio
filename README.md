# VaniTTS — Enterprise Text-to-Speech for Blog Narration

Convert blog articles into natural-sounding, downloadable **MP3 narration** in
**Hindi (हिन्दी)**, **English (Indian accent)** and **Hinglish-friendly** voices.

- **Backend:** Python · FastAPI · REST API · background job processing
- **Frontend:** HTML5 · CSS3 · vanilla JS (custom HTML5-Audio player)
- **Audio:** edge-tts (free, default) or Google Cloud TTS (premium) · pydub MP3 stitching
- **DB:** SQLite by default; PostgreSQL/MySQL via `DATABASE_URL` (generation history)
- **Deploy:** Dockerfile + docker-compose

---

## 1 · Features

| Area | Details |
|---|---|
| Languages | Hindi (hi-IN), English-India (en-IN); Hinglish works naturally via Hindi neural voices |
| Voices | Male + female neural voices; per-voice **preview**; language/voice compatibility validation |
| Editor | Live word/character counts, estimated audio duration, clear button, input limits, Ctrl+Enter generate |
| Player | Play / Pause / Resume / Stop / ±10 s / seekable progress bar / current–total time / volume + mute |
| Generation | Chunked synthesis of long articles (≤ 20,000 chars/request, configurable), stitched into one MP3 at 192 kbps; speaking-speed control (0.75×–1.5×); background jobs with live progress; graceful failure that **never loses the user's text** |
| Download | Meaningful filename (`vanitts_Hindi-Swara_2026-10-15.mp3`) |
| Ops | Job TTL cleanup, optional history persistence, env-based config, structured logging |

## 2 · Project structure

```
vanitts/
├── app/
│   ├── main.py              # FastAPI entrypoint (uvicorn app.main:app)
│   ├── config.py            # pydantic-settings, .env driven
│   ├── database.py          # SQLAlchemy engine/session
│   ├── models.py            # JobRecord (generation history)
│   ├── schemas.py           # request/response schemas
│   ├── api/routes.py        # REST endpoints
│   ├── tts/
│   │   ├── base.py          # Voice / engine contracts
│   │   ├── edge_engine.py   # free Microsoft neural voices
│   │   ├── google_engine.py # premium Google Cloud voices
│   │   └── manager.py       # chunking + async job processing
│   └── static/              # index.html, css/style.css, js/app.js
├── tests/test_smoke.py      # offline smoke tests (pytest)
├── data/                    # SQLite db + generated MP3s (git-ignored)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
# Embed
```
vanitts/
├── app/
│   ├── main.py              # FastAPI entrypoint (uvicorn app.main:app)
│   ├── config.py            # pydantic-settings, .env driven
│   ├── database.py          # SQLAlchemy engine/session
│   ├── models.py            # JobRecord (generation history)
│   ├── schemas.py           # request/response schemas
│   ├── api/routes.py        # REST endpoints
│   ├── tts/
│   │   ├── base.py          # Voice / engine contracts
│   │   ├── edge_engine.py   # free Microsoft neural voices
│   │   ├── google_engine.py # premium Google Cloud voices
│   │   └── manager.py       # chunking + async job processing
│   └── static/              # index.html, css/style.css, js/app.js
├── tests/test_smoke.py      # offline smoke tests (pytest)
├── data/                    # SQLite db + generated MP3s (git-ignored)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 3 · TTS engines — comparison & costs

### Engine A: Microsoft Edge neural voices via `edge-tts` (DEFAULT — free, no API key)

| | |
|---|---|
| Cost | **Free** — no API key, no account |
| Voices | `hi-IN-SwaraNeural` (F), `hi-IN-MadhurNeural` (M), `en-IN-NeerjaNeural` (F), `en-IN-PrabhatNeural` (M) |
| Hinglish | Excellent — neural Hindi voices code-switch to English naturally |
| Requirement | Outbound HTTPS to `speech.platform.bing.com` at runtime |
| Caveat | Unofficial endpoint, **no SLA** — fine for prototyping/small products; for guaranteed uptime use Google |

### Engine B: Google Cloud TTS (premium, optional)

Requires `pip install google-cloud-texttospeech` and a service-account key
(`GOOGLE_APPLICATION_CREDENTIALS`). Hindi voices: `hi-IN-Neural2-A..D`,
`hi-IN-Wavenet-A..D`, `hi-IN-Standard-A..D`; English (India): `en-IN-*`.
The full catalog is fetched live from the API (`GET /api/voices?engine=google`).

Pay-as-you-go, **per character** (spaces/SSML count), free monthly allowance:

| Voice tier | Free / month | Then |
|---|---|---|
| Standard | 4 M chars | $4 / 1M chars |
| WaveNet | 1 M chars | $4 / 1M chars (price cut in 2026) |
| Neural2 | 1 M chars | $16 / 1M chars |
| Chirp 3 HD | 1 M chars | $30 / 1M chars |

> Verify current pricing at https://cloud.google.com/text-to-speech/pricing — rates change.

**Cost example:** a 1,000-word article ≈ 6,000 characters → ≈ $0.096 on Neural2,
well inside the free tier. (~166k words/month free on Neural2.)

## 4 · Local development

### 4.1 Prerequisites

- Python **3.10+**
- **ffmpeg** (required by pydub to decode/stitch MP3):
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: download from https://ffmpeg.org or `winget install ffmpeg`

### 4.2 Setup

```bash
# 1. Clone / enter the project
cd vanitts

# 2. Create and activate a virtual environment
python -m venv .venv
OR
py -3.13 -m venv venv

source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env               # defaults work out of the box

# 5. Run
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
uvicorn app.main:app --reload --host 0.0.0.0 --port 8006

# 6. Python 3.13 removed audioop

pip install pyaudioop
```
Open **http://localhost:8000** — interactive API docs at `/docs`.

## 5 · Docker

```bash
# Using Docker directly
docker build -t vanitts .
docker run --rm -p 8000:8000 -v vanitts_data:/app/data vanitts

# Using Docker Compose (recommended)
cp .env.example .env
docker compose up --build
```

Production hardening tips: put uvicorn behind nginx/caddy for TLS, set
`APP_ENV=production`, mount `data/` on persistent storage, and inject secrets
via a secrets manager rather than `.env` files.

## 6 · API overview

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | liveness probe |
| GET | `/api/config` | limits & defaults for the UI |
| GET | `/api/voices?engine=edge&language=hi-IN` | voice catalog |
| POST | `/api/tts/jobs` | create generation job → `202` + job id |
| POST | `/api/tts/preview` | create a short voice-preview job |
| GET | `/api/tts/jobs/{id}` | poll status: `queued/processing/completed/failed`, `progress`, `audio_url` |
| GET | `/api/tts/jobs/{id}/audio` | stream the generated MP3 |
| DELETE | `/api/tts/jobs/{id}` | cancel + delete job/audio |
| GET | `/api/tts/history` | persisted generation history |

Example:

```bash
curl -s -X POST http://localhost:8000/api/tts/jobs \
  -H "Content-Type: application/json" \
  -d '{"text":"नमस्ते दुनिया। यह एक परीक्षण है।","voice_id":"hi-IN-SwaraNeural","engine":"edge","rate":1.0}'
# → {"id":"ab12cd34ef56","status":"processing", ...}
curl -s http://localhost:8000/api/tts/jobs/ab12cd34ef56
curl -OJ http://localhost:8000/api/tts/jobs/ab12cd34ef56/audio
```

## 7 · How long-text processing works

1. Input validated (≤ `MAX_INPUT_CHARS`, else HTTP 413) and split on paragraph /
   sentence boundaries — Hindi danda `।` supported — into ≤ `CHUNK_MAX_CHARS` chunks.
2. Each chunk is synthesized in a background thread pool (non-blocking UI);
   per-chunk progress is exposed through the job status endpoint.
3. Chunks are stitched with a configurable silence gap (`CHUNK_SILENCE_MS`)
   and exported as a single **192 kbps MP3** (`MP3_BITRATE`).
4. Audio and in-memory jobs auto-expire after `JOB_TTL_SECONDS`.

## 8 · Testing

```bash
pip install pytest
pytest tests/ -v        # offline: validation, voices, mocked job lifecycle
```

Manual test checklist: paste a long Hindi + English mixed article → pick a voice →
**Preview** → set speed → **Generate Audio** → watch progress → use every player
control → **Download MP3** → confirm filename and playback in another player.

## 9 · Security notes

- API keys live only in environment variables (`.env` is docker-ignored).
- Request size capped server-side; voice/engine compatibility validated before jobs start.
- User text is never persisted — only a 200-char preview in the history table
  (disable with `PERSIST_HISTORY=false`).
- Generated audio is removed on TTL expiry or explicit `DELETE`.

## 10 · License

MIT (choose as appropriate for your organization).
