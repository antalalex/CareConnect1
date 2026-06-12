/* ═══════════════════════════════════════════
   CareConect — script.js
   ═══════════════════════════════════════════ */

const BASE_URL = "https://careconnectapi2026-crc6ehajfgbvc3c3.polandcentral-01.azurewebsites.net";

// ── Auth ──
function getMedicId() { return parseInt(localStorage.getItem("cc_medic_id") || "1"); }
function logout() {
  localStorage.removeItem("cc_medic_id");
  localStorage.removeItem("cc_medic_nume");
  localStorage.removeItem("cc_medic_email");
  window.location.href = "login.html";
}

// ── Helpers ──
function g(id) { return document.getElementById(id); }
function setHTML(id, html) { const e = g(id); if (e) e.innerHTML = html; }
function statusClass(s) { return s === "Anormal" ? "abnormal" : s === "Atenție" ? "warning" : "normal"; }
function computeStatus(bpm, temp, ecg) {
  if (ecg === "Anormal" || bpm > 100 || bpm < 50 || temp >= 38.0) return "Anormal";
  if (bpm > 90 || temp >= 37.5) return "Atenție";
  return "Normal";
}

function updateTime() {
  const now = new Date();
  const t = g("time"), d = g("todayDate");
  if (t) t.textContent = now.toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
  if (d) d.textContent = now.toLocaleDateString("ro-RO", { day:"2-digit", month:"long", year:"numeric" });
}

function showToast(msg, type="success") {
  let t = g("cc-toast");
  if (!t) { t = document.createElement("div"); t.id = "cc-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = `cc-toast cc-toast-${type} cc-toast-show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("cc-toast-show"), 3000);
}

// ── State ──
let patients = [], medications = [], histories = [];
let activePatient = 0;
let alerts = [], alertIdCounter = 0;



// ── API ──
async function loadPacientiDinAPI() {
  try {
    const r = await fetch(`${BASE_URL}/api/pacienti/lista/${getMedicId()}`);
    if (!r.ok) return false;
    const lista = await r.json();
    if (!Array.isArray(lista) || lista.length === 0) return false;

    const newPatients = lista.map(p => {
      const existing = patients.find(x => x.id === p.idPacient);
      return {
        id: p.idPacient,
        name: p.nume || "Pacient",
        age: p.varsta || 0,
        adresa: p.adresa || "",
        bpm: existing ? existing.bpm : 0,
        temp: existing ? existing.temp : 0,
        ecg: existing ? existing.ecg : "Normal",
        diagnostic: p.adresa || "-"
      };
    });

    patients = newPatients;
    medications = patients.map(() => []);
    if (histories.length !== patients.length) histories = patients.map(() => []);
    return true;
  } catch(e) { return false; }
}

async function loadIstoricDinAPI(idx) {
  const p = patients[idx];
  if (!p || !p.id) return;
  try {
    const r = await fetch(`${BASE_URL}/api/senzor/istoric/${p.id}`);
    if (!r.ok) return;
    const data = await r.json();
    if (!Array.isArray(data)) return;

    histories[idx] = data.map(row => {
      let dateStr = row.timp || "";
      try {
        const d = new Date((dateStr.includes("Z") ? dateStr : dateStr + "Z"));
        dateStr = d.toLocaleDateString("ro-RO", { day:"2-digit", month:"2-digit", year:"numeric" })
                + " " + d.toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
      } catch(e) {}
      const bpm = row.puls || 0;
      const temp = row.temperatura || 0;
      const ecg = (bpm >= 60 && bpm <= 100) ? "Normal" : "Anormal";
      return { date: dateStr, bpm, temp, ecg, status: computeStatus(bpm, temp, ecg) };
    });

    if (histories[idx].length > 0) {
      const last = histories[idx][0];
      if (last.bpm  > 0) patients[idx].bpm  = last.bpm;
      if (last.temp > 0) patients[idx].temp = last.temp;
      patients[idx].ecg = last.ecg;
    }
  } catch(e) {}
}

// ── Alerts din API ──
const dismissedAlerts = new Set(JSON.parse(localStorage.getItem("cc_dismissed_v2") || "[]"));

function saveDismissed() {
  localStorage.setItem("cc_dismissed_v2", JSON.stringify([...dismissedAlerts]));
}

async function loadAlerteDinAPI() {
  let apiAlerts = [];
  try {
    const r = await fetch(`${BASE_URL}/api/alerte/${getMedicId()}`);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data)) {
        apiAlerts = data.map(a => {
          const tip = a.tipAnomalie || a.tip || "Alertă";
          let minuteKey = "";
          try {
            const d = new Date((a.dataOra.includes("Z") ? a.dataOra : a.dataOra + "Z"));
            minuteKey = d.toISOString().slice(0,16);
          } catch(e) {}
          const key = `${a.idPacient}-${tip}-${minuteKey}`;
          const color = tip.toLowerCase().includes("puls") || tip.toLowerCase().includes("ecg") || tip.toLowerCase().includes("febr") ? "red" : "orange";
          let time = "--";
          try {
            const dt = new Date((a.dataOra.includes("Z") ? a.dataOra : a.dataOra + "Z"));
            time = dt.toLocaleTimeString("ro-RO", { hour:"2-digit", minute:"2-digit" });
          } catch(e) {}
          return { id: key, name: a.numePacient || "Pacient", time, color, priority: "Mare", type: "Valori anormale" };
        });
      }
    }
  } catch(e) {}

  alerts = apiAlerts.filter(a => !dismissedAlerts.has(a.id));
}

