/**
 * A short synthesized applause burst played when an operation completes
 * successfully. Generated with WebAudio (band-passed noise "claps" with
 * random timing and decaying density) so no audio asset needs to ship.
 * Browsers may keep the AudioContext suspended without a prior user gesture —
 * by the time this runs the user has clicked and signed, so resume() covers
 * the rest. Everything is best-effort: any failure just means no sound.
 */
export function playApplause(durationSeconds = 1.8) {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();

    const sampleCount = Math.floor(ctx.sampleRate * durationSeconds);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Individual hand-claps: short noise bursts, arriving faster at the start
    // and thinning out, with per-clap amplitude decaying over the whole burst.
    let t = 0;
    while (t < durationSeconds) {
      const start = Math.floor(t * ctx.sampleRate);
      const length = Math.floor((0.012 + Math.random() * 0.03) * ctx.sampleRate);
      const fade = 1 - t / durationSeconds;
      const amplitude = (0.12 + Math.random() * 0.22) * fade * fade;
      for (let i = 0; i < length && start + i < sampleCount; i++) {
        data[start + i] += (Math.random() * 2 - 1) * amplitude * Math.exp(-i / (length / 4));
      }
      t += 0.018 + Math.random() * (0.03 + 0.05 * t);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1700;
    bandpass.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    source.connect(bandpass).connect(gain).connect(ctx.destination);
    source.onended = () => void ctx.close();
    source.start();
  } catch {
    // Audio is decorative — never let it break the flow.
  }
}
