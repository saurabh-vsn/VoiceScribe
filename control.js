'use strict';

/* ── APP CORE ──────────────────────────────── */
const cvs = document.getElementById('cvs');
const ctx = cvs.getContext('2d');
const $ = id => document.getElementById(id);
const notify = msg => {
  if (window.Shared && Shared.ui && Shared.ui.notify) Shared.ui.notify(msg);
  else alert(msg);
};

const App = {
  state: {
    connected: false, demoMode: false, listening: false, penIsDown: false,
    devModeOn: false, busy: false, penMode: 'pwm',
    lastSendTime: 0, lastOkTime: Date.now(),
    paused: false, lastJob: null, sweeping: false,
    serialPort: null, wrStream: null, rxBuf: '',
    animTimer: null, trails: [], recog: null,
    charsInBuf: 0, sentLinesLen: [], 
    flushing: false, sentQueue: [],
    jobTotalCmds: 0, jobAckedCmds: 0,
    curX: 5, curY: null,
    speechQueue: [], generating: false, 
    lastInterim: '', interimTimer: null,
    audioCtx: null, analyser: null, audioStream: null,
    voiceLang: 'en-IN', voiceIdx: new Set(), lastRestart: 0,
    watchdogTimer: null, lastActivity: Date.now()
  },
  config: {
    srvUp: 128, srvDn: 227, zUp: 5, zDn: 0,
    dwellUp: 250, dwellDn: 250, feedRate: 1000,
    servoHold: false, pathSort: true, minCmdDelay: 50,
    maxX: 200, maxY: 150,
    invertY: false
  },
  queue: [], linesSent: 0, chars: 0, sessStart: Date.now(),
  
  save() { localStorage.setItem('vs-cfg', JSON.stringify(this.config)); },
  load() {
    try {
      const c = localStorage.getItem('vs-cfg');
      if (c) Object.assign(this.config, JSON.parse(c));
    } catch(e) {}
    setTimeout(() => this.syncUI(), 100); // Wait for DOM if needed
  },
  syncUI() {
    if ($('sUpSlider')) $('sUpSlider').value = this.config.srvUp;
    if ($('sUpVal')) $('sUpVal').textContent = this.config.srvUp;
    if ($('sDnSlider')) $('sDnSlider').value = this.config.srvDn;
    if ($('sDnVal')) $('sDnVal').textContent = this.config.srvDn;
    if ($('dwellUpIn')) $('dwellUpIn').value = this.config.dwellUp;
    if ($('ptDwellUp')) $('ptDwellUp').textContent = this.config.dwellUp + ' ms';
    if ($('dwellDnIn')) $('dwellDnIn').value = this.config.dwellDn;
    if ($('ptDwellDn')) $('ptDwellDn').textContent = this.config.dwellDn + ' ms';
    if ($('feedRateSlider')) $('feedRateSlider').value = this.config.feedRate;
    if ($('speedDisp')) $('speedDisp').textContent = this.config.feedRate + ' mm/min';
    if ($('holdCheck')) $('holdCheck').checked = this.config.servoHold;
    if ($('ptHold')) $('ptHold').textContent = this.config.servoHold ? 'ON' : 'OFF';
    if ($('invertYCheck')) $('invertYCheck').checked = this.config.invertY;
    if ($('maxXIn')) $('maxXIn').value = this.config.maxX;
    if ($('maxYIn')) $('maxYIn').value = this.config.maxY;
    if ($('langSel')) $('langSel').value = this.state.voiceLang;
  },
  setVoiceLang(l) { this.state.voiceLang = l; if(this.state.recog) this.state.recog.lang = l; this.notify('Language: ' + l); },
  log(msg, type) { sysLog(msg, type); },
  notify: (m) => notify(m),
  
  // Removed flawed resume() which was restarting the job
  // UI Mappings
  toggleMic: () => toggleMic(),
  toggleDev: () => toggleDev(),
  toggleTheme: () => toggleTheme(),
  devTab: (n, b) => devTab(n, b),
  doConnect: () => doConnect(),
  doHome: () => doHome(),
  doClear: () => doClear(),
  doJog: (a, d) => doJog(a, d),
  doWrite: (t) => doWrite(t),
  doTypeWrite: () => doTypeWrite(),
  eStop: () => eStop(),
  enq: (c) => enq(c),
  setPen: (d) => setPen(d),
  setPenMode: (m) => { App.state.penMode = m; App.save(); },
  onSrvUp: (v) => onSrvUp(v),
  onSrvDn: (v) => onSrvDn(v),
  testServo: (d) => testServo(d),
  servoSweep: () => servoSweep(),
  fetchGrblSettings: () => fetchGrblSettings(),
  fixServoConfig: () => fixServoConfig(),
  togglePause: () => togglePause(),
};
window.App = App;
App.load();

