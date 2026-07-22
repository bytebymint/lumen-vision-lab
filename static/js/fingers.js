import {FilesetResolver, HandLandmarker} from "../vendor/mediapipe/vision_bundle.mjs";
import {CameraSession, cameraError, populateCameraSelect} from "./camera.js";

const video = document.getElementById("finger-video");
const canvas = document.getElementById("finger-canvas");
const context = canvas.getContext("2d");
const setup = document.getElementById("finger-setup");
const setupCamera = document.getElementById("finger-setup-camera");
const activeCamera = document.getElementById("finger-camera");
const controls = document.getElementById("finger-controls");
const startButton = document.getElementById("finger-start");
const errorBox = document.getElementById("finger-error");
const progress = document.getElementById("finger-model-progress");
const status = document.getElementById("finger-status");
const totalLabel = document.getElementById("finger-total");
const breakdown = document.getElementById("finger-breakdown");
const display = document.getElementById("count-display");
const tip = document.getElementById("finger-tip");
const camera = new CameraSession(video);

const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
let landmarker = null;
let permissionGranted = false;
let running = false;
let animationFrame = 0;
let lastInference = 0;
let votes = [];
let stableTotal = null;

async function loadModel() {
  if (landmarker) return;
  progress.style.width = "35%";
  const files = await FilesetResolver.forVisionTasks("/static/vendor/mediapipe/wasm");
  const options = {
    baseOptions: {modelAssetPath: "/static/models/hand_landmarker.task", delegate: "GPU"},
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.62, minHandPresenceConfidence: 0.62, minTrackingConfidence: 0.62,
  };
  progress.style.width = "65%";
  try { landmarker = await HandLandmarker.createFromOptions(files, options); }
  catch (error) { options.baseOptions.delegate = "CPU"; landmarker = await HandLandmarker.createFromOptions(files, options); }
  progress.style.width = "100%";
}

async function firstStep() {
  errorBox.textContent = "";
  startButton.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires localhost or HTTPS.");
    const devices = await camera.request();
    permissionGranted = true;
    populateCameraSelect(setupCamera, devices, camera.activeDeviceId());
    setupCamera.classList.add("visible");
    startButton.textContent = "Start number recognition";
    progress.style.width = "15%";
    loadModel().catch(() => {});
  } catch (error) { errorBox.textContent = error.name ? cameraError(error) : error.message; }
  finally { startButton.disabled = false; }
}

async function startRecognition() {
  errorBox.textContent = "";
  startButton.disabled = true;
  startButton.textContent = "Preparing local hand model...";
  try {
    if (setupCamera.value && setupCamera.value !== camera.activeDeviceId()) await camera.request(setupCamera.value);
    await loadModel();
    const devices = await camera.devices();
    populateCameraSelect(activeCamera, devices, camera.activeDeviceId());
    setup.classList.add("hidden"); controls.hidden = false;
    status.classList.add("live"); status.querySelector("span").textContent = "Tracking up to 2 hands";
    running = true; loop();
  } catch (error) {
    errorBox.textContent = error.name ? cameraError(error) : "The local hand model could not start.";
    startButton.disabled = false; startButton.textContent = "Start number recognition";
  }
}

function loop() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2 && now - lastInference > 65) {
    lastInference = now;
    const result = landmarker.detectForVideo(video, now);
    processHands(result);
  }
  animationFrame = requestAnimationFrame(loop);
}

function jointAngle(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const cb = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const dot = ab[0]*cb[0] + ab[1]*cb[1] + ab[2]*cb[2];
  const length = Math.hypot(...ab) * Math.hypot(...cb) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / length))) * 180 / Math.PI;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

function countHand(hand) {
  const wrist = hand[0];
  let count = 0;
  const fingers = [[8,6,5],[12,10,9],[16,14,13],[20,18,17]];
  for (const [tipIndex, pipIndex, mcpIndex] of fingers) {
    const extended = jointAngle(hand[tipIndex], hand[pipIndex], hand[mcpIndex]) > 154 &&
      distance(hand[tipIndex], wrist) > distance(hand[pipIndex], wrist) * 1.12;
    if (extended) count++;
  }
  const palmCenter = {x:(hand[0].x+hand[5].x+hand[9].x+hand[17].x)/4,y:(hand[0].y+hand[5].y+hand[9].y+hand[17].y)/4,z:0};
  const thumbExtended = jointAngle(hand[4], hand[3], hand[2]) > 145 &&
    distance(hand[4], palmCenter) > distance(hand[3], palmCenter) * 1.12 &&
    distance(hand[4], hand[5]) > distance(hand[3], hand[5]) * 1.08;
  return count + (thumbExtended ? 1 : 0);
}

