# """Free TTS engine backed by Microsoft Edge neural voices (via edge-tts).

# No API key required. Voices use natural neural models and handle Hindi /
# English code-switching (Hinglish) well. Note: this is an unofficial endpoint -
# no SLA. For production SLAs use the Google engine.
# """
# import asyncio

# from .base import SynthesisResult, Voice

# # Curated Indian voices (neural). Extend freely - any edge-tts voice id works.
# EDGE_VOICES = [
#     Voice("hi-IN-SwaraNeural", "Swara", "hi-IN", "Hindi", "Female", "edge"),
#     Voice("hi-IN-MadhurNeural", "Madhur", "hi-IN", "Hindi", "Male", "edge"),
#     Voice("en-IN-NeerjaNeural", "Neerja", "en-IN", "English (India)", "Female", "edge"),
#     Voice("en-IN-PrabhatNeural", "Prabhat", "en-IN", "English (India)", "Male", "edge"),
# ]

# RATE_MIN_PCT, RATE_MAX_PCT = -50, 100


# class EdgeTTSEngine:
#     name = "edge"

#     def list_voices(self, language: str | None = None) -> list[Voice]:
#         return [v for v in EDGE_VOICES if language is None or v.language == language]

#     def synthesize(self, text: str, voice_id: str, rate: float = 1.0) -> SynthesisResult:
#         pct = int(round((rate - 1.0) * 100))
#         pct = max(RATE_MIN_PCT, min(RATE_MAX_PCT, pct))
#         rate_str = f"{pct:+d}%"
#         audio = asyncio.run(self._stream(text, voice_id, rate_str))
#         if not audio:
#             raise RuntimeError(f"edge-tts returned no audio for voice {voice_id!r}.")
#         return SynthesisResult(audio=audio)

#     @staticmethod
#     async def _stream(text: str, voice_id: str, rate_str: str) -> bytes:
#         import edge_tts

#         communicate = edge_tts.Communicate(text, voice_id, rate=rate_str)
#         chunks = []
#         async for chunk in communicate.stream():
#             if chunk["type"] == "audio":
#                 chunks.append(chunk["data"])
#         return b"".join(chunks)

#################################################################################
# Want even more voices?
#
# Two options, both already supported by the architecture:
#
# Google Cloud engine — the premium engine lists its entire catalog dynamically too (GET /api/voices?engine=google): multiple Hindi voices (hi-IN-Neural2-A…D, Wavenet, Standard in both genders) and several Indian English voices. Just add your API key to .env and pick "Google Cloud TTS" in the engine dropdown.
#
# Hardcode extras — if you know a specific voice ID you want pinned, add it to STATIC_EDGE_VOICES in edge_engine.py and it will always be available, even offline.


"""Free TTS engine backed by Microsoft Edge neural voices (via edge-tts).

No API key required. The voice catalog is fetched LIVE from the service at
runtime (cached for 5 minutes), so every male/female Hindi & Indian-English
voice - including newly released ones - appears automatically in the UI.
If the network is unreachable, a curated static list is used as a fallback.

Note: this is an unofficial endpoint - no SLA. For production SLAs use the
Google engine.
"""
import asyncio
import concurrent.futures
import logging
import time

from .base import SynthesisResult, Voice

log = logging.getLogger("tts.edge")

# Curated offline fallback (also used to validate when the network is down).
# STATIC_EDGE_VOICES = [
#     Voice("hi-IN-SwaraNeural", "Swara", "hi-IN", "Hindi", "Female", "edge"),
#     Voice("hi-IN-MadhurNeural", "Madhur", "hi-IN", "Hindi", "Male", "edge"),
#     Voice("en-IN-NeerjaNeural", "Neerja", "en-IN", "English (India)", "Female", "edge"),
#     Voice("en-IN-PrabhatNeural", "Prabhat", "en-IN", "English (India)", "Male", "edge"),
# ]

STATIC_EDGE_VOICES = [
    Voice("hi-IN-SwaraNeural", "Swara", "hi-IN", "Hindi", "Female", "edge"),
    Voice("hi-IN-MadhurNeural", "Madhur", "hi-IN", "Hindi", "Male", "edge"),
    Voice("en-IN-NeerjaExpressiveNeural", "Neerja Expressive", "en-IN", "English (India)", "Female", "edge"),
    Voice("en-IN-NeerjaNeural", "Neerja", "en-IN", "English (India)", "Female", "edge"),
    Voice("en-IN-PrabhatNeural", "Prabhat", "en-IN", "English (India)", "Male", "edge"),
]

SUPPORTED_LOCALES = ("hi-IN", "en-IN")
CACHE_TTL_SECONDS = 300
RATE_MIN_PCT, RATE_MAX_PCT = -50, 100


def _fetch_voice_catalog() -> list[dict]:
    """Fetch the full edge-tts voice list. Runs in its own thread/loop so it is
    safe to call from both sync code and inside a running asyncio loop."""
    import edge_tts

    def _run() -> list[dict]:
        return asyncio.run(edge_tts.list_voices())

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(_run).result(timeout=30)
    except Exception as exc:  # network down / timeout / upstream change
        log.warning("Could not fetch live voice catalog (%s); using static list", exc)
        return []


def _short_name(display_name: str, short_name: str) -> str:
    """'Microsoft Swara Online (Natural) - Hindi (India)' -> 'Swara'."""
    name = display_name.replace("Microsoft ", "").split(" Online")[0].strip()
    return name or short_name.split("-")[2]


class EdgeTTSEngine:
    name = "edge"

    def __init__(self) -> None:
        self._catalog: list[Voice] | None = None
        self._catalog_fetched_at: float = 0.0

    # -------------------------------------------------------------- voices
    def _load_catalog(self) -> list[Voice]:
        now = time.monotonic()
        if self._catalog is not None and now - self._catalog_fetched_at < CACHE_TTL_SECONDS:
            return self._catalog

        raw = _fetch_voice_catalog()
        voices: list[Voice] = []
        for v in raw:
            locale = v.get("Locale", "")
            if locale not in SUPPORTED_LOCALES:
                continue
            short = v.get("ShortName", "")
            gender = (v.get("Gender") or "Unknown").capitalize()
            display = v.get("DisplayName", short)
            label = "Hindi" if locale == "hi-IN" else "English (India)"
            voices.append(Voice(
                id=short,
                name=_short_name(display, short),
                language=locale,
                language_label=label,
                gender=gender,
                engine="edge",
            ))

        if not voices:
            voices = list(STATIC_EDGE_VOICES)  # offline fallback
        # Female first, then male - nicer default ordering in the UI
        voices.sort(key=lambda v: (v.language, v.gender != "Female", v.name))
        self._catalog = voices
        self._catalog_fetched_at = now
        return voices

    def list_voices(self, language: str | None = None) -> list[Voice]:
        return [v for v in self._load_catalog() if language is None or v.language == language]

    # ---------------------------------------------------------- synthesis
    def synthesize(self, text: str, voice_id: str, rate: float = 1.0) -> SynthesisResult:
        pct = int(round((rate - 1.0) * 100))
        pct = max(RATE_MIN_PCT, min(RATE_MAX_PCT, pct))
        rate_str = f"{pct:+d}%"
        audio = asyncio.run(self._stream(text, voice_id, rate_str))
        if not audio:
            raise RuntimeError(f"edge-tts returned no audio for voice {voice_id!r}.")
        return SynthesisResult(audio=audio)

    @staticmethod
    async def _stream(text: str, voice_id: str, rate_str: str) -> bytes:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice_id, rate=rate_str)
        chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)