/* ── DEV MODE ────────────────────────────── */
function toggleDev() {
  App.state.devModeOn = !App.state.devModeOn;
  $('devSec').classList.toggle('show', App.state.devModeOn);
  $('devPill').classList.toggle('on', App.state.devModeOn);
  $('devLbl').textContent = App.state.devModeOn ? 'Dev Active' : 'Dev Mode';
}
function devTab(paneId, btn) {
  document.querySelectorAll('.dev-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dev-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  $('pane-' + paneId).classList.add('active');
}

/* ── SERIAL COMMUNICATION ────────────────── */
async function doConnect() {
  const baud = parseInt($('baudSel').value || 115200);
  $('ptBaud').textContent = baud;

  if (App.state.connected && !App.state.demoMode) {
    App.state.connected = false; 
    try {
      if (App.state.wrStream) { App.state.wrStream.releaseLock(); App.state.wrStream = null; }
      if (App.state.serialPort) { await App.state.serialPort.close(); App.state.serialPort = null; }
    } catch (_) { }
    App.queue = []; App.state.busy = false; App.state.rxBuf = '';
    setBtn('conn-btn', '🔌', 'Connect Arduino (USB)');
    setDot('dConn', 'lConn', false, 'Disconnected');
    setDot('dGrbl', 'lGrbl', false, 'GRBL —');
    setBadge('', 'GRBL response yahan dikhega…');
    sysLog('Disconnected', 'warn');
    return;
  }

  if (!('serial' in navigator)) {
    console.error('Web Serial API not supported or blocked by policy.');
    setBadge('err', '❌ Browser API Blocked (Use Chrome/Edge on HTTPS)');
    notify('❌ Browser fallback: Serial API not found');
    enterDemoMode();
    return;
  }

  try {
    setBadge('wait', 'Port select karo…');
    setBtn('conn-btn wait', '⏳', 'Connecting...');
    App.state.serialPort = await navigator.serial.requestPort();
    await App.state.serialPort.open({
      baudRate: baud, dataBits: 8, stopBits: 1,
      parity: 'none', flowControl: 'none'
    });
    try { await App.state.serialPort.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch(_) {}

    App.state.wrStream = App.state.serialPort.writable.getWriter();
    App.state.connected = true; App.state.demoMode = false;
    
    setBtn('conn-btn on', '✓', 'Connected — Arduino');
    setDot('dConn', 'lConn', true, 'Connected', 'on');
    setBadge('wait', 'Port open — GRBL awaited…');
    sysLog('Port opened @ ' + baud + ' baud', 'ok');
    notify('USB connected! Wake sequence…');

    startReader();

    // WAKE UP GRBL (Enhanced Sequence for GitHub Pages/HTTPS)
    sysLog('Waking up machine...', 'wait');
    await delay(500);
    await rawWrite('\r\n');
    await delay(200);
    await rawWrite('$X\n'); // Kill alarm if present
    await delay(200);
    await rawWrite('$$\n'); // Fetch settings to confirm connection
    await rawWrite('\r\n');

    // INIT SEQUENCE (Classic logic from reference)
    await delay(1800);
    enq('G21'); // mm
    enq('G90'); // absolute
    enq(`M3 S${App.config.srvUp}`);
    enq(`G4 P${(App.config.dwellUp / 1000).toFixed(2)}`);
    if (!App.config.servoHold) enq('M5');
    sysLog('Machine Ready', 'ok');

  } catch (err) {
    App.state.serialPort = null; App.state.wrStream = null;
    App.state.connected = false;
    if (err.name === 'NotFoundError') {
      setBadge('', 'GRBL response yahan dikhega…');
      notify('Port select nahi kiya');
      setBtn('conn-btn', '🔌', 'Connect Arduino (USB)');
      return;
    }
    sysLog('Connect failed: ' + err.message, 'err');
    setBtn('conn-btn demo', '⚠', 'Retry Connection');
    setBadge('err', '❌ ' + err.message);
  }
}

function enterDemoMode() {
  App.state.connected = true; App.state.demoMode = true;
  setBtn('conn-btn demo', '⚠', 'Demo Mode (no hardware)');
  setDot('dConn', 'lConn', true, 'Demo Mode', 'warn');
  setDot('dGrbl', 'lGrbl', true, 'GRBL sim', 'warn');
  sysLog('Running in DEMO MODE', 'warn');
  notify('⚠ Demo mode');
}

async function startReader() {
  if (!App.state.serialPort || !App.state.serialPort.readable) return;
  try {
    const reader = App.state.serialPort.readable.getReader();
    const decoder = new TextDecoder();
    while (App.state.connected) {
      const { value, done } = await reader.read();
      if (done) { reader.releaseLock(); break; }
      App.state.rxBuf += decoder.decode(value, { stream: true });
      const parts = App.state.rxBuf.split('\n');
      App.state.rxBuf = parts.pop();
      for (const raw of parts) {
        const line = raw.replace(/\r/g, '').trim();
        if (line) handleGrblLine(line);
      }
    }
  } catch (e) {
    if (App.state.connected) sysLog('Read stopped: ' + e.message, 'warn');
  }
}

function handleGrblLine(line) {
  if (!line) return;
  const cls = line.startsWith('ok') ? 'gc-ok' : line.startsWith('error') ? 'gc-err' : 'gc-rx';
  gcLog('← ' + line, cls);
  sysLog('GRBL: ' + line, line.startsWith('error') ? 'err' : 'ok');

  if (line.toLowerCase().startsWith('grbl')) {
    setBadge('ok', '✓ ' + line);
    setDot('dGrbl', 'lGrbl', true, 'GRBL ready', 'on');
    notify('✓ ' + line);
  }
  
  if (line.startsWith('ok') || line.startsWith('error')) {
    if ($('grblBadge') && $('grblBadge').textContent.includes('awaited')) {
      setBadge('ok', '✓ Connected & Active');
    }
    App.state.lastOkTime = Date.now();
    App.state.lastActivity = Date.now(); // Reset watchdog on activity
    
    if (App.state.sentLinesLen.length > 0) {
      const len = App.state.sentLinesLen.shift();
      App.state.charsInBuf = Math.max(0, App.state.charsInBuf - len);
    } else { App.state.charsInBuf = 0; }
    
    const acked = App.state.sentQueue.shift();
    if (acked) {
       if (acked.tIdx >= 0) renderCanvas(acked.tIdx);
       if (acked.dispChar && $('ceTitle')) $('ceTitle').textContent += acked.dispChar.toUpperCase();
    }
    if (App.state.jobTotalCmds > 0) {
       App.state.jobAckedCmds++;
       let p = Math.round((App.state.jobAckedCmds / App.state.jobTotalCmds) * 100);
       setProgress(Math.min(100, p));
       if (p >= 100) App.state.jobTotalCmds = 0;
    }

    App.state.busy = (App.queue.length > 0 || App.state.charsInBuf > 0);
    flushQueue();
  }
  
  if (line.startsWith('ALARM')) {
    setBadge('err', '⚠ ALARM: ' + line);
    notify('⚠ ALARM — Home press karo');
  }
  
  if (line.startsWith('<')) {
    const parts = line.slice(1, -1).split('|');
    const state = parts[0];
    setBadge(state.toLowerCase(), state);
    setDot('dGrbl', 'lGrbl', true, state, state==='Run'?'live':'on');
    
    // Auto-unlock busy if machine is Idle but we think it's Busy
    if (state === 'Idle' && App.state.busy && App.queue.length === 0) {
      App.state.busy = false; flushQueue();
    }
  } else if (line.startsWith('[')) {
    $('grblBadge').textContent = line;
  }
}

/* ── COMMAND QUEUE ────────────────────────── */
function enq(cmd, dispChar = null) {
  if (!cmd) return;
  App.queue.push({ cmd: cmd, tIdx: App.state.trails.length - 1, dispChar: dispChar });
  if (!App.state.busy) flushQueue();
}

async function flushQueue() {
  if (App.queue.length === 0 || App.state.paused) return;
  
  while (App.queue.length > 0 && !App.state.paused) {
    const item = App.queue[0];
    const cmdLen = item.cmd.length + 1; // +1 for '\n'
    
    // Wait for 'ok' to free up buffer space (max 127 bytes)
    if (App.state.charsInBuf + cmdLen > 127) {
      break; 
    }
    
    App.queue.shift(); // Remove from queue
    App.state.sentQueue.push(item);
    App.state.charsInBuf += cmdLen;
    App.state.sentLinesLen.push(cmdLen);
    
    App.state.lastSendTime = Date.now();
    
    gcLog('→ ' + item.cmd, 'gc-tx');
    App.linesSent++; 
    $('ptLines').textContent = App.linesSent;
    App.state.busy = true;

    if (App.state.demoMode) {
      setTimeout(() => handleGrblLine('ok'), 20);
    } else {
      rawWrite(item.cmd + '\n').catch(e => {
         sysLog('Write err: ' + e.message, 'err');
         App.state.charsInBuf = Math.max(0, App.state.charsInBuf - cmdLen);
         App.state.sentLinesLen.pop();
         App.state.sentQueue.pop();
      });
    }
  }
}

async function rawWrite(str) {
  if (!App.state.wrStream) return;
  try { await App.state.wrStream.write(new TextEncoder().encode(str)); }
  catch (e) { sysLog('rawWrite err: ' + e.message, 'err'); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

/* ── PEN HELPERS ─────────────────────────── */
function setPen(down) {
  App.state.penIsDown = down;
  $('coPen').textContent = down ? '▼ DOWN' : '▲ UP';
  setDot('dPen', 'lPen', true, down ? 'Pen down' : 'Pen up', down ? 'live' : 'on');
  down ? penDownSeq() : penUpSeq();
  sysLog('Pen: ' + (down ? 'DOWN' : 'UP'), 'ok');
}
function penUpSeq() {
  if (App.state.penMode === 'pwm') {
    enq(`M3 S${App.config.srvUp}`);
    enq(`G4 P${(App.config.dwellUp / 1000).toFixed(3)}`);
    if (!App.config.servoHold) enq('M5');
  } else {
    enq(`G0 Z${App.config.zUp} F2500`);
    enq(`G4 P${(App.config.dwellUp / 1000).toFixed(3)}`);
  }
}
function penDownSeq() {
  if (App.state.penMode === 'pwm') {
    enq(`M3 S${App.config.srvDn}`);
    enq(`G4 P${(App.config.dwellDn / 1000).toFixed(3)}`);
  } else {
    enq(`G1 Z${App.config.zDn} F${App.config.feedRate}`);
    enq(`G4 P${(App.config.dwellDn / 1000).toFixed(3)}`);
  }
}

/* ── VOICE (Web Speech API) ────────────────── */
function toggleMic() {
  App.state.listening ? stopMic() : startMic();
}
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { notify('Chrome ya Edge use karo'); return; }
  App.state.recog = new SR();
  App.state.recog.lang = App.state.voiceLang;
  App.state.recog.continuous = true;
  App.state.recog.interimResults = true;
  
  startVolumeMeter();

  App.state.recog.onstart = () => { 
    App.state.listening = true; 
    App.state.voiceIdx.clear();
    App.state.lastJob = ''; // Clear lastJob to allow repeating the same command
    setMicUI(true); 
    sysLog('Mic ON', 'ok'); 
  };
  App.state.recog.onresult = e => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        if (!App.state.voiceIdx.has(i)) {
          App.state.voiceIdx.add(i);
          final += res[0].transcript;
        }
      } else {
        interim += res[0].transcript;
      }
    }

    if (final.trim()) {
      handleVoice(final.trim());
    }

    const elInt = $('tInterim');
    if (elInt) {
      if (interim) {
         elInt.style.display = 'block'; 
         elInt.innerHTML = `<span style="color:var(--blue);font-size:13px;font-style:italic;">🗣️ Listening: ${interim}...</span>`; 
         
         if (App.state.interimTimer) clearTimeout(App.state.interimTimer);
         App.state.interimTimer = setTimeout(() => {
           if (interim && interim === App.state.lastInterim && App.state.listening) {
             // Smart Resume: Process stable interim as final to prevent data loss
             handleVoice(interim); 
             if (elInt) elInt.style.display = 'none';
             App.state.lastInterim = ''; // Reset to prevent double processing
           }
         }, 1000); // 1s stability window
         App.state.lastInterim = interim;
      } else {
         elInt.style.display = 'none';
         if (App.state.interimTimer) clearTimeout(App.state.interimTimer);
      }
    }
    $('tPh').style.display = 'none';
  };
  App.state.recog.onerror = e => {
    sysLog('Mic Error: ' + e.error, 'err');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      notify('❌ Mic permission denied');
      App.state.listening = false;
      setMicUI(false);
    }
  };
  App.state.recog.onend = () => { 
    if (App.state.listening) {
      const now = Date.now();
      const delay = (now - App.state.lastRestart < 2000) ? 2000 : 300;
      App.state.lastRestart = now;
      sysLog('Mic restart (' + delay + 'ms)...', 'warn');
      setTimeout(() => { try { if(App.state.listening) App.state.recog.start(); } catch(e) {} }, delay);
    } 
  };
  try { App.state.recog.start(); } catch(e) { sysLog('Mic start failed', 'err'); }
}
function stopMic() {
  App.state.listening = false;
  if (App.state.recog) { try { App.state.recog.abort(); } catch (_) { } App.state.recog = null; }
  if (App.state.audioStream) { App.state.audioStream.getTracks().forEach(t => t.stop()); App.state.audioStream = null; }
  if (App.state.audioCtx) { try { App.state.audioCtx.close(); } catch(_) {} App.state.audioCtx = null; }
  setMicUI(false);
}

