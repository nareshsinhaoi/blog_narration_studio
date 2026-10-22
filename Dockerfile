FROM python:3.12-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install ffmpeg (required for your manager.py audio stitching)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Create the audio data directory (useful for local testing)
RUN mkdir -p /app/data/audio

# Render dynamically assigns a PORT. We default to 8000 for local testing.
# Using shell format ("sh", "-c") allows the $PORT variable to be evaluated.
ENV PORT=8000
EXPOSE $PORT

# CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
# CMD ["sh", "-c", "echo '--- DIAGNOSTIC START ---' && pwd && ls -la && echo '--- STARTING UVICORN ---' && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

CMD ["sh", "-c", "echo '--- DIAGNOSTIC START ---' && pwd && ls -la /app && python -c 'import app.main; print(\"IMPORT SUCCESSFUL\")' && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]