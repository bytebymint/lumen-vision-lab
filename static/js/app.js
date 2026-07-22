import {CalibrationProfile, FocusAnalyzer, clamp} from "./scoring.js";
import {VisionEngine} from "./vision.js";

const $ = id => document.getElementById(id);
const elements = Object.fromEntries([
  "setup-modal", "setup-close", "permission-button", "permission-error", "continue-without-camera",
  "camera-select", "camera-confirm-button", "camera-error", "setup-video", "calibration-video",
  "camera-video", "landmark-canvas", "camera-stage", "camera-placeholder", "camera-name", "camera-state-label",
  "change-camera-button", "calibration-button", "calibration-error", "calibration-progress", "calibration-count",
  "quality-label", "face-guide", "session-button", "break-button", "elapsed-time", "goal-label", "state-label",
  "status-orb", "focus-score-title", "score-value", "score-progress", "score-glow", "score-ring-title",
  "score-insight", "confidence-pill", "streak-value", "interruptions-value", "blink-value", "fps-label",
  "recalibrate-button", "focus-chart", "empty-chart", "top-status", "privacy-label", "intervention",
  "intervention-kicker", "intervention-title", "intervention-copy", "dismiss-intervention", "settings-button",
  "settings-close", "settings-drawer", "drawer-backdrop", "goal-select", "reminders-toggle", "landmarks-toggle",
  "sound-toggle", "summary-modal", "summary-score", "summary-focused", "summary-streak", "summary-interruptions",
  "summary-message", "new-session-button", "toast-region",
].map(id => [id.replaceAll("-", "_"), $(id)]));

const vision = new VisionEngine();
const calibration = new CalibrationProfile();
let analyzer = null;
let stream = null;
let latestSignals = null;
let latestReading = null;
let setupStep = 1;
let calibrating = false;
let calibrationTimer = null;
let calibrationOnly = false;
let active = false;
let onBreak = false;
let sessionId = null;
let sessionStartedAt = 0;
let timer = null;
let elapsedSeconds = 0;
let focusedSeconds = 0;
let distractedSeconds = 0;
let breakSeconds = 0;
let currentStreak = 0;
let bestStreak = 0;
let interruptions = 0;
let previousTimedState = "uncertain";
let pendingSamples = [];
let scoreHistory = [];
let latestRenderAt = 0;
let distractedSince = 0;
let postureSince = 0;
let lastInterventionAt = 0;
let interventionTimeout = null;
let phoneAttentionSince = 0;

function showStep(step) {
  setupStep = step;
  document.querySelectorAll(".setup-step").forEach(node => node.classList.toggle("active", Number(node.dataset.step) === step));
  document.querySelectorAll(".setup-progress i").forEach((node, index) => node.classList.toggle("active", index < step));
  const heading = document.querySelector(`.setup-step[data-step="${step}"] h2`);
  if (heading) heading.focus?.({preventScroll: true});
}

function openSetup(step = 1) {
  elements.setup_modal.classList.add("is-open");
  document.body.style.overflow = "hidden";
  showStep(step);
}

function closeSetup({keepCamera = false} = {}) {
  elements.setup_modal.classList.remove("is-open");
  document.body.style.overflow = "";
  if (!keepCamera && !active) stopCamera();
}

function setButtonLoading(button, loading, label) {
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
  button.disabled = loading;
  button.innerHTML = loading ? `<span class="button-spinner" aria-hidden="true"></span>${label}` : button.dataset.originalLabel;
}

function errorMessage(error) {
  if (error?.name === "NotAllowedError") return "Camera permission was blocked. Allow camera access in your browser's site settings, then try again.";
  if (error?.name === "NotFoundError") return "No camera was found. Connect a webcam and try again.";
  if (error?.name === "NotReadableError") return "That camera is busy in another application. Close the other app and try again.";
  if (error?.name === "OverconstrainedError") return "The selected camera cannot provide the requested video mode. Choose another camera.";
  return "The camera could not start. Check your browser permissions and try again.";
}

async function attachStream(mediaStream) {
  [elements.setup_video, elements.calibration_video, elements.camera_video].forEach(video => {
    video.srcObject = mediaStream;
    video.play().catch(() => {});
  });
}

