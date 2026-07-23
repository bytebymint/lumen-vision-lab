import {FaceLandmarker, FilesetResolver} from "../vendor/mediapipe/vision_bundle.mjs";
import {CameraSession, cameraError, populateCameraSelect} from "./camera.js";

const video = document.querySelector("#studio-video");
const canvas = document.querySelector("#studio-canvas");
const context = canvas.getContext("2d");
const setup = document.querySelector("#studio-setup");
const setupCamera = document.querySelector("#studio-setup-camera");
const activeCamera = document.querySelector("#studio-camera");
const startButton = document.querySelector("#studio-start");
const consent = document.querySelector("#studio-consent");
const errorBox = document.querySelector("#studio-error");
const progress = document.querySelector("#studio-progress");
const loadStatus = document.querySelector("#studio-load-status");
const status = document.querySelector("#studio-status");
const controls = document.querySelector("#studio-controls");
const tracking = document.querySelector("#studio-tracking");
const trackingLabel = document.querySelector("#studio-tracking-label");
const modeLabel = document.querySelector("#studio-mode-label");
const title = document.querySelector("#studio-title");
const description = document.querySelector("#studio-description");
const upload = document.querySelector("#studio-upload");
const uploadLabel = document.querySelector("#upload-label");
const clearUpload = document.querySelector("#studio-clear-upload");
const camera = new CameraSession(video);

const FACE_OVAL = [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389, 251, 284, 332, 297, 338];
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const OUTER_MOUTH = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181];
const effects = {
  neon: {label: "NEON MUSE", title: "Neon<br><em>Muse.</em>", copy: "A reactive avatar with eye, mouth, and head-turn sync."},
  fox: {label: "SOLAR FOX", title: "Solar<br><em>Fox.</em>", copy: "A warm illustrated mask that follows your expression."},
  pixel: {label: "PIXEL PULSE", title: "Pixel<br><em>Pulse.</em>", copy: "A playful digital face that reads your eyes and smile."},
  blur: {label: "SOFT BLUR", title: "Soft<br><em>Blur.</em>", copy: "A local privacy effect mapped to your face contour."},
  portrait: {label: "PORTRAIT MASK", title: "Portrait<br><em>Mask.</em>", copy: "Your chosen local image follows your face. Real eyes and mouth stay live for expression sync."},
};
let landmarker = null;
let portraitLandmarker = null;
let running = false;
let frame = 0;
let lastInference = 0;
let effect = "neon";
let portrait = null;
let portraitUrl = null;
let portraitFeatures = null;
let smoothedConfidence = 0;
const blurCanvas = document.createElement("canvas");
const blurContext = blurCanvas.getContext("2d");

async function createLandmarker(runningMode) {
  const files = await FilesetResolver.forVisionTasks("/static/vendor/mediapipe/wasm");
  const options = {
    baseOptions: {modelAssetPath: "/static/models/face_landmarker.task", delegate: "GPU"},
    runningMode, numFaces: 1, minFaceDetectionConfidence: .6,
    minFacePresenceConfidence: .6, minTrackingConfidence: .6,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  };
  try { return await FaceLandmarker.createFromOptions(files, options); }
  catch (error) { options.baseOptions.delegate = "CPU"; return FaceLandmarker.createFromOptions(files, options); }
}

async function loadModel() {
  if (landmarker) return;
  progress.style.width = "22%";
  loadStatus.textContent = "Opening the local face mesh...";
  landmarker = await createLandmarker("VIDEO");
  progress.style.width = "100%";
  loadStatus.textContent = "Local face mesh ready.";
}

async function allowCamera() {
  errorBox.textContent = "";
  if (!consent.checked) { errorBox.textContent = "Confirm that you have permission before starting the camera."; return; }
  startButton.disabled = true;
  startButton.textContent = "Requesting camera...";
  try {
    const devices = await camera.request(setupCamera.value || null);
    populateCameraSelect(setupCamera, devices, camera.activeDeviceId());
    startButton.textContent = "Preparing local face mesh...";
    await loadModel();
    populateCameraSelect(activeCamera, await camera.devices(), camera.activeDeviceId());
    setup.classList.add("hidden"); controls.hidden = false;
    status.classList.add("live"); status.querySelector("span").textContent = "Face tracking live";
    running = true; loop();
  } catch (error) {
    errorBox.textContent = error?.name ? cameraError(error) : "The local face mask could not start.";
    startButton.disabled = false; startButton.textContent = "Allow camera access";
  }
}

