export class WebcamCapture {
  private stream: MediaStream | null = null;

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Webcam is not supported in this browser");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    this.stream = stream;
    video.srcObject = stream;
    await video.play();
  }

  stop(video?: HTMLVideoElement): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (video) {
      video.srcObject = null;
    }
  }

  async capture(video: HTMLVideoElement): Promise<File> {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w <= 0 || h <= 0) {
      throw new Error("Webcam is not ready yet");
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not capture frame");

    ctx.drawImage(video, 0, 0, w, h);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Failed to encode capture"));
      }, "image/png");
    });

    return new File([blob], "webcam-capture.png", { type: "image/png" });
  }
}
