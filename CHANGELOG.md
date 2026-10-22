Here is a comprehensive Change Log documenting all the updates, fixes, and features we've implemented for the **Blog Narration Studio (VaniTTS) Embed Player**.

You can save this in your project root as `CHANGELOG.md`.

---

# Changelog

All notable changes to the **VaniTTS Embed Player** are documented in this file.

## [1.8.0] - 2026-10-22

### Added
- **Discrete Speaking Speed Control:** Replaced the standard HTML range slider with a custom, TrinityAudio-style discrete bar slider. 
- **Speed Drawer UI:** Added a compact `1.0x` toggle button next to the playback controls that reveals the speed bar as an overlay, keeping the player UI clean. Speeds range from `0.5x` to `2.0x`.
- **Responsive Advertisement Banner:** Added a dedicated ad slot (`#adSlot`) that displays an image while the player is in the "Waiting for article…" state. The banner is 300x250 on mobile and fluid/responsive on desktop.
- **Voice Gender Icons:** Replaced the text-based `(F)` and `(M)` tags in the voice selector with standard gender symbols (`♀` and `♂`), complete with custom pink/blue styling for better visual recognition.
- **Custom Voice Display Names:** Implemented a mapping dictionary (`VOICE_DISPLAY_NAMES`) to map complex backend voice IDs to clean, readable names in the UI (e.g., `en-IN-NeerjaExpressiveNeural` becomes **Neerja (Expressive)**).

### Changed
- **Voice Switching Behavior:** When a user clicks a new voice agent, the current audio now pauses, the audio source is cleared, and the player resets. The user must manually tap "Play" to hear the new voice, preventing overlapping audio and abrupt auto-play.
- **Speed Switching Behavior:** Similar to voice changes, selecting a new speed immediately halts the current playback, resets the player, and regenerates the audio in the background.
- **Ad Hide Logic:** The advertisement banner now permanently hides for the session as soon as the user performs any interaction (clicking play, changing speed, switching voice, or dragging the seek bar).
- **Backend Validation:** Updated `schemas.py` to allow `rate` values down to `0.5` (`ge=0.5`) to support the new slower playback speeds.

### Fixed
- Fixed an issue where the standard HTML slider was difficult to interact with on mobile devices; the new custom bar uses comfortable, tappable touch targets.
- Fixed layout shifts by ensuring the ad container is hidden via CSS (`display: none`) until explicitly revealed by the JS state logic.

---

## [1.7.0] - Initial Baseline

### Features
- **Embeddable Iframe Player:** Cross-site audio player mounted via `postMessage` for seamless integration on external blogs (e.g., Outlook India).
- **Edge TTS Integration:** Auto-generates audio using Microsoft Edge neural voices (free tier).
- **Playback Controls:** Play/Pause, Skip ±10s, seekable progress bar, and volume control.
- **Auto-Generation:** Automatically generates audio on page load or upon receiving the article text.
- **Dynamic Height:** Iframe automatically resizes to fit the player contents using `ResizeObserver` and `postMessage`.