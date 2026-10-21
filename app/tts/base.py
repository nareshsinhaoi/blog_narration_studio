"""Shared TTS engine contracts."""
from dataclasses import dataclass
from typing import Protocol

# Short sample used for voice previews, per language.
SAMPLE_TEXTS = {
    "hi-IN": "नमस्ते! यह एक नमूना आवाज़ है। अब आप अपने ब्लॉग लेख को सुन सकते हैं।",
    "en-IN": "Hello! This is a sample voice. Listen to your blog articles in clear, natural Indian English.",
}


@dataclass(frozen=True)
class Voice:
    id: str
    name: str
    language: str          # BCP-47, e.g. "hi-IN"
    language_label: str    # Human-readable
    gender: str            # "Female" | "Male"
    engine: str


@dataclass
class SynthesisResult:
    audio: bytes
    content_type: str = "audio/mpeg"


class TTSEngine(Protocol):
    name: str

    def list_voices(self, language: str | None = None) -> list[Voice]: ...
    def synthesize(self, text: str, voice_id: str, rate: float = 1.0) -> SynthesisResult: ...