async function openCamera(deviceId = null) {
  stopCamera(false);
  const constraints = {
    audio: false,
    video: {
      width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30},
      ...(deviceId ? {deviceId: {exact: deviceId}} : {facingMode: "user"}),
    },
  };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  await attachStream(stream);
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  const cameras = await navigator.mediaDevices.enumerateDevices();
  const selected = cameras.find(device => device.deviceId === settings.deviceId);
  elements.camera_name.textContent = selected?.label || track.label || "Selected camera";
  return cameras.filter(device => device.kind === "videoinput");
}

function stopCamera(clearVideos = true) {
  vision.stop();
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  if (clearVideos) [elements.setup_video, elements.calibration_video, elements.camera_video].forEach(video => { video.srcObject = null; });
  elements.camera_stage.classList.remove("is-live");
  elements.top_status.classList.remove("is-live");
  elements.privacy_label.textContent = "Camera is off";
  elements.camera_state_label.textContent = "OFFLINE";
  elements.fps_label.textContent = "0 FPS";
}

function populateCameras(cameras) {
  elements.camera_select.innerHTML = "";
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    elements.camera_select.append(option);
  });
  const activeId = stream?.getVideoTracks()[0]?.getSettings()?.deviceId;
  if (activeId) elements.camera_select.value = activeId;
}

async function requestCameraPermission() {
  elements.permission_error.textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.permission_error.textContent = "Camera access requires a modern browser on localhost or HTTPS.";
    return;
  }
  setButtonLoading(elements.permission_button, true, "Requesting permission...");
  try {
    const cameras = await openCamera();
    populateCameras(cameras);
    showStep(2);
  } catch (error) {
    elements.permission_error.textContent = errorMessage(error);
  } finally {
    setButtonLoading(elements.permission_button, false, "");
  }
}

async function switchCamera() {
  elements.camera_error.textContent = "";
  elements.camera_confirm_button.disabled = true;
  try {
    const cameras = await openCamera(elements.camera_select.value);
    populateCameras(cameras);
  } catch (error) {
    elements.camera_error.textContent = errorMessage(error);
  } finally {
    elements.camera_confirm_button.disabled = false;
  }
}

async function prepareCalibration() {
  elements.camera_error.textContent = "";
  setButtonLoading(elements.camera_confirm_button, true, "Loading local vision model...");
  try {
    await vision.initialize();
    showStep(3);
    elements.calibration_button.disabled = true;
    elements.quality_label.textContent = "Finding your face...";
    vision.start(elements.calibration_video, null, result => {
      latestSignals = result.signals;
      const ready = Boolean(result.signals);
      elements.face_guide.classList.toggle("good", ready);
      elements.quality_label.textContent = ready ? "Face found - ready to calibrate" : "Center your face in the guide";
      if (!calibrating) elements.calibration_button.disabled = !ready;
      if (calibrating && result.signals) calibration.add(result.signals);
    });
  } catch (error) {
    elements.camera_error.textContent = "The local vision model could not initialize. Reload the app or verify the model files.";
    showToast("Vision model failed to load. No camera frames were transmitted.");
  } finally {
    setButtonLoading(elements.camera_confirm_button, false, "");
  }
}

function runCalibration() {
  if (calibrating || !latestSignals) return;
  calibrating = true;
  calibration.reset();
  elements.calibration_error.textContent = "";
  elements.calibration_button.disabled = true;
  const stage = elements.calibration_video.parentElement;
  stage.classList.add("is-calibrating");
  const started = performance.now();
  const duration = 6000;
  calibrationTimer = setInterval(async () => {
    const progress = clamp((performance.now() - started) / duration * 100);
    elements.calibration_progress.style.strokeDashoffset = String(100 - progress);
    elements.calibration_count.textContent = String(Math.max(0, Math.ceil((duration - (performance.now() - started)) / 1000)));
    if (progress < 100) return;
    clearInterval(calibrationTimer);
    calibrating = false;
    stage.classList.remove("is-calibrating");
    const profile = calibration.build(72);
    if (!profile || profile.quality < 55) {
      elements.calibration_error.textContent = "The reading was too unstable. Improve the lighting, center your face, and try once more.";
      elements.quality_label.textContent = profile ? `Signal quality ${Math.round(profile.quality)}% - needs improvement` : "Not enough face readings";
      elements.calibration_button.disabled = false;
      elements.calibration_progress.style.strokeDashoffset = "100";
      elements.calibration_count.textContent = "6";
      return;
    }
    elements.quality_label.textContent = `Signal quality ${Math.round(profile.quality)}% - strong baseline`;
    analyzer = new FocusAnalyzer(profile);
    if (calibrationOnly && active) {
      calibrationOnly = false;
      closeSetup({keepCamera: true});
      beginVisionLoop();
      showToast("Your personal baseline has been refreshed.");
    } else {
      await startSession(profile);
    }
  }, 100);
}