async function startVolumeMeter() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    App.state.audioStream = stream;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    App.state.audioCtx = ctx;
    const analyser = ctx.createAnalyser();
    App.state.analyser = analyser;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 64;
    const data = new Uint8Array(analyser.frequencyBinCount);
    
    const bars = document.querySelectorAll('.wb');
    function draw() {
      if (!App.state.listening) return;
      analyser.getByteFrequencyData(data);
      let avg = data.reduce((a, b) => a + b) / data.length;
      bars.forEach((b, i) => {
        let h = (data[i % data.length] / 255) * 40 + 2;
        b.style.height = h + 'px';
        b.style.opacity = (h / 40) + 0.3;
      });
      requestAnimationFrame(draw);
    }
    draw();
  } catch (e) {
    console.warn('Volume meter failed:', e);
  }
}
function setMicUI(on) {
  $('micBtn').classList.toggle('on', on);
  $('tBox').classList.toggle('on', on);
  $('micStateLbl').textContent = on ? 'Listening…' : 'Click mic to start';
  setDot('dMic', 'lMic', on, on ? 'Listening' : 'Mic off', on ? 'live' : '');
}

function handleVoice(text, isInterim = false) {
  if (!text) return;
  const t = text.toLowerCase().trim();
  
  // Prevent duplicate processing of the same text (interim then final)
  if (App.state.lastJob === text) return;
  App.state.lastJob = text;
  
  sysLog('Voice: "' + text + '"', 'ok');

  let actionStr = '';
  let writeStr = '';

  if (/\b(write|type|right)\b/i.test(t)) {
    const msg = text.replace(/\b(write|type|right)\b/gi, '').trim();
    if (msg) { writeStr = msg; actionStr = 'WRITING COMMAND'; queueSpeech(msg); }
  }
  else if (/\b(clear|clean|erase)\b/i.test(t)) { actionStr = 'CLEARING CANVAS'; doClear(); }
  else if (/\bhome\b/i.test(t)) { actionStr = 'HOMING MACHINE'; doHome(); }
  else if (/\bstop\b/i.test(t)) { actionStr = 'EMERGENCY STOP'; eStop(); }
  else {
    actionStr = 'AUTO-WRITING';
    writeStr = text;
    queueSpeech(text);
  }

  // Beautiful formatting for the UI transcript box
  let html = `<div style="color:var(--t3);font-size:12px;margin-bottom:6px;font-style:italic;">🗣️ " ${text} "</div>`;
  if (writeStr) {
     html += `<div style="color:var(--green);font-size:18px;font-weight:700;letter-spacing:1px;">✍️ ${writeStr.toUpperCase()}</div>`;
     html += `<div id="vStatus" style="color:var(--amber);font-size:11px;margin-top:4px;">${App.state.generating ? '⏳ Queued (machine is busy)...' : '⚡ Processing...'}</div>`;
  } else {
     html += `<div style="color:var(--amber);font-size:15px;font-weight:600;">⚡ ${actionStr}</div>`;
  }
  showT(html, actionStr);
}

