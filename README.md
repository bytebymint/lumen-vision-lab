# Lumen Vision Lab

Lumen Vision Lab is a local-first Flask application with five browser-based computer-vision experiences. Camera frames are processed in the browser; the Python server serves the application and stores only numeric Focus Monitor session metrics in a project-local SQLite database.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20browser-1f7a6e)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776ab)
![Runtime](https://img.shields.io/badge/runtime-Flask%20%2B%20MediaPipe-111827)

## Experiences

| Tool | What it does |
| --- | --- |
| **Focus Monitor** | Combines gaze, head pose, posture, face presence, fatigue signals, and held-phone attention into a smoothed focus estimate. |
| **Finger Numbers** | Reads one or two hands and produces a stable number from zero to ten using 21 landmarks per hand. |
| **Expression + Age** | Runs local face detection, mesh, expression, and age-estimation models with confidence gating. Age and expression are approximate visual estimates, not facts about identity or feelings. |
| **Air Canvas** | Draws with one raised index finger, pauses with a fist, and moves completed strokes with a thumb-index pinch. Includes local shape suggestions and several ink styles. |
| **Face Studio** | Applies local landmark-synced full-head avatars, face blur, or a user-supplied portrait mask. Built-in avatars cover the face, hair, and ears while mirroring head pose, eyes, brows, blinking, mouth shape, smile, and jaw movement. |

## Privacy

- Camera permission is requested explicitly by the browser and the user can choose a camera after permission is granted.
- Webcam frames, photos, face embeddings, and hand landmarks are not sent to Flask or stored on disk.
- Face Studio portrait images are processed in browser memory only and are discarded when the page closes. Use only images you own or are authorized to use.
- Focus Monitor stores only numeric session metrics in `data/focus_monitor.db`.
- The application contains no local or remote LLM and requires no API key.
- All runtimes, models, fonts, caches, and databases are repository-relative.

## Requirements

- Windows 10 or 11 with PowerShell
- Python 3.10 or newer available as `python`
- A modern Chromium, Edge, Firefox, or Safari browser with camera permission available

## First installation

1. Open PowerShell in the repository folder.
2. Confirm Python is available:

   ```powershell
   python --version
   ```

3. Create the project-local virtual environment, install Flask and Waitress, and verify that all local model files are present:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   ```

   The script creates `.venv/` and uses `.cache/` inside this project. It does not install a local LLM or download a model to a system folder.

4. Start the server:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start.ps1
   ```

5. Open `http://127.0.0.1:5000` and choose a tool. When prompted, allow camera access for `127.0.0.1`, then choose the camera from the selector.

## Run after installation

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Open `http://127.0.0.1:5000`. Browsers allow camera use on localhost. Serving this application to another device requires HTTPS and an appropriate `Permissions-Policy`.

## How to use each tool

### Focus Monitor

1. Choose **Focus Monitor** on the dashboard and allow camera access.
2. Select the intended camera, then complete the on-screen calibration while sitting naturally at your desk.
3. Start a study session and keep one face visible with reasonably even lighting.
4. Watch the focus state, confidence, and explanation cards. A phone distraction is reported only when a phone is visible, appears held, and attention is directed toward it.
5. End the session to save numeric metrics locally in `data/focus_monitor.db`.

### Finger Numbers

1. Choose **Finger Numbers** and allow camera access.
2. Hold one or two hands in front of the camera with palms facing forward and fingertips visible.
3. Keep the pose still briefly while temporal voting stabilizes the number from zero to ten.
4. Change the gesture whenever ready. Use the camera selector to switch devices or the stop control to release the camera.

### Expression + Age

1. Choose **Expression + Age** and wait for the four local face models to load.
2. Allow camera access, choose a camera, and face it with even front lighting.
3. Keep one face centered and relatively still while the page gathers a stable reading.
4. Treat the expression as a visible-cue estimate and the age as an approximate range. The page intentionally reports uncertainty when confidence is weak.

### Air Canvas

1. Choose **Air Canvas**, allow camera access, and select a camera.
2. Raise only the index finger to draw. Keep the finger visible and move it slowly enough for the camera to track.
3. Close the hand into a fist to pause. Raise the index finger again to begin the next stroke exactly from its current position.
4. Touch thumb and index finger together to enter move mode. Pinch close to a completed stroke, then move the hand to reposition it. Moving a closed outline also moves strokes inside it.
5. Use **Undo** or **Clear** to edit the canvas. Choose an ink color and style before drawing a new stroke.
6. When a paused stroke resembles a circle, square, arrow, heart, or star, choose **Use clean shape** to accept the suggestion or **Keep original** to dismiss it.

### Face Studio

1. Choose **Face Studio**, confirm that you have permission for the camera and any portrait image, then allow camera access.
2. Select **Neon Muse**, **Solar Fox**, or **Pixel Pulse** for an opaque full-head avatar. These cover the face, hair, and ears while following live head position, tilt, turn, eye direction, blinking, brows, mouth shape, smile, and jaw movement.
3. Select **Soft Blur** when you want a local face-only privacy effect instead of an avatar.
4. For a custom portrait mask, choose **Use portrait mask** and select a PNG, JPEG, or WebP image. The browser never uploads it; it remains in memory only until removed or the page closes.
5. Center one face in reasonably even front lighting. Portrait masks deliberately retain the live user eyes and mouth so blinking and mouth movement remain synchronized.
6. Use **Remove portrait** to discard the selected image immediately, or the stop control to release the camera.

## Camera troubleshooting

- If permission was blocked, use the browser site settings for `127.0.0.1` to allow the camera, then reload the page.
- If another camera application is using the device, close it before retrying.
- If tracking is weak, use brighter front lighting, keep the hand or face fully in frame, and select the correct camera.
- Use `Ctrl+F5` after updating the project so the browser reloads the latest JavaScript and model UI.

## Test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Get-ChildItem .\static\js\*.js | ForEach-Object { node --check $_.FullName }
```

## Repository layout

```text
focus_monitor/       Flask application, routes, and SQLite setup
static/js/            Camera, focus, finger, expression, Air Canvas, and Face Studio logic
static/models/        Project-local MediaPipe and TensorFlow Lite model files
static/vendor/        Project-local browser runtimes and model artifacts
templates/            Flask templates for the dashboard and five tools
tests/                Flask route and API tests
setup.ps1             Creates the local Python environment and checks required assets
start.ps1             Starts the local Waitress server
```

## License

This project is licensed under the [MIT License](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, privacy, and repository rules.