async function startSession(profile) {
  const goal = Number(elements.goal_select.value);
  const cameraLabel = elements.camera_name.textContent;
  try {
    const response = await fetch("/api/sessions", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({goal_minutes: goal, camera_label: cameraLabel, calibration_quality: profile.quality}),
    });
    if (!response.ok) throw new Error("Session API failed");
    sessionId = (await response.json()).id;
  } catch (error) {
    sessionId = null;
    showToast("The session will run locally, but metrics could not be saved.");
  }
  active = true;
  onBreak = false;
  sessionStartedAt = Date.now();
  elapsedSeconds = focusedSeconds = distractedSeconds = breakSeconds = currentStreak = bestStreak = interruptions = 0;
  previousTimedState = "uncertain";
  pendingSamples = [];
  scoreHistory = [];
  latestReading = null;
  elements.empty_chart.style.display = "none";
  elements.camera_stage.classList.add("is-live");
  elements.top_status.classList.add("is-live");
  elements.privacy_label.textContent = "On-device analysis active";
  elements.camera_state_label.textContent = "LOCAL / LIVE";
  elements.session_button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10"/></svg> End session`;
  elements.session_button.classList.remove("button-primary");
  elements.session_button.classList.add("button-secondary");
  elements.break_button.disabled = false;
  elements.recalibrate_button.disabled = false;
  elements.goal_label.textContent = `of ${goal} min`;
  closeSetup({keepCamera: true});
  beginVisionLoop();
  clearInterval(timer);
  timer = setInterval(sessionTick, 1000);
  sessionTick();
}

function beginVisionLoop() {
  vision.stop();
  vision.showLandmarks = elements.landmarks_toggle.checked;
  vision.start(elements.camera_video, elements.landmark_canvas, result => {
    latestSignals = result.signals;
    elements.fps_label.textContent = `${result.fps} FPS`;
    if (!active || onBreak || !analyzer) return;
    const phoneContext = evaluatePhoneAttention(result.phone, result.signals, result.timestamp);
    latestReading = analyzer.update(result.signals, result.timestamp, phoneContext);
    if (result.timestamp - latestRenderAt > 160) {
      latestRenderAt = result.timestamp;
      renderReading(latestReading);
      evaluateIntervention(latestReading, result.timestamp);
    }
  });
}

function evaluatePhoneAttention(phone, signals, timestamp) {
  if (!phone?.visible || !signals || !analyzer) {
    phoneAttentionSince = 0;
    return {phoneVisible: false, phoneHeld: false, phoneAttention: false};
  }
  const profile = analyzer.profile;
  const phoneCenterX = phone.box ? phone.box.x + phone.box.width / 2 : signals.faceX;
  const phoneCenterY = phone.box ? phone.box.y + phone.box.height / 2 : signals.faceY;
  const horizontalDirection = Math.sign(phoneCenterX - signals.faceX);
  const lookingDown = phoneCenterY > signals.faceY + 0.06 && (
    signals.pitch - profile.pitch > 0.055 || signals.gazeY - profile.gazeY > 0.07
  );
  const lookingSideways = Math.abs(phoneCenterX - signals.faceX) > 0.12 &&
    Math.sign(signals.yaw - profile.yaw) === horizontalDirection &&
    Math.abs(signals.yaw - profile.yaw) > 0.065;
  const evidenceNow = phone.holding && (lookingDown || lookingSideways);
  if (evidenceNow) phoneAttentionSince ||= timestamp;
  else phoneAttentionSince = 0;
  return {
    phoneVisible: true,
    phoneHeld: phone.holding,
    phoneAttention: Boolean(phoneAttentionSince && timestamp - phoneAttentionSince >= 1200),
  };
}