function geometry() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const videoRatio = video.videoWidth / Math.max(video.videoHeight, 1);
  const canvasRatio = width / Math.max(height, 1);
  const renderWidth = videoRatio > canvasRatio ? width : height * videoRatio;
  const renderHeight = videoRatio > canvasRatio ? width / videoRatio : height;
  return {width, height, renderWidth, renderHeight, offsetX: (width - renderWidth) / 2, offsetY: (height - renderHeight) / 2};
}

function point(landmark, g) { return {x: g.offsetX + landmark.x * g.renderWidth, y: g.offsetY + landmark.y * g.renderHeight}; }
function path(indices, landmarks, g) { context.beginPath(); indices.forEach((index, position) => { const p = point(landmarks[index], g); position ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y); }); context.closePath(); }
function bounds(landmarks, g) {
  const points = FACE_OVAL.map(index => point(landmarks[index], g));
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return {x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)};
}
function blendshape(result, name) { return result.faceBlendshapes?.[0]?.categories?.find(item => item.categoryName === name)?.score || 0; }

function drawBlur(landmarks, g) {
  const ratio = devicePixelRatio || 1;
  const width = Math.round(g.width * ratio), height = Math.round(g.height * ratio);
  if (blurCanvas.width !== width || blurCanvas.height !== height) { blurCanvas.width = width; blurCanvas.height = height; }
  blurContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  blurContext.clearRect(0, 0, g.width, g.height);
  blurContext.filter = "blur(18px) saturate(.78)";
  blurContext.drawImage(video, g.offsetX, g.offsetY, g.renderWidth, g.renderHeight);
  blurContext.filter = "none";
  context.save(); path(FACE_OVAL, landmarks, g); context.clip();
  context.drawImage(blurCanvas, 0, 0, g.width, g.height);
  context.restore();
  context.save(); path(FACE_OVAL, landmarks, g); context.strokeStyle = "rgba(207,218,255,.3)"; context.lineWidth = 1; context.stroke(); context.restore();
}

function drawAvatar(landmarks, result, g, kind) {
  const box = bounds(landmarks, g);
  const leftEye = point(landmarks[468] || landmarks[33], g), rightEye = point(landmarks[473] || landmarks[263], g);
  const mouth = point(landmarks[13], g), nose = point(landmarks[1], g);
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const yaw = Math.max(-.75, Math.min(.75, (nose.x - (leftEye.x + rightEye.x) / 2) / Math.max(box.width * .2, 1)));
  const blinkLeft = blendshape(result, "eyeBlinkLeft"), blinkRight = blendshape(result, "eyeBlinkRight");
  const smile = Math.max(blendshape(result, "mouthSmileLeft"), blendshape(result, "mouthSmileRight"));
  const jaw = Math.max(blendshape(result, "jawOpen"), blendshape(result, "mouthOpen"));
  const eyeHeight = Math.max(4, box.height * .05 * (1 - (blinkLeft + blinkRight) / 2));
  drawHeadShell(box, roll, yaw, kind, smile);
  context.save(); path(FACE_OVAL, landmarks, g); context.clip();
  const palette = kind === "fox" ? ["#ffbd62", "#e96e49", "#4c193a"] : kind === "pixel" ? ["#75e9dd", "#5871ee", "#111a45"] : ["#ff80c4", "#a99cff", "#201338"];
  const gradient = context.createLinearGradient(box.x, box.y, box.x + box.width, box.y + box.height);
  gradient.addColorStop(0, palette[0]); gradient.addColorStop(.58, palette[1]); gradient.addColorStop(1, palette[2]);
  context.fillStyle = gradient; context.fillRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
  context.globalCompositeOperation = "screen"; context.fillStyle = "rgba(255,255,255,.16)"; context.fillRect(box.x, box.y, box.width, box.height * .4); context.globalCompositeOperation = "source-over";
  if (kind === "pixel") { context.fillStyle = "rgba(5,9,24,.18)"; for (let x = box.x; x < box.x + box.width; x += 8) for (let y = box.y; y < box.y + box.height; y += 8) context.fillRect(x, y, 4, 4); }
  context.restore();
  drawLiveFeatures(landmarks, g, box, leftEye, rightEye, mouth, eyeHeight, smile, jaw, kind);
  context.save(); path(FACE_OVAL, landmarks, g); context.strokeStyle = kind === "fox" ? "rgba(69,23,56,.75)" : "rgba(241,236,255,.48)"; context.lineWidth = 1.5; context.stroke(); context.restore();
}