function queueSpeech(text) {
  App.state.speechQueue.push(text);
  processSpeechQueue();
}

async function processSpeechQueue() {
  if (App.state.generating || App.state.speechQueue.length === 0) return;
  
  if ($('vStatus')) $('vStatus').textContent = '✍️ Writing now...';
  
  const text = App.state.speechQueue.shift();
  await doWrite(text);
  
  if ($('vStatus')) $('vStatus').textContent = '✅ Finished.';
  processSpeechQueue();
}

function doTypeWrite() {
  const v = $('typeIn').value.trim();
  if (!v) return;
  if (!App.state.connected) { notify('Pehle robot connect karo!'); return; }
  if (/^[gm\$!~\?\-\+]/i.test(v)) { enq(v); } else { showT(v, 'WRITING TEXT...'); queueSpeech(v); }
  $('typeIn').value = '';
}
function showT(html, status) {
  const el = $('tFinal');
  if (el) { el.style.display = 'block'; el.innerHTML = html; }
  $('tPh').style.display = 'none';
}

/* ── WRITE TEXT (High-Precision Async Engine) ────────── */
async function doWrite(text) {
  if (App.state.generating) return;
  App.state.generating = true;
  
  try {
    if ($('cvsOverlay')) {
      $('ceTitle').textContent = '';
      $('cvsOverlay').classList.remove('hidden');
      $('cvsOverlay').style.opacity = '1';
      $('cvsOverlay').style.background = 'transparent';
    }

    sysLog('Preparing Job: "' + text.substring(0,20) + '..."', 'ok');
    App.chars += text.length;
    $('ptChars').textContent = App.chars;

    const f = typeof HERSHEY_SIMPLEX !== 'undefined' ? HERSHEY_SIMPLEX : null;
    if (!f) { notify('Wait! Hershey font loading…'); return; }

    const W = cvs.width, H = cvs.height;
    const mmX = App.config.maxX, mmY = App.config.maxY;
    const ratio = mmX / W;
    const fontScale = 0.45, fontBaseline = 22, lineH_mm = 12;
    
    // Initialize or resume coordinates
    if (App.state.curY === null) App.state.curY = mmY - 40; 
    let curX_mm = App.state.curX;
    let curY_mm = App.state.curY;

    // Auto-space between continuous voice commands
    if (curX_mm > 5 && text.trim() !== '') {
      text = ' ' + text.trim();
    }
    
    penUpSeq();

    const lines = text.split('\n');
    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const words = lines[lIdx].split(' ');
      if (lIdx > 0) { curX_mm = 5; curY_mm -= lineH_mm; } 

      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        let word = words[wIdx];
        if (wIdx > 0) word = ' ' + word; 

        let wWidth = word.length * 8 * fontScale; 
        if (curX_mm + wWidth > App.config.maxX - 5 && curX_mm > 5) {
          curX_mm = 5; curY_mm -= lineH_mm;
          if (word.startsWith(' ')) word = word.substring(1);
        }

        if (curY_mm < 0) {
          sysLog('Page full!', 'warn');
          notify('Page full!');
          return;
        }

        for (let char of word) {
          await new Promise(r => setTimeout(r, 0));

          const fontData = f[char.charCodeAt(0)] || f[63];
          if (!fontData) { curX_mm += 10 * fontScale; continue; }
          
          const [width, strokes] = fontData;
          let minX = Infinity;
          strokes.forEach(s => { for (let i = 0; i < s.length; i += 2) if (s[i] < minX) minX = s[i]; });
          if (minX === Infinity) minX = 0;

          if (strokes.length === 0) {
            enq('G4 P0.001', char);
          } else {
            strokes.forEach((s, sIdx) => {
              let penLowered = false;
              for (let i = 0; i < s.length; i += 2) {
                const xM = curX_mm + (s[i] - minX) * fontScale;
                const yM = curY_mm - (s[i+1] - fontBaseline) * fontScale;
                const finalY = App.config.invertY ? App.config.maxY - yM : yM;
                App.state.trails.push({ x: xM / ratio, y: H - (yM / ratio), d: penLowered });
                
                if (!penLowered) {
                  enq(`G0 X${xM.toFixed(3)} Y${finalY.toFixed(3)} F2500`); penDownSeq(); penLowered = true;
                } else {
                  const isLastStroke = (sIdx === strokes.length - 1);
                  const isLastSegment = (i >= s.length - 2);
                  enq(`G1 X${xM.toFixed(3)} Y${finalY.toFixed(3)} F${App.config.feedRate}`, (isLastStroke && isLastSegment) ? char : null);
                }
              }
              penUpSeq();
            });
          }
          curX_mm += (width - minX + 2) * fontScale;
        }
      }
    }
    
    App.state.curX = curX_mm;
    App.state.curY = curY_mm;
    App.state.jobTotalCmds = App.queue.length + App.state.sentQueue.length;
    App.state.jobAckedCmds = 0;
    sysLog('Generation complete.', 'ok');
  } catch (e) {
    sysLog('doWrite error: ' + e.message, 'err');
  } finally {
    App.state.generating = false;
  }
}



