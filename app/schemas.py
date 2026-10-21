"""Pydantic request/response schemas."""
from pydantic import BaseModel, Field


class JobCreate(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesize (max enforced by server config)")
    voice_id: str
    engine: str = "edge"
    rate: float = Field(1.0, ge=0.5, le=2.0, description="Speaking-rate multiplier")


class PreviewRequest(BaseModel):
    voice_id: str
    engine: str = "edge"
    rate: float = Field(1.0, ge=0.5, le=2.0)


class VoiceOut(BaseModel):
    id: str
    name: str
    language: str
    language_label: str
    gender: str
    engine: str