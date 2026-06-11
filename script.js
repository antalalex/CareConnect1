/* ═══════════════════════════════════════════
   CareConect — API Integration
   ═══════════════════════════════════════════ */

const BASE_URL = "https://careconnectapi2026-crc6ehajfgbvc3c3.polandcentral-01.azurewebsites.net";

// ── Auth helpers ──
function getMedicId()   { return parseInt(localStorage.getItem("cc_medic_id") || "1"); }
function getMedicNume() { return localStorage.getItem("cc_medic_nume") || "Medic"; }
function isLoggedIn()   { return !!localStorage.getItem("cc_medic_id"); }

function logout() {
  localStorage.removeItem("cc_medic_id");
  localStorage.removeItem("cc_medic_nume");
  window.location.href = "login.html";
}

// ── API calls ──
async function apiGetListaPacienti(idMedic) {
  try {
    const r = await fetch(`${BASE_URL}/api/pacienti/lista/${idMedic}`);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function apiGetProfilPacient(idPacient) {
  try {
    const r = await fetch(`${BASE_URL}/api/pacienti/profil/${idPacient}`);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function apiGetIstoricPacient(idPacient) {
  try {
    const r = await fetch(`${BASE_URL}/api/senzor/istoric/${idPacient}`);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function apiGetMedici() {
  try {
    const r = await fetch(`${BASE_URL}/api/pacienti/medici`);
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function apiInregistrarePacient(nume, varsta, adresa, idMedic) {
  try {
    const url = `${BASE_URL}/api/pacienti/inregistrare?nume=${encodeURIComponent(nume)}&varsta=${encodeURIComponent(varsta)}&adresa=${encodeURIComponent(adresa)}&idMedic=${idMedic}`;
    const r = await fetch(url, { method: "POST" });
    const body = await r.text();
    try { return JSON.parse(body); } catch(e) { return { idPacient: parseInt(body.trim()) }; }
  } catch(e) { return null; }
}

async function apiSetareParola(idPacient, parola) {
  try {
    const url = `${BASE_URL}/api/pacienti/setare-parola?idPacient=${idPacient}&parola=${encodeURIComponent(parola)}`;
    const r = await fetch(url, { method: "POST" });
    return r.ok;
  } catch(e) { return false; }
}

async function apiLoginPacient(idPacient, parola) {
  try {
    const url = `${BASE_URL}/api/pacienti/login?idPacient=${idPacient}&parola=${encodeURIComponent(parola)}`;
    const r = await fetch(url, { method: "POST" });
    return r.ok;
  } catch(e) { return false; }
}

// ── Incarcare pacienti din API ──
async function loadPacientiDinAPI() {
  const idMedic = getMedicId();
  const lista = await apiGetListaPacienti(idMedic);
  if (!lista || !Array.isArray(lista) || lista.length === 0) return false;

  const newPatients = lista.map(p => ({
    id: p.idPacient,
    name: p.nume || "Pacient",
    age: p.varsta || 0,
    adresa: p.adresa || "",
    email: "",
    bpm: 0,
    temp: 0,
    ecg: "Normal",
    diagnostic: p.adresa || "-"
  }));

  // Pastreaza valorile bpm/temp/ecg existente la refresh
  newPatients.forEach((np, i) => {
    const existing = patients.find(p => p.id === np.id);
    if (existing) {
      np.bpm  = existing.bpm;
      np.temp = existing.temp;
      np.ecg  = existing.ecg;
    }
  });

  patients = newPatients;
  if (medications.length !== patients.length) medications = patients.map(() => []);
  if (histories.length   !== patients.length) histories   = patients.map(() => []);
  return true;
}

// ── Incarcare istoric din API pentru un pacient ──
async function loadIstoricDinAPI(patientIdx) {
  const p = patients[patientIdx];
  if (!p || !p.id) return;

  const istoric = await apiGetIstoricPacient(p.id);
  if (!istoric || !Array.isArray(istoric)) return;

  const newHistory = istoric.map(row => {
    let dateStr = row.timp || "";
    try {
      const timpUTC = dateStr.includes("Z") ? dateStr : dateStr + "Z";
      const d = new Date(timpUTC);
      dateStr = d.toLocaleDateString("ro-RO", { day:"2-digit", month:"2-digit", year:"numeric" })
              + " " + d.toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
    } catch(e) {}

    const bpm  = row.puls || 0;
    const temp = row.temperatura || 0;
    const ekg  = row.ekg || 0;
    const ecg  = (bpm >= 60 && bpm <= 100) ? "Normal" : "Anormal";
    const status = computeStatus(bpm, temp, ecg);
    return { date: dateStr, bpm, temp, ekg, ecg, status };
  });

  // Seteaza atomically - fara reset intermediar
  histories[patientIdx] = newHistory;

  // Actualizeaza valorile pacientului din prima (cea mai recenta) inregistrare
  if (newHistory.length > 0) {
    const last = newHistory[0];
    if (last.bpm  > 0) patients[patientIdx].bpm  = last.bpm;
    if (last.temp > 0) patients[patientIdx].temp = last.temp;
    patients[patientIdx].ecg = last.ecg;

    // Actualizeaza bufferele grafice daca e pacientul activ
    if (patientIdx === activePatient) {
      const vals = newHistory.slice(0, 50).reverse();
      vals.forEach(row => {
        if (row.bpm > 0) {
          pulseBuffer.push(row.bpm);
          if (pulseBuffer.length > 50) pulseBuffer.shift();
        }
        if (row.temp > 0) {
          tempBuffer.push(row.temp);
          if (tempBuffer.length > 50) tempBuffer.shift();
        }
      });

      // Adauga doar cel mai recent punct ECG in buffer (nu reseta)
      if (newHistory.length > 0 && newHistory[0].ekg > 0) {
        const latestEkg = newHistory[0].ekg;
        // Adauga doar daca e diferit de ultimul punct (date noi)
        if (ecgWaveBuffer.length === 0 || ecgWaveBuffer[ecgWaveBuffer.length - 1] !== latestEkg) {
          ecgWaveBuffer.push(latestEkg);
          if (ecgWaveBuffer.length > 120) ecgWaveBuffer.shift();
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════
   CareConect — script.js
   ═══════════════════════════════════════════ */

// Fara date demo - totul din API

const DEFAULT_MEDICATIONS = [
  [
    { name: "Metoprolol",    dose: "50mg",  freq: "2x/zi",       start: "2025-03-10", end: "2025-06-10", type: "Cardio",         notes: "Se administrează după masă." },
    { name: "Aspirină",      dose: "100mg", freq: "1x/zi",        start: "2025-01-15", end: "",           type: "Cardio",         notes: "" }
  ],
  [
    { name: "Paracetamol",   dose: "500mg", freq: "3x/zi",        start: "2025-05-01", end: "2025-05-15", type: "Antiinflamator", notes: "Doar la nevoie, max 3 zile." },
    { name: "Ibuprofen",     dose: "400mg", freq: "2x/zi",        start: "2025-05-01", end: "2025-05-10", type: "Antiinflamator", notes: "Evitați pe stomacul gol." }
  ],
  [
    { name: "Amiodaronă",    dose: "200mg", freq: "1x/zi",        start: "2025-02-20", end: "",           type: "Cardio",         notes: "Monitorizare lunară tiroidă." },
    { name: "Furosemid",     dose: "40mg",  freq: "1x/dimineață", start: "2025-04-05", end: "",           type: "Altele",         notes: "Dimineața devreme, cu apă multă." }
  ],
  [
    { name: "Metformină",    dose: "850mg", freq: "2x/zi",        start: "2024-11-01", end: "",           type: "Antidiabetic",   notes: "Cu masa de prânz și cină." }
  ],
  [
    { name: "Atorvastatină", dose: "20mg",  freq: "1x/seară",     start: "2025-01-08", end: "",           type: "Cardio",         notes: "Seara, înainte de culcare." },
    { name: "Ramipril",      dose: "5mg",   freq: "1x/zi",        start: "2025-01-08", end: "",           type: "Cardio",         notes: "" }
  ]
];

const DEFAULT_HISTORIES = [
  [
    { date: "16.05.2025 19:45", bpm: 72,  temp: 36.6, ecg: "Normal",  status: "Normal"  },
    { date: "16.05.2025 18:45", bpm: 74,  temp: 36.5, ecg: "Normal",  status: "Normal"  },
    { date: "16.05.2025 17:45", bpm: 71,  temp: 36.7, ecg: "Normal",  status: "Normal"  }
  ],
  [
    { date: "16.05.2025 19:45", bpm: 88,  temp: 37.8, ecg: "Normal",  status: "Atenție" },
    { date: "16.05.2025 18:45", bpm: 84,  temp: 37.4, ecg: "Normal",  status: "Atenție" },
    { date: "16.05.2025 17:45", bpm: 80,  temp: 37.1, ecg: "Normal",  status: "Normal"  }
  ],
  [
    { date: "16.05.2025 19:45", bpm: 102, temp: 37.2, ecg: "Anormal", status: "Anormal" },
    { date: "16.05.2025 18:45", bpm: 98,  temp: 37.1, ecg: "Anormal", status: "Anormal" },
    { date: "16.05.2025 17:45", bpm: 91,  temp: 36.9, ecg: "Normal",  status: "Atenție" }
  ],
  [
    { date: "16.05.2025 19:45", bpm: 65,  temp: 36.4, ecg: "Normal",  status: "Normal"  },
    { date: "16.05.2025 18:45", bpm: 67,  temp: 36.4, ecg: "Normal",  status: "Normal"  },
    { date: "16.05.2025 17:45", bpm: 64,  temp: 36.3, ecg: "Normal",  status: "Normal"  }
  ],
  [
    { date: "16.05.2025 19:45", bpm: 71,  temp: 36.5, ecg: "Normal",  status: "Normal"  },
    { date: "16.05.2025 18:45", bpm: 73,  temp: 36.6, ecg: "Normal",  status: "Normal"  },
    { date: "16.05.2025 17:45", bpm: 70,  temp: 36.4, ecg: "Normal",  status: "Normal"  }
  ]
];

/* ── localStorage ── */
const RESET_KEY = "cc_reset_v7";

function loadData() {
  patients    = [];
  medications = [];
  histories   = [];
  dismissedAlertKeys = [];
  alertIdCounter = 0;
}

function saveData() {
  // Datele vin din API - nu se salveaza in localStorage
}

function saveDismissed() {
  // Alertele nu se salveaza in localStorage
}

function computeStatus(bpm, temp, ecg) {
  if (ecg === "Anormal" || bpm > 100 || bpm < 50 || temp >= 38.0) return "Anormal";
  if (bpm > 90 || temp >= 37.5) return "Atenție";
  return "Normal";
}

/* ── State ── */
let patients, medications, histories;
let activePatient   = 0;
let phase           = 0;
let modalPatientIdx = -1;
let fisaPatientIdx  = -1;
let alerts          = [];
let alertIdCounter  = 0;
let dismissedAlertKeys = [];
loadData();

function alertKey(type, patientIdx) {
  return `${type}-${patientIdx}-${patients[patientIdx]?.bpm}-${patients[patientIdx]?.temp}-${patients[patientIdx]?.ecg}`;
}

function generateAlerts() {
  const now = new Date().toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
  const newAlerts = [];

  patients.forEach((p, i) => {
    const checks = [];
    // Nu genera alerte daca nu exista date reale
    if (!p.bpm || !p.temp || p.bpm === 0 || p.temp === 0) return;

    if (p.ecg === "Anormal")
      checks.push({ key: alertKey("ecg", i), text: "ECG anormal detectat", color:"red", priority:"Mare", type:"ECG anormal" });
    if (p.bpm > 100)
      checks.push({ key: alertKey("puls-h", i), text: `Puls ridicat: ${p.bpm} bpm`, color:"red", priority:"Mare", type:"Puls ridicat" });
    else if (p.bpm < 50 && p.bpm > 0)
      checks.push({ key: alertKey("puls-l", i), text: `Puls scăzut: ${p.bpm} bpm`, color:"orange", priority:"Mare", type:"Puls scăzut" });
    if (p.temp >= 38.0)
      checks.push({ key: alertKey("febra", i), text: `Febră: ${p.temp.toFixed(1)}°C`, color:"red", priority:"Mare", type:"Febră" });
    else if (p.temp >= 37.5)
      checks.push({ key: alertKey("subf", i), text: `Subfebrilitate: ${p.temp.toFixed(1)}°C`, color:"orange", priority:"Medie", type:"Temperatură" });

    checks.forEach(c => {
      // Verifica daca alerta exista deja (dupa key)
      const exists = alerts.find(a => a.key === c.key);
      if (exists) {
        newAlerts.push(exists);
      } else if (!dismissedAlertKeys.includes(c.key)) {
        newAlerts.push({ id: ++alertIdCounter, patientIdx: i, name: p.name,
          text: c.text, time: now, color: c.color, priority: c.priority,
          type: c.type, key: c.key });
      }
    });
  });

  alerts = newAlerts;
}

function deleteAlert(id) {
  const a = alerts.find(x => x.id === id);
  if (a) dismissedAlertKeys.push(a.key);
  alerts = alerts.filter(x => x.id !== id);
  saveDismissed();
  renderAlerts(); renderAlertsFull(); updateStatCards();
}

function clearAllAlerts() {
  if (!alerts.length) return;
  if (!confirm("Ștergi toate alertele?")) return;
  alerts.forEach(a => dismissedAlertKeys.push(a.key));
  alerts = [];
  saveDismissed();
  renderAlerts(); renderAlertsFull(); updateStatCards();
}

/* ── Helpers ── */
function statusClass(s) {
  return s === "Anormal" ? "abnormal" : s === "Atenție" ? "warning" : "normal";
}

function g(id) { return document.getElementById(id); }
function setHTML(id, html) { const e = g(id); if (e) e.innerHTML = html; }
function setVal(id, v)     { const e = g(id); if (e) e.value = v; }
function getVal(id)        { const e = g(id); return e ? e.value : ""; }

function updateTime() {
  const now = new Date();
  const t = g("time"), d = g("todayDate");
  if (t) t.textContent = now.toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
  if (d) d.textContent = now.toLocaleDateString("ro-RO", { day:"2-digit", month:"long", year:"numeric" });
}

/* ── Populate selects ── */
function populateSelects() {
  ["patientSelect","historyPatientSelect","medPatientSelect","medFilterSelect","quickMedPatient"].forEach(id => {
    const el = g(id); if (!el) return;
    const prev = el.value;
    const isFilter = id === "medFilterSelect";
    el.innerHTML = (isFilter ? '<option value="all">Toți pacienții</option>' : "") +
      patients.map((p,i) => `<option value="${i}">${p.name}</option>`).join("");
    if (el.querySelector(`option[value="${prev}"]`)) el.value = prev;
  });
}

function updateStatCards() {
  const tp = g("totalPatients"), aa = g("activeAlerts");
  if (tp) tp.textContent = patients.length;
  if (aa) aa.textContent = alerts.length;
  // alerts page cards
  const at = g("alertTotal");
  if (at) at.textContent = alerts.length;
  const ap = g("alertPuls");
  if (ap) ap.textContent = alerts.filter(a => a.type === "Puls ridicat" || a.type === "Puls scăzut").length;
  const atemp = g("alertTemp");
  if (atemp) atemp.textContent = alerts.filter(a => a.type === "Temperatură" || a.type === "Febră").length;
  const ae = g("alertEcg");
  if (ae) ae.textContent = alerts.filter(a => a.type === "ECG anormal").length;
}

/* ── ECG + animation ── */
const ecgWaveBuffer = [];
let ecgPhaseLocal = 0;
const ECG_MIN = 42, ECG_MAX = 138;

function generateEcgPoint(pos) {
  const p = pos % 60;
  let val = 80;
  if (p >= 3 && p < 9)   val = 80 + Math.sin((p - 3) / 6 * Math.PI) * 8;
  else if (p >= 14 && p < 16) val = 80 - (p - 14) * 6;
  else if (p >= 16 && p < 17) val = 68 + (p - 16) * 80;
  else if (p >= 17 && p < 18) val = 148 - (p - 17) * 90;
  else if (p >= 18 && p < 20) val = 58 + (p - 18) * 11;
  else if (p >= 28 && p < 42) val = 80 + Math.sin((p - 28) / 14 * Math.PI) * 18;
  val += (Math.random() - 0.5) * 1.2;
  return Math.max(ECG_MIN, Math.min(ECG_MAX, val));
}

function drawECG() {
  const c = g("ecgCanvas"); if (!c) return;
  const ctx = c.getContext("2d");
  const r = window.devicePixelRatio || 1;
  const w = c.clientWidth * r, h = c.clientHeight * r;
  c.width = w; c.height = h;

  ecgWaveBuffer.push(generateEcgPoint(ecgPhaseLocal++));
  while (ecgWaveBuffer.length > 120) ecgWaveBuffer.shift();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#071B3D";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#26385F";
  ctx.lineWidth = r;
  ctx.beginPath();
  ctx.moveTo(0, h / 3); ctx.lineTo(w, h / 3);
  ctx.moveTo(0, h * 2 / 3); ctx.lineTo(w, h * 2 / 3);
  ctx.stroke();

  if (ecgWaveBuffer.length < 2) return;

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#93C5FD";
  ctx.lineWidth = 2.8 * r;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  const range = ECG_MAX - ECG_MIN;
  const pad = h * 0.14;
  const stepX = w / (ecgWaveBuffer.length - 1);

  ecgWaveBuffer.forEach((val, i) => {
    const normalized = Math.max(0, Math.min(1, (val - ECG_MIN) / range));
    const x = i * stepX;
    const y = h - pad - normalized * (h - 2 * pad);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

const pulseBuffer = Array(20).fill(0);
const tempBuffer  = Array(20).fill(0);

function drawSmallChart(canvas, buffer, minVal, maxVal, color) {
  if (!canvas || buffer.length < 2) return;
  const ctx = canvas.getContext("2d"), r = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * r, h = canvas.clientHeight * r;
  canvas.width = w; canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4 * r;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const range = maxVal - minVal || 1;
  const pad = h * 0.1;
  buffer.forEach((val, i) => {
    const x = (i / (buffer.length - 1)) * w;
    const normalized = Math.max(0, Math.min(1, (val - minVal) / range));
    const y = h - pad - normalized * (h - 2 * pad);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Demo mode (identic cu Android) ──
let demoCount = 0;
let demoPulse = 72;
let demoTemp = 36.6;
let demoRunning = false;
let demoInterval = null;

function startWebDemo() {
  if (demoRunning) return;
  demoRunning = true;
  demoInterval = setInterval(() => {
    const phase = Math.floor(demoCount / 100) % 2;
    const abnormal = phase === 1;
    const targetPulse = abnormal ? 112 : 76;
    const targetTemp  = abnormal ? 38.3 : 36.7;
    demoPulse += (targetPulse - demoPulse) * 0.045;
    demoTemp  += (targetTemp  - demoTemp)  * 0.035;
    demoCount++;

    const puls = Math.round(demoPulse);
    const temp = parseFloat(demoTemp.toFixed(1));
    const pulsNormal = puls >= 60 && puls <= 100;
    const tempNormala = temp >= 36.1 && temp <= 37.2;
    const ecg = abnormal ? "Anormal" : "Normal";

    // Actualizeaza pacientul activ
    if (patients[activePatient]) {
      patients[activePatient].bpm  = puls;
      patients[activePatient].temp = temp;
      patients[activePatient].ecg  = ecg;
    }

    // Adauga in buffere grafice
    pulseBuffer.push(puls);
    if (pulseBuffer.length > 50) pulseBuffer.shift();
    tempBuffer.push(temp);
    if (tempBuffer.length > 50) tempBuffer.shift();

    // Actualizeaza UI
    const hist = histories[activePatient] || [];
    const last = hist.length ? hist[0] : null;
    setHTML("pulseValue", `${puls} <em>bpm</em>`);
    setHTML("tempValue",  `${temp.toFixed(1)} <em>°C</em>`);

    const ps = g("pulseStatus");
    if (ps) {
      const c = !pulsNormal ? "#dc2626" : "#16a34a";
      const t = puls > 100 ? "Ridicat" : puls < 50 ? "Scăzut" : "Normal";
      ps.innerHTML = `<span style="color:${c};font-weight:800;font-size:13px">● ${t}</span>`;
    }
    const ts = g("tempStatus");
    if (ts) {
      const c = temp >= 38 ? "#dc2626" : temp >= 37.5 ? "#d97706" : "#16a34a";
      const t = temp >= 38 ? "Febră" : temp >= 37.5 ? "Subfebrilitate" : "Normală";
      ts.innerHTML = `<span style="color:${c};font-weight:800;font-size:13px">● ${t}</span>`;
    }

    const es = g("ecgStatus");
    if (es) { es.textContent = ecg; es.className = ecg === "Normal" ? "pill normal" : "pill abnormal"; }

    generateAlerts(); renderAlerts(); renderAlertsFull(); updateStatCards();
  }, 2000);
}

function stopWebDemo() {
  demoRunning = false;
  if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
}

let lastEcgTime = 0;
function animate(timestamp) {
  // ECG se actualizeaza la ~80ms (ca in aplicatia Android)
  if (timestamp - lastEcgTime >= 80) {
    phase += 2.2;
    drawECG();
    lastEcgTime = timestamp;
  }
  drawSmallChart(g("pulseChart"), pulseBuffer, 40, 140, "#2563eb");
  drawSmallChart(g("tempChart"), tempBuffer, 35, 40, "#22c55e");
  requestAnimationFrame(animate);
}

function updatePatient() {
  const p = patients[activePatient]; if (!p) return;

  // Puls
  setHTML("pulseValue", hasData ? `${p.bpm} <em>bpm</em>` : `--- <em>bpm</em>`);
  // Temperatura
  setHTML("tempValue",  hasData ? `${p.temp.toFixed(1)} <em>°C</em>` : `--.-- <em>°C</em>`);

  const es = g("ecgStatus");
  if (es) {
    if (!hasData) { es.textContent = "--"; es.className = "pill"; }
    else { es.textContent=p.ecg; es.className=p.ecg==="Normal"?"pill normal":"pill abnormal"; }
  }

  const ps = g("pulseStatus");
  if (ps) {
    if (!hasData) {
      ps.innerHTML = `<span style="color:#94a3b8;font-weight:800;font-size:13px">● Așteptare date...</span>`;
    } else {
      const c=p.bpm>100?"#dc2626":p.bpm>90?"#d97706":"#16a34a";
      const t=p.bpm>100?"Ridicat":p.bpm<50?"Scăzut":"Normal";
      ps.innerHTML=`<span style="color:${c};font-weight:800;font-size:13px">● ${t}</span>`;
    }
  }

  const ts = g("tempStatus");
  if (ts) {
    if (!hasData) {
      ts.innerHTML = `<span style="color:#94a3b8;font-weight:800;font-size:13px">● Așteptare date...</span>`;
    } else {
      const c=p.temp>=38?"#dc2626":p.temp>=37.5?"#d97706":"#16a34a";
      const t=p.temp>=38?"Febră":p.temp>=37.5?"Subfebrilitate":"Normală";
      ts.innerHTML=`<span style="color:${c};font-weight:800;font-size:13px">● ${t}</span>`;
    }
  }

  // Daca nu exista date, afiseaza linie plata pe ECG
  if (!hasData && ecgWaveBuffer.length === 0) {
    for (let i = 0; i < 120; i++) ecgWaveBuffer.push(80);
  }
}

/* ── Alerts ── */
function renderAlerts() {
  const l = g("alertList"); if (!l) return;
  if (!alerts.length) { l.innerHTML=`<div class="med-empty">Nicio alertă activă.</div>`; return; }
  l.innerHTML = alerts.map(a=>`
    <div class="alert-row">
      <span class="dot ${a.color}"></span>
      <div><strong>${a.name}</strong><span>${a.text}</span></div>
      <strong class="alert-time">${a.time}</strong>
    </div>`).join("");
}

function renderAlertsFull() {
  const l = g("alertsFullList"); if (!l) return;
  if (!alerts.length) { l.innerHTML=`<div class="med-empty">Nicio alertă activă.</div>`; return; }
  l.innerHTML = alerts.map(a=>`
    <div class="alert-full-card">
      <span class="dot ${a.color}"></span>
      <div><h3>${a.type}</h3><p><strong>${a.name}</strong> — ${a.text} • ${a.time}</p></div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <span class="priority ${a.priority==="Mare"?"high":"medium"}">${a.priority}</span>
        <button class="alert-delete-btn" onclick="deleteAlert(${a.id})" title="Șterge alertă">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`).join("");
}

/* ── History ── */
function renderHistory() {
  const sel=g("historyPatientSelect"), tbl=g("historyTable");
  if (!sel||!tbl) return;
  if (!patients.length) {
    tbl.innerHTML=`<div class="med-empty">Nu sunt pacienți înregistrați.</div>`;
    return;
  }
  const i=Number(sel.value), p=patients[i], h=histories[i]||[];
  if (!p) {
    tbl.innerHTML=`<div class="med-empty">Selectează un pacient.</div>`;
    return;
  }
  if (!h.length) {
    tbl.innerHTML=`<div class="med-empty">Nicio înregistrare salvată pentru ${p.name}.</div>`;
    return;
  }
  tbl.innerHTML=`
    <div class="history-head"><span>Data</span><span>Puls</span><span>Temperatură</span><span>ECG</span><span>Status</span><span></span></div>
    ${h.map((row,ri)=>`
      <div class="history-row" style="grid-template-columns:1.2fr 100px 130px 120px 120px 40px">
        <span>${row.date}</span>
        <strong>${row.bpm} bpm</strong>
        <strong>${row.temp.toFixed(1)} °C</strong>
        <span class="status ${row.ecg==="Normal"?"normal":"abnormal"}">${row.ecg}</span>
        <span class="status ${statusClass(row.status)}">${row.status}</span>
        <button class="med-delete-btn" onclick="deleteHistoryFromPage(${i},${ri})" title="Șterge">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join("")}`;
}

function deleteHistoryFromPage(patIdx, rowIdx) {
  if (!confirm("Ștergi această înregistrare?")) return;
  histories[patIdx].splice(rowIdx, 1);
  saveData();
  renderHistory();
  showToast("Înregistrare ștearsă.", "error");
}

/* ── Quick patient cards ── */
function renderQuickPatients() {
  const c = g("quickPatientsList"); if (!c) return;
  const SC = {
    "Normal":  {bg:"#f0fdf4",border:"#86efac",accent:"#16a34a"},
    "Atenție": {bg:"#fffbeb",border:"#fcd34d",accent:"#d97706"},
    "Anormal": {bg:"#fef2f2",border:"#fca5a5",accent:"#dc2626"}
  };
  c.innerHTML = patients.map((p,i) => {
    const status=computeStatus(p.bpm,p.temp,p.ecg);
    const sc=SC[status]||SC["Normal"];
    const meds=medications[i]||[];
    const hist = histories[i] || [];
    const lastHistory = hist.length ? hist[0] : null;
    const displayBpm  = lastHistory ? lastHistory.bpm  : p.bpm;
    const displayTemp = lastHistory ? lastHistory.temp : p.temp;
    const bC=displayBpm>100?"#dc2626":displayBpm>90?"#d97706":"#2563eb";
    const tC=displayTemp>=37.5?"#dc2626":displayTemp>=37.0?"#d97706":"#16a34a";
    const eC=p.ecg==="Anormal"?"#dc2626":"#16a34a";
    const ini=p.name.split(" ").map(w=>w[0]).join("").slice(0,2);
    const medHtml=meds.length
      ? meds.slice(0,4).map(m=>`<span class="qpc2-med-pill">${m.name} <em>${m.dose}</em></span>`).join("")
        +(meds.length>4?`<span class="qpc2-med-pill qpc2-med-more">+${meds.length-4}</span>`:"")
      : `<span class="qpc2-no-meds">Fără medicație</span>`;
    return `
      <div class="qpc2-card" id="patient-card-${i}" style="border-left:4px solid ${sc.accent}">
        <div class="qpc2-top">
          <div class="qpc2-avatar" style="background:${sc.bg};color:${sc.accent};border:1.5px solid ${sc.border}">${ini}</div>
          <div class="qpc2-identity">
            <strong>${p.name}</strong>
            <span>${p.age} ani &nbsp;·&nbsp; ${p.diagnostic}</span>

          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            <span class="status ${statusClass(status)}">${status}</span>
            <div class="qpc2-btn-group">
              <button class="qpc2-action-btn qpc2-blue-btn" onclick="openFisaModal(${i})" title="Fișă pacient">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </button>
              <button class="qpc2-action-btn qpc2-blue-btn" onclick="openMedModal(${i})" title="Medicație">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>
              </button>
              <button class="qpc2-action-btn qpc2-delete-btn" onclick="deletePatient(${i})" title="Șterge">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="qpc2-divider"></div>
        <div class="qpc2-bottom">
          <div class="qpc2-vitals">
            <div class="qpc2-vital-box">
              <span>Puls</span>
              <strong style="color:${bC}">${lastHistory ? lastHistory.bpm : p.bpm}<em>bpm</em></strong>
              ${lastHistory ? `<em class="qpc2-last-time">${lastHistory.date.split(" ")[1]}</em>` : ""}
            </div>
            <div class="qpc2-vital-box">
              <span>Temp.</span>
              <strong style="color:${tC}">${lastHistory ? lastHistory.temp.toFixed(1) : p.temp.toFixed(1)}<em>°C</em></strong>
              ${lastHistory ? `<em class="qpc2-last-time">${lastHistory.date.split(" ")[1]}</em>` : ""}
            </div>
            <div class="qpc2-vital-box"><span>ECG</span><strong style="color:${eC}">${p.ecg}</strong></div>
          </div>
          <div class="qpc2-meds-area">
            <span class="qpc2-meds-label">Medicație</span>
            <div class="qpc2-meds-pills">${medHtml}</div>
          </div>
        </div>
      </div>`;
  }).join("") || `<div class="no-patients-state">
    <svg width="48" height="48" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    <strong>Niciun pacient în sistem</strong>
    <span>Adaugă primul pacient folosind formularul de mai sus.</span>
  </div>`;
}

/* ── Search ── */
function renderSearchResults(query) {
  const box = g("searchResults"); if (!box) return;
  if (!query.trim()) { box.innerHTML=""; return; }
  const q=query.toLowerCase();
  const results=patients.map((p,i)=>({p,i}))
    .filter(({p})=>p.name.toLowerCase().includes(q)||p.diagnostic.toLowerCase().includes(q));
  if (!results.length) { box.innerHTML=`<div class="search-no-result">Niciun rezultat găsit.</div>`; return; }
  box.innerHTML=results.map(({p,i})=>{
    const status=computeStatus(p.bpm,p.temp,p.ecg);
    const bg=status==="Normal"?"#f0fdf4":status==="Atenție"?"#fffbeb":"#fef2f2";
    const cl=status==="Normal"?"#16a34a":status==="Atenție"?"#d97706":"#dc2626";
    return `
      <div class="search-result-row" onclick="scrollToPatient(${i})" style="cursor:pointer">
        <div class="search-result-avatar" style="background:${bg};color:${cl}">
          ${p.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
        </div>
        <div><strong>${p.name}</strong><span>${p.age} ani · ${p.diagnostic}</span></div>
        <span class="status ${statusClass(status)}">${status}</span>
      </div>`;
  }).join("");
}

function scrollToPatient(i) {
  const card=g(`patient-card-${i}`); if (!card) return;
  card.scrollIntoView({behavior:"smooth",block:"center"});
  card.classList.add("qpc2-highlight");
  setTimeout(()=>card.classList.remove("qpc2-highlight"),2000);
  const s=g("patientSearch"); if(s) s.value="";
  const r=g("searchResults"); if(r) r.innerHTML="";
}

/* ── Add patient ── */
function addPatient() {
  const name  = getVal("newPatientName").trim();
  const age   = parseInt(getVal("newPatientAge"));
  const diag  = getVal("newPatientDiag").trim();
  const email = getVal("newPatientEmail").trim();
  if (!name||!age||!diag) { showToast("Completează numele, vârsta și diagnosticul.","error"); return; }
  const bpm  = Math.floor(60+Math.random()*40);
  const temp = parseFloat((36.2+Math.random()*1.3).toFixed(1));
  patients.push({name,age,email,bpm,temp,ecg:"Normal",diagnostic:diag});
  medications.push([]);
  histories.push([]);
  saveData();
  ["newPatientName","newPatientAge","newPatientDiag","newPatientEmail"].forEach(id=>{const e=g(id);if(e)e.value="";});
  populateSelects(); updateStatCards(); renderQuickPatients();
  showToast(`${name} adăugat cu succes.`,"success");
}

/* ── Delete patient ── */
function deletePatient(idx) {
  const name=patients[idx].name;
  if (!confirm(`Ștergi pacientul ${name}?`)) return;
  patients.splice(idx,1); medications.splice(idx,1); histories.splice(idx,1);
  if (activePatient>=patients.length) activePatient=Math.max(0,patients.length-1);
  saveData(); generateAlerts(); populateSelects(); updateStatCards(); renderQuickPatients(); renderAlerts(); renderAlertsFull();
  showToast(`${name} șters.`,"error");
}

/* ── Quick med ── */
function addQuickMed() {
  const idx  = Number(getVal("quickMedPatient"));
  const name = getVal("quickMedName").trim();
  const dose = getVal("quickMedDose").trim();
  const freq = getVal("quickMedFreq").trim();
  const type = getVal("quickMedType");
  if (!name||!dose||!freq) { showToast("Completează medicamentul, doza și frecvența.","error"); return; }
  if (!medications[idx]) medications[idx]=[];
  medications[idx].push({name,dose,freq,start:"",end:"",type,notes:""});
  saveData();
  ["quickMedName","quickMedDose","quickMedFreq"].forEach(id=>{const e=g(id);if(e)e.value="";});
  renderQuickPatients();
  showToast(`${name} adăugat pentru ${patients[idx].name}.`,"success");
}

/* ── Fișă modal ── */
function openFisaModal(idx) {
  fisaPatientIdx=idx;
  const p=patients[idx];
  const t=g("fisaModalTitle"); if(t) t.textContent=`Fișă pacient — ${p.name}`;
  setVal("fisaName",  p.name||"");
  setVal("fisaAge",   p.age||"");
  setVal("fisaEmail", p.email||"");
  setVal("fisaDiag",  p.diagnostic||"");
  setVal("fisaEcg",   p.ecg||"Normal");
  renderFisaMedList(idx);
  g("fisaModalOverlay")?.classList.add("active");
  g("fisaModal")?.classList.add("active");
}

function renderFisaMedList(idx) {
  const list = g("fisaMedList"); if (!list) return;
  const meds = medications[idx] || [];
  if (!meds.length) {
    list.innerHTML = `<div class="med-empty" style="margin:0">Niciun medicament înregistrat.</div>`;
    return;
  }
  list.innerHTML = meds.map((m, mi) => `
    <div class="modal-med-row">
      <div class="modal-med-info">
        <strong>${m.name}</strong>
        <span>${m.dose} &nbsp;·&nbsp; ${m.freq} &nbsp;·&nbsp; <em>${m.type}</em></span>
        ${m.notes ? `<span class="modal-med-notes">${m.notes}</span>` : ""}
        ${m.start ? `<span style="font-size:11px;color:var(--muted)">${m.start}${m.end ? " → "+m.end : " · activ"}</span>` : ""}
      </div>
      <button class="med-delete-btn" onclick="deleteMedFromFisa(${mi})">Șterge</button>
    </div>`).join("");
}

function deleteMedFromFisa(mi) {
  if (!confirm("Ștergi acest medicament?")) return;
  medications[fisaPatientIdx].splice(mi, 1);
  saveData(); renderFisaMedList(fisaPatientIdx); renderQuickPatients();
  showToast("Medicament șters.", "error");
}

function closeFisaModal() {
  g("fisaModalOverlay")?.classList.remove("active");
  g("fisaModal")?.classList.remove("active");
  fisaPatientIdx=-1;
}

function saveFisaModal() {
  if (fisaPatientIdx<0) return;
  const name  = getVal("fisaName").trim();
  const age   = parseInt(getVal("fisaAge"));
  const email = getVal("fisaEmail").trim();
  const diag  = getVal("fisaDiag").trim();
  const ecg   = getVal("fisaEcg");
  if (!name||!age||!diag) { showToast("Completează numele, vârsta și diagnosticul.","error"); return; }
  patients[fisaPatientIdx]={...patients[fisaPatientIdx],name,age,email,diagnostic:diag,ecg};
  // clear dismissed alerts for this patient so fresh alerts appear
  dismissedAlertKeys = dismissedAlertKeys.filter(k => !k.includes(`-${fisaPatientIdx}-`));
  saveData(); generateAlerts(); populateSelects(); renderQuickPatients(); renderAlerts(); renderAlertsFull(); updateStatCards(); closeFisaModal();
  showToast(`${name} actualizat.`,"success");
}

/* ── Med modal ── */
function openMedModal(idx) {
  modalPatientIdx=idx;
  const t=g("medModalTitle"); if(t) t.textContent=`Medicație — ${patients[idx].name}`;
  renderModalMedList();
  g("medModalOverlay")?.classList.add("active");
  g("medModal")?.classList.add("active");
}

function closeMedModal() {
  g("medModalOverlay")?.classList.remove("active");
  g("medModal")?.classList.remove("active");
  modalPatientIdx=-1;
  ["modalMedName","modalMedDose","modalMedFreq","modalMedNotes","modalMedStart","modalMedEnd"]
    .forEach(id=>{const e=g(id);if(e)e.value="";});
}

function renderModalMedList() {
  const list=g("medModalList"); if(!list) return;
  const meds=medications[modalPatientIdx]||[];
  if (!meds.length) { list.innerHTML=`<div class="med-empty" style="margin-top:16px">Niciun medicament adăugat încă.</div>`; return; }
  list.innerHTML=meds.map((m,mi)=>`
    <div class="modal-med-row">
      <div class="modal-med-info">
        <strong>${m.name}</strong>
        <span>${m.dose} &nbsp;·&nbsp; ${m.freq} &nbsp;·&nbsp; <em>${m.type}</em></span>
        ${m.notes?`<span class="modal-med-notes">${m.notes}</span>`:""}
        ${m.start?`<span style="font-size:11px;color:var(--muted)">${m.start}${m.end?" → "+m.end:" · activ"}</span>`:""}
      </div>
      <button class="med-delete-btn" onclick="deleteMedFromModal(${mi})">Șterge</button>
    </div>`).join("");
}

function addMedFromModal() {
  if (modalPatientIdx<0) return;
  const name  = getVal("modalMedName").trim();
  const dose  = getVal("modalMedDose").trim();
  const freq  = getVal("modalMedFreq").trim();
  const type  = getVal("modalMedType");
  const start = getVal("modalMedStart");
  const end   = getVal("modalMedEnd");
  const notes = getVal("modalMedNotes").trim();
  if (!name||!dose||!freq) { showToast("Completează medicamentul, doza și frecvența.","error"); return; }
  if (!medications[modalPatientIdx]) medications[modalPatientIdx]=[];
  medications[modalPatientIdx].push({name,dose,freq,start,end,type,notes});
  saveData();
  ["modalMedName","modalMedDose","modalMedFreq","modalMedNotes","modalMedStart","modalMedEnd"]
    .forEach(id=>{const e=g(id);if(e)e.value="";});
  renderModalMedList(); renderQuickPatients();
  showToast(`${name} adăugat.`,"success");
}

function deleteMedFromModal(mi) {
  if (!confirm("Ștergi acest medicament?")) return;
  medications[modalPatientIdx].splice(mi,1);
  saveData(); renderModalMedList(); renderQuickPatients();
  showToast("Medicament șters.","error");
}


/* ════════════════════════════════════════════
   Monitorizare live — salvare + istoric
   ════════════════════════════════════════════ */
function saveMonitoring() {
  const p = patients[activePatient]; if (!p) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString("ro-RO", { day:"2-digit", month:"2-digit", year:"numeric" })
                + " " + now.toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
  const status = computeStatus(p.bpm, p.temp, p.ecg);
  const entry = { date: dateStr, bpm: p.bpm, temp: p.temp, ecg: p.ecg, status };
  if (!histories[activePatient]) histories[activePatient] = [];
  histories[activePatient].unshift(entry); // cel mai recent primul
  saveData();
  renderLiveHistory();
  showToast(`Monitorizare salvată pentru ${p.name}.`, "success");
}

function renderLiveHistory() {
  const list = g("liveHistoryList"); if (!list) return;
  const p = patients[activePatient];
  const sub = g("liveHistorySubtitle");
  if (sub && p) sub.textContent = `Valorile salvate pentru ${p.name}.`;
  const hist = histories[activePatient] || [];
  if (!hist.length) {
    list.innerHTML = `<div class="med-empty">Nicio monitorizare salvată încă.</div>`;
    return;
  }
  list.innerHTML = `
    <div class="live-hist-head">
      <span>Data și ora</span><span>Puls</span><span>Temperatură</span><span>ECG</span><span>Status</span><span></span>
    </div>
    ${hist.map((row, ri) => {
      const bC = row.bpm>100?"#dc2626":row.bpm>90?"#d97706":"#2563eb";
      const tC = row.temp>=37.5?"#dc2626":row.temp>=37.0?"#d97706":"#16a34a";
      return `
        <div class="live-hist-row">
          <span class="live-hist-date">${row.date}</span>
          <strong style="color:${bC}">${row.bpm} <em>bpm</em></strong>
          <strong style="color:${tC}">${row.temp.toFixed(1)} <em>°C</em></strong>
          <span class="status ${row.ecg==="Normal"?"normal":"abnormal"}">${row.ecg}</span>
          <span class="status ${statusClass(row.status)}">${row.status}</span>
          <button class="med-delete-btn" onclick="deleteHistoryEntry(${ri})" title="Șterge">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
    }).join("")}`;
}

function deleteHistoryEntry(ri) {
  if (!confirm("Ștergi această înregistrare?")) return;
  histories[activePatient].splice(ri, 1);
  saveData();
  renderLiveHistory();
  showToast("Înregistrare ștearsă.", "error");
}

/* ── Toast ── */
function showToast(msg,type="success") {
  let t=g("cc-toast");
  if (!t) { t=document.createElement("div"); t.id="cc-toast"; document.body.appendChild(t); }
  t.textContent=msg; t.className=`cc-toast cc-toast-${type} cc-toast-show`;
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove("cc-toast-show"),3000);
}

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", function() {
  const patientSelect = g("patientSelect");
  if (patientSelect) patientSelect.addEventListener("change", () => {
    activePatient = Number(patientSelect.value);
    // Reseteaza valorile la schimbarea pacientului
    if (patients[activePatient]) {
      patients[activePatient].bpm  = 0;
      patients[activePatient].temp = 0;
    }
    pulseBuffer.fill(0);
    tempBuffer.fill(0);
    ecgWaveBuffer.length = 0;
    updatePatient();
    renderLiveHistory();
    loadIstoricDinAPI(activePatient).then(() => {
      updatePatient();
      renderLiveHistory();
      generateAlerts();
      renderAlerts();
      renderAlertsFull();
      updateStatCards();
    });
  });

  const historySelect = g("historyPatientSelect");
  if (historySelect) historySelect.addEventListener("change", renderHistory);

  const patientSearch = g("patientSearch");
  if (patientSearch) patientSearch.addEventListener("input", () => renderSearchResults(patientSearch.value));

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeMedModal(); closeFisaModal(); }
  });

  updateTime();
  setInterval(updateTime, 1000);
  animate();

  // Incarca totul din API
  (async () => {
    const loaded = await loadPacientiDinAPI();
    if (loaded) {
      populateSelects();
      updateStatCards();
      renderQuickPatients();
      generateAlerts();
      renderAlerts();
      renderAlertsFull();
      renderHistory();
    }
    for (let i = 0; i < patients.length; i++) {
      await loadIstoricDinAPI(i);
    }
    // Opreste demo-ul dupa ce s-au incarcat datele reale
    stopWebDemo();
    updatePatient();
    renderLiveHistory();
    renderHistory();
    generateAlerts();
    renderAlerts();
    renderAlertsFull();
    updateStatCards();
    renderQuickPatients();
  })();

  // Refresh istoric la fiecare 5 secunde pentru toti pacientii
  setInterval(async () => {
    for (let i = 0; i < patients.length; i++) {
      await loadIstoricDinAPI(i);
    }
    updatePatient();
    renderLiveHistory();
    renderHistory();
    generateAlerts();
    renderAlerts();
    renderAlertsFull();
    updateStatCards();
    renderQuickPatients();
  }, 2000);
});