function drawHeadShell(box, roll, yaw, kind, smile) {
  const centerX = box.x + box.width * (.5 + yaw * .045);
  const centerY = box.y + box.height * .43;
  const radiusX = box.width * .76;
  const radiusY = box.height * .86;
  const palette = kind === "fox" ? ["#ffca6b", "#e36e4f", "#48183c"] : kind === "pixel" ? ["#78e9df", "#5a73ee", "#10193e"] : ["#ff87c7", "#aa9dff", "#1b153a"];
  context.save(); context.translate(centerX, centerY); context.rotate(roll);
  if (kind === "fox") {
    context.fillStyle = "#ffbf61"; context.strokeStyle = "#451738"; context.lineWidth = Math.max(2, box.width * .012);
    [-1, 1].forEach(side => {
      context.beginPath(); context.moveTo(side * radiusX * .78, -radiusY * .33); context.lineTo(side * radiusX * .52, -radiusY * 1.25); context.lineTo(side * radiusX * .18, -radiusY * .68); context.closePath(); context.fill(); context.stroke();
      context.fillStyle = "#ff8d82"; context.beginPath(); context.moveTo(side * radiusX * .59, -radiusY * .43); context.lineTo(side * radiusX * .5, -radiusY * 1.02); context.lineTo(side * radiusX * .29, -radiusY * .66); context.closePath(); context.fill(); context.fillStyle = "#ffbf61";
    });
  }
  context.beginPath();
  context.moveTo(0, -radiusY);
  context.bezierCurveTo(radiusX * .72, -radiusY * .98, radiusX * 1.04, -radiusY * .32, radiusX * .92, radiusY * .2);
  context.bezierCurveTo(radiusX * .82, radiusY * .78, radiusX * .42, radiusY * 1.04, 0, radiusY * 1.08);
  context.bezierCurveTo(-radiusX * .42, radiusY * 1.04, -radiusX * .82, radiusY * .78, -radiusX * .92, radiusY * .2);
  context.bezierCurveTo(-radiusX * 1.04, -radiusY * .32, -radiusX * .72, -radiusY * .98, 0, -radiusY);
  context.closePath();
  const gradient = context.createLinearGradient(-radiusX, -radiusY, radiusX, radiusY);
  gradient.addColorStop(0, palette[0]); gradient.addColorStop(.53, palette[1]); gradient.addColorStop(1, palette[2]);
  context.fillStyle = gradient; context.fill();
  context.clip();
  context.fillStyle = "rgba(255,255,255,.12)"; context.beginPath(); context.ellipse(-radiusX * .27, -radiusY * .48, radiusX * .42, radiusY * .31, -.45, 0, Math.PI * 2); context.fill();
  context.globalCompositeOperation = "overlay"; context.fillStyle = "rgba(255,255,255,.12)";
  for (let x = -radiusX; x < radiusX; x += 9) for (let y = -radiusY; y < radiusY; y += 9) if ((x + y) % 18 === 0) context.fillRect(x, y, 3, 3);
  context.globalCompositeOperation = "source-over";
  context.restore();
  context.save(); context.translate(centerX, centerY); context.rotate(roll); context.beginPath(); context.ellipse(0, 0, radiusX * .94, radiusY * 1.05, 0, 0, Math.PI * 2); context.strokeStyle = kind === "fox" ? "rgba(69,23,56,.82)" : "rgba(230,224,255,.45)"; context.lineWidth = Math.max(2, box.width * .011); context.shadowColor = palette[0]; context.shadowBlur = 20 + smile * 13; context.stroke(); context.restore();
}