function renderReading(reading) {
  const score = Math.round(reading.focusScore);
  const confidence = Math.round(reading.confidence);
  elements.score_value.textContent = String(score);
  elements.score_progress.style.strokeDashoffset = String(100 - score);
  elements.score_glow.style.strokeDashoffset = String(100 - score);
  elements.score_ring_title.textContent = `Focus score is ${score} out of 100 with ${confidence}% confidence`;
  elements.confidence_pill.textContent = `${confidence}% confidence`;
  elements.state_label.textContent = stateCopy(reading.state);
  elements.status_orb.className = `status-orb ${reading.state}`;
  elements.blink_value.textContent = String(reading.blinkRate);
  const insight = {
    focused: "Your signals are steady. Keep the current pace.",
    drifting: "Attention is softening slightly. A small reset may help.",
    distracted: "Several signals moved away from your baseline.",
    phone: "A phone is in hand and your attention is directed toward it.",
    away: "No face is visible. The session remains private and paused from judgement.",
    uncertain: "Signal confidence is rebuilding. No judgement is being made.",
  };
  elements.score_insight.textContent = insight[reading.state] || insight.uncertain;
  updateSignal("gaze", reading.gazeScore, reading.details.gaze);
  updateSignal("head", reading.headScore, reading.details.head);
  updateSignal("posture", reading.postureScore, reading.details.posture);
  updateSignal("fatigue", reading.fatigueScore, reading.details.fatigue);
  updateSignal("phone", reading.phoneScore, reading.details.phone);
}

function updateSignal(name, value, detail) {
  const rounded = Math.round(value);
  $(`${name}-value`).textContent = String(rounded);
  $(`${name}-detail`).textContent = detail;
  const meter = $(`${name}-meter`);
  meter.style.width = `${rounded}%`;
  meter.style.background = rounded >= 72 ? "var(--mint)" : rounded >= 50 ? "var(--amber)" : "var(--coral)";
}

function stateCopy(state) {
  return {focused: "Deep focus", drifting: "Attention drifting", distracted: "Distracted", phone: "Phone distraction", away: "Away from camera", uncertain: "Reading signals", break: "On a restorative break"}[state] || "Reading signals";
}

function sessionTick() {
  if (!active) return;
  elapsedSeconds = Math.max(elapsedSeconds + 1, Math.floor((Date.now() - sessionStartedAt) / 1000));
  elements.elapsed_time.textContent = formatClock(elapsedSeconds);
  if (onBreak) {
    breakSeconds++;
    elements.state_label.textContent = stateCopy("break");
    elements.status_orb.className = "status-orb drifting";
  } else if (latestReading) {
    const state = latestReading.state;
    if (state === "focused") {
      focusedSeconds++;
      currentStreak++;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      if (["distracted", "phone", "away"].includes(state)) distractedSeconds++;
      if (["distracted", "phone", "away"].includes(state) && ["focused", "drifting"].includes(previousTimedState)) interruptions++;
      if (state !== "uncertain") currentStreak = 0;
    }
    previousTimedState = state;
    const sample = {
      elapsed_seconds: elapsedSeconds,
      focus_score: Math.round(latestReading.focusScore * 10) / 10,
      confidence: Math.round(latestReading.confidence * 10) / 10,
      state,
      gaze_score: Math.round(latestReading.gazeScore * 10) / 10,
      head_score: Math.round(latestReading.headScore * 10) / 10,
      posture_score: Math.round(latestReading.postureScore * 10) / 10,
      presence_score: Math.round(latestReading.presenceScore * 10) / 10,
      fatigue_score: Math.round(latestReading.fatigueScore * 10) / 10,
      phone_score: Math.round(latestReading.phoneScore * 10) / 10,
    };
    pendingSamples.push(sample);
    scoreHistory.push(sample);
    if (scoreHistory.length > 900) scoreHistory.shift();
    drawChart();
  }
  elements.streak_value.textContent = formatMinutes(bestStreak);
  elements.interruptions_value.textContent = String(interruptions);
  if (pendingSamples.length >= 5) flushSamples();
  const goalSeconds = Number(elements.goal_select.value) * 60;
  if (elapsedSeconds >= goalSeconds) finishSession();
}