function deleteAlert(id) {
  dismissedAlerts.add(id);
  saveDismissed();
  alerts = alerts.filter(x => x.id !== id);
  renderAlerts(); renderAlertsFull(); updateStatCards();
}

function clearAllAlerts() {
  if (!alerts.length) return;
  if (!confirm("Ștergi toate alertele?")) return;
  alerts.forEach(a => dismissedAlerts.add(a.id));
  saveDismissed();
  alerts = [];
  renderAlerts(); renderAlertsFull(); updateStatCards();
}

// ── Render ──
function updateStatCards() {
  const tp = g("totalPatients"), aa = g("activeAlerts");
  if (tp) tp.textContent = patients.length > 0 ? patients.length : "--";
  if (aa) aa.textContent = patients.length > 0 ? alerts.length : "--";
  const at = g("alertTotal"); if (at) at.textContent = alerts.length;

}

function populateSelects() {
  ["historyPatientSelect", "patientSelect"].forEach(id => {
    const el = g(id); if (!el) return;
    const prev = el.value;
    el.innerHTML = patients.map((p,i) => `<option value="${i}">${p.name}</option>`).join("");
    if (el.querySelector(`option[value="${prev}"]`)) el.value = prev;
  });
}

function renderAlerts() {
  const l = g("alertList"); if (!l) return;
  if (!alerts.length) { l.innerHTML = `<div class="med-empty">Nicio alertă activă.</div>`; return; }
  l.innerHTML = alerts.map(a => `
    <div class="alert-row">
      <span class="dot ${a.color}"></span>
      <div><strong>${a.name}</strong></div>
      <strong class="alert-time">${a.time}</strong>

    </div>`).join("");
}

function renderAlertsFull() {
  const l = g("alertsFullList"); if (!l) return;
  if (!alerts.length) { l.innerHTML = `<div class="med-empty">Nicio alertă activă.</div>`; return; }
  l.innerHTML = alerts.map(a => `
    <div class="alert-full-card">
      <span class="dot ${a.color}"></span>
      <div><h3>${a.type}</h3><p><strong>${a.name}</strong> • ${a.time}</p></div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <span class="priority ${a.priority==="Mare"?"high":"medium"}">${a.priority}</span>
      </div>
    </div>`).join("");
}

