/* global URL, console, document, AudioContext, MediaRecorder, performance, requestAnimationFrame, setTimeout, Blob */

import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(
  new URL("./color-clock-audio.webm", import.meta.url),
);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage();
  await page.setContent("<button id='start'>Generate fixture</button>");
  await page.click("#start");

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas2D is required to generate the fixture");

    const audioContext = new AudioContext({ sampleRate: 48_000 });
    await audioContext.resume();
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 440;
    const gain = audioContext.createGain();
    gain.gain.value = 0.08;
    const audioDestination = audioContext.createMediaStreamDestination();
    oscillator.connect(gain);
    gain.connect(audioDestination);
    oscillator.start();

    const stream = canvas.captureStream(30);
    for (const track of audioDestination.stream.getAudioTracks()) {
      stream.addTrack(track);
    }

    const mimeType = "video/webm;codecs=vp8,opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      throw new Error(`Unsupported fixture codec: ${mimeType}`);
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 800_000,
    });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    const stopped = new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });

    const startedAt = performance.now();
    const draw = () => {
      const elapsed = performance.now() - startedAt;
      const frame = Math.floor(elapsed / (1000 / 30));
      const hue = (frame * 4) % 360;
      context.fillStyle = `hsl(${hue} 75% 42%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "white";
      context.font = "bold 28px sans-serif";
      context.fillText(`FRAME ${String(frame).padStart(3, "0")}`, 42, 128);
      if (elapsed < 2_100) requestAnimationFrame(draw);
    };

    draw();
    recorder.start(100);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    recorder.stop();
    await stopped;
    oscillator.stop();
    await audioContext.close();
    for (const track of stream.getTracks()) track.stop();

    const blob = new Blob(chunks, { type: mimeType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "color-clock-audio.webm";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5_000);
  });

  const download = await downloadPromise;
  await download.saveAs(outputPath);
  console.log(`Generated ${outputPath}`);
} finally {
  await browser.close();
}
