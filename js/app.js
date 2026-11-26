import { CatalogService } from "./catalog-service.js";
import { createState } from "./state.js";
import { calcularOnGrid } from "./engines/ongrid.js";
import { calcularOffGrid } from "./engines/offgrid.js";
import { calcularHibrido } from "./engines/hibrido.js";
import { calcularManual } from "./engines/manual.js";

const catalog = new CatalogService();
let stateManager = null;
let sistemaActual = "ONGRID";
let lineasManuales = [];

const el = {
  tabs: document.getElementById("ceTabs"),
  selectorForm: document.getElementById("ceSelectorForm"),
  kpis: document.getElementById("ceKpis"),
  alerts: document.getElementById("ceAlerts"),
  manualBox: document.getElementById("ceManualBox"),
  manualSelect: document.getElementById("manualItemSelect"),
  manualQty: document.getElementById("manualItemQty"),
  manualAddBtn: document.getElementById("manualAddBtn"),
  itemsBody: document.getElementById("ceItemsBody"),
  totalesBox: document.getElementById("ceTotalesBox"),
  btnPrint: document.getElementById("btnPrint"),
  btnReset: document.getElementById("btnReset")
};

function fmtUsd(val) {
  return `US$ ${(Number(val) || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtArs(val) {
  return `$ ${(Math.round(Number(val) || 0)).toLocaleString("es-AR")}`;
}

function renderSelector(st) {
  el.selectorForm.innerHTML = `
    <div class="ce-field">
      <label for="f_cliente">Cliente / Proyecto</label>
      <input id="f_cliente" type="text" value="${st.cliente || ""}" placeholder="Ej. Estancia La Sofía" />
    </div>
    <div class="ce-field">
      <label for="f_localidad">Localidad</label>
      <input id="f_localidad" type="text" value="${st.localidad || "Olavarría"}" />
    </div>
    <div class="ce-field">
      <label for="f_tension">Tensión de red</label>
      <select id="f_tension">
        <option value="Monofasico" ${st.tension === "Monofasico" ? "selected" : ""}>Monofásico</option>
        <option value="Trifasico" ${st.tension === "Trifasico" ? "selected" : ""}>Trifásico</option>
      </select>
    </div>
    <div class="ce-field">
      <label for="f_tipo_inst">Montaje de paneles</label>
      <select id="f_tipo_inst">
        <option value="TECHO" ${st.tipo_instalacion_paneles === "TECHO" ? "selected" : ""}>Techo</option>
        <option value="SUELO" ${st.tipo_instalacion_paneles === "SUELO" ? "selected" : ""}>Suelo</option>
      </select>
    </div>
    <div class="ce-field">
      <label for="f_kms">Distancia (km)</label>
      <input id="f_kms" type="number" min="0" step="1" value="${st.kms_ubicacion ?? 60}" />
    </div>
    <div class="ce-field">
      <label for="f_consumo_mes">Consumo mensual (kWh)</label>
      <input id="f_consumo_mes" type="number" min="1" step="1" value="${st.consumo_mensual_kwh ?? 75}" />
    </div>
    <div class="ce-field">
      <label for="f_cobertura">Cobertura On-Grid / Híbrido (%)</label>
      <input id="f_cobertura" type="number" min="10" max="150" step="5" value="${st.cobertura_ongrid_pct ?? 50}" />
    </div>
    <div class="ce-field">
      <label for="f_hsp">Horas Solar Pico (HSP)</label>
      <input id="f_hsp" type="number" min="2" max="8" step="0.1" value="${st.hsp ?? 4.5}" />
    </div>
    <div class="ce-field">
      <label for="f_autonomia">Días de autonomía (Off-Grid)</label>
      <input id="f_autonomia" type="number" min="1" max="10" step="1" value="${st.dias_autonomia ?? 1}" />
    </div>
    <div class="ce-field">
      <label for="f_dod">Profundidad descarga batería DoD (%)</label>
      <input id="f_dod" type="number" min="20" max="90" step="5" value="${st.dod_pct ?? 80}" />
    </div>
    <div class="ce-field">
      <label for="f_pot_crit">Potencia crítica respaldo (W)</label>
      <input id="f_pot_crit" type="number" min="100" step="50" value="${st.potencia_critica_w ?? 600}" />
    </div>
    <div class="ce-field">
      <label for="f_hs_crit">Horas autonomía crítica (h)</label>
      <input id="f_hs_crit" type="number" min="1" max="72" step="1" value="${st.horas_autonomia_critica ?? 12}" />
    </div>
    <div class="ce-field">
      <label for="f_dolar">Tipo de cambio (ARS / USD)</label>
      <input id="f_dolar" type="number" min="1" step="1" value="${st.dolar_ars ?? 1590}" />
    </div>
    <div class="ce-field">
      <label for="f_tarifa">Tarifa eléctrica (ARS / kWh)</label>
      <input id="f_tarifa" type="number" min="1" step="1" value="${st.tarifa_kwh_ars ?? 172}" />
    </div>
    <div class="ce-field">
      <label class="ce-checkbox">
        <input id="f_solo_mat" type="checkbox" ${st.solo_materiales ? "checked" : ""} />
        Solo materiales (sin mano de obra ni viáticos)
      </label>
    </div>
  `;

  el.selectorForm.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", onSelectorChange);
    input.addEventListener("change", onSelectorChange);
  });
}

function onSelectorChange() {
  stateManager.updateSelector({
    cliente: document.getElementById("f_cliente").value,
    localidad: document.getElementById("f_localidad").value,
    tension: document.getElementById("f_tension").value,
    tipo_instalacion_paneles: document.getElementById("f_tipo_inst").value,
    kms_ubicacion: Number(document.getElementById("f_kms").value) || 0,
    consumo_mensual_kwh: Number(document.getElementById("f_consumo_mes").value) || 75,
    cobertura_ongrid_pct: Number(document.getElementById("f_cobertura").value) || 50,
    hsp: Number(document.getElementById("f_hsp").value) || 4.5,
    dias_autonomia: Number(document.getElementById("f_autonomia").value) || 1,
    dod_pct: Number(document.getElementById("f_dod").value) || 80,
    potencia_critica_w: Number(document.getElementById("f_pot_crit").value) || 600,
    horas_autonomia_critica: Number(document.getElementById("f_hs_crit").value) || 12,
    dolar_ars: Number(document.getElementById("f_dolar").value) || 1590,
    tarifa_kwh_ars: Number(document.getElementById("f_tarifa").value) || 172,
    solo_materiales: document.getElementById("f_solo_mat").checked
  });
  calcularYRenderizar();
}

function ejecutarMotor() {
  const st = stateManager.getState();
  switch (sistemaActual) {
    case "OFFGRID":
      return calcularOffGrid(catalog, st);
    case "HIBRIDO":
      return calcularHibrido(catalog, st);
    case "MANUAL":
      return calcularManual(catalog, st, lineasManuales);
    case "ONGRID":
    default:
      return calcularOnGrid(catalog, st);
  }
}

function calcularYRenderizar() {
  const resultado = ejecutarMotor();
  const rt = resultado.resumenTecnico || {};

  // Alertas técnicas
  const alertas = [
    rt.alerta_mppt,
    rt.alerta_descarga_bateria
  ].filter(Boolean);

  el.alerts.innerHTML = alertas
    .map((msg) => `<div class="ce-alert">⚠️ ${msg}</div>`)
    .join("");

  // KPIs principales
  const kpiCards = [];
  if (rt.potencia_pico_kwp !== undefined) {
    kpiCards.push({
      label: "Potencia Solar",
      value: `${rt.potencia_pico_kwp} kWp (${rt.cantidad_paneles || 0} p.)`
    });
  }
  if (rt.inversor_modelo) {
    kpiCards.push({
      label: "Inversor Sugerido",
      value: rt.inversor_modelo
    });
  }
  if (rt.capacidad_banco_kwh !== undefined) {
    kpiCards.push({
      label: "Banco Baterías",
      value: `${rt.capacidad_banco_kwh} kWh (${rt.cantidad_baterias || 0} u.)`
    });
  }
  if (rt.generacion_mensual_kwh !== undefined) {
    kpiCards.push({
      label: "Generación Mensual",
      value: `${rt.generacion_mensual_kwh} kWh/mes`
    });
  }
  if (rt.roi_estimado_anios) {
    kpiCards.push({
      label: "Retorno Estimado",
      value: `${rt.roi_estimado_anios} años`
    });
  }
  if (kpiCards.length === 0) {
    kpiCards.push({
      label: "Ítems en Presupuesto",
      value: `${resultado.items.length}`
    });
  }

  el.kpis.innerHTML = kpiCards
    .map(
      (k) => `
      <div class="ce-kpi">
        <div class="label">${k.label}</div>
        <div class="value">${k.value}</div>
      </div>`
    )
    .join("");

  // Filas de ítems
  el.itemsBody.innerHTML = resultado.items
    .map(
      (it) => `
      <tr>
        <td><strong>${it.modelo}</strong></td>
        <td>${it.descripcion}${it.nota ? ` <em>(${it.nota})</em>` : ""}</td>
        <td>${it.categoria}</td>
        <td class="num">${it.cantidad}</td>
        <td class="num">${fmtUsd(it.precio_venta_usd)}</td>
        <td class="num">${fmtUsd(it.subtotal_usd)}</td>
        <td class="num">${fmtUsd((it.iva105_usd || 0) + (it.iva21_usd || 0))}</td>
        <td class="num"><strong>${fmtUsd(it.total_usd)}</strong></td>
      </tr>`
    )
    .join("");

  // Totales
  const tot = resultado.totales;
  el.totalesBox.innerHTML = `
    <div class="ce-totales-row"><span>Subtotal Neto:</span><span>${fmtUsd(tot.neto_usd)}</span></div>
    <div class="ce-totales-row"><span>IVA 10.5%:</span><span>${fmtUsd(tot.iva105_usd)}</span></div>
    <div class="ce-totales-row"><span>IVA 21%:</span><span>${fmtUsd(tot.iva21_usd)}</span></div>
    <div class="ce-totales-row final"><span>Total USD:</span><span>${fmtUsd(tot.total_usd)}</span></div>
    <div class="ce-totales-row"><span>Total ARS (TC ${tot.dolar_ars}):</span><strong>${fmtArs(tot.total_ars)}</strong></div>
  `;
}

function poblarSelectorManual() {
  const items = catalog.getAllItems();
  el.manualSelect.innerHTML = items
    .map(
      (it) =>
        `<option value="${it.modelo}">${it.modelo} — ${it.descripcion_corta || it.descripcion}</option>`
    )
    .join("");
}

function initTabs() {
  el.tabs.querySelectorAll(".ce-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.tabs.querySelectorAll(".ce-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      sistemaActual = btn.dataset.sistema;
      el.manualBox.style.display = sistemaActual === "MANUAL" ? "block" : "none";
      calcularYRenderizar();
    });
  });

  el.manualAddBtn.addEventListener("click", () => {
    const modelo = el.manualSelect.value;
    const cantidad = Number(el.manualQty.value) || 1;
    if (modelo && cantidad > 0) {
      lineasManuales.push({ modelo, cantidad });
      calcularYRenderizar();
    }
  });

  el.btnPrint.addEventListener("click", () => window.print());
  el.btnReset.addEventListener("click", () => {
    stateManager.resetToDefaults();
    lineasManuales = [];
    renderSelector(stateManager.getState());
    calcularYRenderizar();
  });
}

async function boot() {
  try {
    await catalog.init();
    stateManager = createState(catalog.getParametros());
    poblarSelectorManual();
    initTabs();
    renderSelector(stateManager.getState());
    calcularYRenderizar();
  } catch (err) {
    console.error("Error inicializando cotizador:", err);
    el.alerts.innerHTML = `<div class="ce-alert">Error al cargar los datos del catálogo: ${err.message}</div>`;
  }
}

boot();