function renderHistory() {
  const sel = g("historyPatientSelect"), tbl = g("historyTable");
  if (!sel || !tbl) return;
  if (!patients.length) { tbl.innerHTML = `<div class="med-empty">Nu sunt pacienți înregistrați.</div>`; return; }
  const i = Number(sel.value), p = patients[i], h = histories[i] || [];
  if (!p) { tbl.innerHTML = `<div class="med-empty">Selectează un pacient.</div>`; return; }
  if (!h.length) { tbl.innerHTML = `<div class="med-empty">Nicio înregistrare salvată pentru ${p.name}.</div>`; return; }
  tbl.innerHTML = `
    <div class="history-head"><span>Data</span><span>Puls</span><span>Temperatură</span><span>ECG</span><span>Status</span></div>
    ${h.map(row => `
      <div class="history-row" style="grid-template-columns:1.2fr 100px 130px 120px 120px">
        <span>${row.date}</span>
        <strong>${row.bpm} bpm</strong>
        <strong>${row.temp.toFixed(1)} °C</strong>
        <span class="status ${row.ecg==="Normal"?"normal":"abnormal"}">${row.ecg}</span>
        <span class="status ${statusClass(row.status)}">${row.status}</span>
      </div>`).join("")}`;
}

function renderQuickPatients() {
  const c = g("quickPatientsList"); if (!c) return;
  if (!patients.length) {
    c.innerHTML = `<div class="no-patients-state">
      <svg width="48" height="48" fill="none" stroke="#cbd5e1" stroke-width="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <strong>Niciun pacient în sistem</strong>
    </div>`;
    return;
  }
  const SC = { "Normal":{bg:"#f0fdf4",border:"#86efac",accent:"#16a34a"}, "Atenție":{bg:"#fffbeb",border:"#fcd34d",accent:"#d97706"}, "Anormal":{bg:"#fef2f2",border:"#fca5a5",accent:"#dc2626"} };
  c.innerHTML = patients.map((p, i) => {
    const status = computeStatus(p.bpm, p.temp, p.ecg);
    const sc = SC[status] || SC["Normal"];
    const h = histories[i] || [];
    const last = h.length ? h[0] : null;
    const bpm  = last ? last.bpm  : p.bpm;
    const temp = last ? last.temp : p.temp;
    const bC = bpm  > 100 ? "#dc2626" : bpm  > 90 ? "#d97706" : "#2563eb";
    const tC = temp >= 37.5 ? "#dc2626" : temp >= 37.0 ? "#d97706" : "#16a34a";
    const eC = p.ecg === "Anormal" ? "#dc2626" : "#16a34a";
    const ini = p.name.split(" ").map(w => w[0]).join("").slice(0, 2);
    return `
      <div class="qpc2-card" id="patient-card-${i}" style="border-left:4px solid ${sc.accent}">
        <div class="qpc2-top">
          <div class="qpc2-avatar" style="background:${sc.bg};color:${sc.accent};border:1.5px solid ${sc.border}">${ini}</div>
          <div class="qpc2-identity">
            <strong>${p.name}</strong>
            <span>${p.age} ani &nbsp;·&nbsp; ${p.diagnostic}</span>
          </div>
          <span class="status ${statusClass(status)}">${status}</span>
        </div>
        <div class="qpc2-divider"></div>
        <div class="qpc2-bottom">
          <div class="qpc2-vitals">
            <div class="qpc2-vital-box">
              <span>Puls</span>
              <strong style="color:${bC}">${bpm > 0 ? bpm : "--"}<em>bpm</em></strong>
              ${last ? `<em class="qpc2-last-time">${last.date.split(" ")[1]}</em>` : ""}
            </div>
            <div class="qpc2-vital-box">
              <span>Temp.</span>
              <strong style="color:${tC}">${temp > 0 ? temp.toFixed(1) : "--"}<em>°C</em></strong>
              ${last ? `<em class="qpc2-last-time">${last.date.split(" ")[1]}</em>` : ""}
            </div>
            <div class="qpc2-vital-box"><span>ECG</span><strong style="color:${eC}">${p.ecg}</strong></div>
          </div>
        </div>
      </div>`;
  }).join("");
}

