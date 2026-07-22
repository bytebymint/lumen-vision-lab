const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const deviation = values => {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(mean(values.map(value => (value - center) ** 2)));
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const center = points => ({x: mean(points.map(point => point.x)), y: mean(points.map(point => point.y))});
const scoreDelta = (delta, tolerance, failure) => clamp(100 * (1 - Math.max(0, delta - tolerance) / (failure - tolerance)));

export function extractSignals(landmarks, timestamp = performance.now()) {
  if (!landmarks || landmarks.length < 468) return null;
  const leftOuter = landmarks[33];
  const leftInner = landmarks[133];
  const rightInner = landmarks[362];
  const rightOuter = landmarks[263];
  const leftEyeCenter = center([leftOuter, leftInner, landmarks[159], landmarks[145]]);
  const rightEyeCenter = center([rightInner, rightOuter, landmarks[386], landmarks[374]]);
  const leftIris = landmarks.length >= 478 ? center(landmarks.slice(468, 473)) : leftEyeCenter;
  const rightIris = landmarks.length >= 478 ? center(landmarks.slice(473, 478)) : rightEyeCenter;
  const normalizedIris = (iris, a, b, upper, lower) => {
    const minX = Math.min(a.x, b.x);
    const width = Math.max(Math.abs(a.x - b.x), 0.0001);
    const minY = Math.min(upper.y, lower.y);
    const height = Math.max(Math.abs(upper.y - lower.y), 0.0001);
    return {x: (iris.x - minX) / width, y: (iris.y - minY) / height};
  };
  const leftGaze = normalizedIris(leftIris, leftOuter, leftInner, landmarks[159], landmarks[145]);
  const rightGaze = normalizedIris(rightIris, rightInner, rightOuter, landmarks[386], landmarks[374]);
  const leftOpen = distance(landmarks[159], landmarks[145]) / Math.max(distance(leftOuter, leftInner), 0.0001);
  const rightOpen = distance(landmarks[386], landmarks[374]) / Math.max(distance(rightInner, rightOuter), 0.0001);
  const eyeMid = center([leftEyeCenter, rightEyeCenter]);
  const eyeDistance = Math.max(distance(leftEyeCenter, rightEyeCenter), 0.0001);
  const mouthMid = center([landmarks[13], landmarks[14]]);
  const facePoints = [landmarks[10], landmarks[152], landmarks[234], landmarks[454]];
  const minX = Math.min(...facePoints.map(point => point.x));
  const maxX = Math.max(...facePoints.map(point => point.x));
  const minY = Math.min(...facePoints.map(point => point.y));
  const maxY = Math.max(...facePoints.map(point => point.y));

  return {
    timestamp,
    gazeX: mean([leftGaze.x, rightGaze.x]),
    gazeY: mean([leftGaze.y, rightGaze.y]),
    eyeOpenness: mean([leftOpen, rightOpen]),
    yaw: (landmarks[1].x - eyeMid.x) / eyeDistance,
    pitch: (landmarks[1].y - eyeMid.y) / Math.max(mouthMid.y - eyeMid.y, 0.0001),
    roll: Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x) * 180 / Math.PI,
    faceX: (minX + maxX) / 2,
    faceY: (minY + maxY) / 2,
    faceScale: maxX - minX,
  };
}

export class CalibrationProfile {
  constructor() { this.reset(); }

  reset() {
    this.samples = [];
    this.startedAt = 0;
  }

  add(signals) {
    if (!signals) return;
    this.samples.push(signals);
    if (!this.startedAt) this.startedAt = signals.timestamp;
  }

  build(expectedFrames = 70) {
    if (this.samples.length < 15) return null;
    const fields = ["gazeX", "gazeY", "eyeOpenness", "yaw", "pitch", "roll", "faceX", "faceY", "faceScale"];
    const baseline = Object.fromEntries(fields.map(field => [field, median(this.samples.map(sample => sample[field]))]));
    const presence = clamp(this.samples.length / expectedFrames * 100);
    const stability = clamp(100 - (
      deviation(this.samples.map(s => s.yaw)) * 180 +
      deviation(this.samples.map(s => s.pitch)) * 130 +
      deviation(this.samples.map(s => s.faceX)) * 240
    ));
    const eyeQuality = baseline.eyeOpenness > 0.12 && baseline.eyeOpenness < 0.55 ? 100 : 55;
    const scaleQuality = baseline.faceScale > 0.16 && baseline.faceScale < 0.75 ? 100 : 60;
    const quality = Math.round(presence * 0.35 + stability * 0.35 + eyeQuality * 0.15 + scaleQuality * 0.15);
    return {...baseline, quality: clamp(quality), sampleCount: this.samples.length};
  }
}

export class FocusAnalyzer {
  constructor(profile) {
    this.profile = profile;
    this.smoothed = null;
    this.state = "uncertain";
    this.candidateState = "uncertain";
    this.candidateSince = performance.now();
    this.closedSince = null;
    this.blinks = [];
    this.eyeHistory = [];
    this.lastSeenAt = performance.now();
  }

