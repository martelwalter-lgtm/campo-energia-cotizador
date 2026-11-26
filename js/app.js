import { CatalogService, obtenerDolarBnaVenta } from "./catalog-service.js";
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

function aplicarCamposPorModo(modo) {
  const selectorCfg = catalog.getSelectorConfig?.() || {};
  const claveModo = String(modo || "ongrid").toLowerCase();
  const permitidos = new Set(selectorCfg.campos_por_modo?.[claveModo] || []);

  el.selectorForm.querySelectorAll("[data-campo]").forEach((wrapper) => {
    const campo = wrapper.getAttribute("data-campo");
    const visible = permitidos.size === 0 || permitidos.has(campo);
    wrapper.style.display = visible ? "" : "none";
  });
}

function renderSelector(st) {
  el.selectorForm.innerHTML = `
    <div class="ce-field" data-campo="cliente_proyecto">
      <label for="f_cliente">Cliente / Proyecto</label>
      <input id="f_cliente" type="text" value="${st.cliente || ""}" placeholder="Ej. Estancia La Sofía" />
    </div>
    <div class="ce-field" data-campo="localidad">
      <label for="f_localidad">Localidad</label>
      <input id="f_localidad" type="text" value="${st.localidad || "Olavarría"}" />
    </div>
    <div class="ce-field" data-campo="tension">
      <label for="f_tension">Tensión de red</label>
      <select id="f_tension">
        <option value="Monofasico" ${st.tension === "Monofasico" ? "selected" : ""}>Monofásico</option>
        <option value="Trifasico" ${st.tension === "Trifasico" ? "selected" : ""}>Trifásico</option>
      </select>
    </div>
    <div class="ce-field" data-campo="tipo_instalacion_paneles">
      <label for="f_tipo_inst">Montaje de paneles</label>
      <select id="f_tipo_inst">
        <option value="TECHO" ${st.tipo_instalacion_paneles === "TECHO" ? "selected" : ""}>Techo</option>
        <option value="SUELO" ${st.tipo_instalacion_paneles === "SUELO" ? "selected" : ""}>Suelo</option>
      </select>
    </div>
    <div class="ce-field" data-campo="metros_cable_paneles">
      <label for="f_metros_cable">Metros cable paneles</label>
      <input id="f_metros_cable" type="number" min="0" step="1" value="${st.metros_cable_paneles ?? 10}" />
    </div>
    <div class="ce-field" data-campo="zanjeo_suelo">
      <label class="ce-checkbox">
        <input id="f_zanjeo" type="checkbox" ${st.zanjeo_suelo ? "checked" : ""} />
        Zanjeo en suelo
      </label>
    </div>
    <div class="ce-field" data-campo="kms_ubicacion">
      <label for="f_kms">Distancia (km)</label>
      <input id="f_kms" type="number" min="0" step="1" value="${st.kms_ubicacion ?? 60}" />
    </div>
    <div class="ce-field" data-campo="consumo_mensual_kwh">
      <label for="f_consumo_mes">Consumo mensual (kWh)</label>
      <input id="f_consumo_mes" type="number" min="1" step="1" value="${st.consumo_mensual_kwh ?? 75}" />
    </div>
    <div class="ce-field" data-campo="cobertura_ongrid_pct">
      <label for="f_cobertura">Cobertura On-Grid / Híbrido (%)</label>
      <input id="f_cobertura" type="number" min="10" max="150" step="5" value="${st.cobertura_ongrid_pct ?? 50}" />
    </div>
    <div class="ce-field" data-campo="respaldo_nocturno_pct">
      <label for="f_respaldo_noct">Respaldo nocturno (%)</label>
      <input id="f_respaldo_noct" type="number" min="0" max="100" step="5" value="${st.respaldo_nocturno_pct ?? 40}" />
    </div>
    <div class="ce-field" data-campo="hsp">
      <label for="f_hsp">Horas Solar Pico (HSP)</label>
      <input id="f_hsp" type="number" min="2" max="8" step="0.1" value="${st.hsp ?? 4.5}" />
    </div>
    <div class="ce-field" data-campo="perdidas_pct">
      <label for="f_perdidas">Pérdidas del sistema (%)</label>
      <input id="f_perdidas" type="number" min="0" max="50" step="1" value="${st.perdidas_pct ?? 15}" />
    </div>
    <div class="ce-field" data-campo="tension_sistema_v">
      <label for="f_tension_sys">Tensión de batería / sistema (V)</label>
      <select id="f_tension_sys">
        <option value="12" ${Number(st.tension_sistema_v) === 12 ? "selected" : ""}>12 V</option>
        <option value="24" ${Number(st.tension_sistema_v) === 24 ? "selected" : ""}>24 V</option>
        <option value="48" ${Number(st.tension_sistema_v) === 48 ? "selected" : ""}>48 V</option>
      </select>
    </div>
    <div class="ce-field" data-campo="dias_autonomia">
      <label for="f_autonomia">Días de autonomía (Off-Grid)</label>
      <input id="f_autonomia" type="number" min="1" max="10" step="1" value="${st.dias_autonomia ?? 1}" />
    </div>
    <div class="ce-field" data-campo="dod_pct">
      <label for="f_dod">Profundidad descarga batería DoD (%)</label>
      <input id="f_dod" type="number" min="20" max="90" step="5" value="${st.dod_pct ?? 80}" />
    </div>
    <div class="ce-field" data-campo="potencia_critica_w">
      <label for="f_pot_crit">Potencia crítica respaldo (W)</label>
      <input id="f_pot_crit" type="number" min="100" step="50" value="${st.potencia_critica_w ?? 600}" />
    </div>
    <div class="ce-field" data-campo="horas_autonomia_critica">
      <label for="f_hs_crit">Horas autonomía crítica (h)</label>
      <input id="f_hs_crit" type="number" min="1" max="72" step="1" value="${st.horas_autonomia_critica ?? 12}" />
    </div>
    <div class="ce-field" data-campo="factor_simultaneidad">
      <label for="f_simultaneidad">Factor de simultaneidad</label>
      <input id="f_simultaneidad" type="number" min="0.1" max="1" step="0.05" value="${st.factor_simultaneidad ?? 0.8}" />
    </div>
    <div class="ce-field" data-campo="dolar_ars">
      <label for="f_dolar">Dólar BNA Venta (ARS / USD)</label>
      <input id="f_dolar" type="number" min="1" step="0.5" value="${st.dolar_ars ?? 1625}" />
    </div>
    <div class="ce-field" data-campo="tarifa_kwh_ars">
      <label for="f_tarifa">Tarifa eléctrica (ARS / kWh)</label>
      <input id="f_tarifa" type="number" min="1" step="1" value="${st.tarifa_kwh_ars ?? 172}" />
    </div>
    <div class="ce-field" data-campo="solo_materiales">
      <label class="ce-checkbox">
        <input id="f_solo_mat" type="checkbox" ${st.solo_materiales ? "checked" : ""} />
        Solo materiales (sin mano de obra ni viáticos)
      </label>
    </div>
  `;

  aplicarCamposPorModo(sistemaActual);

  el.selectorForm.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", onSelectorChange);
    input.addEventListener("change", onSelectorChange);
  });
}