/* ── CANVAS ANIMATION ─────────────────────── */
function renderCanvas(upTo) {
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  if (upTo < 0 || !App.state.trails[upTo]) return;
  const col = getComputedStyle(document.documentElement).getPropertyValue('--t1').trim();
  ctx.strokeStyle = col; ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  App.state.trails.slice(0, upTo + 1).forEach((pt, j) => {
    if (j === 0 || !pt.d) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();
  const cur = App.state.trails[upTo];
  ctx.beginPath(); ctx.arc(cur.x, cur.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = cur.d ? '#f87171' : '#4ade80'; ctx.fill();

  if (App.state.penIsDown !== cur.d) {
    App.state.penIsDown = cur.d;
    $('coPen').textContent = cur.d ? '▼ DOWN' : '▲ UP';
    setDot('dPen', 'lPen', true, cur.d ? 'Pen down' : 'Pen up', cur.d ? 'live' : 'on');
  }
}
function setProgress(p) {
  $('progFill').style.width = p + '%'; $('progPct').textContent = p + '%';
}

/* ── MACHINE CONTROLS ────────────────────── */
function eStop() {
  if (App.state.animTimer) clearTimeout(App.state.animTimer);
  App.queue = []; App.state.busy = false;
  App.state.sentQueue = [];
  App.state.jobTotalCmds = 0; App.state.jobAckedCmds = 0;
  if (App.state.wrStream) rawWrite('\x18\n'); // Soft Reset instead of Feed Hold
  setProgress(0); sysLog('E-STOP (Soft Reset)', 'err'); notify('⛔ Hard Stop / Reset');
}
function doHome() {
  penUpSeq(); enq('G0 X0 Y0 F2000');
  $('coX').textContent = '0.00'; $('coY').textContent = '0.00';
  sysLog('Homing', 'ok'); notify('Homing…');
}
function doClear() {
  App.state.trails = []; ctx.clearRect(0, 0, cvs.width, cvs.height); setProgress(0);
  App.state.curX = 5; App.state.curY = null;
  $('coX').textContent = '0.00'; $('coY').textContent = '0.00';
  
  if ($('cvsOverlay')) {
    $('ceTitle').textContent = 'WORKSPACE READY';
    $('cvsOverlay').classList.remove('hidden');
    $('cvsOverlay').style.opacity = '0.4';
    $('cvsOverlay').style.background = 'rgba(10, 10, 12, 0.4)';
  }

  if ($('tFinal')) $('tFinal').style.display = 'none';
  if ($('tInterim')) $('tInterim').style.display = 'none';
  if ($('tPh')) $('tPh').style.display = 'inline';
  sysLog('Cleared', 'warn'); notify('Cleared');
}
function fetchGrblSettings() { enq('$$'); notify('Fetching settings…'); }
function fixServoConfig() {
  enq('$32=0'); enq('$30=255'); enq('$31=0'); enq('$10=1');
  notify('Config fixed!');
}
function togglePause() {
  App.state.paused = !App.state.paused;
  if (App.state.paused) { 
      rawWrite('!'); sysLog('Paused', 'warn'); 
      if ($('pauseBtn')) { $('pauseBtn').textContent = '⏯ Resume'; $('pauseBtn').style.color = '#4ade80'; }
  } else { 
      rawWrite('~'); sysLog('Resumed', 'ok'); 
      if ($('pauseBtn')) { $('pauseBtn').textContent = '⏸ Pause'; $('pauseBtn').style.color = 'var(--amber)'; }
      flushQueue(); 
  }
}
function doJog(axis, dist) { enq(`$J=G91 ${axis}${dist} F1500`); sysLog('Jog: ' + axis + dist, 'ok'); }

/* ── UI HELPERS ──────────────────────────── */
function setBtn(cls, icon, txt) {
  const b = $('connBtn'); if (!b) return;
  b.className = cls; if ($('connIcon')) $('connIcon').textContent = icon; if ($('connTxt')) $('connTxt').textContent = txt;
}
function setDot(dotId, lblId, on, label, cls) {
  const d = $(dotId); if (!d) return;
  d.className = 'dot' + (on ? ' ' + (cls || 'on') : '');
  if (lblId && $(lblId)) $(lblId).textContent = label;
}
function setBadge(state, msg) {
  const el = $('grblBadge'); if (el) { el.className = 'grbl-badge' + (state ? ' ' + state : ''); el.textContent = msg; }
}
function gcLog(line, cls) {
  const log = $('gcLog'); if (!log) return;
  const el = document.createElement('div'); el.className = cls; el.textContent = line;
  log.appendChild(el); log.scrollTop = log.scrollHeight;
}
function sysLog(msg, type) {
  const log = $('sysLog'); if (!log) return;
  const t = new Date().toTimeString().slice(0, 8);
  const el = document.createElement('div'); el.className = 'sl-row';
  el.innerHTML = `<span class="sl-t">${t}</span><span class="sl-${type || 'ok'}">${msg}</span>`;
  log.appendChild(el); log.scrollTop = log.scrollHeight;
}

// Clock & Watchdog
setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString();
  const e = Math.floor((Date.now() - App.sessStart) / 1000);
  $('coSess').textContent = String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0');
}, 1000);

setInterval(() => {
  if (App.state.connected && !App.state.demoMode) {
    // Aggressive Heartbeat: Always poll status if connected to keep dot green
    rawWrite('?');
  }
  
  // Watchdog: If busy but no activity for 4 seconds, force resume
  if (App.state.connected && App.state.busy && (Date.now() - App.state.lastActivity > 4000)) {
    sysLog('Watchdog: No response, forcing flush...', 'warn');
    App.state.charsInBuf = 0;
    App.state.sentLinesLen = [];
    App.state.busy = false;
    App.state.lastActivity = Date.now();
    flushQueue();
  }
}, 2000);