function renderSearchResults(query) {
  const box = g("searchResults"); if (!box) return;
  if (!query.trim()) { box.innerHTML = ""; return; }
  const q = query.toLowerCase();
  const results = patients.map((p,i) => ({p,i})).filter(({p}) => p.name.toLowerCase().includes(q));
  if (!results.length) { box.innerHTML = `<div class="search-no-result">Niciun rezultat găsit.</div>`; return; }
  box.innerHTML = results.map(({p,i}) => {
    const status = computeStatus(p.bpm, p.temp, p.ecg);
    const bg = status==="Normal"?"#f0fdf4":status==="Atenție"?"#fffbeb":"#fef2f2";
    const cl = status==="Normal"?"#16a34a":status==="Atenție"?"#d97706":"#dc2626";
    return `<div class="search-result-row" onclick="scrollToPatient(${i})" style="cursor:pointer">
      <div class="search-result-avatar" style="background:${bg};color:${cl}">${p.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</div>
      <div><strong>${p.name}</strong><span>${p.age} ani</span></div>
      <span class="status ${statusClass(status)}">${status}</span>
    </div>`;
  }).join("");
}

function scrollToPatient(i) {
  const card = g(`patient-card-${i}`); if (!card) return;
  card.scrollIntoView({behavior:"smooth", block:"center"});
  card.classList.add("qpc2-highlight");
  setTimeout(() => card.classList.remove("qpc2-highlight"), 2000);
  const s = g("patientSearch"); if (s) s.value = "";
  const r = g("searchResults"); if (r) r.innerHTML = "";
}

// ── Boot ──
document.addEventListener("DOMContentLoaded", function() {
  updateTime();
  setInterval(updateTime, 1000);

  const historySelect = g("historyPatientSelect");
  if (historySelect) historySelect.addEventListener("change", async () => {
    const i = Number(historySelect.value);
    await loadIstoricDinAPI(i);
    renderHistory();
  });

  const patientSearch = g("patientSearch");
  if (patientSearch) patientSearch.addEventListener("input", () => renderSearchResults(patientSearch.value));

  // Incarca din API
  (async () => {
    const loaded = await loadPacientiDinAPI();
    if (loaded) {
      populateSelects();
      renderQuickPatients();
      updateStatCards();
    }
    for (let i = 0; i < patients.length; i++) await loadIstoricDinAPI(i);
    await loadAlerteDinAPI();
    renderAlerts();
    renderAlertsFull();
    renderHistory();
    renderQuickPatients();
    updateStatCards();
  })();

  // Refresh la fiecare 5 secunde
  setInterval(async () => {
    await loadPacientiDinAPI();
    for (let i = 0; i < patients.length; i++) await loadIstoricDinAPI(i);
    await loadAlerteDinAPI();
    renderAlerts();
    renderAlertsFull();
    renderQuickPatients();
    renderHistory();
    updateStatCards();
  }, 5000);
});

// ── Fișă pacient (readonly) ──
let fisaPatientIdx = -1;

function openFisaModal(idx) {
  fisaPatientIdx = idx;
  const p = patients[idx];
  const t = g("fisaModalTitle"); if (t) t.textContent = `Fișă pacient — ${p.name}`;
  const setVal = (id, v) => { const e = g(id); if (e) e.value = v; };
  setVal("fisaName", p.name || "");
  setVal("fisaAge",  p.age  || "");
  setVal("fisaDiag", p.diagnostic || "");
  setVal("fisaEcg",  p.ecg || "Normal");
  g("fisaModalOverlay")?.classList.add("active");
  g("fisaModal")?.classList.add("active");
}

function closeFisaModal() {
  g("fisaModalOverlay")?.classList.remove("active");
  g("fisaModal")?.classList.remove("active");
  fisaPatientIdx = -1;
}
