const STORAGE_KEY_STATE = "ce_cotizador_state_v1";

export const DEFAULT_SELECTOR_STATE = {
  cliente: "",
  localidad: "Olavarría",
  tension: "Monofasico",
  kms_ubicacion: 60,
  solo_materiales: false,
  metros_cable_paneles: 10,
  zanjeo_suelo: true,
  consumo_mensual_kwh: 75,
  hsp: 4.5,
  perdidas_pct: 15,
  tension_sistema_v: 48,
  cobertura_ongrid_pct: 50,
  dias_autonomia: 1,
  dod_pct: 80,
  respaldo_nocturno_pct: 40,
  tipo_instalacion_paneles: "TECHO",
  dolar_ars: 1590,
  tarifa_kwh_ars: 172,
  potencia_critica_w: 600,
  horas_autonomia_critica: 12,
  factor_simultaneidad: 0.8,
  consumos: []
};

export function createState(initialParams = {}) {
  const baseDefaults = {
    ...DEFAULT_SELECTOR_STATE,
    ...(initialParams.defaults_selector || {}),
    consumos: Array.isArray(initialParams.consumos_base)
      ? structuredClone(initialParams.consumos_base)
      : []
  };

  let state = structuredClone(baseDefaults);

  try {
    const savedRaw = localStorage.getItem(STORAGE_KEY_STATE);
    if (savedRaw) {
      const parsed = JSON.parse(savedRaw);
      state = {
        ...baseDefaults,
        ...parsed,
        consumos: Array.isArray(parsed.consumos)
          ? parsed.consumos
          : baseDefaults.consumos
      };
    }
  } catch (err) {
    console.warn("No se pudo leer el estado guardado en localStorage:", err);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
    } catch (err) {
      console.warn("No se pudo guardar el estado en localStorage:", err);
    }
  }

  function getState() {
    return state;
  }

  function updateSelector(partial = {}) {
    state = {
      ...state,
      ...partial
    };
    persist();
    return state;
  }

  function setConsumos(listaConsumos = []) {
    state.consumos = Array.isArray(listaConsumos) ? listaConsumos : [];
    persist();
    return state.consumos;
  }

  function resetToDefaults() {
    state = structuredClone(baseDefaults);
    persist();
    return state;
  }

  return {
    getState,
    updateSelector,
    setConsumos,
    resetToDefaults
  };
}
