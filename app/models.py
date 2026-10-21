"""SQLAlchemy models for generation history (optional persistence)."""
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from .database import Base


class JobRecord(Base):
    __tablename__ = "job_records"

    id = Column(String(36), primary_key=True)
    voice_id = Column(String(64), nullable=False)
    engine = Column(String(32), nullable=False)
    rate = Column(Float, default=1.0)
    is_preview = Column(Boolean, default=False)
    status = Column(String(16), nullable=False)
    progress = Column(Float, default=0.0)
    error = Column(String(500), nullable=True)
    audio_path = Column(String(300), nullable=True)
    total_chunks = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    text_preview = Column(Text, nullable=True)  # first 200 chars, for history display only