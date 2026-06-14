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
  const jumpscare = document.getElementById("jumpscare");
  const muteMusicBtn = document.getElementById("mute-music");
  const muteSfxBtn = document.getElementById("mute-sfx");

  // ---------- audio (Web Audio API, fully synthesized — no files) ----------
  const Sound = (function () {
    let ctx, master, musicGain, sfxGain, dreadGain, dreadFilter;
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
      const t = ctx.currentTime, dur = 1.9;
      // noise shriek
      const nb = ctx.createBufferSource(); nb.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3.5;
      bp.frequency.setValueAtTime(1600, t); bp.frequency.exponentialRampToValueAtTime(420, t + dur);
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(1.0, t + 0.06); ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      nb.connect(bp); bp.connect(ng); ng.connect(sfxGain); nb.start(t); nb.stop(t + dur);
      // detuned distorted shrieking voices
      const ws = ctx.createWaveShaper(); ws.curve = distCurve(60);
      const wsg = ctx.createGain(); wsg.gain.value = 0.5; ws.connect(wsg); wsg.connect(sfxGain);
      [0, 0.06, -0.05, 7].forEach((semi) => {
        const o = ctx.createOscillator(); o.type = "sawtooth";
        const base = 520 * Math.pow(2, semi / 12);
        o.frequency.setValueAtTime(base * 1.7, t);
        o.frequency.exponentialRampToValueAtTime(base * 0.55, t + dur);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.07); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(ws); o.start(t); o.stop(t + dur);
      });
      // sub thump
      const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.setValueAtTime(120, t); sub.frequency.exponentialRampToValueAtTime(35, t + 0.8);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.7, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      sub.connect(sg); sg.connect(sfxGain); sub.start(t); sub.stop(t + 1.1);
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
      dreadGain.gain.setTargetAtTime(dread * 0.55, ctx.currentTime, 0.4);
      dreadFilter.frequency.setTargetAtTime(70 + dread * 140, ctx.currentTime, 0.4);
      if (dread > 0.12) {
        hbAcc += dt;
        const interval = 1.15 - dread * 0.8; // faster as it nears
        if (hbAcc >= interval) { hbAcc = 0; heartbeat(); }
      } else hbAcc = 0;
    }

    return {
      init,
      scream, blip,
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

  // ---------- the monster: tall dark spindly figure (from the reference) ----------
  // dark sinew texture — near-black with faint twisted strands, like knotted cables
  function sinewTex() {
    const c = makeCanvas(128), x = c.getContext("2d");
    x.fillStyle = "#070707"; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 34; i++) {
      const g = 22 + Math.random() * 30 | 0;
      x.strokeStyle = `rgba(${g},${g - 2},${g - 4},0.6)`;
      x.lineWidth = Math.random() * 2 + 0.4; x.beginPath();
      let px = Math.random() * 128, py = 0; x.moveTo(px, py);
      for (let s = 0; s < 9; s++) { px += Math.sin(s + i) * 6 + (Math.random() - 0.5) * 6; py += 14; x.lineTo(px, py); }
      x.stroke();
    }
    for (let i = 0; i < 500; i++) { x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  const monster = new THREE.Group();
  const mDark = new THREE.MeshStandardMaterial({ map: sinewTex(), color: 0x141414, roughness: 0.95, metalness: 0.0, emissive: 0x000000 });

  // thin tapered limb segment
  function seg(len, rTop, rBot) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 7), mDark);
    m.castShadow = true; return m;
  }

  // tall & gaunt — feet at 0, head just under the 4.0 ceiling
  const hipY = 1.9, TORSO = 1.3;

  // torso — two thin intertwined strands, slightly hunched
  const torso = new THREE.Group();
  torso.position.set(0, hipY, 0);
  torso.rotation.x = 0.12;
  const t1 = seg(TORSO, 0.1, 0.15); t1.position.set(0.04, TORSO / 2, 0); t1.rotation.z = 0.13;
  const t2 = seg(TORSO, 0.09, 0.13); t2.position.set(-0.04, TORSO / 2, 0); t2.rotation.z = -0.15;
  torso.add(t1, t2);
  monster.add(torso);

  // thin neck
  const neck = seg(0.32, 0.05, 0.07);
  neck.position.set(0, TORSO + 0.14, 0.03);
  torso.add(neck);

  // ----- head: round black head with a glowing white smile (the Smiler) -----
  const head = new THREE.Group();
  head.position.set(0, TORSO + 0.36, 0.03);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.29, 18, 18), mDark);
  skull.castShadow = true; head.add(skull);
  // glowing white face — unlit so it glows in the dark like the reference
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 12), faceMat); eyeL.position.set(-0.105, 0.075, 0.25); eyeL.scale.set(1, 1.15, 1);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 12), faceMat); eyeR.position.set(0.105, 0.075, 0.25); eyeR.scale.set(1, 1.15, 1);
  head.add(eyeL, eyeR);
  // wide curved grin
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.03, 8, 24, Math.PI), faceMat);
  smile.position.set(0, -0.03, 0.245);
  smile.rotation.z = Math.PI; // arc opens upward → a smile
  head.add(smile);
  const eyeGlow = new THREE.PointLight(0xffffff, 0.5, 4.5, 2); eyeGlow.position.set(0, 0, 0.32); head.add(eyeGlow);
  // empty jaw group kept so the animation code stays valid (no visible jaw on the Smiler)
  const jaw = new THREE.Group(); head.add(jaw);
  torso.add(head);

  // ----- arms: very long, thin, twisted, hanging (armL/armR pivots swing in update) -----
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, TORSO - 0.02, 0);
    const upper = seg(1.1, 0.06, 0.045);
    upper.position.set(side * 0.06, -0.55, 0.02); upper.rotation.z = side * 0.18;
    pivot.add(upper);
    const fore = seg(1.15, 0.045, 0.028);
    fore.position.set(side * 0.16, -1.55, 0.16); fore.rotation.x = -0.45; fore.rotation.z = side * 0.24;
    pivot.add(fore);
    // a few long thin fingers
    const hand = new THREE.Group();
    hand.position.set(side * 0.3, -2.05, 0.42);
    for (let f = 0; f < 3; f++) {
      const fg = seg(0.32, 0.02, 0.008);
      fg.position.set(side * (f - 1) * 0.04, -0.14, 0.02);
      fg.rotation.x = 0.3 + f * 0.1;
      hand.add(fg);
    }
    pivot.add(hand);
    torso.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ----- legs: very long & thin -----
  function makeLeg(side) {
    const g = new THREE.Group();
    g.position.set(side * 0.1, hipY, 0);
    const thigh = seg(0.95, 0.08, 0.05);
    thigh.position.set(side * 0.03, -0.47, 0.02); thigh.rotation.z = side * 0.08;
    g.add(thigh);
    const shin = seg(0.98, 0.05, 0.032);
    shin.position.set(side * 0.08, -1.43, -0.03); shin.rotation.x = 0.16;
    g.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.26), mDark);
    foot.position.set(side * 0.12, -1.9, 0.08); g.add(foot);
    monster.add(g);
  }
  makeLeg(-1);
  makeLeg(1);

  scene.add(monster);

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
    keys: {},
  };
  const items = []; // lootable food/water {mesh, type, cell, taken}
  const phantoms = []; // illusory walls that appear behind you {mesh, mat, cell, life}
  let lastPlayerCell = -1, phantomCd = 0;

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
    state.keys[e.code] = true;
    if (e.code === "KeyF") toggleFlash();
    if (e.code === "KeyE") tryExit();
    if (e.code === "KeyM") toggleMusic();
    if (e.code === "KeyN") toggleSfx();
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
    state.hunger = 1; state.thirst = 1; state.lunge = 0; state.staticAmt = 0;
    lastPlayerCell = -1; phantomCd = 6;
    screamWarn.classList.add("hidden");
    jumpscare.classList.add("hidden");
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
    buildAnomalies();
    buildTents();
    buildCorpses();
  }

  // blood splatter texture for corpse pools
  function bloodTex() {
    const c = makeCanvas(128), x = c.getContext("2d");
    x.clearRect(0, 0, 128, 128);
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
    g.addColorStop(0, "rgba(110,4,4,0.92)");
    g.addColorStop(0.6, "rgba(80,0,0,0.6)");
    g.addColorStop(1, "rgba(60,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      const a = 0.3 + Math.random() * 0.55;
      x.fillStyle = `rgba(${80 + Math.random() * 70 | 0},0,0,${a})`;
      x.beginPath();
      x.arc(64 + (Math.random() - 0.5) * 100, 64 + (Math.random() - 0.5) * 100, Math.random() * 13 + 1.5, 0, 7);
      x.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // dead hazmat figures slumped in pools of blood
  const corpseSuit = new THREE.MeshStandardMaterial({ color: 0xb9b39a, roughness: 0.92 });
  const corpseMask = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4, metalness: 0.3 });
  const corpseLens = new THREE.MeshStandardMaterial({ color: 0x222018, roughness: 0.2, metalness: 0.5, emissive: 0x0a0a06 });
  function buildCorpses() {
    const cells = openCells
      .filter(([c, r]) => (c - 1) * (c - 1) + (r - 1) * (r - 1) > 12)
      .sort(() => Math.random() - 0.5).slice(0, 12);
    for (const [c, r] of cells) {
      const p = cellCenter(c, r);
      const g = new THREE.Group();
      g.position.set(p.x + (Math.random() - 0.5) * 2.2, 0, p.z + (Math.random() - 0.5) * 2.2);
      g.rotation.y = Math.random() * Math.PI * 2;
      g.userData.proc = true;
      // blood pool
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(1.0 + Math.random() * 0.6, 22),
        new THREE.MeshBasicMaterial({ map: bloodTex(), transparent: true, opacity: 0.92, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.y = 0.015; g.add(pool);
      // torso lying along +z
      const torsoC = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.95, 10), corpseSuit);
      torsoC.rotation.x = Math.PI / 2; torsoC.position.set(0, 0.2, 0); torsoC.castShadow = true; g.add(torsoC);
      // hood + head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), corpseSuit);
      head.position.set(0, 0.2, 0.62); head.castShadow = true; g.add(head);
      const mask = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), corpseMask);
      mask.scale.set(1, 0.9, 0.7); mask.position.set(0, 0.18, 0.74); g.add(mask);
      const lensL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), corpseLens); lensL.position.set(-0.06, 0.2, 0.82); g.add(lensL);
      const lensR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), corpseLens); lensR.position.set(0.06, 0.2, 0.82); g.add(lensR);
      // splayed limbs
      const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.7, 7);
      const aL = new THREE.Mesh(armGeo, corpseSuit); aL.rotation.z = Math.PI / 2; aL.rotation.y = 0.6; aL.position.set(-0.32, 0.16, 0.2); g.add(aL);
      const aR = new THREE.Mesh(armGeo, corpseSuit); aR.rotation.z = Math.PI / 2; aR.rotation.y = -0.4; aR.position.set(0.34, 0.16, 0.05); g.add(aR);
      const legGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.8, 7);
      const lL = new THREE.Mesh(legGeo, corpseSuit); lL.rotation.x = Math.PI / 2; lL.rotation.z = 0.18; lL.position.set(-0.12, 0.16, -0.7); g.add(lL);
      const lR = new THREE.Mesh(legGeo, corpseSuit); lR.rotation.x = Math.PI / 2; lR.rotation.z = -0.22; lR.position.set(0.13, 0.16, -0.72); g.add(lR);
      scene.add(g);
      // some corpses have scavengeable supplies beside them
      if (Math.random() < 0.7) {
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
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.9, side: THREE.DoubleSide });
  function buildTents() {
    const cells = openCells
      .filter(([c, r]) => (c - 1) * (c - 1) + (r - 1) * (r - 1) > 16)
      .sort(() => Math.random() - 0.5).slice(0, 3);
    for (const [c, r] of cells) {
      const p = cellCenter(c, r);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = Math.random() * Math.PI;
      g.userData.proc = true;
      // A-frame tent: two sloped panels + triangular ends
      const w = 1.7, h = 1.1, dlen = 2.0;
      const left = new THREE.Mesh(new THREE.PlaneGeometry(dlen, Math.hypot(w / 2, h)), tentMat);
      left.position.set(-w / 4, h / 2, 0); left.rotation.z = -Math.atan2(w / 2, h); left.rotation.y = Math.PI / 2; g.add(left);
      const right = new THREE.Mesh(new THREE.PlaneGeometry(dlen, Math.hypot(w / 2, h)), tentMat);
      right.position.set(w / 4, h / 2, 0); right.rotation.z = Math.atan2(w / 2, h); right.rotation.y = Math.PI / 2; g.add(right);
      scene.add(g);
      // loot inside / beside the tent (guaranteed)
      spawnItem(p.x + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8, [c, r], "food");
      spawnItem(p.x + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8, [c, r], "water");
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

  // trippy anomaly cells — wrong-colored breathing haze that warps the senses
  function buildAnomalies() {
    const palette = [0xff1f8f, 0x12f5c8, 0x8a2be2, 0x39ff14, 0xff4040, 0x2f7bff];
    const cells = openCells.slice().sort(() => Math.random() - 0.5).slice(0, 6);
    let ci = 0;
    for (const [c, r] of cells) {
      const p = cellCenter(c, r);
      const color = palette[ci % palette.length]; ci++;
      const haze = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 0.98, WALL_H * 0.96, CELL * 0.98),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.BackSide, depthWrite: false })
      );
      haze.position.set(p.x, WALL_H / 2, p.z);
      haze.userData.proc = true;
      scene.add(haze);
      const wl = new THREE.PointLight(color, 0.5, CELL * 2.6, 2);
      wl.position.set(p.x, WALL_H * 0.6, p.z);
      wl.userData.proc = true;
      scene.add(wl);
      warps.push({ haze, wl, t: (ci * 1.7) % 6, base: 0.5 });
    }
  }

  function die(reason) {
    if (!state.alive) return;
    state.alive = false;
    radarEl.classList.add("hidden");
    screamWarn.classList.add("hidden");
    canvas.style.filter = "";
    grain.style.opacity = "0.05";
    document.exitPointerLock();
    Sound.scream();
    // jumpscare: the grinning face lunges at the screen, then the death card
    jumpscare.classList.remove("hidden");
    document.getElementById("end-icon").textContent = "💀";
    document.getElementById("end-title").textContent = "CAUGHT";
    document.getElementById("end-text").textContent =
      reason + ` You wandered the yellow rooms for ${fmtTime(state.time)} before it took you.`;
    setTimeout(() => {
      jumpscare.classList.add("hidden");
      endscreen.classList.remove("hidden");
    }, 1000);
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

    if (state.started && state.alive) {
      update(dt);
    }
    // flicker always (atmosphere)
    flickerUpdate(dt);

    renderer.render(scene, camera);
  }

  function flickerUpdate(dt) {
    for (const f of flickers) {
      f.t += dt;
      let v;
      if (f.broken) {
        v = (Math.sin(f.t * 23) > 0.7 && Math.random() > 0.3) ? f.base : f.base * 0.05;
      } else {
        v = f.base * (0.85 + 0.15 * Math.sin(f.t * 7 + Math.sin(f.t * 13)));
        if (Math.random() < 0.004) v = f.base * 0.2; // rare blink
      }
      if (f.panel) f.panel.material.emissiveIntensity = v;
      if (f.light) f.light.intensity = v;
    }
    // breathing trippy anomaly cells
    for (const w of warps) {
      w.t += dt;
      const s = 0.5 + 0.5 * Math.sin(w.t * 1.4);
      w.haze.material.opacity = 0.05 + 0.13 * s;
      w.haze.scale.set(0.88 + 0.12 * Math.sin(w.t * 2.1), 1, 0.88 + 0.12 * Math.cos(w.t * 1.7));
      w.haze.rotation.y += dt * 0.25;
      w.wl.intensity = w.base * (0.35 + 0.65 * s);
    }
  }

  function update(dt) {
    state.time += dt;
    clockEl.textContent = fmtTime(state.time);

    // ---- movement ----
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    let mx = 0, mz = 0;
    if (state.keys["KeyW"]) { mx += forward.x; mz += forward.z; }
    if (state.keys["KeyS"]) { mx -= forward.x; mz -= forward.z; }
    if (state.keys["KeyD"]) { mx += right.x; mz += right.z; }
    if (state.keys["KeyA"]) { mx -= right.x; mz -= right.z; }
    const moving = mx !== 0 || mz !== 0;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;

    state.sprinting = state.keys["ShiftLeft"] && moving && state.stamina > 0.02;
    const speed = (state.sprinting ? 7.2 : 3.4) * dt;
    if (state.sprinting) state.stamina = Math.max(0, state.stamina - dt * 0.32);
    else state.stamina = Math.min(1, state.stamina + dt * 0.18);

    const px = yawObj.position.x, pz = yawObj.position.z;
    const nx = px + mx * speed, nz = pz + mz * speed;
    if (!blocked(nx, pz)) yawObj.position.x = nx;
    if (!blocked(yawObj.position.x, nz)) yawObj.position.z = nz;

    // ---- the entity screams every 30s and pinpoints you ----
    state.screamTimer += dt;
    if (state.screamTimer >= 30) {
      state.screamTimer = 0;
      state.seen = true; state.seenTimer = 7;   // it locks on and hunts
      pathTimer = 0;                              // recompute path toward you now
      state.warnTimer = 2;
      state.screamShake = 1.0;
      state.lunge = 1.6;        // it bursts toward you on the scream
      dmgflash.style.opacity = "0.55";
      screamWarn.classList.remove("hidden");
      Sound.scream();
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

    // detection: long sight line, and it can SENSE you when you're close even without sight
    const baseRange = 24;
    const flashBonus = state.flashOn ? 10 : 0;
    const los = hasLOS(monster.position.x, monster.position.z, yawObj.position.x, yawObj.position.z);
    const detected = (los && distM < baseRange + flashBonus) || distM < 7.5;
    if (detected) {
      if (!state.seen) state.lunge = Math.max(state.lunge, 0.8); // pounces the instant it spots you
      state.seen = true; state.seenTimer = 6;
    } else if (state.seenTimer > 0) {
      state.seenTimer -= dt; if (state.seenTimer <= 0) state.seen = false;
    }

    dangerbar.classList.toggle("hidden", !state.seen);

    // it accelerates the longer it chases; bursts on lunge
    const chaseSpeed = 5.0 + state.lunge * 4.0;
    const mSpeed = (state.seen ? chaseSpeed : 2.1) * dt;

    // recompute path frequently when hunting
    pathTimer -= dt;
    if (pathTimer <= 0) {
      pathTimer = state.seen ? 0.25 : 0.4;
      const mc = colOf(monster.position.x), mr = rowOf(monster.position.z);
      let tc, tr;
      if (state.seen) { tc = colOf(yawObj.position.x); tr = rowOf(yawObj.position.z); }
      else { const tgt = openCells[(Math.random() * openCells.length) | 0]; tc = tgt[0]; tr = tgt[1]; }
      monsterPath = bfsPath(mc, mr, tc, tr);
      if (monsterPath.length > 1) monsterPath.shift();
    }

    if (monsterPath.length) {
      const tgt = cellCenter(monsterPath[0][0], monsterPath[0][1]);
      const tdx = tgt.x - monster.position.x, tdz = tgt.z - monster.position.z;
      const td = Math.hypot(tdx, tdz);
      if (td < 0.3) monsterPath.shift();
      else {
        monster.position.x += (tdx / td) * mSpeed;
        monster.position.z += (tdz / td) * mSpeed;
        monster.rotation.y = Math.atan2(tdx, tdz);
      }
    } else if (state.seen) {
      monster.position.x += (dxm / (distM || 1)) * mSpeed;
      monster.position.z += (dzm / (distM || 1)) * mSpeed;
      monster.rotation.y = Math.atan2(dxm, dzm);
    }

    // ---- monster animation: violent, jittering, lunging ----
    const close = distM < 6 ? (6 - distM) / 6 : 0; // 0..1 how close
    const gait = state.seen ? 13 : 6;
    const sw = Math.sin(state.time * gait) * (state.seen ? 0.9 : 0.4);
    armL.rotation.x = sw; armR.rotation.x = -sw;
    // skittering body jitter that spikes when it's hunting/close
    const jit = (state.seen ? 0.05 : 0.012) + close * 0.12 + state.lunge * 0.06;
    torso.position.x = (Math.random() - 0.5) * jit;
    torso.position.z = (Math.random() - 0.5) * jit;
    torso.rotation.x = 0.12 + (Math.random() - 0.5) * jit * 0.5;
    monster.position.y = Math.abs(Math.sin(state.time * gait * 0.5)) * (state.seen ? 0.16 : 0.06);
    // head snaps toward you and the grin widens as it closes in
    head.rotation.z = Math.sin(state.time * (state.seen ? 9 : 3.3)) * (state.seen ? 0.3 : 0.05) + (Math.random() - 0.5) * close * 0.25;
    head.rotation.x = -close * 0.5; // tips face up at you when right on top of you
    head.scale.setScalar(1 + close * 0.35);
    eyeGlow.intensity = (state.seen ? 1.3 : 0.5) + close * 1.5 + Math.random() * close;

    // ---- VHS static spike when it's in view or near ----
    const inFront = (dxm * forward.x + dzm * forward.z) / (distM || 1);
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
      state.sanity = Math.min(1, state.sanity + dt * 0.02);
      dmgflash.style.opacity = "0";
    }

    // caught?
    if (distM < 1.6) return die("It caught you.");
    if (state.sanity <= 0) return die("Your mind shattered in the endless yellow.");

    // ---- prompts ----
    let nearExit = null, nearD = 99;
    for (const e of exits) {
      if (e.used) continue;
      const dx = e.mesh.position.x - yawObj.position.x;
      const dz = e.mesh.position.z - yawObj.position.z;
      const d = Math.hypot(dx, dz);
      if (d < nearD) { nearD = d; nearExit = e; }
    }
    if (nearExit && nearD < 2.5) showPrompt("Press E to use this exit");
    else showPrompt("");

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

    // ---- food/water pickups (around corpses, in tents) ----
    for (const it of items) {
      if (it.taken) continue;
      it.mesh.rotation.y += dt * 1.2;
      it.mesh.position.y = it.baseY + Math.sin(state.time * 2.5 + it.cell[0]) * 0.04;
      const dx = it.mesh.position.x - yawObj.position.x;
      const dz = it.mesh.position.z - yawObj.position.z;
      if (dx * dx + dz * dz < 1.6 * 1.6) {
        it.taken = true;
        scene.remove(it.mesh);
        Sound.blip();
        if (it.type === "food") { state.hunger = Math.min(1, state.hunger + 0.4); toast("🥫 Ate condensed food (+hunger)"); }
        else { state.thirst = Math.min(1, state.thirst + 0.45); toast("💧 Drank water (+thirst)"); }
      }
    }

    // ---- hunger & thirst: drain very slowly; starving/parched bleeds sanity ----
    state.hunger = Math.max(0, state.hunger - dt * 0.0011);
    state.thirst = Math.max(0, state.thirst - dt * 0.0014);
    if (state.hunger <= 0 || state.thirst <= 0) {
      state.sanity = Math.max(0, state.sanity - dt * 0.02);
    }

    // ---- bars ----
    staminaFill.style.width = (state.stamina * 100) + "%";
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
  }

  requestAnimationFrame(loop);
})();