async function flushSamples() {
  if (!sessionId || !pendingSamples.length) return;
  const samples = pendingSamples.splice(0, pendingSamples.length);
  try {
    const response = await fetch(`/api/sessions/${sessionId}/samples`, {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({samples}), keepalive: true,
    });
    if (!response.ok) throw new Error("save failed");
  } catch (error) {
    pendingSamples.unshift(...samples.slice(-60));
  }
}

async function finishSession() {
  if (!active) return;
  active = false;
  clearInterval(timer);
  timer = null;
  await flushSamples();
  const validScores = scoreHistory.filter(item => item.confidence >= 45 && item.state !== "away").map(item => item.focus_score);
  const average = validScores.length ? Math.round(validScores.reduce((sum, value) => sum + value, 0) / validScores.length) : 0;
  if (sessionId) {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({average_focus: average, focused_seconds: focusedSeconds, distracted_seconds: distractedSeconds, break_seconds: breakSeconds, interruptions}),
      });
    } catch (error) { showToast("The final summary could not be saved, but it remains visible here."); }
  }
  stopCamera();
  elements.break_button.disabled = true;
  elements.recalibrate_button.disabled = true;
  elements.session_button.classList.add("button-primary");
  elements.session_button.classList.remove("button-secondary");
  elements.session_button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 8 6-8 6Z"/></svg> Set up camera`;
  elements.summary_score.textContent = String(average);
  elements.summary_focused.textContent = formatMinutes(focusedSeconds);
  elements.summary_streak.textContent = formatMinutes(bestStreak);
  elements.summary_interruptions.textContent = String(interruptions);
  elements.summary_message.textContent = average >= 80 ? "Your attention stayed remarkably stable. Protect the conditions that made this block work." : average >= 62 ? "A solid session with a few recoverable drifts. Your strongest periods are already visible." : "This block had friction. Treat the signal as context, not a verdict, and adjust the environment for the next one.";
  elements.summary_modal.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function toggleBreak() {
  if (!active) return;
  onBreak = !onBreak;
  if (onBreak) {
    elements.break_button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 8 6-8 6Z"/></svg> Resume`;
    elements.score_insight.textContent = "Take your eyes off the screen. Lumen is not scoring this time.";
  } else {
    elements.break_button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M17 5v14"/></svg> Break`;
    distractedSince = postureSince = 0;
  }
}

function evaluateIntervention(reading, now) {
  if (!elements.reminders_toggle.checked || onBreak || now - lastInterventionAt < 45000) return;
  if (["distracted", "away"].includes(reading.state)) distractedSince ||= now;
  else distractedSince = 0;
  if (reading.postureScore < 42 && reading.presenceScore > 0) postureSince ||= now;
  else postureSince = 0;
  if (reading.state === "phone") {
    showIntervention("Phone detected", "Put the phone out of reach", "A phone is in your hand and your attention is on it. Move it away before returning to the work.");
  } else if (reading.fatigueScore < 48 && elapsedSeconds > 12 * 60) {
    showIntervention("Recovery signal", "Your eyes may need a real break", "A two-minute distance break will help more than forcing the next paragraph.");
  } else if (distractedSince && now - distractedSince > 8000) {
    showIntervention("Gentle reset", "Bring your eyes back to the work", "The drift lasted long enough to be meaningful, so this is your one quiet nudge.");
  } else if (postureSince && now - postureSince > 12000) {
    showIntervention("Posture check", "Return to your comfortable baseline", "Your position has shifted for a while. Reset without holding yourself rigidly.");
  }
}

function showIntervention(kicker, title, copy) {
  lastInterventionAt = performance.now();
  distractedSince = postureSince = 0;
  elements.intervention_kicker.textContent = kicker;
  elements.intervention_title.textContent = title;
  elements.intervention_copy.textContent = copy;
  elements.intervention.classList.add("is-visible");
  if (elements.sound_toggle.checked) playTone();
  clearTimeout(interventionTimeout);
  interventionTimeout = setTimeout(() => elements.intervention.classList.remove("is-visible"), 10000);
}

