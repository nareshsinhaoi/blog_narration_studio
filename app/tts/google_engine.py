"""Premium TTS engine backed by Google Cloud Text-to-Speech.

Requires `pip install google-cloud-texttospeech` and a service-account key
referenced by GOOGLE_APPLICATION_CREDENTIALS. Charged per character.
"""
try:
    from google.cloud import texttospeech
except ImportError:  # optional dependency - app still runs with the free engine
    texttospeech = None

from .base import SynthesisResult, Voice

_GENDER = {}


class GoogleTTSEngine:
    name = "google"

    def __init__(self) -> None:
        self._client = None
        if texttospeech is not None:
            _GENDER.update({
                texttospeech.SsmlVoiceGender.FEMALE: "Female",
                texttospeech.SsmlVoiceGender.MALE: "Male",
                texttospeech.SsmlVoiceGender.NEUTRAL: "Neutral",
            })

    @property
    def client(self):
        if texttospeech is None:
            raise RuntimeError(
                "google-cloud-texttospeech is not installed. "
                "Run: pip install google-cloud-texttospeech"
            )
        if self._client is None:
            self._client = texttospeech.TextToSpeechClient()
        return self._client

    def list_voices(self, language: str | None = None) -> list[Voice]:
        languages = [language] if language else ["hi-IN", "en-IN"]
        voices: list[Voice] = []
        for lang in languages:
            response = self.client.list_voices(language_code=lang)
            for v in response.voices:
                if lang not in v.language_codes:
                    continue
                label = "Hindi" if lang.startswith("hi") else "English (India)"
                voices.append(Voice(
                    id=v.name, name=v.name, language=lang, language_label=label,
                    gender=_GENDER.get(v.ssml_gender, "Unknown"), engine=self.name,
                ))
        return voices

    def synthesize(self, text: str, voice_id: str, rate: float = 1.0) -> SynthesisResult:
        language_code = "-".join(voice_id.split("-")[:2])  # "hi-IN-Standard-A" -> "hi-IN"
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(language_code=language_code, name=voice_id)
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=min(4.0, max(0.25, rate)),
        )
        response = self.client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
        return SynthesisResult(audio=response.audio_content)