function onSelectorChange() {
  stateManager.updateSelector({
    cliente: document.getElementById("f_cliente")?.value ?? "",
    localidad: document.getElementById("f_localidad")?.value ?? "Olavarría",
    tension: document.getElementById("f_tension")?.value ?? "Monofasico",
    tipo_instalacion_paneles: document.getElementById("f_tipo_inst")?.value ?? "TECHO",
    metros_cable_paneles: Number(document.getElementById("f_metros_cable")?.value) || 0,
    zanjeo_suelo: Boolean(document.getElementById("f_zanjeo")?.checked),
    kms_ubicacion: Number(document.getElementById("f_kms")?.value) || 0,
    consumo_mensual_kwh: Number(document.getElementById("f_consumo_mes")?.value) || 75,
    cobertura_ongrid_pct: Number(document.getElementById("f_cobertura")?.value) || 50,
    respaldo_nocturno_pct: Number(document.getElementById("f_respaldo_noct")?.value) || 40,
    hsp: Number(document.getElementById("f_hsp")?.value) || 4.5,
    perdidas_pct: Number(document.getElementById("f_perdidas")?.value) || 15,
    tension_sistema_v: Number(document.getElementById("f_tension_sys")?.value) || 48,
    dias_autonomia: Number(document.getElementById("f_autonomia")?.value) || 1,
    dod_pct: Number(document.getElementById("f_dod")?.value) || 80,
    potencia_critica_w: Number(document.getElementById("f_pot_crit")?.value) || 600,
    horas_autonomia_critica: Number(document.getElementById("f_hs_crit")?.value) || 12,
    factor_simultaneidad: Number(document.getElementById("f_simultaneidad")?.value) || 0.8,
    dolar_ars: Number(document.getElementById("f_dolar")?.value) || 1625,
    tarifa_kwh_ars: Number(document.getElementById("f_tarifa")?.value) || 172,
    solo_materiales: Boolean(document.getElementById("f_solo_mat")?.checked)
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

  const alertas = [rt.alerta_mppt, rt.alerta_descarga_bateria].filter(Boolean);
  el.alerts.innerHTML = alertas
    .map((msg) => `<div class="ce-alert">⚠️ ${msg}</div>`)
    .join("");

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

async function resolverDolarVenta(selCfg) {
  const bnaCfg = selCfg?.cotizacion_bna || {};
  const fallback =
    Number(bnaCfg.valor_referencia_ars ?? selCfg?.defaults_selector?.dolar_ars ?? 1625) || 1625;

  if (bnaCfg.actualizar_automatico === false) {
    return fallback;
  }

  return await obtenerDolarBnaVenta(fallback);
}

function initTabs() {
  el.tabs.querySelectorAll(".ce-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.tabs.querySelectorAll(".ce-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      sistemaActual = btn.dataset.sistema;
      el.manualBox.style.display = sistemaActual === "MANUAL" ? "block" : "none";
      aplicarCamposPorModo(sistemaActual);
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
  el.btnReset.addEventListener("click", async () => {
    stateManager.resetToDefaults();
    const selCfg = catalog.getSelectorConfig?.() || {};
    const dolarVenta = await resolverDolarVenta(selCfg);
    stateManager.updateSelector({ dolar_ars: dolarVenta });
    lineasManuales = [];
    renderSelector(stateManager.getState());
    calcularYRenderizar();
  });
}

async function boot() {
  try {
    await catalog.init();

    const params = catalog.getParametros() || {};
    const selCfg = catalog.getSelectorConfig() || {};
    const estadoInicial = catalog.getEstadoInicial() || {};

    stateManager = createState({
      ...params,
      defaults_selector: {
        ...(params.defaults_selector || {}),
        ...(selCfg.defaults_selector || {}),
        ...estadoInicial
      },
      consumos_base: Array.isArray(estadoInicial.consumos_base)
        ? estadoInicial.consumos_base
        : params.consumos_base
    });

    const dolarVenta = await resolverDolarVenta(selCfg);
    stateManager.updateSelector({ dolar_ars: dolarVenta });

    poblarSelectorManual();
    initTabs();
    renderSelector(stateManager.getState());
    aplicarCamposPorModo(sistemaActual);
    calcularYRenderizar();
  } catch (err) {
    console.error("Error inicializando cotizador:", err);
    el.alerts.innerHTML = `<div class="ce-alert">Error al cargar los datos del catálogo: ${err.message}</div>`;
  }
}

boot();