  update(signals, timestamp = performance.now(), context = {}) {
    if (!signals) return this._missing(timestamp);
    this.lastSeenAt = timestamp;
    const p = this.profile;
    const gazeDelta = Math.hypot((signals.gazeX - p.gazeX) * 1.15, signals.gazeY - p.gazeY);
    const gazeScore = scoreDelta(gazeDelta, 0.07, 0.31);
    const headDelta = Math.max(
      Math.abs(signals.yaw - p.yaw) / 0.22,
      Math.abs(signals.pitch - p.pitch) / 0.28,
      Math.abs(signals.roll - p.roll) / 20
    );
    const headScore = scoreDelta(headDelta, 0.24, 1);
    const centerDelta = Math.hypot(signals.faceX - p.faceX, signals.faceY - p.faceY);
    const scaleDelta = Math.abs(signals.faceScale - p.faceScale) / Math.max(p.faceScale, 0.001);
    const postureScore = Math.min(scoreDelta(centerDelta, 0.025, 0.18), scoreDelta(scaleDelta, 0.08, 0.42));
    const closed = signals.eyeOpenness < p.eyeOpenness * 0.58;
    this._trackBlink(closed, timestamp);
    this.eyeHistory.push({timestamp, closed});
    this.eyeHistory = this.eyeHistory.filter(item => timestamp - item.timestamp < 60000);
    const perclos = this.eyeHistory.length ? this.eyeHistory.filter(item => item.closed).length / this.eyeHistory.length : 0;
    const prolonged = this.closedSince && timestamp - this.closedSince > 850;
    const blinkRate = this.blinks.filter(time => timestamp - time < 60000).length;
    const fatigueScore = clamp(100 - perclos * 190 - Math.max(0, blinkRate - 28) * 1.7 - (prolonged ? 30 : 0));
    const phoneScore = context.phoneAttention ? 4 : context.phoneHeld ? 72 : 100;
    const baseScore = gazeScore * 0.31 + headScore * 0.22 + postureScore * 0.13 + fatigueScore * 0.09 + phoneScore * 0.1 + 15;
    const rawScore = context.phoneAttention ? Math.min(baseScore, 18) : baseScore;
    const alpha = this.smoothed === null ? 1 : context.phoneAttention ? 0.42 : 0.17;
    this.smoothed = this.smoothed === null ? rawScore : this.smoothed + alpha * (rawScore - this.smoothed);
    const confidence = clamp(p.quality * 0.72 + 28 - Math.min(18, Math.abs(signals.faceScale - p.faceScale) * 80));
    const targetState = context.phoneAttention ? "phone" : this.smoothed >= 72 ? "focused" : this.smoothed >= 52 ? "drifting" : "distracted";
    this._setCandidate(targetState, timestamp, targetState === "phone" ? 500 : targetState === "distracted" ? 1100 : 1600);
    return {
      focusScore: clamp(this.smoothed), confidence, state: this.state,
      gazeScore, headScore, postureScore, presenceScore: 100, fatigueScore, phoneScore,
      blinkRate, prolongedBlink: Boolean(prolonged), perclos,
      details: {
        gaze: gazeScore > 75 ? "Eyes aligned with your baseline" : "Gaze has moved from the work",
        head: headScore > 75 ? "Comfortably centered" : "Head angle shifted",
        posture: postureScore > 75 ? "Position is stable" : "Seating position changed",
        fatigue: fatigueScore > 72 ? "No strong fatigue pattern" : "Eye closure is trending upward",
        phone: context.phoneAttention ? "Phone held and receiving attention" : context.phoneHeld ? "Phone in hand; attention not confirmed" : context.phoneVisible ? "Phone visible; not being held" : "No phone interaction detected",
      },
    };
  }

  _trackBlink(closed, timestamp) {
    if (closed && this.closedSince === null) this.closedSince = timestamp;
    if (!closed && this.closedSince !== null) {
      const duration = timestamp - this.closedSince;
      if (duration >= 70 && duration <= 850) this.blinks.push(timestamp);
      this.closedSince = null;
    }
    this.blinks = this.blinks.filter(time => timestamp - time < 60000);
  }

  _missing(timestamp) {
    const absentFor = timestamp - this.lastSeenAt;
    if (absentFor > 900) this._setCandidate("away", timestamp, 500);
    return {
      focusScore: this.smoothed ?? 0,
      confidence: absentFor > 900 ? 96 : 35,
      state: absentFor > 900 ? this.state : "uncertain",
      gazeScore: 0, headScore: 0, postureScore: 0, presenceScore: 0,
      fatigueScore: 100, phoneScore: 100, blinkRate: this.blinks.length, prolongedBlink: false, perclos: 0,
      details: {gaze: "Face not visible", head: "Face not visible", posture: "Face not visible", fatigue: "No reading", phone: "No reliable reading"},
    };
  }

  _setCandidate(next, timestamp, holdMs) {
    if (next === this.state) {
      this.candidateState = next;
      this.candidateSince = timestamp;
      return;
    }
    if (next !== this.candidateState) {
      this.candidateState = next;
      this.candidateSince = timestamp;
      return;
    }
    if (timestamp - this.candidateSince >= holdMs) this.state = next;
  }
}

export {clamp};