function drawLiveFeatures(landmarks, g, box, leftEye, rightEye, mouth, eyeHeight, smile, jaw, kind) {
  const eyeColor = kind === "fox" ? "#35152f" : "#121632";
  context.save(); context.strokeStyle = eyeColor; context.lineWidth = Math.max(2, box.width * .018); context.lineCap = "round";
  [[70, 63, 105, 66, 107], [336, 296, 334, 293, 300]].forEach(indices => { context.beginPath(); indices.forEach((index, position) => { const p = point(landmarks[index], g); position ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y); }); context.stroke(); });
  context.fillStyle = eyeColor; context.shadowColor = "rgba(255,255,255,.45)"; context.shadowBlur = 8;
  [leftEye, rightEye].forEach(eye => { context.beginPath(); context.ellipse(eye.x, eye.y, box.width * .075, eyeHeight, 0, 0, Math.PI * 2); context.fill(); });
  context.shadowBlur = 0; context.fillStyle = "#fff7ff"; [leftEye, rightEye].forEach(eye => { context.beginPath(); context.arc(eye.x + box.width * .012, eye.y - eyeHeight * .2, Math.max(1.5, box.width * .014), 0, Math.PI * 2); context.fill(); });
  context.fillStyle = kind === "fox" ? "#5d1740" : "#30143a"; path(OUTER_MOUTH, landmarks, g); context.fill();
  context.strokeStyle = "rgba(255,225,248,.75)"; context.lineWidth = Math.max(1, box.width * .008); context.beginPath(); const leftCorner = point(landmarks[61], g), rightCorner = point(landmarks[291], g); context.moveTo(leftCorner.x, leftCorner.y); context.quadraticCurveTo(mouth.x, mouth.y + box.height * (.025 + smile * .065 + jaw * .025), rightCorner.x, rightCorner.y); context.stroke(); context.restore();
}

function drawPortrait(landmarks, result, g) {
  if (!portrait) { drawAvatar(landmarks, result, g, "neon"); return; }
  const target = [point(landmarks[468] || landmarks[33], g), point(landmarks[473] || landmarks[263], g), point(landmarks[13], g)];
  context.save(); path(FACE_OVAL, landmarks, g); context.clip();
  if (portraitFeatures) {
    const matrix = affineMatrix(portraitFeatures, target);
    context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    context.filter = "contrast(1.04) saturate(.92)";
    context.drawImage(portrait, 0, 0);
  } else {
    const box = bounds(landmarks, g), scale = Math.max((box.width + 16) / portrait.width, (box.height + 16) / portrait.height);
    const width = portrait.width * scale, height = portrait.height * scale;
    context.drawImage(portrait, box.x + box.width / 2 - width / 2, box.y + box.height / 2 - height / 2, width, height);
  }
  context.restore();
  [LEFT_EYE, RIGHT_EYE, OUTER_MOUTH].forEach(indices => { context.save(); path(indices, landmarks, g); context.clip(); context.drawImage(video, g.offsetX, g.offsetY, g.renderWidth, g.renderHeight); context.restore(); });
  context.save(); path(FACE_OVAL, landmarks, g); context.strokeStyle = "rgba(169,156,255,.78)"; context.lineWidth = 2; context.shadowColor = "#a99cff"; context.shadowBlur = 16; context.stroke(); context.restore();
}

function affineMatrix(source, target) {
  const solve = values => {
    const [p1, p2, p3] = source, [v1, v2, v3] = values;
    const det = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y);
    if (Math.abs(det) < .001) return [1, 0, 0];
    return [
      (v1 * (p2.y - p3.y) + v2 * (p3.y - p1.y) + v3 * (p1.y - p2.y)) / det,
      (v1 * (p3.x - p2.x) + v2 * (p1.x - p3.x) + v3 * (p2.x - p1.x)) / det,
      (v1 * (p2.x * p3.y - p3.x * p2.y) + v2 * (p3.x * p1.y - p1.x * p3.y) + v3 * (p1.x * p2.y - p2.x * p1.y)) / det,
    ];
  };
  const [a, c, e] = solve(target.map(p => p.x));
  const [b, d, f] = solve(target.map(p => p.y));
  return {a, b, c, d, e, f};
}

