export class CameraSession {
  constructor(video) {
    this.video = video;
    this.stream = null;
  }

  async request(deviceId = null) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30},
        ...(deviceId ? {deviceId: {exact: deviceId}} : {facingMode: "user"}),
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    return this.devices();
  }

  async devices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === "videoinput");
  }

  activeDeviceId() {
    return this.stream?.getVideoTracks()[0]?.getSettings()?.deviceId || "";
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}

export function populateCameraSelect(select, devices, selectedId = "") {
  select.innerHTML = "";
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    select.append(option);
  });
  if (selectedId) select.value = selectedId;
}

export function cameraError(error) {
  if (error?.name === "NotAllowedError") return "Camera permission was blocked. Allow it in browser site settings, then retry.";
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  if (error?.name === "NotReadableError") return "The camera is already in use by another application.";
  return "The camera could not start. Check permission and connection, then retry.";
}