function playTone() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(520, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.3);
}

function drawChart() {
  const canvas = elements.focus_chart;
  const rect = canvas.getBoundingClientRect();
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  const width = rect.width, height = rect.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "rgba(190,221,204,.08)"; context.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = 8 + (height - 22) * i / 4; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
  const points = scoreHistory.slice(-240);
  if (points.length < 2) return;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(124,225,188,.23)"); gradient.addColorStop(1, "rgba(124,225,188,0)");
  const coordinates = points.map((point, index) => ({x: index / (points.length - 1) * width, y: 8 + (100 - point.focus_score) / 100 * (height - 22)}));
  context.beginPath(); context.moveTo(coordinates[0].x, height); coordinates.forEach(point => context.lineTo(point.x, point.y)); context.lineTo(width, height); context.closePath(); context.fillStyle = gradient; context.fill();
  context.beginPath(); coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.strokeStyle = "#7ce1bc"; context.lineWidth = 2; context.lineJoin = "round"; context.stroke();
  canvas.setAttribute("aria-label", `Focus timeline with ${points.length} readings. Latest score ${Math.round(points.at(-1).focus_score)}.`);
}

function formatClock(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function formatMinutes(seconds) { return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`; }
function showToast(message) {
  const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message;
  elements.toast_region.append(toast); setTimeout(() => toast.remove(), 4500);
}

function openSettings() {
  elements.settings_drawer.classList.add("is-open"); elements.drawer_backdrop.classList.add("is-open");
  elements.settings_drawer.setAttribute("aria-hidden", "false"); elements.settings_close.focus();
}
function closeSettings() {
  elements.settings_drawer.classList.remove("is-open"); elements.drawer_backdrop.classList.remove("is-open");
  elements.settings_drawer.setAttribute("aria-hidden", "true"); elements.settings_button.focus();
}

elements.permission_button.addEventListener("click", requestCameraPermission);
elements.camera_select.addEventListener("change", switchCamera);
elements.camera_confirm_button.addEventListener("click", prepareCalibration);
elements.calibration_button.addEventListener("click", runCalibration);
elements.continue_without_camera.addEventListener("click", () => closeSetup());
elements.setup_close.addEventListener("click", () => closeSetup({keepCamera: active}));
document.querySelectorAll(".step-back").forEach(button => button.addEventListener("click", () => showStep(Number(button.dataset.back))));
elements.session_button.addEventListener("click", () => active ? finishSession() : openSetup(1));
elements.break_button.addEventListener("click", toggleBreak);
elements.change_camera_button.addEventListener("click", () => active ? showToast("End this session before changing cameras so its baseline remains valid.") : openSetup(1));
elements.recalibrate_button.addEventListener("click", () => { if (!active) return; calibrationOnly = true; vision.stop(); attachStream(stream); openSetup(3); prepareCalibration(); });
elements.dismiss_intervention.addEventListener("click", () => elements.intervention.classList.remove("is-visible"));
elements.settings_button.addEventListener("click", openSettings);
elements.settings_close.addEventListener("click", closeSettings);
elements.drawer_backdrop.addEventListener("click", closeSettings);
elements.landmarks_toggle.addEventListener("change", () => { vision.showLandmarks = elements.landmarks_toggle.checked; });
elements.goal_select.addEventListener("change", () => { if (!active) elements.goal_label.textContent = `of ${elements.goal_select.value} min`; });
elements.new_session_button.addEventListener("click", () => { elements.summary_modal.classList.remove("is-open"); document.body.style.overflow = ""; openSetup(1); });
window.addEventListener("resize", () => { if (scoreHistory.length) drawChart(); });
window.addEventListener("beforeunload", () => { if (active && pendingSamples.length) flushSamples(); stopCamera(); });
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (elements.settings_drawer.classList.contains("is-open")) closeSettings();
  else if (elements.intervention.classList.contains("is-visible")) elements.intervention.classList.remove("is-visible");
  else if (elements.setup_modal.classList.contains("is-open")) closeSetup({keepCamera: active});
});

elements.goal_label.textContent = `of ${elements.goal_select.value} min`;
