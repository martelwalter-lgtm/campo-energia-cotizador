
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
  return `US$ ${(Number(val) \vert{}\vert{} 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }  function fmtArs(val) { return `$ ${(Math.round(Number(val) || 0)).toLocaleString("es-AR")}`;
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
        <input id="f_solo_mat