function drawFrame(landmarks, result) {
  const g = geometry(), ratio = devicePixelRatio || 1;
  const width = Math.max(1, Math.round(g.width * ratio)), height = Math.max(1, Math.round(g.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, g.width, g.height);
  if (!landmarks) return;
  const box = bounds(landmarks, g);
  const rawConfidence = Math.min(1, Math.max(.2, box.width / Math.min(g.width, g.height) * 3.4));
  smoothedConfidence += (rawConfidence - smoothedConfidence) * .3;
  if (effect === "blur") drawBlur(landmarks, g);
  else if (effect === "portrait") drawPortrait(landmarks, result, g);
  else drawAvatar(landmarks, result, g, effect);
  const quality = Math.round(smoothedConfidence * 100);
  tracking.style.width = `${quality}%`; trackingLabel.textContent = quality > 56 ? "Locked" : "Finding";
}

function loop() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2 && now - lastInference > 33) {
    lastInference = now;
    try {
      const result = landmarker.detectForVideo(video, now);
      const landmarks = result.faceLandmarks?.[0] || null;
      drawFrame(landmarks, result);
      if (!landmarks) { tracking.style.width = "0%"; trackingLabel.textContent = "Find face"; }
    } catch (error) { trackingLabel.textContent = "Recovering"; }
  }
  frame = requestAnimationFrame(loop);
}

function selectEffect(next) {
  effect = next;
  document.querySelectorAll(".effect-card").forEach(button => button.classList.toggle("active", button.dataset.effect === next));
  const copy = effects[next]; modeLabel.textContent = copy.label; title.innerHTML = copy.title; description.textContent = copy.copy;
}

async function inspectPortrait(image) {
  try {
    portraitLandmarker ||= await createLandmarker("IMAGE");
    const landmarks = portraitLandmarker.detect(image).faceLandmarks?.[0];
    if (!landmarks) return null;
    const pixel = index => landmarks[index] ? {x: landmarks[index].x * image.naturalWidth, y: landmarks[index].y * image.naturalHeight} : null;
    const features = [pixel(468) || pixel(33), pixel(473) || pixel(263), pixel(13)];
    return features.every(Boolean) ? features : null;
  } catch (error) {
    return null;
  }
}

function readPortrait(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { errorBox.textContent = "Choose a PNG, JPEG, or WebP portrait image."; return; }
  if (portraitUrl) URL.revokeObjectURL(portraitUrl);
  portraitUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = async () => {
    portrait = image;
    uploadLabel.textContent = "Aligning portrait...";
    portraitFeatures = await inspectPortrait(image);
    uploadLabel.textContent = portraitFeatures ? "Portrait mask active" : "Portrait mask active";
    if (!portraitFeatures) errorBox.textContent = "The portrait loaded, but its face could not be aligned. Using a centered fallback mask.";
    clearUpload.hidden = false;
    selectEffect("portrait");
  };
  image.onerror = () => { errorBox.textContent = "That portrait image could not be opened."; URL.revokeObjectURL(portraitUrl); portraitUrl = null; };
  image.src = portraitUrl;
}

function stop() {
  running = false; cancelAnimationFrame(frame); camera.stop();
  controls.hidden = true; setup.classList.remove("hidden"); status.classList.remove("live"); status.querySelector("span").textContent = "Camera off";
  tracking.style.width = "0%"; trackingLabel.textContent = "Waiting"; startButton.disabled = false; startButton.textContent = "Allow camera access";
}

startButton.addEventListener("click", allowCamera);
setupCamera.addEventListener("change", async () => { if (!setupCamera.value) return; try { await camera.request(setupCamera.value); } catch (error) { errorBox.textContent = cameraError(error); } });
activeCamera.addEventListener("change", async () => { running = false; cancelAnimationFrame(frame); try { await camera.request(activeCamera.value); running = true; loop(); } catch (error) { errorBox.textContent = cameraError(error); } });
document.querySelectorAll(".effect-card").forEach(button => button.addEventListener("click", () => selectEffect(button.dataset.effect)));
upload.addEventListener("change", () => readPortrait(upload.files?.[0]));
clearUpload.addEventListener("click", () => { portrait = null; portraitFeatures = null; if (portraitUrl) URL.revokeObjectURL(portraitUrl); portraitUrl = null; upload.value = ""; uploadLabel.textContent = "Use portrait mask"; clearUpload.hidden = true; selectEffect("neon"); });
document.querySelector("#studio-stop").addEventListener("click", stop);
window.addEventListener("beforeunload", () => { if (portraitUrl) URL.revokeObjectURL(portraitUrl); camera.stop(); });
