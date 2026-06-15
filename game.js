/* ============================================================
   THE BACKROOMS — Level 0
   A 3D first-person survival-horror in the endless yellow rooms.
   ============================================================ */
(function () {
  "use strict";

  if (!window.THREE) {
    const el = document.getElementById("loadinfo");
    if (el) el.textContent = "⚠ Three.js failed to load.";
    return;
  }
  const li = document.getElementById("loadinfo");
  if (li) li.textContent = "Engine ready. Click ▶ to begin.";

  // ---------- config ----------
  const CELL = 6;          // world units per grid cell
  const GRID = 21;         // grid is GRID x GRID cells (odd for maze carving)
  const WALL_H = 4.0;      // wall / ceiling height
  const PLAYER_R = 0.65;   // collision radius
  const EYE_H = 1.7;
  const WORLD = GRID * CELL;

  // ---------- DOM ----------
  const canvas = document.getElementById("canvas");
  const overlay = document.getElementById("overlay");
  const endscreen = document.getElementById("endscreen");
  const startbtn = document.getElementById("startbtn");
  const restartbtn = document.getElementById("restartbtn");
  const promptEl = document.getElementById("prompt");
  const toastEl = document.getElementById("toast");
  const dmgflash = document.getElementById("dmgflash");
  const grain = document.getElementById("grain");
  const vignette = document.getElementById("vignette");
  const dangerbar = document.getElementById("dangerbar");
  const staminaFill = document.getElementById("stamina-fill");
  const batteryFill = document.getElementById("battery-fill");
  const sanityFill = document.getElementById("sanity-fill");
  const exitsEl = document.getElementById("exits");
  const clockEl = document.getElementById("clock");
  const zoneEl = document.getElementById("zone");
  const screamWarn = document.getElementById("screamwarn");
  const radarEl = document.getElementById("radar");
  const radarArrow = document.getElementById("radar-arrow");
  const radarTimerEl = document.getElementById("radar-timer");
  const hungerFill = document.getElementById("hunger-fill");
  const thirstFill = document.getElementById("thirst-fill");
  const devour = document.getElementById("devour");
  const inventoryEl = document.getElementById("inventory");
  const invItemsEl = document.getElementById("inv-items");
  const hidemaskEl = document.getElementById("hidemask");
  const staminaBarFill = document.getElementById("stamina-bar-fill");
  const muteMusicBtn = document.getElementById("mute-music");
  const muteSfxBtn = document.getElementById("mute-sfx");

  // ---------- audio (Web Audio API, fully synthesized — no files) ----------
  const Sound = (function () {
    let ctx, master, musicGain, sfxGain, dreadGain, dreadFilter, reverb;
    let started = false, musicMuted = false, sfxMuted = false;
    let hbAcc = 0, dread = 0;
    let noiseBuf = null;

    function makeNoise(dur) {
      const len = (ctx.sampleRate * dur) | 0;
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      return b;
    }
    function makeImpulse(dur, decay) {
      const len = (ctx.sampleRate * dur) | 0;
      const b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return b;
    }
    function distCurve(k) {
      const n = 256, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (3 + k) * x * 0.3 / (Math.PI + k * Math.abs(x)); }
      return c;
    }

    function init() {
      if (started) { if (ctx && ctx.state === "suspended") ctx.resume(); return; }
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      if (ctx.state === "suspended") ctx.resume();
      started = true;
      master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.0001; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
      noiseBuf = makeNoise(2);
      // cavernous reverb tail for the scream
      reverb = ctx.createConvolver(); reverb.buffer = makeImpulse(2.6, 2.2);
      const revGain = ctx.createGain(); revGain.gain.value = 0.85; reverb.connect(revGain); revGain.connect(master);

      // ---- drone bed: dissonant low oscillators with slow swells ----
      const freqs = [49, 51.9, 73.4, 98];
      freqs.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = i === 3 ? "sawtooth" : "sine"; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0.05 + i * 0.01;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
        o.connect(lp); lp.connect(g); g.connect(musicGain);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.02 + i * 0.013;
        const lg = ctx.createGain(); lg.gain.value = 0.045;
        lfo.connect(lg); lg.connect(g.gain);
        o.start(); lfo.start();
      });

      // ---- dread layer: rumble that swells when the entity is near ----
      const dn = ctx.createBufferSource(); dn.buffer = makeNoise(4); dn.loop = true;
      dreadFilter = ctx.createBiquadFilter(); dreadFilter.type = "lowpass"; dreadFilter.frequency.value = 90;
      dreadGain = ctx.createGain(); dreadGain.gain.value = 0.0001;
      dn.connect(dreadFilter); dreadFilter.connect(dreadGain); dreadGain.connect(master);
      dn.start();

      musicGain.gain.setTargetAtTime(musicMuted ? 0.0001 : 0.5, ctx.currentTime, 3);
      scheduleEerie();
    }

    let eerieTO = null;
    function scheduleEerie() {
      const delay = 9 + Math.random() * 16;
      eerieTO = setTimeout(() => { if (!musicMuted) eerieTone(); scheduleEerie(); }, delay * 1000);
    }
    function eerieTone() {
      const t = ctx.currentTime, dur = 3 + Math.random() * 3;
      const o = ctx.createOscillator(); o.type = "sine";
      const base = [330, 415, 494, 587][(Math.random() * 4) | 0];
      o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 0.97, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
      o.connect(lp); lp.connect(g); g.connect(musicGain);
      o.start(t); o.stop(t + dur + 0.1);
    }

    function scream() {
      if (!started || sfxMuted) return;
      const t = ctx.currentTime, dur = 2.7;

      // dry + cavernous reverb, with a disorienting stereo sweep
      const out = ctx.createGain(); out.gain.value = 0.9;
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        const panLfo = ctx.createOscillator(); panLfo.type = "sine"; panLfo.frequency.value = 4.5;
        const panD = ctx.createGain(); panD.gain.value = 0.85; panLfo.connect(panD); panD.connect(panner.pan);
        panLfo.start(t); panLfo.stop(t + dur);
        out.connect(panner); panner.connect(sfxGain);
      } else out.connect(sfxGain);
      if (reverb) out.connect(reverb);

      // two-part envelope: violent hit, dip, then a second surge (it "re-screams")
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(1.0, t + 0.03);
      env.gain.linearRampToValueAtTime(0.5, t + dur * 0.42);
      env.gain.linearRampToValueAtTime(0.95, t + dur * 0.56);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);
      env.connect(out);

      // brutal distortion
      const shaper = ctx.createWaveShaper(); shaper.curve = distCurve(110); shaper.oversample = "4x";
      shaper.connect(env);

      // ===== HIGH HUMAN-TERROR SHRIEK + formants (human + child scream bands) =====
      const shriekBus = ctx.createGain(); shriekBus.gain.value = 0.5;
      [[2650, 15, 1.0], [3300, 17, 0.9], [3900, 18, 0.7], [1500, 11, 0.55]].forEach(([f, q, gg]) => {
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
        const fg = ctx.createGain(); fg.gain.value = gg; shriekBus.connect(bp); bp.connect(fg); fg.connect(shaper);
      });
      // HARSH ROUGHNESS — fast amplitude tremor (the band that triggers fear/"acoustic roughness")
      const rough = ctx.createGain(); rough.gain.value = 0.55; rough.connect(shriekBus);
      const roughLfo = ctx.createOscillator(); roughLfo.type = "sawtooth";
      roughLfo.frequency.setValueAtTime(55, t); roughLfo.frequency.linearRampToValueAtTime(95, t + dur);
      const roughD = ctx.createGain(); roughD.gain.value = 0.5; roughLfo.connect(roughD); roughD.connect(rough.gain);
      roughLfo.start(t); roughLfo.stop(t + dur);
      // ring modulation → inhuman metallic edge
      const ring = ctx.createGain(); ring.gain.value = 0;
      const carrier = ctx.createOscillator(); carrier.type = "sawtooth";
      carrier.frequency.setValueAtTime(85, t); carrier.frequency.linearRampToValueAtTime(150, t + dur);
      carrier.connect(ring.gain); carrier.start(t); carrier.stop(t + dur);
      ring.connect(rough);
      // shared vibrato
      const vib = ctx.createOscillator(); vib.type = "sine"; vib.frequency.value = 8;
      const vibD = ctx.createGain(); vibD.gain.value = 50; vib.connect(vibD); vib.start(t); vib.stop(t + dur);
      // a CHORUS of detuned voices across octaves (a swarm), each with chaotic pitch-breaking
      [760, 772, 1170, 385, 1560].forEach((base, i) => {
        const o = ctx.createOscillator(); o.type = (i % 2) ? "sawtooth" : "square";
        o.frequency.setValueAtTime(base, t);
        let tt = t + 0.02;
        while (tt < t + dur) {
          const f = base * (0.78 + Math.random() * 0.6) * (1 - (tt - t) / dur * 0.3);
          o.frequency.linearRampToValueAtTime(f, tt);
          tt += 0.022 + Math.random() * 0.04;
        }
        vibD.connect(o.frequency);
        const g = ctx.createGain(); g.gain.value = i === 3 ? 0.45 : 0.55; o.connect(g); g.connect(ring); o.start(t); o.stop(t + dur);
      });

      // ===== LOW DEMONIC GROWL underneath =====
      const am = ctx.createGain(); am.gain.value = 0.5; am.connect(shaper);
      const amLfo = ctx.createOscillator(); amLfo.type = "square";
      amLfo.frequency.setValueAtTime(44, t); amLfo.frequency.linearRampToValueAtTime(70, t + dur);
      const amD = ctx.createGain(); amD.gain.value = 0.5; amLfo.connect(amD); amD.connect(am.gain); amLfo.start(t); amLfo.stop(t + dur);
      [62, 93, 124].forEach((base) => {
        const o = ctx.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(base * 1.35, t); o.frequency.exponentialRampToValueAtTime(base * 0.65, t + dur);
        const g = ctx.createGain(); g.gain.value = 0.55; o.connect(g); g.connect(am); o.start(t); o.stop(t + dur);
      });

      // ragged breath
      const nb = ctx.createBufferSource(); nb.buffer = makeNoise(dur + 0.3);
      const nbp = ctx.createBiquadFilter(); nbp.type = "bandpass"; nbp.Q.value = 0.8;
      nbp.frequency.setValueAtTime(2800, t); nbp.frequency.exponentialRampToValueAtTime(650, t + dur);
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.5, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      nb.connect(nbp); nbp.connect(ng); ng.connect(shaper); nb.start(t); nb.stop(t + dur);

      // gut-punch sub-bass
      const sub = ctx.createOscillator(); sub.type = "sine";
      sub.frequency.setValueAtTime(125, t); sub.frequency.exponentialRampToValueAtTime(32, t + 0.95);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(1.0, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + 1.25);
    }

    function heartbeat() {
      if (!started || sfxMuted) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * Math.min(1, dread + 0.2), t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.24);
    }
    function blip() {
      if (!started || sfxMuted) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.setValueAtTime(880, t); o.frequency.linearRampToValueAtTime(1320, t + 0.08);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.13);
    }

    function tick(dt, dreadLevel) {
      if (!started) return;
      dread = dreadLevel;
      dreadGain.gain.setTargetAtTime(dread * 0.9, ctx.currentTime, 0.25);
      dreadFilter.frequency.setTargetAtTime(80 + dread * 260, ctx.currentTime, 0.25);
      if (dread > 0.08) {
        hbAcc += dt;
        const interval = 1.0 - dread * 0.78; // pounding faster as it nears
        if (hbAcc >= Math.max(0.22, interval)) { hbAcc = 0; heartbeat(); }
      } else hbAcc = 0;
    }

    // wet bone-crunch — the bite
    function bite() {
      if (!started || sfxMuted) return;
      const t = ctx.currentTime;
      const nb = ctx.createBufferSource(); nb.buffer = makeNoise(0.5);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(1900, t); bp.frequency.exponentialRampToValueAtTime(260, t + 0.4);
      const sh = ctx.createWaveShaper(); sh.curve = distCurve(70); sh.oversample = "2x";
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1.0, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.46);
      nb.connect(bp); bp.connect(sh); sh.connect(g); g.connect(sfxGain);
      nb.start(t); nb.stop(t + 0.5);
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.26);
      const og = ctx.createGain(); og.gain.setValueAtTime(1.0, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(og); og.connect(sfxGain); o.start(t); o.stop(t + 0.32);
    }
    // squelching, tearing flesh — the chewing
    function gore() {
      if (!started || sfxMuted) return;
      const t0 = ctx.currentTime;
      for (let i = 0; i < 5; i++) {
        const t = t0 + i * 0.18 + Math.random() * 0.05;
        const nb = ctx.createBufferSource(); nb.buffer = makeNoise(0.3);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
        lp.frequency.setValueAtTime(900 + Math.random() * 600, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.22);
        const sh = ctx.createWaveShaper(); sh.curve = distCurve(40);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.7, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        nb.connect(lp); lp.connect(sh); sh.connect(g); g.connect(sfxGain);
        nb.start(t); nb.stop(t + 0.3);
      }
    }
    // dry breathy whisper drifting past — for the weird-stuff anomalies
    function whisper() {
      if (!started || sfxMuted) return;
      const t = ctx.currentTime, dur = 1.4 + Math.random();
      const nb = ctx.createBufferSource(); nb.buffer = makeNoise(dur + 0.2);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 4;
      bp.frequency.setValueAtTime(700, t); bp.frequency.linearRampToValueAtTime(1700, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      let out = g;
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner(); pan.pan.setValueAtTime((Math.random() * 2 - 1) * 0.9, t);
        g.connect(pan); out = pan;
      }
      nb.connect(bp); bp.connect(g); out.connect(sfxGain);
      if (reverb) out.connect(reverb);
      nb.start(t); nb.stop(t + dur + 0.1);
    }

    // low, wet guttural growl that rolls out when it's near or surging toward you
    function growl() {
      if (!started || sfxMuted) return;
      const t = ctx.currentTime, dur = 0.9 + Math.random() * 0.5;
      const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(0.55, t + 0.12); out.gain.exponentialRampToValueAtTime(0.001, t + dur);
      out.connect(sfxGain); if (reverb) out.connect(reverb);
      const sh = ctx.createWaveShaper(); sh.curve = distCurve(55); sh.connect(out);
      const am = ctx.createGain(); am.gain.value = 0.6; am.connect(sh);
      const amLfo = ctx.createOscillator(); amLfo.type = "square";
      amLfo.frequency.setValueAtTime(26, t); amLfo.frequency.linearRampToValueAtTime(48, t + dur);
      const amD = ctx.createGain(); amD.gain.value = 0.5; amLfo.connect(amD); amD.connect(am.gain); amLfo.start(t); amLfo.stop(t + dur);
      [55, 82, 110].forEach((f) => {
        const o = ctx.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(f * 1.2, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
        const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(am); o.start(t); o.stop(t + dur);
      });
    }

    return {
      init,
      scream, blip, bite, gore, whisper, growl,
      tick,
      setMusicMuted(v) { musicMuted = v; if (started) musicGain.gain.setTargetAtTime(v ? 0.0001 : 0.5, ctx.currentTime, 0.5); },
      setSfxMuted(v) { sfxMuted = v; },
      isMusicMuted() { return musicMuted; },
      isSfxMuted() { return sfxMuted; },
    };
  })();

  // ---------- three basics ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a06);
  scene.fog = new THREE.FogExp2(0x12120a, 0.045);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);

  // yaw/pitch holder for the camera
  const yawObj = new THREE.Object3D();
  const pitchObj = new THREE.Object3D();
  yawObj.add(pitchObj);
  pitchObj.add(camera);
  scene.add(yawObj);

  // ---------- procedural textures ----------
  function makeCanvas(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  }

  function wallpaperTex() {
    const c = makeCanvas(256), x = c.getContext("2d");
    x.fillStyle = "#b6a44a"; x.fillRect(0, 0, 256, 256);
    // mottled damp stains
    for (let i = 0; i < 700; i++) {
      const r = Math.random() * 3 + 0.5;
      const a = Math.random() * 0.10;
      x.fillStyle = Math.random() < 0.5
        ? `rgba(120,100,30,${a})` : `rgba(210,195,120,${a})`;
      x.beginPath();
      x.arc(Math.random() * 256, Math.random() * 256, r, 0, 7);
      x.fill();
    }
    // faint vertical wallpaper stripes
    for (let i = 0; i < 256; i += 16) {
      x.fillStyle = "rgba(90,75,20,0.07)";
      x.fillRect(i, 0, 6, 256);
    }
    // damp blotches
    for (let i = 0; i < 16; i++) {
      const gx = Math.random() * 256, gy = Math.random() * 256, gr = 20 + Math.random() * 50;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, "rgba(70,55,15,0.25)");
      g.addColorStop(1, "rgba(70,55,15,0)");
      x.fillStyle = g; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function carpetTex() {
    const c = makeCanvas(256), x = c.getContext("2d");
    x.fillStyle = "#7a6a2c"; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random();
      x.fillStyle = v < 0.5 ? "rgba(60,52,20,0.5)" : "rgba(120,108,55,0.4)";
      x.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
    }
    // damp dark patches
    for (let i = 0; i < 10; i++) {
      const gx = Math.random() * 256, gy = Math.random() * 256, gr = 25 + Math.random() * 40;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, "rgba(30,26,10,0.45)");
      g.addColorStop(1, "rgba(30,26,10,0)");
      x.fillStyle = g; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function ceilingTex() {
    const c = makeCanvas(256), x = c.getContext("2d");
    x.fillStyle = "#cfc18a"; x.fillRect(0, 0, 256, 256);
    // ceiling tile grid
    x.strokeStyle = "rgba(70,60,25,0.6)"; x.lineWidth = 3;
    x.strokeRect(0, 0, 256, 256);
    x.strokeRect(128, 0, 0, 256);
    x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256);
    x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();
    // speckle
    for (let i = 0; i < 1500; i++) {
      x.fillStyle = "rgba(90,80,40,0.25)";
      x.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  const texWall = wallpaperTex();
  const texFloor = carpetTex();
  const texCeil = ceilingTex();
  texFloor.repeat.set(GRID, GRID);
  texCeil.repeat.set(GRID, GRID);

  const matWall = new THREE.MeshStandardMaterial({ map: texWall, roughness: 0.95, metalness: 0 });
  const matFloor = new THREE.MeshStandardMaterial({ map: texFloor, roughness: 1.0, metalness: 0 });
  const matCeil = new THREE.MeshStandardMaterial({ map: texCeil, roughness: 0.9, metalness: 0, emissive: 0x3a3415, emissiveIntensity: 0.35 });

  // ---------- floor + ceiling ----------
  const floorGeo = new THREE.PlaneGeometry(WORLD, WORLD);
  const floor = new THREE.Mesh(floorGeo, matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(WORLD / 2, 0, WORLD / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const ceil = new THREE.Mesh(floorGeo, matCeil);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(WORLD / 2, WALL_H, WORLD / 2);
  scene.add(ceil);

  // ---------- maze generation ----------
  // grid[r][c] = 1 wall, 0 open
  let grid = [];
  function genMaze() {
    grid = [];
    for (let r = 0; r < GRID; r++) {
      grid[r] = [];
      for (let c = 0; c < GRID; c++) grid[r][c] = 1;
    }
    // recursive backtracker on odd cells
    const stack = [[1, 1]];
    grid[1][1] = 0;
    const dirs = [[0, 2], [0, -2], [2, 0], [-2, 0]];
    while (stack.length) {
      const [cr, cc] = stack[stack.length - 1];
      const opts = [];
      for (const [dr, dc] of dirs) {
        const nr = cr + dr, nc = cc + dc;
        if (nr > 0 && nr < GRID - 1 && nc > 0 && nc < GRID - 1 && grid[nr][nc] === 1) {
          opts.push([nr, nc, dr, dc]);
        }
      }
      if (opts.length) {
        const [nr, nc, dr, dc] = opts[(Math.random() * opts.length) | 0];
        grid[cr + dr / 2][cc + dc / 2] = 0;
        grid[nr][nc] = 0;
        stack.push([nr, nc]);
      } else {
        stack.pop();
      }
    }
    // open it up — backrooms feel: knock down ~22% of interior walls
    for (let r = 1; r < GRID - 1; r++) {
      for (let c = 1; c < GRID - 1; c++) {
        if (grid[r][c] === 1 && Math.random() < 0.22) grid[r][c] = 0;
      }
    }
  }
  genMaze();

  function isWallCell(c, r) {
    if (r < 0 || c < 0 || r >= GRID || c >= GRID) return true;
    return grid[r][c] === 1;
  }
  // world<->grid
  const cellCenter = (c, r) => new THREE.Vector3((c + 0.5) * CELL, 0, (r + 0.5) * CELL);
  const colOf = (x) => Math.floor(x / CELL);
  const rowOf = (z) => Math.floor(z / CELL);

  // ---------- world build resources (populated by rebuildWorld) ----------
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const wallGroup = new THREE.Group();
  scene.add(wallGroup);

  const panelGeo = new THREE.PlaneGeometry(CELL * 0.55, CELL * 0.55);
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0xfff3c0, emissive: 0xfff0b0, emissiveIntensity: 1.0, side: THREE.DoubleSide,
  });
  const flickers = []; // {light, panel, base, t, broken}
  const warps = [];    // trippy anomaly cells {haze, wl, t, base}
  const crushers = []; // oscillating walls that slide in to crush you {axis, slabs, ...}
  const closets = [];  // enterable hiding furniture {g, cell, faceYaw, hidePos, enterPos}
  const openCells = [];
  const LIGHT_COUNT = 7;

  // ambient so it's the eerie dim-lit backrooms, not pitch black
  const ambient = new THREE.AmbientLight(0xbfae6a, 0.45);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xfff0c0, 0x2a2410, 0.25);
  scene.add(hemi);

  // ---------- flashlight ----------
  const flashlight = new THREE.SpotLight(0xfff6e0, 0.0, 26, Math.PI / 6, 0.4, 1.2);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  const flashTarget = new THREE.Object3D();
  camera.add(flashlight);
  camera.add(flashTarget);
  flashlight.position.set(0.2, -0.2, 0);
  flashTarget.position.set(0, 0, -1);
  flashlight.target = flashTarget;

  // ---------- the monster: THE SMILER — tall, gaunt, articulated, relentless ----------
  // dark mottled skin with faint veins/sinew (near-black, reads as wet flesh in the dark)
  function skinTex() {
    const c = makeCanvas(256), x = c.getContext("2d");
    x.fillStyle = "#090909"; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1700; i++) {
      const v = Math.random();
      const g = v < 0.6 ? 5 + Math.random() * 12 : 16 + Math.random() * 20;
      const a = 0.25 + Math.random() * 0.4;
      x.fillStyle = `rgba(${g},${g - 1},${g - 2},${a})`;
      x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, Math.random() * 3 + 0.4, 0, 7); x.fill();
    }
    for (let i = 0; i < 34; i++) { // faint dark-red veins
      x.strokeStyle = `rgba(${26 + Math.random() * 22 | 0},6,8,0.3)`; x.lineWidth = Math.random() * 1.4 + 0.3;
      x.beginPath(); let px = Math.random() * 256, py = Math.random() * 256; x.moveTo(px, py);
      for (let s = 0; s < 6; s++) { px += (Math.random() - 0.5) * 42; py += (Math.random() - 0.5) * 42; x.lineTo(px, py); }
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  const monster = new THREE.Group();
  // wet, gaunt black flesh — low roughness gives a slick specular sheen in the flashlight
  const mDark = new THREE.MeshStandardMaterial({ map: skinTex(), color: 0x121212, roughness: 0.5, metalness: 0.25, emissive: 0x0c0202, emissiveIntensity: 0.55 });
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xdcd2b8 }); // bone-white, glows faintly in the dark
  const mawMat = new THREE.MeshBasicMaterial({ color: 0x000000 });   // pure black mouth/socket void
  const monAnim = { arms: [], legs: [] };

  function seg(len, rTop, rBot) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 8), mDark);
    m.castShadow = true; return m;
  }
  function joint(r) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mDark); m.castShadow = true; return m; }

  const hipY = 1.8, TORSO = 1.28;

  // ----- emaciated torso: pelvis, tapered ribcage, exposed ribs + spine, shoulder yoke -----
  const torso = new THREE.Group();
  torso.position.set(0, hipY, 0);
  torso.rotation.x = 0.17; // hunched forward
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mDark);
  pelvis.scale.set(1.55, 0.95, 0.95); torso.add(pelvis);
  const chest = seg(TORSO, 0.17, 0.30); chest.position.y = TORSO / 2; torso.add(chest);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.17 - i * 0.012, 0.018, 6, 14, Math.PI * 1.3), mDark);
    rib.position.set(0, 0.55 + i * 0.16, 0.02); rib.rotation.x = Math.PI / 2; rib.rotation.z = -Math.PI * 0.65;
    torso.add(rib);
  }
  for (let i = 0; i < 7; i++) { const k = joint(0.035); k.position.set(0, 0.25 + i * 0.13, -0.13); torso.add(k); }
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), mDark);
  yoke.rotation.z = Math.PI / 2; yoke.position.y = TORSO - 0.02; torso.add(yoke);
  monster.add(torso);

  // ----- neck + head: the grinning skull -----
  const neck = seg(0.26, 0.05, 0.07); neck.position.set(0, TORSO + 0.1, 0.02); torso.add(neck);
  const head = new THREE.Group(); head.position.set(0, TORSO + 0.33, 0.02);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.32, 22, 22), mDark); skull.scale.set(0.94, 1.1, 1.02); skull.castShadow = true; head.add(skull);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.13), mDark); brow.position.set(0, 0.15, 0.25); brow.rotation.x = -0.2; head.add(brow);
  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mDark); cheekL.position.set(-0.17, -0.04, 0.2); cheekL.scale.set(1, 1.4, 0.7); head.add(cheekL);
  const cheekR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mDark); cheekR.position.set(0.17, -0.04, 0.2); cheekR.scale.set(1, 1.4, 0.7); head.add(cheekR);
  // deep black eye sockets, with thin glowing slit-eyes sunk inside
  const sockL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), mawMat); sockL.position.set(-0.13, 0.08, 0.2); sockL.scale.set(1, 1.3, 0.7); head.add(sockL);
  const sockR = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), mawMat); sockR.position.set(0.13, 0.08, 0.2); sockR.scale.set(1, 1.3, 0.7); head.add(sockR);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), faceMat); eyeL.position.set(-0.13, 0.075, 0.27); eyeL.scale.set(0.7, 1.7, 1); head.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), faceMat); eyeR.position.set(0.13, 0.075, 0.27); eyeR.scale.set(0.7, 1.7, 1); head.add(eyeR);
  // a black maw behind a wide ring of jagged teeth (an open grinning hole, not a painted smile)
  const maw = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), mawMat); maw.scale.set(1.1, 0.7, 0.5); maw.position.set(0, -0.12, 0.22); head.add(maw);
  const grin = new THREE.Group(); grin.position.set(0, -0.12, 0.24); head.add(grin);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 8, 30), faceMat); lip.scale.set(1, 0.62, 0.5); grin.add(lip);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const tx = Math.cos(a) * 0.17, ty = Math.sin(a) * 0.105;
    const th = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 5), faceMat);
    th.position.set(tx, ty, 0.02); th.rotation.z = -a + Math.PI / 2; // point inward toward the maw
    grin.add(th);
  }
  // dark blood crusted around the mouth
  const mouthBlood = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 22),
    new THREE.MeshBasicMaterial({ color: 0x320000 }));
  mouthBlood.scale.set(1.05, 0.72, 0.35); mouthBlood.position.set(0, -0.12, 0.21); head.add(mouthBlood);

  // ----- hinged lower jaw: drops open to a gaping maw, lined with fangs, dripping drool -----
  const jaw = new THREE.Group(); jaw.position.set(0, -0.07, 0.16); head.add(jaw);
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), mDark);
  chin.scale.set(1.05, 0.55, 0.95); chin.position.set(0, -0.17, 0.0); jaw.add(chin);
  const lowerLip = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 22, Math.PI), faceMat);
  lowerLip.position.set(0, -0.11, 0.07); lowerLip.rotation.x = Math.PI / 2; lowerLip.rotation.z = Math.PI; jaw.add(lowerLip);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + Math.PI * (i / 6);
    const th = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.07, 5), faceMat);
    th.position.set(Math.sin(a) * 0.13, -0.09, 0.07 + Math.cos(a) * 0.015);
    th.rotation.x = -0.25; jaw.add(th); // point up out of the lower jaw
  }
  const drool = [];
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.002, 0.3, 5),
      new THREE.MeshBasicMaterial({ color: 0xc9d6b4, transparent: true, opacity: 0.45 }));
    d.position.set((i - 1) * 0.06, -0.22, 0.13); jaw.add(d); drool.push(d);
  }
  monAnim.jaw = jaw; monAnim.drool = drool;

  // furnace-red glow from inside the maw, a lashing tongue, and stretching sinew strands
  const mawLight = new THREE.PointLight(0xff1505, 0, 3.6, 2); mawLight.position.set(0, -0.12, 0.14); head.add(mawLight);
  const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.012, 0.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a0a0a, roughness: 0.4, emissive: 0x2a0000, emissiveIntensity: 0.5 }));
  tongue.position.set(0, -0.26, 0.16); jaw.add(tongue);
  const sinew = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4),
      new THREE.MeshBasicMaterial({ color: 0x7a1010, transparent: true, opacity: 0.55 }));
    s.position.set((i - 1.5) * 0.07, -0.1, 0.22); head.add(s); sinew.push(s);
  }
  monAnim.mawLight = mawLight; monAnim.tongue = tongue; monAnim.sinew = sinew;

  const eyeGlow = new THREE.PointLight(0xff2a18, 0.6, 5.5, 2); eyeGlow.position.set(0, 0.05, 0.34); head.add(eyeGlow); // red hellish cast
  torso.add(head);

  // ----- dark aura shell — an unsettling smear of presence that wobbles -----
  const aura = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false }));
  aura.scale.set(0.7, 2.0, 0.7); aura.position.y = 1.9; monster.add(aura);

  // ----- articulated arms: shoulder → elbow → clawed hand (very long) -----
  function makeArm(side) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.22, TORSO - 0.02, 0.02);
    shoulder.add(joint(0.08));
    const upper = seg(0.95, 0.09, 0.07); upper.position.y = -0.475; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.95; shoulder.add(elbow);
    elbow.add(joint(0.055));
    const fore = seg(1.0, 0.07, 0.05); fore.position.y = -0.5; elbow.add(fore);
    const hand = new THREE.Group(); hand.position.y = -1.0; elbow.add(hand);
    for (let f = 0; f < 4; f++) {
      const fg = seg(0.36, 0.022, 0.006); fg.position.set((f - 1.5) * 0.045, -0.17, 0.02); fg.rotation.x = 0.25; hand.add(fg);
    }
    const thumb = seg(0.24, 0.02, 0.007); thumb.position.set(side * 0.08, -0.1, 0.05); thumb.rotation.z = side * 0.9; hand.add(thumb);
    torso.add(shoulder);
    monAnim.arms.push({ shoulder, elbow });
    return shoulder;
  }
  makeArm(-1);
  makeArm(1);

  // ----- articulated legs: hip → knee → foot (bent, menacing stance) -----
  function makeLeg(side) {
    const hip = new THREE.Group(); hip.position.set(side * 0.13, hipY, 0);
    hip.add(joint(0.1));
    const thigh = seg(0.9, 0.13, 0.09); thigh.position.y = -0.45; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.9; hip.add(knee);
    knee.add(joint(0.07));
    const shin = seg(0.9, 0.085, 0.058); shin.position.y = -0.45; knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.34), mDark); foot.position.set(0, -0.9, 0.1); foot.castShadow = true; knee.add(foot);
    hip.rotation.x = side * 0.04; knee.rotation.x = 0.18; // slight bend
    monster.add(hip);
    monAnim.legs.push({ hip, knee });
  }
  makeLeg(-1);
  makeLeg(1);

  monster.scale.setScalar(1.2); // taller, more looming
  scene.add(monster);

  // ---------- weird-stuff anomalies: a glimpsed figure + eyes in the dark ----------
  // a pure-black humanoid that appears down a far hallway, then is gone
  const glimpse = new THREE.Group();
  {
    const sil = new THREE.MeshBasicMaterial({ color: 0x050507 });
    const gTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 1.25, 7), sil); gTorso.position.y = 1.15; glimpse.add(gTorso);
    const gHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), sil); gHead.position.y = 1.95; glimpse.add(gHead);
    const gL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 1.05, 6), sil); gL.position.set(-0.1, 0.52, 0); glimpse.add(gL);
    const gR = gL.clone(); gR.position.x = 0.1; glimpse.add(gR);
    const gAl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.9, 6), sil); gAl.position.set(-0.22, 1.2, 0); glimpse.add(gAl);
    const gAr = gAl.clone(); gAr.position.x = 0.22; glimpse.add(gAr);
  }
  glimpse.visible = false; scene.add(glimpse);
  let glimpseT = 0;

  // two glowing eyes that open in a dark cell, blink, and vanish
  const eyes = new THREE.Group();
  {
    const em = new THREE.MeshBasicMaterial({ color: 0xff2a14 });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), em); e1.position.x = -0.13; eyes.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.13; eyes.add(e2);
  }
  eyes.visible = false; scene.add(eyes);
  let eyesT = 0;

  // a HALLUCINATION of the entity — a perfect copy that stands and stares, but isn't real
  const fakeMonster = monster.clone(true);
  fakeMonster.traverse((o) => { if (o.isLight) o.intensity = 0; if (o.isMesh) o.castShadow = false; });
  fakeMonster.visible = false; scene.add(fakeMonster);
  let hallucT = 0;

  // ---------- exits ----------
  const exitMat = new THREE.MeshStandardMaterial({ color: 0x2a6b2a, emissive: 0x18ff5a, emissiveIntensity: 0.7, roughness: 0.5 });
  const exits = []; // {mesh, cell, used}
  const EXIT_TOTAL = 1;
  document.getElementById("exitsTotal").textContent = EXIT_TOTAL;

  // ---------- radar trackers ----------
  const radars = []; // {mesh, cell, taken}
  function createRadar(p) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.27, 0.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x22301f, roughness: 0.6, metalness: 0.3 }));
    base.castShadow = true; g.add(base);
    const dish = new THREE.Mesh(
      new THREE.CircleGeometry(0.17, 18),
      new THREE.MeshStandardMaterial({ color: 0x0a2a12, emissive: 0x1aff5a, emissiveIntensity: 0.9 }));
    dish.rotation.x = -Math.PI / 2; dish.position.y = 0.051; g.add(dish);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 5),
      new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: 0x33ff77, emissiveIntensity: 0.9 }));
    ant.position.y = 0.27; g.add(ant);
    g.position.set(p.x, 0.12, p.z);
    g.userData.proc = true;
    return g;
  }

  // illusory wall that appears in a cell behind the player (no collision; fades away on approach)
  function spawnPhantom(c, r) {
    const p = cellCenter(c, r);
    const mat = matWall.clone();
    mat.transparent = true; mat.opacity = 1;
    const m = new THREE.Mesh(wallGeo, mat);
    m.position.set(p.x, WALL_H / 2, p.z);
    m.userData.proc = true;
    scene.add(m);
    phantoms.push({ mesh: m, mat, cell: [c, r], life: 16 });
  }

  // ---------- game state ----------
  const state = {
    started: false, alive: false, won: false,
    stamina: 1, battery: 1, sanity: 1,
    sprinting: false, flashOn: false,
    exitsFound: 0, time: 0,
    seen: false, seenTimer: 0,
    radarTimer: 0,
    screamTimer: 0, warnTimer: 0, screamShake: 0,
    hunger: 1, thirst: 1,
    lunge: 0,            // brief speed burst when hunting
    staticAmt: 0,        // VHS static intensity when the entity is in view/near
    blinkCd: 2,          // cooldown for the "closer when you look away" step
    glimpseCd: 8, eyesCd: 6, blackoutCd: 16, blackoutT: 0, hallucCd: 10, // anomaly timers
    inv: { food: 0, water: 0 }, invOpen: false,        // inventory
    hidden: false,                                      // tucked inside a closet
    lightLevel: 1, darkCd: 55, darkT: 0, lightsOut: false, monsterBlind: 0, // full-blackout event
    keys: {},
  };
  const items = []; // lootable food/water {mesh, type, cell, taken}
  const phantoms = []; // illusory walls that appear behind you {mesh, mat, cell, life}
  let lastPlayerCell = -1, phantomCd = 0;
  let nearestItem = null; // closest ground item in pickup range, for the E prompt
  let nearestCloset = null, hideCloset = null; // closet hiding state

  function resetPositions() {
    // player start at cell (1,1)
    const sp = cellCenter(1, 1);
    yawObj.position.set(sp.x, EYE_H, sp.z);
    yaw = 0; pitch = 0;

    // monster far away — pick a far open cell
    let best = openCells[0], bestD = -1;
    for (const [c, r] of openCells) {
      const d = (c - 1) * (c - 1) + (r - 1) * (r - 1);
      if (d > bestD) { bestD = d; best = [c, r]; }
    }
    const mp = cellCenter(best[0], best[1]);
    monster.position.set(mp.x, 0, mp.z);
    monsterPath = [];

    // exits — pick 3 distinct far-ish open cells
    for (const e of exits) scene.remove(e.mesh);
    exits.length = 0;
    const candidates = openCells
      .filter(([c, r]) => (c - 1) * (c - 1) + (r - 1) * (r - 1) > 64)
      .sort((a, b) => ((b[0] - 1) ** 2 + (b[1] - 1) ** 2) - ((a[0] - 1) ** 2 + (a[1] - 1) ** 2));
    for (let i = 0; i < EXIT_TOTAL && i < candidates.length; i++) {
      const cc = candidates[i];
      const p = cellCenter(cc[0], cc[1]);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 0.3), exitMat);
      door.position.set(p.x, 1.3, p.z);
      door.rotation.y = Math.random() * Math.PI;
      scene.add(door);
      const dl = new THREE.PointLight(0x22ff66, 0.8, 7, 2);
      dl.position.set(p.x, 1.6, p.z);
      door.add(dl); dl.position.set(0, 0.3, 0);
      exits.push({ mesh: door, cell: cc, used: false });
    }

    // radar trackers — scattered on the floor, away from spawn and the exit
    for (const rd of radars) scene.remove(rd.mesh);
    radars.length = 0;
    state.radarTimer = 0;
    radarEl.classList.add("hidden");
    const exitCell = exits[0] ? exits[0].cell : null;
    const rcands = openCells
      .filter(([c, r]) => (c - 1) * (c - 1) + (r - 1) * (r - 1) > 20 &&
        !(exitCell && c === exitCell[0] && r === exitCell[1]))
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);
    for (const [c, r] of rcands) {
      const p = cellCenter(c, r);
      const mesh = createRadar(p);
      scene.add(mesh);
      radars.push({ mesh, cell: [c, r], taken: false });
    }
  }

  // ---------- collision ----------
  function blocked(x, z) {
    const r = PLAYER_R;
    const pts = [[x + r, z], [x - r, z], [x, z + r], [x, z - r], [x + r * 0.7, z + r * 0.7], [x - r * 0.7, z - r * 0.7]];
    for (const [px, pz] of pts) {
      if (isWallCell(colOf(px), rowOf(pz))) return true;
    }
    return false;
  }

  // ---------- monster pathfinding (BFS to player cell) ----------
  let monsterPath = [];
  function bfsPath(sc, sr, tc, tr) {
    if (isWallCell(tc, tr)) return [];
    const key = (c, r) => r * GRID + c;
    const prev = new Map();
    const q = [[sc, sr]];
    prev.set(key(sc, sr), null);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let found = false;
    while (q.length) {
      const [c, r] = q.shift();
      if (c === tc && r === tr) { found = true; break; }
      for (const [dc, dr] of dirs) {
        const nc = c + dc, nr = r + dr;
        if (isWallCell(nc, nr)) continue;
        if (crusherSealed(nc, nr)) continue; // route around shut corridors
        const k = key(nc, nr);
        if (prev.has(k)) continue;
        prev.set(k, [c, r]);
        q.push([nc, nr]);
      }
    }
    if (!found) return [];
    const path = [];
    let cur = [tc, tr];
    while (cur) { path.push(cur); cur = prev.get(key(cur[0], cur[1])); }
    path.reverse();
    return path;
  }

  // line of sight between two world points along grid (Bresenham over cells)
  function hasLOS(ax, az, bx, bz) {
    let c0 = colOf(ax), r0 = rowOf(az);
    const c1 = colOf(bx), r1 = rowOf(bz);
    let dc = Math.abs(c1 - c0), dr = Math.abs(r1 - r0);
    let sc = c0 < c1 ? 1 : -1, sr = r0 < r1 ? 1 : -1;
    let err = dc - dr;
    let guard = 0;
    while (guard++ < 200) {
      if (isWallCell(c0, r0)) return false;
      if (c0 === c1 && r0 === r1) return true;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c0 += sc; }
      if (e2 < dc) { err += dc; r0 += sr; }
    }
    return true;
  }

  // ---------- controls ----------
  let yaw = 0, pitch = 0;
  const onMouseMove = (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  };
  document.addEventListener("mousemove", onMouseMove);

  let pointerLocked = false;
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas || document.pointerLockElement === document.body;
  });
  canvas.addEventListener("click", () => {
    if (state.started && state.alive) canvas.requestPointerLock();
  });

  window.addEventListener("keydown", (e) => {
    if (state.invOpen) { // inventory captures input while open
      if (e.code === "Tab" || e.code === "Escape") { e.preventDefault(); toggleInventory(); }
      else if (e.code === "Digit1") useItem("food");
      else if (e.code === "Digit2") useItem("water");
      return;
    }
    state.keys[e.code] = true;
    if (e.code === "KeyF") toggleFlash();
    if (e.code === "KeyE") {
      if (state.hidden) exitCloset();
      else if (nearestItem) tryPickup();
      else if (!tryEnterCloset()) tryExit();
    }
    if (e.code === "KeyM") toggleMusic();
    if (e.code === "KeyN") toggleSfx();
    if (e.code === "Tab") { e.preventDefault(); toggleInventory(); }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { state.keys[e.code] = false; });

  function toggleMusic() {
    const m = !Sound.isMusicMuted();
    Sound.setMusicMuted(m);
    muteMusicBtn.classList.toggle("muted", m);
    muteMusicBtn.textContent = m ? "🎵" : "🎵";
    toast(m ? "🎵 Music muted" : "🎵 Music on");
  }
  function toggleSfx() {
    const m = !Sound.isSfxMuted();
    Sound.setSfxMuted(m);
    muteSfxBtn.classList.toggle("muted", m);
    muteSfxBtn.textContent = m ? "🔇" : "🔊";
    toast(m ? "🔇 SFX/scream muted" : "🔊 SFX on");
  }
  muteMusicBtn.addEventListener("click", (e) => { e.stopPropagation(); Sound.init(); toggleMusic(); });
  muteSfxBtn.addEventListener("click", (e) => { e.stopPropagation(); Sound.init(); toggleSfx(); });

  function toggleFlash() {
    if (state.battery <= 0) { state.flashOn = false; flashlight.intensity = 0; return; }
    state.flashOn = !state.flashOn;
    flashlight.intensity = state.flashOn ? 3.0 : 0;
    toast(state.flashOn ? "🔦 Flashlight ON" : "🔦 Flashlight OFF");
  }

  function tryExit() {
    for (const e of exits) {
      if (e.used) continue;
      const dx = e.mesh.position.x - yawObj.position.x;
      const dz = e.mesh.position.z - yawObj.position.z;
      if (dx * dx + dz * dz < 6.25) { // within 2.5 units
        e.used = true;
        e.mesh.material = e.mesh.material.clone();
        e.mesh.material.emissive.set(0x666666);
        e.mesh.material.emissiveIntensity = 0.1;
        state.exitsFound++;
        exitsEl.textContent = state.exitsFound;
        toast(`🚪 You found the way out!`);
        if (state.exitsFound >= EXIT_TOTAL) win();
        return;
      }
    }
  }

  // ---------- inventory ----------
  function tryPickup() {
    if (!nearestItem || nearestItem.taken) return;
    const dx = nearestItem.mesh.position.x - yawObj.position.x;
    const dz = nearestItem.mesh.position.z - yawObj.position.z;
    if (dx * dx + dz * dz > 4.0) return; // within 2 units
    nearestItem.taken = true;
    scene.remove(nearestItem.mesh);
    state.inv[nearestItem.type] = (state.inv[nearestItem.type] || 0) + 1;
    Sound.blip();
    toast((nearestItem.type === "food" ? "🥫 Picked up food" : "💧 Picked up water") + " — Tab for inventory");
    nearestItem = null;
  }

  function useItem(type) {
    if (!state.inv[type] || state.inv[type] <= 0) return;
    state.inv[type]--;
    if (type === "food") state.hunger = Math.min(1, state.hunger + 0.4);
    else state.thirst = Math.min(1, state.thirst + 0.45);
    hungerFill.style.width = (state.hunger * 100) + "%";
    thirstFill.style.width = (state.thirst * 100) + "%";
    Sound.blip();
    renderInventory();
  }

  function renderInventory() {
    invItemsEl.innerHTML = "";
    const defs = [
      { type: "food", icon: "🥫", label: "Condensed Food", effect: "+ Hunger", key: "1" },
      { type: "water", icon: "💧", label: "Water Bottle", effect: "+ Thirst", key: "2" },
    ];
    for (const d of defs) {
      const n = state.inv[d.type] || 0;
      const slot = document.createElement("div");
      slot.className = "inv-item" + (n > 0 ? "" : " empty");
      slot.innerHTML =
        `<div class="inv-ic">${d.icon}</div><div class="inv-meta">` +
        `<div class="inv-name">${d.label} <span class="inv-x">×${n}</span></div>` +
        `<div class="inv-eff">${d.effect} · press ${d.key}</div></div>`;
      if (n > 0) slot.addEventListener("click", () => useItem(d.type));
      invItemsEl.appendChild(slot);
    }
  }

  function toggleInventory() {
    if (!state.started || !state.alive || cut) return;
    state.invOpen = !state.invOpen;
    if (state.invOpen) {
      document.exitPointerLock();
      renderInventory();
      inventoryEl.classList.remove("hidden");
    } else {
      inventoryEl.classList.add("hidden");
      canvas.requestPointerLock();
    }
  }

  // ---------- hiding in closets ----------
  function tryEnterCloset() {
    if (!nearestCloset) return false;
    enterCloset(nearestCloset);
    return true;
  }
  function enterCloset(cl) {
    state.hidden = true; hideCloset = cl;
    if (cl.type === "under") {
      yawObj.position.set(cl.hidePos.x, 0.55, cl.hidePos.z);  // crouch under the table
      toast("🛋️ Hiding under — E to come out");
    } else {
      yawObj.position.set(cl.hidePos.x, EYE_H, cl.hidePos.z);  // tuck toward the back
      yaw = cl.faceYaw; pitch = -0.05;                         // face out through the crack
      hidemaskEl.classList.remove("hidden");
      toast("🚪 Hiding — peek through the crack · E to step out");
    }
    state.seenTimer = Math.min(state.seenTimer, 1.5);          // it quickly loses your trail
    showPrompt("");
  }
  function exitCloset() {
    if (hideCloset) yawObj.position.set(hideCloset.enterPos.x, EYE_H, hideCloset.enterPos.z);
    state.hidden = false; hideCloset = null;
    hidemaskEl.classList.add("hidden");
  }

  // ---------- ui helpers ----------
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.style.opacity = "0"), 2200);
  }
  function showPrompt(msg) {
    promptEl.textContent = msg;
    promptEl.style.opacity = msg ? "1" : "0";
  }

  // ---------- start / end ----------
  function start() {
    genMaze();
    // rebuild walls + panels would be heavy; for simplicity regen only positions:
    rebuildWorld();
    resetPositions();
    state.started = true; state.alive = true; state.won = false;
    state.stamina = 1; state.battery = 1; state.sanity = 1;
    state.exitsFound = 0; state.time = 0; state.seen = false; state.flashOn = false;
    state.screamTimer = 0; state.warnTimer = 0; state.screamShake = 0;
    state.hunger = 1; state.thirst = 1; state.lunge = 0; state.staticAmt = 0; state.surge = 0;
    state.blinkCd = 2; state.glimpseCd = 8; state.eyesCd = 6; state.blackoutCd = 16; state.blackoutT = 0; state.hallucCd = 10;
    state.inv = { food: 0, water: 0 }; state.invOpen = false;
    state.hidden = false; hideCloset = null; nearestCloset = null;
    state.lightLevel = 1; state.darkCd = 45 + Math.random() * 40; state.darkT = 0; state.lightsOut = false; state.monsterBlind = 0;
    ambient.intensity = 0.45; hemi.intensity = 0.25; matCeil.emissiveIntensity = 0.35;
    inventoryEl.classList.add("hidden");
    hidemaskEl.classList.add("hidden");
    lastPlayerCell = -1; phantomCd = 6; nearestItem = null;
    cut = null;
    glimpse.visible = false; eyes.visible = false; fakeMonster.visible = false;
    head.scale.setScalar(1); grin.scale.set(1, 1, 1); maw.scale.set(1.1, 0.7, 0.5); monAnim.jaw.rotation.x = 0.08;
    screamWarn.classList.add("hidden");
    devour.classList.add("hidden"); devour.style.opacity = "0";
    canvas.style.filter = "";
    flashlight.intensity = 0;
    exitsEl.textContent = 0;
    overlay.classList.add("hidden");
    endscreen.classList.add("hidden");
    Sound.init();
    canvas.requestPointerLock();
  }

  function rebuildWorld() {
    // clear old walls / panels / lights
    while (wallGroup.children.length) wallGroup.remove(wallGroup.children[0]);
    flickers.length = 0;
    warps.length = 0;
    crushers.length = 0;
    closets.length = 0;
    phantoms.length = 0;
    items.length = 0;
    openCells.length = 0;
    // remove scattered scene panels/lights tagged
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const ch = scene.children[i];
      if (ch.userData && ch.userData.proc) scene.remove(ch);
    }
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++) {
        if (grid[r][c] === 1) {
          const m = new THREE.Mesh(wallGeo, matWall);
          const p = cellCenter(c, r);
          m.position.set(p.x, WALL_H / 2, p.z);
          m.castShadow = m.receiveShadow = true;
          wallGroup.add(m);
        } else openCells.push([c, r]);
      }
    for (const [c, r] of openCells) {
      const p = cellCenter(c, r);
      const panel = new THREE.Mesh(panelGeo, panelMat.clone());
      panel.rotation.x = Math.PI / 2;
      panel.position.set(p.x, WALL_H - 0.02, p.z);
      panel.userData.proc = true;
      scene.add(panel);
      flickers.push({ panel, light: null, base: panel.material.emissiveIntensity, t: Math.random() * 10, broken: Math.random() < 0.18 });
    }
    const shuffled = openCells.slice().sort(() => Math.random() - 0.5).slice(0, LIGHT_COUNT);
    for (const [c, r] of shuffled) {
      const p = cellCenter(c, r);
      const light = new THREE.PointLight(0xffeec0, 0.9, CELL * 3.2, 2);
      light.position.set(p.x, WALL_H - 0.4, p.z);
      light.userData.proc = true;
      scene.add(light);
      flickers.push({ panel: null, light, base: 0.9, t: Math.random() * 10, broken: Math.random() < 0.25 });
    }
    buildPinches();
    buildCrushers();
    buildAnomalies();
    buildTents();
    buildCorpses();
    buildWallText();
    buildClosets();
    buildFurniture();
  }

  // CRUSHING CORRIDORS — straight halls whose side walls slide inward to crush you,
  // then open, then close again, on a slow oscillation. Linger inside when shut → death.
  function buildCrushers() {
    const N = 4;
    let placed = 0;
    const cells = openCells.slice().sort(() => Math.random() - 0.5);
    const tryAxis = [["x", 1, 0], ["z", 0, 1]];
    for (const [c, r] of cells) {
      if (placed >= 2) break;
      if (Math.abs(c - 1) + Math.abs(r - 1) < 5) continue; // not at spawn
      for (const [axis, dc, dr] of tryAxis) {
        let ok = true;
        for (let i = 0; i < N; i++) {
          const cc = c + dc * i, rr = r + dr * i;
          if (isWallCell(cc, rr)) { ok = false; break; }
          if (!isWallCell(cc + dr, rr + dc) || !isWallCell(cc - dr, rr - dc)) { ok = false; break; }
        }
        if (!ok) continue;
        const sP = cellCenter(c, r), eP = cellCenter(c + dc * (N - 1), r + dr * (N - 1));
        const midX = (sP.x + eP.x) / 2, midZ = (sP.z + eP.z) / 2, along = N * CELL;
        const T = 5; // deep block so it reads as a solid wall mass (its bulk is buried in the side wall)
        const geo = axis === "x"
          ? new THREE.BoxGeometry(along, WALL_H, T)
          : new THREE.BoxGeometry(T, WALL_H, along);
        const slabA = new THREE.Mesh(geo, matWall); slabA.userData.proc = true; slabA.castShadow = slabA.receiveShadow = true;
        const slabB = new THREE.Mesh(geo, matWall); slabB.userData.proc = true; slabB.castShadow = slabB.receiveShadow = true;
        scene.add(slabA, slabB);
        crushers.push({
          axis, midX, midZ, slabA, slabB, T,
          cells: Array.from({ length: N }, (_, i) => [c + dc * i, r + dr * i]),
          t: Math.random() * 4, speed: 0.28 + Math.random() * 0.12, // slower oscillation
          maxGap: CELL - 0.2, minGap: -0.4, gap: CELL - 0.2, // minGap < 0 → walls fully seal/overlap
        });
        placed++;
        break;
      }
    }
  }

  // creepy backrooms scrawl smeared on the walls
  const WALL_MSGS = ["NO EXIT", "IT SEES", "TURN BACK", "WE NEVER LEFT", "BEHIND YOU",
    "NOT REAL", "HELP US", "DON'T LOOK", "IT'S HUNGRY", "ALMOST OUT", "RUN"];
  function wallTextTex(msg) {
    const S = 512, c = makeCanvas(S), x = c.getContext("2d");
    x.clearRect(0, 0, S, S);
    // --- blood splatter behind and around the writing ---
    for (let i = 0; i < 22; i++) {
      const bx = Math.random() * S, by = 70 + Math.random() * (S - 150), rad = 6 + Math.random() * 40;
      const g = x.createRadialGradient(bx, by, 1, bx, by, rad);
      g.addColorStop(0, `rgba(${70 + Math.random() * 45 | 0},0,0,${0.25 + Math.random() * 0.5})`);
      g.addColorStop(1, "rgba(45,0,0,0)");
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, rad, 0, 7); x.fill();
    }
    // fine spray + droplets
    for (let i = 0; i < 260; i++) {
      x.fillStyle = `rgba(${40 + Math.random() * 55 | 0},0,0,${0.3 + Math.random() * 0.5})`;
      x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 2.4 + 0.3, 0, 7); x.fill();
    }
    // --- the message, finger-smeared in blood, drawn letter by letter ---
    x.save(); x.translate(S / 2, S / 2); x.rotate((Math.random() - 0.5) * 0.16);
    x.textAlign = "center"; x.textBaseline = "middle";
    let fs = [54, 64, 74][(Math.random() * 3) | 0];
    let spacing = fs * 0.64;
    const letters = msg.split("");
    const maxW = S * 0.84;
    const fullW = (letters.length - 1) * spacing + fs; // span + outer letter widths
    if (fullW > maxW) { const sc = maxW / fullW; fs *= sc; spacing *= sc; } // shrink long messages to fit
    x.font = `900 ${fs}px Georgia, 'Times New Roman', serif`;
    const span = (letters.length - 1) * spacing;
    letters.forEach((ch, i) => {
      const lx = -span / 2 + i * spacing, ly = (Math.random() - 0.5) * fs * 0.18, rot = (Math.random() - 0.5) * 0.3;
      x.save(); x.translate(lx, ly); x.rotate(rot);
      // several offset, semi-transparent passes → wet, uneven hand-painted look
      for (let s = 0; s < 4; s++) {
        x.fillStyle = `rgba(${72 + Math.random() * 38 | 0},${Math.random() * 7 | 0},${Math.random() * 7 | 0},${0.22 + Math.random() * 0.22})`;
        x.fillText(ch, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      }
      // gravity drips running down from each letter
      x.strokeStyle = "rgba(68,0,0,0.6)"; x.lineCap = "round";
      const dn = 1 + ((Math.random() * 2) | 0);
      for (let d = 0; d < dn; d++) {
        x.lineWidth = 1.5 + Math.random() * 3;
        const ddx = (Math.random() - 0.5) * fs * 0.5;
        x.beginPath(); x.moveTo(ddx, fs * 0.34); x.lineTo(ddx + (Math.random() - 0.5) * 9, fs * 0.34 + Math.random() * 130); x.stroke();
      }
      x.restore();
    });
    x.restore();
    return new THREE.CanvasTexture(c);
  }
  function buildWallText() {
    const cells = openCells.slice().sort(() => Math.random() - 0.5);
    let placed = 0;
    for (const [c, r] of cells) {
      if (placed >= 6) break;
      if (Math.abs(c - 1) + Math.abs(r - 1) < 3) continue; // not right at spawn
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => isWallCell(c + dc, r + dr));
      if (!opts.length) continue;
      const [dc, dr] = opts[(Math.random() * opts.length) | 0];
      const p = cellCenter(c, r);
      const mat = new THREE.MeshBasicMaterial({ map: wallTextTex(WALL_MSGS[(Math.random() * WALL_MSGS.length) | 0]), transparent: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.78, WALL_H * 0.55), mat);
      const off = CELL / 2 - 0.04;
      plane.position.set(p.x + dc * off, WALL_H * 0.52, p.z + dr * off);
      plane.rotation.y = Math.atan2(-dc, -dr); // face into the open cell
      plane.userData.proc = true;
      scene.add(plane);
      placed++;
    }
  }

  // ---------- hiding furniture (wardrobes) + décor (tables) ----------
  function woodTex(base) {
    const c = makeCanvas(128), x = c.getContext("2d");
    x.fillStyle = base; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 44; i++) { // vertical grain streaks
      x.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.09})`;
      x.lineWidth = 0.5 + Math.random() * 1.6;
      const xx = Math.random() * 128;
      x.beginPath(); x.moveTo(xx, 0);
      for (let y = 0; y <= 128; y += 14) x.lineTo(xx + (Math.random() - 0.5) * 6, y);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex("#3a2a18"), color: 0x6b4e2e, roughness: 0.72, metalness: 0.05 });
  const woodDarkMat = new THREE.MeshStandardMaterial({ map: woodTex("#241a0f"), color: 0x4a3621, roughness: 0.8, metalness: 0.05 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.35, metalness: 0.85 });

  function makeCloset() {
    const g = new THREE.Group();
    const W = 1.2, H = 2.1, D = 0.78, t = 0.05, gap = 0.17;
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || woodMat);
    const back = box(W, H, t); back.position.set(0, H / 2, -D / 2 + t / 2); g.add(back);
    const left = box(t, H, D); left.position.set(-W / 2 + t / 2, H / 2, 0); g.add(left);
    const right = box(t, H, D); right.position.set(W / 2 - t / 2, H / 2, 0); g.add(right);
    const top = box(W, t, D); top.position.set(0, H - t / 2, 0); g.add(top);
    const bottom = box(W, t, D); bottom.position.set(0, t / 2 + 0.02, 0); g.add(bottom);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { // little feet
      const foot = box(0.08, 0.06, 0.08, woodDarkMat);
      foot.position.set(sx * (W / 2 - 0.1), 0.03, sz * (D / 2 - 0.1)); g.add(foot);
    });
    const dw = (W - gap) / 2 - 0.015; // two doors leaving a central crack
    const mkDoor = (sign) => {
      const door = new THREE.Group();
      door.add(box(dw, H - 0.12, 0.035, woodDarkMat));
      const panel = box(dw * 0.62, (H - 0.12) * 0.4, 0.012, woodMat);
      panel.position.set(0, (H - 0.12) * 0.21, 0.02); door.add(panel);
      const panel2 = panel.clone(); panel2.position.y = -(H - 0.12) * 0.22; door.add(panel2);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), metalMat);
      handle.position.set(-sign * (dw / 2 - 0.05), 0, 0.045); door.add(handle);
      door.position.set(sign * (gap / 2 + dw / 2), H / 2, D / 2 - 0.02);
      return door;
    };
    g.add(mkDoor(-1)); g.add(mkDoor(1));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData.proc = true;
    return { g, W, H, D };
  }

  function buildClosets() {
    const cells = openCells
      .filter(([c, r]) => Math.abs(c - 1) + Math.abs(r - 1) > 4)
      .sort(() => Math.random() - 0.5);
    let placed = 0;
    for (const [c, r] of cells) {
      if (placed >= 6) break;
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => isWallCell(c + dc, r + dr));
      if (!opts.length) continue;
      const [dc, dr] = opts[(Math.random() * opts.length) | 0];
      const cl = makeCloset();
      const p = cellCenter(c, r);
      const off = CELL / 2 - cl.D / 2 - 0.06;     // back nearly flush with the wall
      cl.g.position.set(p.x + dc * off, 0, p.z + dr * off);
      cl.g.rotation.y = Math.atan2(-dc, -dr);     // front (doors/+z) faces the room
      scene.add(cl.g);
      closets.push({
        g: cl.g, cell: [c, r], type: "closet",
        faceYaw: Math.atan2(dc, dr),              // yaw so the player looks OUT the crack
        hidePos: new THREE.Vector3(cl.g.position.x + dc * 0.12, 0, cl.g.position.z + dr * 0.12),
        enterPos: new THREE.Vector3(cl.g.position.x - dc * (cl.D / 2 + 0.7), 0, cl.g.position.z - dr * (cl.D / 2 + 0.7)),
      });
      placed++;
    }
  }

  function buildFurniture() {
    const cells = openCells
      .filter(([c, r]) => Math.abs(c - 1) + Math.abs(r - 1) > 3)
      .sort(() => Math.random() - 0.5).slice(0, 8);
    for (const [c, r] of cells) {
      const p = cellCenter(c, r);
      const g = new THREE.Group(); g.userData.proc = true;
      g.position.set(p.x + (Math.random() - 0.5) * 1.6, 0, p.z + (Math.random() - 0.5) * 1.6);
      g.rotation.y = Math.random() * Math.PI * 2;
      const TW = 1.5, TD = 0.95, TH = 0.82, lt = 0.07; // big enough to crawl under
      const tabletop = new THREE.Mesh(new THREE.BoxGeometry(TW, 0.06, TD), woodMat);
      tabletop.position.y = TH; g.add(tabletop);
      // a low apron under the rim so it reads as solid cover from outside
      const apron = new THREE.Mesh(new THREE.BoxGeometry(TW - 0.1, 0.12, TD - 0.1), woodDarkMat);
      apron.position.y = TH - 0.1; g.add(apron);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(lt, TH, lt), woodDarkMat);
        leg.position.set(sx * (TW / 2 - lt), TH / 2, sz * (TD / 2 - lt)); g.add(leg);
      });
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(g);
      // crawl under it to hide
      closets.push({
        g, cell: [c, r], type: "under", faceYaw: g.rotation.y,
        hidePos: new THREE.Vector3(g.position.x, 0, g.position.z),
        enterPos: new THREE.Vector3(g.position.x, 0, g.position.z),
      });
    }
  }

  // realistic blood pool: dark dried edges, wet crimson center, droplets + drag smears
  function bloodTex() {
    const c = makeCanvas(256), x = c.getContext("2d");
    x.clearRect(0, 0, 256, 256);
    // irregular main pool via overlapping blobs
    const cx = 128, cy = 128;
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * 7, rr = 30 + Math.random() * 64;
      const px = cx + Math.cos(ang) * rr * Math.random(), py = cy + Math.sin(ang) * rr * Math.random();
      const rad = 28 + Math.random() * 46;
      const g = x.createRadialGradient(px, py, 2, px, py, rad);
      g.addColorStop(0, "rgba(96,2,2,0.95)");
      g.addColorStop(0.7, "rgba(64,0,0,0.85)");
      g.addColorStop(1, "rgba(40,0,2,0)");
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    }
    // wet sheen highlight near center
    const sh = x.createRadialGradient(118, 116, 2, 118, 116, 40);
    sh.addColorStop(0, "rgba(180,30,30,0.5)"); sh.addColorStop(1, "rgba(180,30,30,0)");
    x.fillStyle = sh; x.beginPath(); x.arc(118, 116, 40, 0, 7); x.fill();
    // dried dark rim flecks
    for (let i = 0; i < 120; i++) {
      const ang = Math.random() * 7, rr = 70 + Math.random() * 55;
      x.fillStyle = `rgba(${30 + Math.random() * 30 | 0},0,0,${0.4 + Math.random() * 0.4})`;
      x.beginPath(); x.arc(128 + Math.cos(ang) * rr, 128 + Math.sin(ang) * rr, Math.random() * 4 + 0.6, 0, 7); x.fill();
    }
    // drag smear
    x.strokeStyle = "rgba(70,0,0,0.5)"; x.lineWidth = 10; x.lineCap = "round";
    x.beginPath(); x.moveTo(120, 120); x.lineTo(120 + (Math.random() - 0.5) * 120, 120 + (Math.random() - 0.5) * 120); x.stroke();
    return new THREE.CanvasTexture(c);
  }

  // grimy, blood-stained hazmat suit texture
  function suitTex() {
    const c = makeCanvas(256), x = c.getContext("2d");
    x.fillStyle = "#cdc6ad"; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(${90 + Math.random() * 40 | 0},${85 + Math.random() * 38 | 0},60,0.18)`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    // dirt smudges
    for (let i = 0; i < 22; i++) {
      const gx = Math.random() * 256, gy = Math.random() * 256, gr = 12 + Math.random() * 34;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, "rgba(40,34,18,0.4)"); g.addColorStop(1, "rgba(40,34,18,0)");
      x.fillStyle = g; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    // blood stains
    for (let i = 0; i < 9; i++) {
      const gx = Math.random() * 256, gy = Math.random() * 256, gr = 10 + Math.random() * 26;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, "rgba(90,0,0,0.7)"); g.addColorStop(0.7, "rgba(60,0,0,0.4)"); g.addColorStop(1, "rgba(60,0,0,0)");
      x.fillStyle = g; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  // dead hazmat figures slumped in pools of blood
  const corpseSuit = new THREE.MeshStandardMaterial({ map: suitTex(), color: 0xcabfa0, roughness: 0.9 });
  const corpseMask = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.4 });
  const corpseLens = new THREE.MeshStandardMaterial({ color: 0x2a2820, roughness: 0.15, metalness: 0.6, emissive: 0x0c0c08 });
  const corpseFilter = new THREE.MeshStandardMaterial({ color: 0x33312a, roughness: 0.6, metalness: 0.5 });

  // one anatomically-jointed body part (upper + lower segment with a joint)
  function limbPair(upLen, upR, loLen, loR, bend) {
    const g = new THREE.Group();
    const up = new THREE.Mesh(new THREE.CylinderGeometry(upR, upR * 0.85, upLen, 8), corpseSuit);
    up.position.y = -upLen / 2; up.castShadow = true; g.add(up);
    const jnt = new THREE.Group(); jnt.position.y = -upLen; jnt.rotation.x = bend; g.add(jnt);
    const lo = new THREE.Mesh(new THREE.CylinderGeometry(upR * 0.85, loR, loLen, 8), corpseSuit);
    lo.position.y = -loLen / 2; lo.castShadow = true; jnt.add(lo);
    return { g, jnt };
  }

  // gas-mask head used by every corpse pose
  function maskHead() {
    const h = new THREE.Group();
    const skullC = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 14), corpseSuit); skullC.castShadow = true; h.add(skullC);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 14), corpseMask); mask.scale.set(1, 0.92, 0.72); mask.position.set(0, -0.01, 0.12); h.add(mask);
    const lensL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), corpseLens); lensL.position.set(-0.06, 0.02, 0.19); h.add(lensL);
    const lensR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), corpseLens); lensR.position.set(0.06, 0.02, 0.19); h.add(lensR);
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), corpseFilter); filter.rotation.x = Math.PI / 2; filter.position.set(0, -0.08, 0.2); h.add(filter);
    return h;
  }
  function bloodPool(g, rad) {
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(rad, 26),
      new THREE.MeshBasicMaterial({ map: bloodTex(), transparent: true, opacity: 0.95, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.rotation.z = Math.random() * 6; pool.position.y = 0.012; g.add(pool);
  }

  // sprawled on the floor
  function proneBody(g) {
    bloodPool(g, 1.1 + Math.random() * 0.8);
    const body = new THREE.Group(); body.rotation.z = (Math.random() - 0.5) * 1.2; g.add(body);
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.19, 0.34, 10), corpseSuit);
    hips.rotation.x = Math.PI / 2; hips.position.set(0, 0.19, -0.1); hips.castShadow = true; body.add(hips);
    const chestC = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.21, 0.62, 10), corpseSuit);
    chestC.rotation.x = Math.PI / 2; chestC.position.set(0, 0.2, 0.32); chestC.castShadow = true; body.add(chestC);
    const headG = maskHead(); headG.position.set(0, 0.2, 0.66); headG.rotation.set(0.2, (Math.random() - 0.5) * 1.0, 0); body.add(headG);
    [[-1, 0.5 + Math.random() * 0.6], [1, -0.5 - Math.random() * 0.6]].forEach(([side, splay]) => {
      const arm = limbPair(0.42, 0.07, 0.42, 0.05, -0.4 - Math.random() * 0.8);
      arm.g.position.set(side * 0.24, 0.22, 0.55); arm.g.rotation.z = side * 1.5; arm.g.rotation.y = splay; arm.g.rotation.x = 0.2;
      body.add(arm.g);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), corpseSuit); hand.position.y = -0.42; arm.jnt.add(hand);
    });
    [[-1, Math.random() * 0.5], [1, -Math.random() * 0.9]].forEach(([side, splay]) => {
      const leg = limbPair(0.5, 0.1, 0.5, 0.07, 0.2 + Math.random() * 0.9);
      leg.g.position.set(side * 0.13, 0.2, -0.28); leg.g.rotation.x = Math.PI - 0.15; leg.g.rotation.z = side * 0.15 + splay;
      body.add(leg.g);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.26), corpseMask); boot.position.set(0, -0.45, 0.06); leg.jnt.add(boot);
    });
  }

  // slumped sitting, back against a wall, head lolled, legs splayed out front
  function sittingBody(g) {
    bloodPool(g, 0.9 + Math.random() * 0.5);
    // leaned-back torso
    const torsoG = new THREE.Group(); torsoG.position.set(0, 0.26, 0); torsoG.rotation.x = -0.32; g.add(torsoG);
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), corpseSuit); hips.scale.set(1.1, 0.8, 0.9); hips.castShadow = true; torsoG.add(hips);
    const chestC = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.6, 10), corpseSuit); chestC.position.y = 0.34; chestC.castShadow = true; torsoG.add(chestC);
    // head slumped forward onto chest
    const headG = maskHead(); headG.position.set((Math.random() - 0.5) * 0.1, 0.6, 0.08); headG.rotation.set(0.7, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4); torsoG.add(headG);
    // arms hang at sides into the lap
    [-1, 1].forEach((side) => {
      const arm = limbPair(0.4, 0.07, 0.42, 0.05, -1.1 - Math.random() * 0.5);
      arm.g.position.set(side * 0.22, 0.5, 0.02); arm.g.rotation.x = 0.5; arm.g.rotation.z = side * 0.25;
      torsoG.add(arm.g);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), corpseSuit); hand.position.y = -0.42; arm.jnt.add(hand);
    });
    // legs extended forward along the floor, slightly bent
    [-1, 1].forEach((side) => {
      const leg = limbPair(0.5, 0.1, 0.5, 0.07, 0.5 + Math.random() * 0.4);
      leg.g.position.set(side * 0.13, 0.2, 0.1); leg.g.rotation.x = -Math.PI / 2 + 0.12; leg.g.rotation.z = side * (0.2 + Math.random() * 0.2);
      g.add(leg.g);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.26), corpseMask); boot.position.set(0, -0.42, -0.04); boot.rotation.x = 0.4; leg.jnt.add(boot);
    });
  }

  function buildCorpses() {
    const cells = openCells
      .filter(([c, r]) => (c - 1) * (c - 1) + (r - 1) * (r - 1) > 12)
      .sort(() => Math.random() - 0.5).slice(0, 12);
    for (const [c, r] of cells) {
      const p = cellCenter(c, r);
      const g = new THREE.Group();
      g.userData.proc = true;
      // prefer leaning against a wall when one is adjacent
      const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => isWallCell(c + dc, r + dr));
      if (nbs.length && Math.random() < 0.55) {
        const [dc, dr] = nbs[(Math.random() * nbs.length) | 0];
        const off = CELL / 2 - 0.45;
        g.position.set(p.x + dc * off, 0, p.z + dr * off);
        g.rotation.y = Math.atan2(-dc, -dr); // back to wall, facing the room
        sittingBody(g);
      } else {
        g.position.set(p.x + (Math.random() - 0.5) * 2.0, 0, p.z + (Math.random() - 0.5) * 2.0);
        g.rotation.y = Math.random() * Math.PI * 2;
        proneBody(g);
      }
      scene.add(g);
      // supplies are scarce — only the occasional corpse still has any
      if (Math.random() < 0.22) {
        const type = Math.random() < 0.5 ? "food" : "water";
        spawnItem(g.position.x + (Math.random() - 0.5) * 1.4, g.position.z + (Math.random() - 0.5) * 1.4, [c, r], type);
      }
    }
  }

  // food cans / water bottles
  const foodMat = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.5, metalness: 0.4, emissive: 0xff7a1a, emissiveIntensity: 0.7 });
  const foodLidMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c0, roughness: 0.4, metalness: 0.5, emissive: 0x554422, emissiveIntensity: 0.4 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x7fd6ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x2aa0ff, emissiveIntensity: 0.7 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.4 });
  function spawnItem(x, z, cell, type) {
    const g = new THREE.Group();
    if (type === "food") {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 12), foodMat);
      can.castShadow = true; g.add(can);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.03, 12), foodLidMat); lid.position.y = 0.1; g.add(lid);
    } else {
      const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.34, 12), waterMat);
      bot.castShadow = true; g.add(bot);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), capMat); cap.position.y = 0.2; g.add(cap);
    }
    g.position.set(x, 0.22, z);
    g.userData.proc = true;
    scene.add(g);
    items.push({ mesh: g, type, cell, taken: false, baseY: 0.22 });
  }

  // supply tents — a couple of safe-ish caches with loot inside
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xbf5a23, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const tentDark = new THREE.MeshStandardMaterial({ color: 0x140a05, roughness: 1, side: THREE.DoubleSide });
  const tentPole = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 });
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x241608, roughness: 1 });
  // build a flat polygon from world-space corner Vector3s (double-sided so winding is irrelevant)
  function poly(points, mat) {
    const geo = new THREE.BufferGeometry();
    const arr = [];
    for (let i = 1; i < points.length - 1; i++) {
      arr.push(points[0].x, points[0].y, points[0].z,
        points[i].x, points[i].y, points[i].z,
        points[i + 1].x, points[i + 1].y, points[i + 1].z);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m;
  }
  function buildTents() {
    const cells = openCells
      .filter(([c, r]) => (c - 1) * (c - 1) + (r - 1) * (r - 1) > 16)
      .sort(() => Math.random() - 0.5).slice(0, 3);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const [c, r] of cells) {
      const p = cellCenter(c, r);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = Math.random() * Math.PI * 2;
      g.userData.proc = true;
      const W = 2.0, H = 1.45, L = 2.7, hw = W / 2, hl = L / 2;
      // ridge ends
      const rF = V(0, H, hl), rB = V(0, H, -hl);
      // base edges
      const blF = V(-hw, 0, hl), blB = V(-hw, 0, -hl), brF = V(hw, 0, hl), brB = V(hw, 0, -hl);
      // two sloped fabric sides
      g.add(poly([rB, rF, brF, brB], tentMat)); // right slope
      g.add(poly([rB, rF, blF, blB], tentMat)); // left slope
      // closed back triangle
      g.add(poly([blB, brB, rB], tentMat));
      // front: two flaps leaving a dark entrance gap in the middle
      g.add(poly([blF, V(-0.28, 0, hl), V(0, H * 0.55, hl), rF], tentMat));
      g.add(poly([brF, V(0.28, 0, hl), V(0, H * 0.55, hl), rF], tentMat));
      // dark interior backdrop so the opening reads as a hole
      g.add(poly([V(-0.5, 0, hl - 0.05), V(0.5, 0, hl - 0.05), V(0.4, H * 0.7, hl - 0.05), V(-0.4, H * 0.7, hl - 0.05)], tentDark));
      // ridge pole + ground sheet
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L + 0.1, 6), tentPole);
      pole.rotation.x = Math.PI / 2; pole.position.y = H; g.add(pole);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.96, L * 0.96), groundMat);
      ground.rotation.x = -Math.PI / 2; ground.position.y = 0.02; g.add(ground);
      scene.add(g);
      // a single supply sitting just OUTSIDE the entrance, so it's actually visible (and rare)
      const ry = g.rotation.y, fz = L / 2 + 0.65;
      spawnItem(p.x + Math.sin(ry) * fz, p.z + Math.cos(ry) * fz, [c, r], Math.random() < 0.5 ? "food" : "water");
    }
  }

  // real "shrinking corridor" — walls bulge inward and the ceiling lowers toward
  // a tight squeeze in the middle of a straight hallway, then opens up again.
  // Built from the actual wall/ceiling textures so it reads as the room closing in.
  function buildPinches() {
    const insetMax = CELL * 0.32, dropMax = WALL_H * 0.42;
    const N = 5;
    let placed = 0;
    const cells = openCells.slice().sort(() => Math.random() - 0.5);
    const tryAxis = [["x", 1, 0], ["z", 0, 1]];
    for (const [c, r] of cells) {
      if (placed >= 2) break;
      if (Math.abs(c - 1) + Math.abs(r - 1) < 4) continue; // not at spawn
      for (const [axis, dc, dr] of tryAxis) {
        // a straight 1-wide hallway run of N cells (walls on both sides)
        let ok = true;
        for (let i = 0; i < N; i++) {
          const cc = c + dc * i, rr = r + dr * i;
          if (isWallCell(cc, rr)) { ok = false; break; }
          if (!isWallCell(cc + dr, rr + dc) || !isWallCell(cc - dr, rr - dc)) { ok = false; break; }
        }
        if (!ok) continue;
        for (let i = 0; i < N; i++) {
          const cc = c + dc * i, rr = r + dr * i;
          const n = Math.sin((i / (N - 1)) * Math.PI); // 0 → 1 → 0
          const inset = n * insetMax, drop = n * dropMax;
          const p = cellCenter(cc, rr);
          if (inset > 0.03) {
            if (axis === "x") {
              const s1 = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H, inset), matWall);
              s1.position.set(p.x, WALL_H / 2, (rr + 1) * CELL - inset / 2); s1.receiveShadow = true; s1.userData.proc = true; scene.add(s1);
              const s2 = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H, inset), matWall);
              s2.position.set(p.x, WALL_H / 2, rr * CELL + inset / 2); s2.receiveShadow = true; s2.userData.proc = true; scene.add(s2);
            } else {
              const s1 = new THREE.Mesh(new THREE.BoxGeometry(inset, WALL_H, CELL), matWall);
              s1.position.set((cc + 1) * CELL - inset / 2, WALL_H / 2, p.z); s1.receiveShadow = true; s1.userData.proc = true; scene.add(s1);
              const s2 = new THREE.Mesh(new THREE.BoxGeometry(inset, WALL_H, CELL), matWall);
              s2.position.set(cc * CELL + inset / 2, WALL_H / 2, p.z); s2.receiveShadow = true; s2.userData.proc = true; scene.add(s2);
            }
          }
          if (drop > 0.03) {
            const cd = new THREE.Mesh(new THREE.BoxGeometry(CELL, drop, CELL), matCeil);
            cd.position.set(p.x, WALL_H - drop / 2, p.z); cd.userData.proc = true; scene.add(cd);
          }
        }
        placed++;
        break;
      }
    }
  }

  // BREATHING WALLS — pick real maze walls that swell & recede like lungs.
  // (no floating boxes; the actual wallpapered walls bulge in and out.)
  function buildAnomalies() {
    const walls = wallGroup.children;
    if (!walls.length) return;
    const want = Math.min(14, Math.floor(walls.length * 0.18));
    const idx = walls.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, want);
    for (const i of idx) {
      const m = walls[i];
      if (m.userData.breathing) continue;
      m.userData.breathing = true;
      m.material = m.material.clone(); // own material so its faint sick glow is independent
      m.material.emissive = new THREE.Color(0x160020);
      m.material.emissiveIntensity = 0;
      warps.push({ mesh: m, t: Math.random() * 6, freq: 0.5 + Math.random() * 0.6, phase: Math.random() * 6 });
    }
  }

  // ---------- death: the devour cutscene ----------
  let cut = null;
  function die(reason, devoured = true) {
    if (!state.alive || cut) return;
    state.alive = false;
    radarEl.classList.add("hidden");
    screamWarn.classList.add("hidden");
    dangerbar.classList.add("hidden");
    showPrompt("");
    glimpse.visible = false; eyes.visible = false; fakeMonster.visible = false;
    document.exitPointerLock();
    Sound.scream();
    // environmental death (crushed, mind shattered) — no eating cutscene
    if (!devoured) {
      canvas.style.filter = ""; grain.style.opacity = "0.05";
      document.getElementById("end-icon").textContent = "💀";
      document.getElementById("end-title").textContent = "DEAD";
      document.getElementById("end-text").textContent =
        reason + ` You lasted ${fmtTime(state.time)} in the endless yellow.`;
      endscreen.classList.remove("hidden");
      return;
    }
    // slam the entity right into your face, looming, and play the cutscene
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    monster.position.set(yawObj.position.x + fx * 3.6, 0, yawObj.position.z + fz * 3.6);
    cut = { t: 0, dur: 3.0, reason, fx, fz, bit: false, gore: false };
    devour.classList.remove("hidden");
    devour.style.opacity = "0";
    state.staticAmt = 0.5;
  }

  function devourUpdate(dt) {
    cut.t += dt;
    const k = Math.min(1, cut.t / cut.dur);
    const ease = k * k * (3 - 2 * k); // smoothstep
    const px = yawObj.position.x, pz = yawObj.position.z;
    // it rushes in from arm's length to right against the lens
    const d = 3.6 * (1 - ease) + 0.22;
    monster.position.x = px + cut.fx * d;
    monster.position.z = pz + cut.fz * d;
    monster.position.y = ease * 0.25;            // rears up over you
    monster.rotation.y = Math.atan2(px - monster.position.x, pz - monster.position.z);

    // the head swells and the jaw gapes wide to swallow the screen
    head.scale.setScalar(1 + ease * 5.5);
    grin.scale.set(1 + ease * 2.5, 1 + ease * 3.5, 1);
    maw.scale.set(1.1 * (1 + ease * 3.0), 0.7 * (1 + ease * 4.5), 0.6);
    monAnim.jaw.rotation.x = 0.1 + ease * 1.3;
    for (const dr of monAnim.drool) { dr.scale.y = 0.3 + ease * 4; dr.position.y = -0.22 - ease * 0.5; dr.material.opacity = 0.55; }
    eyeGlow.intensity = 2 + ease * 9;
    monAnim.mawLight.intensity = 4 + ease * 8; // the throat glows as it swallows you
    eyeL.scale.y = eyeR.scale.y = 1.7;

    // force the camera to crane up into the maw, shaking violently
    pitch += (0.25 + ease * 0.4 - pitch) * Math.min(1, dt * 6);
    yawObj.rotation.y = yaw; pitchObj.rotation.x = pitch;
    const shake = 0.04 + ease * 0.55;
    camera.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.5);
    camera.rotation.z = (Math.random() - 0.5) * shake;

    // bite + tearing audio as it closes
    if (!cut.bit && k > 0.6) { cut.bit = true; Sound.bite(); }
    if (!cut.gore && k > 0.72) { cut.gore = true; Sound.gore(); }

    // flesh & blood draw over the lens in the final stretch
    devour.style.opacity = String(Math.max(0, (k - 0.5) / 0.5));
    canvas.style.filter = `saturate(${(1.4 + ease * 1.6).toFixed(2)}) contrast(${(1.1 + ease * 0.6).toFixed(2)}) hue-rotate(${(ease * -22).toFixed(0)}deg)`;
    grain.style.opacity = (0.1 + ease * 0.5).toFixed(2);
    vignette.style.boxShadow = `inset 0 0 ${(220 + ease * 200) | 0}px ${(80 + ease * 280) | 0}px rgba(${(40 + ease * 90) | 0},0,0,0.96)`;

    if (k >= 1) finishDevour();
  }

  function finishDevour() {
    const reason = cut.reason;
    cut = null;
    // reset the face for the next run
    head.scale.setScalar(1); grin.scale.set(1, 1, 1); maw.scale.set(1.1, 0.7, 0.5);
    monAnim.jaw.rotation.x = 0.08;
    canvas.style.filter = ""; grain.style.opacity = "0.05";
    document.getElementById("end-icon").textContent = "💀";
    document.getElementById("end-title").textContent = "DEVOURED";
    document.getElementById("end-text").textContent =
      reason + ` It dragged you into the dark and fed. You lasted ${fmtTime(state.time)} in the endless yellow.`;
    devour.classList.add("hidden"); devour.style.opacity = "0";
    endscreen.classList.remove("hidden");
  }
  function win() {
    state.alive = false; state.won = true;
    radarEl.classList.add("hidden");
    screamWarn.classList.add("hidden");
    canvas.style.filter = "";
    grain.style.opacity = "0.05";
    document.exitPointerLock();
    document.getElementById("end-icon").textContent = "🚪";
    document.getElementById("end-title").textContent = "ESCAPED";
    document.getElementById("end-text").textContent =
      `You found the exit and clawed your way back to reality — in ${fmtTime(state.time)}. For now, you're free.`;
    endscreen.classList.remove("hidden");
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  }

  // ---------- crushing corridors ----------
  // a crusher corridor is impassable to the monster once its gap is too narrow to fit through
  function crusherSealed(c, r) {
    for (const cr of crushers) {
      if (cr.gap < 1.4 && cr.cells.some(([cc, rr]) => cc === c && rr === r)) return true;
    }
    return false;
  }
  function updateCrushers(dt) {
    if (!crushers.length) return;
    const px = yawObj.position.x, pz = yawObj.position.z;
    const pc = colOf(px), pr = rowOf(pz);
    for (const cr of crushers) {
      cr.t += dt;
      const phase = Math.sin(cr.t * cr.speed) * 0.5 + 0.5;       // 0 open → 1 shut
      const gap = cr.maxGap * (1 - phase) + cr.minGap * phase;
      cr.gap = gap;
      const half = Math.max(0, gap) / 2;
      const off = half + cr.T / 2; // place the block so its inner face is at ±half, the bulk buried in the side wall
      if (cr.axis === "x") {
        cr.slabA.position.set(cr.midX, WALL_H / 2, cr.midZ - off);
        cr.slabB.position.set(cr.midX, WALL_H / 2, cr.midZ + off);
      } else {
        cr.slabA.position.set(cr.midX - off, WALL_H / 2, cr.midZ);
        cr.slabB.position.set(cr.midX + off, WALL_H / 2, cr.midZ);
      }
      const inZone = cr.cells.some(([c, r]) => c === pc && r === pr);
      if (inZone) {
        // only lethal if the walls actually collide (gap shut) AND you're caught in the middle
        const perp = cr.axis === "x" ? Math.abs(pz - cr.midZ) : Math.abs(px - cr.midX);
        if (gap <= 0.25 && perp < 0.8) return die("The walls slammed shut on you.", false);
        if (gap < CELL * 0.62) {
          state.screamShake = Math.max(state.screamShake, (1 - gap / (CELL * 0.62)) * 0.45);
        }
      }
    }
  }

  // ---------- weird-stuff anomalies (glimpses, eyes, blackouts, hallucinations) ----------
  function updateAnomalies(dt) {
    const px = yawObj.position.x, pz = yawObj.position.z;

    // HALLUCINATION: you "see" the entity standing where it isn't. It frays your sanity
    // while in view, then is simply gone — more frequent the more unhinged you are.
    state.hallucCd -= dt;
    if (fakeMonster.visible) {
      hallucT -= dt;
      fakeMonster.lookAt(px, fakeMonster.position.y, pz);
      fakeMonster.rotation.y += (Math.random() - 0.5) * 0.05; // faint twitch
      const fdx = fakeMonster.position.x - px, fdz = fakeMonster.position.z - pz, fd = Math.hypot(fdx, fdz);
      const seenLOS = hasLOS(px, pz, fakeMonster.position.x, fakeMonster.position.z);
      const inView = (fdx * forward.x + fdz * forward.z) / (fd || 1) > 0.2 && seenLOS;
      if (inView) state.sanity = Math.max(0, state.sanity - dt * 0.045);
      if (hallucT <= 0 || fd < 6 || !seenLOS) fakeMonster.visible = false; // it was never there
    } else if (state.hallucCd <= 0 && !state.seen) {
      const fear = 1 - state.sanity;
      state.hallucCd = 14 + Math.random() * 16 - fear * 8;
      if (Math.random() < 0.4 + fear * 0.5) {
        const cand = openCells.filter(([c, r]) => {
          const p = cellCenter(c, r); const dd = Math.hypot(p.x - px, p.z - pz);
          return dd > 9 && dd < 26 && hasLOS(px, pz, p.x, p.z);
        });
        if (cand.length) {
          const [c, r] = cand[(Math.random() * cand.length) | 0]; const p = cellCenter(c, r);
          fakeMonster.position.set(p.x, 0, p.z); fakeMonster.visible = true; hallucT = 2.5 + Math.random() * 2;
          if (Math.random() < 0.5) Sound.whisper();
        }
      }
    }

    // a figure glimpsed down a far corridor — gone the instant you near it or look away
    state.glimpseCd -= dt;
    if (glimpse.visible) {
      glimpseT -= dt;
      glimpse.lookAt(px, 1.15, pz);
      const gd = Math.hypot(glimpse.position.x - px, glimpse.position.z - pz);
      if (glimpseT <= 0 || gd < 7 || !hasLOS(px, pz, glimpse.position.x, glimpse.position.z)) glimpse.visible = false;
    } else if (state.glimpseCd <= 0 && !state.seen) {
      state.glimpseCd = 12 + Math.random() * 16;
      const cand = openCells.filter(([c, r]) => {
        const p = cellCenter(c, r); const dd = Math.hypot(p.x - px, p.z - pz);
        return dd > 14 && dd < 42 && hasLOS(px, pz, p.x, p.z);
      });
      if (cand.length) {
        const [c, r] = cand[(Math.random() * cand.length) | 0]; const p = cellCenter(c, r);
        glimpse.position.set(p.x, 0, p.z); glimpse.visible = true; glimpseT = 1.3 + Math.random() * 0.8;
        state.sanity = Math.max(0, state.sanity - 0.02);
        if (Math.random() < 0.5) Sound.whisper();
      }
    }

    // pairs of eyes that open in the dark, blink, and vanish
    state.eyesCd -= dt;
    if (eyes.visible) {
      eyesT -= dt;
      eyes.lookAt(px, eyes.position.y, pz);
      eyes.scale.y = (Math.sin(state.time * 7) > 0.85) ? 0.12 : 1; // blink
      if (eyesT <= 0) eyes.visible = false;
    } else if (state.eyesCd <= 0) {
      state.eyesCd = 9 + Math.random() * 12;
      const cand = openCells.filter(([c, r]) => {
        const p = cellCenter(c, r); const dd = Math.hypot(p.x - px, p.z - pz); return dd > 8 && dd < 24;
      });
      if (cand.length) {
        const [c, r] = cand[(Math.random() * cand.length) | 0]; const p = cellCenter(c, r);
        eyes.position.set(p.x, 1.5, p.z); eyes.visible = true; eyesT = 2 + Math.random() * 2;
      }
    }

    // the lights die for a beat while something whispers
    if (state.blackoutT > 0) {
      state.blackoutT -= dt;
    } else {
      state.blackoutCd -= dt;
      if (state.blackoutCd <= 0) {
        state.blackoutCd = 22 + Math.random() * 26;
        state.blackoutT = 0.55 + Math.random() * 0.5;
        Sound.whisper();
        state.sanity = Math.max(0, state.sanity - 0.04);
      }
    }
  }

  // ---------- rare full blackout: pitch black → flicker → back on ----------
  const DARK_OFF = 5.5, DARK_FLICK = 2.5; // seconds of pitch dark, then flickering recovery
  function updateDarkEvent(dt) {
    if (state.darkT > 0) {
      state.darkT -= dt;
      const elapsed = (DARK_OFF + DARK_FLICK) - state.darkT;
      let lvl;
      if (elapsed < DARK_OFF) lvl = 0.015;                 // pitch black — only the flashlight reads
      else {
        const fp = (elapsed - DARK_OFF) / DARK_FLICK;      // 0..1 recovery
        lvl = (Math.random() < 0.5 ? 0.04 : 0.55 + Math.random() * 0.45); // violent stutter
        lvl = Math.min(1, Math.max(lvl, fp));              // trends back to full
      }
      if (state.darkT <= 0) { state.darkT = 0; lvl = 1; }
      state.lightLevel = lvl;
      state.lightsOut = lvl < 0.3;
    } else {
      if (state.lightLevel < 1) state.lightLevel = Math.min(1, state.lightLevel + dt * 4);
      state.lightsOut = false;
      state.darkCd -= dt;
      if (state.darkCd <= 0) {
        state.darkCd = 70 + Math.random() * 80;
        if (Math.random() < 0.45) state.darkT = DARK_OFF + DARK_FLICK; // rare trigger
      }
    }
    ambient.intensity = 0.45 * state.lightLevel;
    hemi.intensity = 0.25 * state.lightLevel;
    matCeil.emissiveIntensity = 0.35 * state.lightLevel;
  }

  startbtn.addEventListener("click", start);
  restartbtn.addEventListener("click", start);

  // ---------- resize ----------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- main loop ----------
  let last = performance.now();
  let pathTimer = 0;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // apply look
    yawObj.rotation.y = yaw;
    pitchObj.rotation.x = pitch;

    if (cut) {
      devourUpdate(dt);
    } else if (state.started && state.alive && !state.invOpen) {
      update(dt);
    }
    // flicker always (atmosphere)
    flickerUpdate(dt);

    renderer.render(scene, camera);
  }

  function flickerUpdate(dt) {
    const dark = state.blackoutT > 0 ? 0.05 : 1; // sudden blackout anomaly kills the lights
    for (const f of flickers) {
      f.t += dt;
      let v;
      if (f.broken) {
        v = (Math.sin(f.t * 23) > 0.7 && Math.random() > 0.3) ? f.base : f.base * 0.05;
      } else {
        v = f.base * (0.85 + 0.15 * Math.sin(f.t * 7 + Math.sin(f.t * 13)));
        if (Math.random() < 0.004) v = f.base * 0.2; // rare blink
      }
      v *= dark * state.lightLevel; // full-blackout event drags everything toward pitch black
      if (f.panel) f.panel.material.emissiveIntensity = v;
      if (f.light) f.light.intensity = v;
    }
    // breathing walls — the actual maze walls swell & recede; stronger as sanity falls
    const insane = 1 - (state.sanity != null ? state.sanity : 1);
    for (const w of warps) {
      w.t += dt;
      const wave = Math.sin(w.t * w.freq + w.phase);
      const amp = 0.03 + insane * 0.17;           // barely-there when sane, heaving when not
      const s = 1 + wave * amp;
      w.mesh.scale.set(s, 1 + (s - 1) * 0.25, s);  // bulge sideways, slight vertical
      w.mesh.material.emissiveIntensity = insane * (0.12 + 0.12 * (wave * 0.5 + 0.5));
    }
  }

  function update(dt) {
    state.time += dt;
    clockEl.textContent = fmtTime(state.time);

    // rare full blackout (drives lighting + the flashlight-blinding window)
    updateDarkEvent(dt);

    // ---- movement ----
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    let mx = 0, mz = 0;
    if (state.keys["KeyW"]) { mx += forward.x; mz += forward.z; }
    if (state.keys["KeyS"]) { mx -= forward.x; mz -= forward.z; }
    if (state.keys["KeyD"]) { mx += right.x; mz += right.z; }
    if (state.keys["KeyA"]) { mx -= right.x; mz -= right.z; }
    if (state.hidden) { mx = 0; mz = 0; } // you're tucked inside the closet
    const moving = mx !== 0 || mz !== 0;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;

    state.sprinting = state.keys["ShiftLeft"] && moving && state.stamina > 0.02;
    const speed = (state.sprinting ? 7.2 : 3.4) * dt;
    if (state.sprinting) state.stamina = Math.max(0, state.stamina - dt * 0.2);
    else state.stamina = Math.min(1, state.stamina + dt * 0.18);

    const px = yawObj.position.x, pz = yawObj.position.z;
    const nx = px + mx * speed, nz = pz + mz * speed;
    if (!blocked(nx, pz)) yawObj.position.x = nx;
    if (!blocked(yawObj.position.x, nz)) yawObj.position.z = nz;

    // ---- the entity screams every 30s and pinpoints you ----
    state.screamTimer += dt;
    if (state.screamTimer >= 30) {
      state.screamTimer = 0;
      state.screamShake = 1.0;
      dmgflash.style.opacity = "0.55";
      Sound.scream();
      if (!state.hidden) {                       // hiding keeps your location a secret
        state.seen = true; state.seenTimer = 7;  // your spot is leaked — it hunts
        pathTimer = 0;
        state.warnTimer = 2;
        state.lunge = 1.3;
        screamWarn.classList.remove("hidden");
      }
    }
    if (state.warnTimer > 0) {
      state.warnTimer -= dt;
      if (state.warnTimer <= 0) screamWarn.classList.add("hidden");
    }

    // ---- illusory walls: a corridor seals up behind you, dissolves if you approach ----
    const curCol = colOf(yawObj.position.x), curRow = rowOf(yawObj.position.z);
    const curCell = curRow * GRID + curCol;
    phantomCd -= dt;
    if (curCell !== lastPlayerCell) {
      if (phantomCd <= 0 && lastPlayerCell >= 0) {
        const lc = lastPlayerCell % GRID, lr = (lastPlayerCell / GRID) | 0;
        const dCol = lc - curCol, dRow = lr - curRow;
        const behind = forward.x * dCol + forward.z * dRow < 0; // cell you came from is behind you
        const chance = 0.45 + (1 - state.sanity) * 0.4;
        if (behind && !isWallCell(lc, lr) && Math.random() < chance) {
          spawnPhantom(lc, lr);
          phantomCd = 7 + Math.random() * 7;
        }
      }
      lastPlayerCell = curCell;
    }
    for (let i = phantoms.length - 1; i >= 0; i--) {
      const ph = phantoms[i];
      ph.life -= dt;
      const ddx = ph.mesh.position.x - yawObj.position.x, ddz = ph.mesh.position.z - yawObj.position.z;
      if (Math.hypot(ddx, ddz) < CELL * 1.3 || ph.life <= 0) {
        ph.mat.opacity -= dt * 2.5;
        if (ph.mat.opacity <= 0) { scene.remove(ph.mesh); phantoms.splice(i, 1); }
      }
    }

    // ---- flashlight battery ----
    if (state.flashOn) {
      state.battery = Math.max(0, state.battery - dt * 0.025);
      if (state.battery <= 0) { state.flashOn = false; flashlight.intensity = 0; toast("🔦 Battery dead!"); }
    } else {
      state.battery = Math.min(1, state.battery + dt * 0.006);
    }

    // ---- monster AI (relentless stalker) ----
    const dxm = yawObj.position.x - monster.position.x;
    const dzm = yawObj.position.z - monster.position.z;
    const distM = Math.hypot(dxm, dzm);
    state.lunge = Math.max(0, state.lunge - dt * 0.9);

    const los = hasLOS(monster.position.x, monster.position.z, yawObj.position.x, yawObj.position.z);
    const inFront = (dxm * forward.x + dzm * forward.z) / (distM || 1); // 1 = dead ahead
    const watched = los && inFront > 0.45 && distM < 24; // you are looking right at it

    // in a full blackout, catching it in your flashlight beam blinds it for ~1.5s
    if (state.lightsOut && state.flashOn && los && inFront > 0.75 && distM < 26) state.monsterBlind = 1.5;
    state.monsterBlind = Math.max(0, state.monsterBlind - dt);

    // it has no eyes for you — you're invisible. It only knows where you are when your location
    // is LEAKED (the scream), and only for as long as that hunt lasts. Then you vanish again.
    if (state.seenTimer > 0) {
      state.seenTimer -= dt;
      if (state.seenTimer <= 0) state.seen = false;
    }

    dangerbar.classList.toggle("hidden", !state.seen);

    // it slips closer the instant you aren't looking right at it — blink and it's nearer
    state.blinkCd -= dt;
    if (state.seen && !watched && distM > 4.5 && state.blinkCd <= 0 && Math.random() < dt * 1.4) {
      state.blinkCd = 1.4 + Math.random() * 1.8;
      const step = Math.min(distM - 3.5, 2.0);
      monster.position.x += (dxm / distM) * step;
      monster.position.z += (dzm / distM) * step;
    }

    // RELENTLESS: it ALWAYS advances on you once it knows where you are. Looking at it
    // only slows it a little — looking AWAY lets it sprint. You cannot stare it down; you run.
    state.surge = Math.max(0, (state.surge || 0) - dt);
    if (state.seen && state.surge <= 0 && Math.random() < dt * 0.32) { state.surge = 0.5 + Math.random() * 0.8; Sound.growl(); } // random terrifying bursts
    const chaseSpeed = 5.2 + state.lunge * 3.6 + (state.surge > 0 ? 2.8 : 0);
    let mSpeed = state.seen ? chaseSpeed : 2.6; // steady prowl while roaming, fast when hunting
    if (state.seen) { if (watched) mSpeed *= 0.62; else mSpeed *= 1.55; } // creeps when faced, bolts when you look away
    mSpeed *= dt;
    if (state.monsterBlind > 0) mSpeed = 0; // blinded by the flashlight — frozen in place

    // pathing: chase your live position while leaked; otherwise ROAM — commit to a far wander
    // target and only pick a new one once it arrives, so it actually prowls instead of jittering.
    pathTimer -= dt;
    if (state.seen) {
      if (pathTimer <= 0) {
        pathTimer = 0.25;
        const mc = colOf(monster.position.x), mr = rowOf(monster.position.z);
        monsterPath = bfsPath(mc, mr, colOf(yawObj.position.x), rowOf(yawObj.position.z));
        if (monsterPath.length > 1) monsterPath.shift();
      }
    } else if (!monsterPath.length) {
      const mc = colOf(monster.position.x), mr = rowOf(monster.position.z);
      let tgt, tries = 0;
      do { tgt = openCells[(Math.random() * openCells.length) | 0]; tries++; }
      while (tries < 10 && (tgt[0] - mc) ** 2 + (tgt[1] - mr) ** 2 < 16); // wander somewhere a few cells off
      monsterPath = bfsPath(mc, mr, tgt[0], tgt[1]);
      if (monsterPath.length > 1) monsterPath.shift();
    }

    if (monsterPath.length) {
      const tgt = cellCenter(monsterPath[0][0], monsterPath[0][1]);
      const tdx = tgt.x - monster.position.x, tdz = tgt.z - monster.position.z;
      const td = Math.hypot(tdx, tdz);
      if (td < 0.3) monsterPath.shift();
      else {
        const nmx = monster.position.x + (tdx / td) * mSpeed, nmz = monster.position.z + (tdz / td) * mSpeed;
        if (!crusherSealed(colOf(nmx), rowOf(nmz))) { // can't push through a shut crusher wall
          monster.position.x = nmx; monster.position.z = nmz;
          monster.rotation.y = Math.atan2(tdx, tdz);
        }
      }
    } else if (state.seen) {
      const nmx = monster.position.x + (dxm / (distM || 1)) * mSpeed, nmz = monster.position.z + (dzm / (distM || 1)) * mSpeed;
      if (!crusherSealed(colOf(nmx), rowOf(nmz))) {
        monster.position.x = nmx; monster.position.z = nmz;
        monster.rotation.y = Math.atan2(dxm, dzm);
      }
    }

    // ---- monster animation: articulated walk + violent twitching, lunging ----
    const close = distM < 6 ? (6 - distM) / 6 : 0; // 0..1 how close
    const gait = state.seen ? 12 : 5.5;
    const phase = state.time * gait;
    const stride = state.seen ? 0.85 : 0.45;
    // legs stride; knees bend on the back-swing — opposite phase per leg
    monAnim.legs.forEach((lg, i) => {
      const ph = phase + (i === 0 ? 0 : Math.PI);
      lg.hip.rotation.x = Math.sin(ph) * stride;
      lg.knee.rotation.x = 0.18 + Math.max(0, -Math.cos(ph)) * 0.9; // tuck on lift
    });
    // arms swing opposite the legs and reach out when hunting
    monAnim.arms.forEach((ar, i) => {
      const ph = phase + (i === 0 ? Math.PI : 0);
      ar.shoulder.rotation.x = Math.sin(ph) * stride * 0.9 - close * 1.1; // reaches for you up close
      ar.elbow.rotation.x = -0.5 - close * 0.6 + Math.sin(ph) * 0.2;
    });
    // skittering whole-body jitter that spikes when hunting/close
    const jit = (state.seen ? 0.07 : 0.015) + close * 0.2 + state.lunge * 0.08;
    torso.position.x = (Math.random() - 0.5) * jit;
    torso.position.z = (Math.random() - 0.5) * jit;
    torso.rotation.x = 0.17 + (Math.random() - 0.5) * jit * 0.6;
    torso.rotation.z = (Math.random() - 0.5) * jit * 0.4;
    monster.position.y = Math.abs(Math.sin(phase * 0.5)) * (state.seen ? 0.14 : 0.05);
    // when you're staring at it, it goes still and locks its grin onto you — pure dread
    if (watched) { torso.position.x *= 0.25; torso.position.z *= 0.25; }
    // head snaps toward you; grin & maw distend, eyes flare as it closes in
    head.rotation.z = Math.sin(state.time * (state.seen ? 9 : 3.3)) * (state.seen ? 0.3 : 0.05) + (Math.random() - 0.5) * close * 0.3;
    head.rotation.y = Math.sin(state.time * 2.1) * (state.seen ? 0.18 : 0.06);
    head.rotation.x = -close * 0.55 - watched * 0.15;
    head.scale.setScalar(1 + close * 0.32);
    grin.scale.set(1 + close * 0.7, 1 + close * 1.1, 1);     // smile stretches grotesquely
    maw.scale.set(1.1 * (1 + close * 0.6), 0.7 * (1 + close * 1.0), 0.5);
    // jaw gapes open as it bears down on you; drool stretches and drips
    monAnim.jaw.rotation.x = 0.08 + close * 0.85 + (state.seen ? 0.06 : 0) + Math.abs(Math.sin(state.time * 11)) * close * 0.25;
    for (const dr of monAnim.drool) { dr.scale.y = 0.3 + close * 3.2; dr.position.y = -0.22 - close * 0.4; dr.material.opacity = 0.18 + close * 0.5; }
    const jawOpen = monAnim.jaw.rotation.x;
    monAnim.mawLight.intensity = (state.seen ? 0.7 : 0.2) + close * 3 + jawOpen * 1.6;   // mouth glows from within
    monAnim.tongue.rotation.x = 0.5 + jawOpen * 0.7;
    monAnim.tongue.rotation.z = Math.sin(state.time * (state.seen ? 15 : 5)) * (0.25 + close * 0.6); // lashing
    monAnim.tongue.scale.y = 1 + close * 0.9;
    for (const s of monAnim.sinew) { s.scale.y = 0.3 + jawOpen * 2.4; s.position.y = -0.1 - jawOpen * 0.12; s.material.opacity = 0.18 + close * 0.5; }
    eyeGlow.intensity = (state.seen ? 1.5 : 0.6) + close * 2.2 + (watched ? 0.8 : 0) + Math.random() * close;
    const eflick = Math.random() < 0.07 ? 0.25 : 1; // unsettling eye flicker
    eyeL.scale.y = (1.7 + close * 0.7) * eflick; eyeR.scale.y = (1.7 + close * 0.7) * eflick;
    if (state.monsterBlind > 0) { torso.rotation.x -= 0.55; head.rotation.x -= 0.45; eyeGlow.intensity *= 0.25; } // recoils from the light
    // aura shell wobbles / breathes, swelling when it's near
    aura.scale.set(0.7 + Math.sin(state.time * 2) * 0.06 + close * 0.3, 2.0 + Math.sin(state.time * 1.3) * 0.15, 0.7 + Math.cos(state.time * 1.7) * 0.06 + close * 0.3);
    aura.material.opacity = 0.16 + close * 0.3 + (state.seen ? 0.06 : 0);

    // ---- VHS static spike when it's in view or near ----
    const inView = los && distM < 18 && inFront > 0;
    let staticTarget = inView ? (1 - distM / 18) * 0.8 : 0;
    staticTarget = Math.max(staticTarget, close * 0.9, state.screamShake * 0.7);
    state.staticAmt += (staticTarget - state.staticAmt) * Math.min(1, dt * 6);

    // audio dread scales with proximity + being hunted
    Sound.tick(dt, Math.max(close, state.seen ? 0.4 : 0) + state.screamShake * 0.5);

    // ---- sanity / proximity ----
    if (distM < 10) {
      const fear = (10 - distM) / 10;
      state.sanity = Math.max(0, state.sanity - dt * 0.075 * fear * (state.seen ? 2.2 : 1));
      dmgflash.style.opacity = String(Math.min(0.7, fear * 0.7 + (state.seen ? 0.12 : 0)));
    } else {
      state.sanity = Math.min(1, state.sanity + dt * 0.03); // slowly recovers on its own when it's not near
      dmgflash.style.opacity = "0";
    }

    // caught?
    if (distM < 1.6 && !state.hidden) return die("It caught you.");
    if (state.sanity <= 0) return die("Your mind shattered in the endless yellow.", false);

    // ---- prompts ----
    let nearExit = null, nearD = 99;
    for (const e of exits) {
      if (e.used) continue;
      const dx = e.mesh.position.x - yawObj.position.x;
      const dz = e.mesh.position.z - yawObj.position.z;
      const d = Math.hypot(dx, dz);
      if (d < nearD) { nearD = d; nearExit = e; }
    }
    nearestCloset = null;
    if (!state.hidden) {
      let cbest = 2.2 * 2.2;
      for (const cl of closets) {
        const dx = cl.g.position.x - yawObj.position.x, dz = cl.g.position.z - yawObj.position.z;
        const d = dx * dx + dz * dz;
        if (d < cbest) { cbest = d; nearestCloset = cl; }
      }
    }
    if (state.hidden) showPrompt("Press E to step out");
    else if (nearestItem) showPrompt(nearestItem.type === "food" ? "Press E to pick up 🥫 food" : "Press E to pick up 💧 water");
    else if (nearestCloset) showPrompt(nearestCloset.type === "under" ? "Press E to hide under" : "Press E to hide");
    else if (nearExit && nearD < 2.5) showPrompt("Press E to use this exit");
    else showPrompt("");

    // ---- crushing corridors (may set its own RUN prompt / kill you) ----
    updateCrushers(dt);
    if (!state.alive) return;

    // zone flavor
    zoneEl.textContent = state.seen ? "⚠ BEING HUNTED" : "The Lobby — Level 0";

    // ---- radar trackers: bob/spin, pick up, then point at the monster for 4s ----
    for (const rd of radars) {
      if (rd.taken) continue;
      rd.mesh.rotation.y += dt * 1.6;
      rd.mesh.position.y = 0.14 + Math.sin(state.time * 3 + rd.cell[0]) * 0.05;
      const dx = rd.mesh.position.x - yawObj.position.x;
      const dz = rd.mesh.position.z - yawObj.position.z;
      if (dx * dx + dz * dz < 1.7 * 1.7) {
        rd.taken = true;
        scene.remove(rd.mesh);
        state.radarTimer = 4;
        Sound.blip();
        toast("📡 Tracker found — exit located for 4s!");
      }
    }
    if (state.radarTimer > 0) {
      state.radarTimer -= dt;
      radarEl.classList.remove("hidden");
      // arrow up = exit straight ahead; rotates to point toward it
      const ex = exits.find(e => !e.used) || exits[0];
      if (ex) {
        const dxe = ex.mesh.position.x - yawObj.position.x;
        const dze = ex.mesh.position.z - yawObj.position.z;
        const ang = Math.atan2(forward.x, forward.z) - Math.atan2(dxe, dze);
        radarArrow.style.transform = `rotate(${ang}rad)`;
      }
      radarTimerEl.textContent = Math.max(0, state.radarTimer).toFixed(1) + "s";
      if (state.radarTimer <= 0) radarEl.classList.add("hidden");
    }

    // ---- food/water on the ground: bob, and track the nearest in range for the E prompt ----
    nearestItem = null; let nearItemD = 99;
    for (const it of items) {
      if (it.taken) continue;
      it.mesh.rotation.y += dt * 1.2;
      it.mesh.position.y = it.baseY + Math.sin(state.time * 2.5 + it.cell[0]) * 0.04;
      const dx = it.mesh.position.x - yawObj.position.x;
      const dz = it.mesh.position.z - yawObj.position.z;
      const d = Math.hypot(dx, dz);
      if (d < nearItemD && d < 2.0) { nearItemD = d; nearestItem = it; }
    }

    // ---- hunger & thirst: drain very slowly; starving/parched bleeds sanity ----
    state.hunger = Math.max(0, state.hunger - dt * 0.0011);
    state.thirst = Math.max(0, state.thirst - dt * 0.0014);
    if (state.hunger <= 0 || state.thirst <= 0) {
      state.sanity = Math.max(0, state.sanity - dt * 0.02);
    }

    // ---- weird stuff: glimpses, eyes in the dark, blackouts ----
    updateAnomalies(dt);

    // ---- bars ----
    staminaFill.style.width = (state.stamina * 100) + "%";
    staminaBarFill.style.width = (state.stamina * 100) + "%";
    staminaBarFill.classList.toggle("low", state.stamina < 0.25);
    batteryFill.style.width = (state.battery * 100) + "%";
    sanityFill.style.width = (state.sanity * 100) + "%";
    hungerFill.style.width = (state.hunger * 100) + "%";
    thirstFill.style.width = (state.thirst * 100) + "%";

    // ---- camera: head bob + proximity shake + insanity wobble ----
    const bobY = moving ? Math.sin(state.time * (state.sprinting ? 14 : 9)) * (state.sprinting ? 0.07 : 0.04) : 0;
    // screen shake ramps up hard as the monster closes in (and on each scream)
    state.screamShake = Math.max(0, state.screamShake - dt * 1.3);
    let shake = state.screamShake * 0.14;
    if (distM < 10) shake = Math.max(shake, Math.pow((10 - distM) / 10, 1.6) * (state.seen ? 0.16 : 0.07));
    const insane = 1 - state.sanity;
    const wob = insane * 0.05;
    camera.position.x = (Math.random() - 0.5) * shake + Math.sin(state.time * 1.3) * wob;
    camera.position.y = bobY + (Math.random() - 0.5) * shake;
    camera.position.z = (Math.random() - 0.5) * shake * 0.5;
    camera.rotation.z = (Math.random() - 0.5) * shake * 0.6 + Math.sin(state.time * 0.9) * insane * 0.045;
    // FOV breathes when sanity drops / when it's right on top of you
    const fov = 75 + Math.sin(state.time * 2.4) * insane * 9 + shake * 28;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // full-screen "going insane" distortion via CSS filter — grows as sanity falls
    if (insane > 0.02) {
      const hue = Math.sin(state.time * 0.35) * insane * 130;
      const blur = insane * 1.8;
      const sat = 1 + insane * 1.6;
      const con = 1 + insane * 0.35;
      canvas.style.filter = `hue-rotate(${hue.toFixed(1)}deg) saturate(${sat.toFixed(2)}) contrast(${con.toFixed(2)}) blur(${blur.toFixed(2)}px)`;
    } else if (canvas.style.filter) {
      canvas.style.filter = "";
    }
    // VHS static / interference spike when the entity is seen or near
    grain.style.opacity = (0.05 + state.staticAmt * 0.6).toFixed(3);
    grain.style.transform = `translate(${(Math.random() - 0.5) * state.staticAmt * 14}px, ${(Math.random() - 0.5) * state.staticAmt * 14}px)`;
    // tunnel-vision vignette closes in (and reddens) as it bears down on you
    const vig = Math.max(close, state.screamShake);
    const spread = 80 + vig * 320;
    const tint = vig > 0.01 ? `rgba(${(40 + vig * 90) | 0},0,0,${(0.85 + vig * 0.15).toFixed(2)})` : "rgba(0,0,0,.85)";
    vignette.style.boxShadow = `inset 0 0 ${(220 + vig * 120) | 0}px ${spread | 0}px ${tint}`;
  }

  requestAnimationFrame(loop);
})();
