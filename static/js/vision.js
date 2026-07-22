import {FaceLandmarker, FilesetResolver, HandLandmarker, ObjectDetector} from "../vendor/mediapipe/vision_bundle.mjs";
import {extractSignals} from "./scoring.js";

const KEY_LANDMARKS = [10, 152, 234, 454, 33, 133, 159, 145, 263, 362, 386, 374, 1, 13, 14, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477];

export class VisionEngine {
  constructor() {
    this.landmarker = null;
    this.objectDetector = null;
    this.handLandmarker = null;
    this.running = false;
    this.animationFrame = 0;
    this.lastInference = 0;
    this.lastObjectInference = 0;
    this.lastHandInference = 0;
    this.phone = {visible: false, holding: false, confidence: 0, box: null};
    this.hands = [];
    this.frames = [];
    this.showLandmarks = true;
  }

  async initialize() {
    if (this.landmarker && this.objectDetector && this.handLandmarker) return;
    const files = await FilesetResolver.forVisionTasks("/static/vendor/mediapipe/wasm");
    const createWithFallback = async (Task, options) => {
      try {
        return await Task.createFromOptions(files, options);
      } catch (error) {
        options.baseOptions.delegate = "CPU";
        return Task.createFromOptions(files, options);
      }
    };
    this.landmarker = await createWithFallback(FaceLandmarker, {
      baseOptions: {modelAssetPath: "/static/models/face_landmarker.task", delegate: "GPU"},
      runningMode: "VIDEO", numFaces: 1,
      minFaceDetectionConfidence: 0.62, minFacePresenceConfidence: 0.62, minTrackingConfidence: 0.62,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    this.objectDetector = await createWithFallback(ObjectDetector, {
      baseOptions: {modelAssetPath: "/static/models/efficientdet_lite0.tflite", delegate: "GPU"},
      runningMode: "VIDEO", maxResults: 3, scoreThreshold: 0.32, categoryAllowlist: ["cell phone"],
    });
    this.handLandmarker = await createWithFallback(HandLandmarker, {
      baseOptions: {modelAssetPath: "/static/models/hand_landmarker.task", delegate: "GPU"},
      runningMode: "VIDEO", numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  }

  start(video, canvas, callback) {
    this.stop();
    this.running = true;
    const context = canvas?.getContext("2d");
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      if (video.readyState >= 2 && now - this.lastInference >= 62) {
        this.lastInference = now;
        try {
          const faceResult = this.landmarker.detectForVideo(video, now);
          const landmarks = faceResult.faceLandmarks?.[0] || null;
          const signals = landmarks ? extractSignals(landmarks, now) : null;
          if (now - this.lastHandInference >= 180) {
            this.lastHandInference = now;
            this.hands = this.handLandmarker.detectForVideo(video, now).landmarks || [];
          }
          if (now - this.lastObjectInference >= 330) {
            this.lastObjectInference = now;
            this.phone = this._readPhone(this.objectDetector.detectForVideo(video, now), video);
          }
          this.phone.holding = this.phone.visible && this._handOverlapsPhone(this.phone.box, video);
          this.frames.push(now);
          this.frames = this.frames.filter(time => now - time < 1000);
          if (canvas && context) this.draw(canvas, context, landmarks, this.phone, video);
          callback({signals, landmarks, phone: this.phone, fps: this.frames.length, timestamp: now});
        } catch (error) {
          callback({signals: null, landmarks: null, phone: this.phone, fps: 0, timestamp: now, error});
        }
      }
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  _readPhone(result, video) {
    const detection = result.detections?.find(item => item.categories?.[0]?.categoryName === "cell phone");
    if (!detection) return {visible: false, holding: false, confidence: 0, box: null};
    const box = detection.boundingBox;
    return {
      visible: true, holding: false,
      confidence: detection.categories[0].score * 100,
      box: {
        x: box.originX / video.videoWidth, y: box.originY / video.videoHeight,
        width: box.width / video.videoWidth, height: box.height / video.videoHeight,
      },
    };
  }

  _handOverlapsPhone(box) {
    if (!box) return false;
    const margin = Math.max(0.045, Math.min(box.width, box.height) * 0.55);
    return this.hands.some(hand => hand.some(point =>
      point.x >= box.x - margin && point.x <= box.x + box.width + margin &&
      point.y >= box.y - margin && point.y <= box.y + box.height + margin
    ));
  }

  draw(canvas, context, landmarks, phone, video) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * devicePixelRatio) || canvas.height !== Math.round(height * devicePixelRatio)) {
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
    }
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const videoRatio = video.videoWidth / Math.max(video.videoHeight, 1);
    const canvasRatio = width / Math.max(height, 1);
    const renderWidth = videoRatio > canvasRatio ? width : height * videoRatio;
    const renderHeight = videoRatio > canvasRatio ? width / videoRatio : height;
    const offsetX = (width - renderWidth) / 2;
    const offsetY = (height - renderHeight) / 2;
    if (landmarks && this.showLandmarks) {
      context.fillStyle = "rgba(124, 225, 188, .58)";
      for (const index of KEY_LANDMARKS) {
        const point = landmarks[index];
        if (!point) continue;
        context.beginPath();
        context.arc(offsetX + (1 - point.x) * renderWidth, offsetY + point.y * renderHeight, index >= 468 ? 1.3 : 1, 0, Math.PI * 2);
        context.fill();
      }
    }
    if (phone?.visible && phone.box) {
      const x = offsetX + (1 - phone.box.x - phone.box.width) * renderWidth;
      const y = offsetY + phone.box.y * renderHeight;
      const boxWidth = phone.box.width * renderWidth;
      const boxHeight = phone.box.height * renderHeight;
      context.strokeStyle = phone.holding ? "#f07855" : "#f2bb62";
      context.fillStyle = "rgba(7, 17, 15, .84)";
      context.lineWidth = 2;
      context.strokeRect(x, y, boxWidth, boxHeight);
      context.fillRect(x, Math.max(0, y - 22), phone.holding ? 104 : 86, 22);
      context.fillStyle = phone.holding ? "#ff9b7c" : "#f2bb62";
      context.font = "600 10px Manrope";
      context.fillText(phone.holding ? "PHONE IN HAND" : "PHONE VISIBLE", x + 6, Math.max(14, y - 7));
    }
  }
}
