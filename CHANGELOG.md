# Changelog

All notable changes to VaniTTS Blog Narration Studio are documented here.

## [2.0.0] - 2026-10-24

### Added
- Client-based access validation with subscription expiry checks for voice listing and audio generation.
- Per-client advertisement images and destination links configured through `app/clients.json`.
- A transparent 1×1 spacer image for clients without an ad and for expired or invalid subscriptions.
- Automatic cleanup of audio files older than 12 hours before a newly generated MP3 is saved.
- Support for additional Edge TTS locales: English (Singapore), English (Tanzania), and English (United States).
- Request-level language selection for voice validation, previews, and audio generation.

### Changed
- Updated the studio and embed player for client-aware API requests.
- Embed advertisements open their configured destination in a new tab.
- Edge TTS input is normalized to remove invisible characters and repeated whitespace before synthesis.
- Embed player attribution and stylesheet cache version now identify version 2.0.

### Fixed
- Dashboard language selection now follows the active language tab, and the selected language is sent with generation and preview requests.
- Corrected Hindi text chunk preparation so it no longer references an undefined variable.
- Fixed client ID handling so API payloads match the expected string type.
- Kept recent audio files and subdirectories intact during retention cleanup.

## [1.8.0] - 2026-10-22

### Added
- Discrete speaking-speed controls from 0.5× to 2.0× in an overlay drawer.
- A responsive advertisement slot shown while the embed player waits for article text.
- Voice gender icons and readable display names for selected voices.

### Changed
- Voice and speed changes stop current playback before regenerating audio.
- Advertisements hide after the listener interacts with the player.
- Speaking rates down to 0.5× are accepted by the API.

### Fixed
- Improved touch interaction for speed selection and kept the ad slot hidden until it is ready to display.

## [1.7.0] - Initial baseline

### Added
- Embeddable iframe player with automatic article narration and dynamic iframe resizing.
- Microsoft Edge neural text-to-speech integration.
- Playback controls for play/pause, seeking, skipping, volume, and MP3 download.