function processHands(result) {
  const hands = result.landmarks || [];
  const counts = hands.map(countHand);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (hands.length) {
    votes.push(total); if (votes.length > 12) votes.shift();
    const frequency = new Map(); votes.forEach(value => frequency.set(value, (frequency.get(value) || 0) + 1));
    const winner = [...frequency.entries()].sort((a,b) => b[1]-a[1])[0];
    if (winner[1] >= Math.min(7, votes.length)) stableTotal = winner[0];
    totalLabel.textContent = stableTotal ?? total;
    breakdown.textContent = hands.length === 2 ? `Left / right: ${counts.join(" + ")}` : `${counts[0]} on one visible hand`;
    display.classList.toggle("uncertain", stableTotal === null);
    tip.textContent = stableTotal === null ? "Hold the pose for a moment while the reading stabilizes." : "Stable reading. Change your fingers whenever you are ready.";
  } else {
    votes = []; stableTotal = null; totalLabel.textContent = "--";
    breakdown.textContent = "Show your hands to begin"; display.classList.add("uncertain");
    tip.textContent = "Face your palms toward the camera, keep every fingertip visible, and separate touching fingers.";
  }
  drawHands(hands, counts);
}

function renderGeometry() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const videoRatio = video.videoWidth / Math.max(video.videoHeight,1), canvasRatio = width / Math.max(height,1);
  const renderWidth = videoRatio > canvasRatio ? width : height * videoRatio;
  const renderHeight = videoRatio > canvasRatio ? width / videoRatio : height;
  return {width,height,renderWidth,renderHeight,offsetX:(width-renderWidth)/2,offsetY:(height-renderHeight)/2};
}

function drawHands(hands, counts) {
  const g = renderGeometry(); const ratio = devicePixelRatio || 1;
  canvas.width = Math.round(g.width * ratio); canvas.height = Math.round(g.height * ratio);
  context.setTransform(ratio,0,0,ratio,0,0); context.clearRect(0,0,g.width,g.height);
  const point = p => ({x:g.offsetX + (1-p.x)*g.renderWidth,y:g.offsetY + p.y*g.renderHeight});
  hands.forEach((hand,index) => {
    context.strokeStyle = "rgba(244,202,100,.72)"; context.lineWidth = 2;
    CONNECTIONS.forEach(([a,b]) => {const p1=point(hand[a]),p2=point(hand[b]);context.beginPath();context.moveTo(p1.x,p1.y);context.lineTo(p2.x,p2.y);context.stroke();});
    context.fillStyle = "#f4ca64"; hand.forEach(mark => {const p=point(mark);context.beginPath();context.arc(p.x,p.y,3,0,Math.PI*2);context.fill();});
    const wrist=point(hand[0]);context.fillStyle="rgba(4,9,7,.85)";context.fillRect(wrist.x-28,wrist.y+12,56,35);context.fillStyle="#f4ca64";context.font="600 25px 'Space Grotesk'";context.textAlign="center";context.fillText(String(counts[index]),wrist.x,wrist.y+39);
  });
}

startButton.addEventListener("click", () => permissionGranted ? startRecognition() : firstStep());
setupCamera.addEventListener("change", async () => { try { await camera.request(setupCamera.value); } catch (error) { errorBox.textContent = cameraError(error); } });
activeCamera.addEventListener("change", async () => { running=false;cancelAnimationFrame(animationFrame);await camera.request(activeCamera.value);running=true;loop(); });
document.getElementById("finger-stop").addEventListener("click", () => {running=false;cancelAnimationFrame(animationFrame);camera.stop();setup.classList.remove("hidden");controls.hidden=true;permissionGranted=false;setupCamera.classList.remove("visible");startButton.textContent="Allow camera access";progress.style.width="0";status.classList.remove("live");status.querySelector("span").textContent="Camera off";});
window.addEventListener("beforeunload",()=>camera.stop());

