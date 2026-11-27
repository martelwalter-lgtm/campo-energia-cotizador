function buildItem(catalogService, modelo, cantidad, nota = "") {
  const item = catalogService.getItem(modelo);
  if (!item) {
    return {
      modelo,
      descripcion: `${modelo} (no encontrado en catálogo)`,
      categoria: "SIN_CLASIFICAR",
      cantidad,
      precio_venta_usd: 0,
      subtotal_usd: 0,
      iva: 0.21,
      iva105_usd: 0,
      iva21_usd: 0,
      total_usd: 0,
      nota
    };
  }

  const qty = Number(cantidad) || 0;
  const unit = Number(item.precio_venta_usd) || 0;
  const subtotal = Number((unit * qty).toFixed(2));
  const ivaRate = typeof item.iva === "number" ? item.iva : 0.21;
  const iva105 =
    Math.abs(ivaRate - 0.105) < 1e-6 ? Number((subtotal * 0.105).toFixed(2)) : 0;
  const iva21 =
    Math.abs(ivaRate - 0.21) < 1e-6 ? Number((subtotal * 0.21).toFixed(2)) : 0;
  const total = Number((subtotal + iva105 + iva21).toFixed(2));

  return {
    modelo: item.modelo,
    descripcion: item.descripcion_corta || item.descripcion,
    categoria: item.categoria,
    cantidad: qty,
    precio_venta_usd: unit,
    subtotal_usd: subtotal,
    iva: ivaRate,
    iva105_usd: iva105,
    iva21_usd: iva21,
    total_usd: total,
    nota
  };
}

function summarizeItems(items, dolarArs = 1625) {
  const netoUsd = Number(
    items.reduce((acc, it) => acc + (it.subtotal_usd || 0), 0).toFixed(2)
  );
  const iva105Usd = Number(
    items.reduce((acc, it) => acc + (it.iva105_usd || 0), 0).toFixed(2)
  );
  const iva21Usd = Number(
    items.reduce((acc, it) => acc + (it.iva21_usd || 0), 0).toFixed(2)
  );
  const totalUsd = Number((netoUsd + iva105Usd + iva21Usd).toFixed(2));
  const tc = Number(dolarArs) || 1;

  return {
    neto_usd: netoUsd,
    iva105_usd: iva105Usd,
    iva21_usd: iva21Usd,
    total_usd: totalUsd,
    total_ars: Math.round(totalUsd * tc),
    dolar_ars: tc
  };
}

function normCategoria(cat) {
  return String(cat || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function matchTipoBateria(item, tipoBateria) {
  const texto =
    `${item?.modelo || ""} ${item?.descripcion || ""} ${item?.tec?.tipo || ""} ${item?.tec?.subcategoria || ""}`.toUpperCase();
  if (tipoBateria === "LITIO") {
    return texto.includes("LITIO") || texto.includes("LIFEPO4");
  }
  if (tipoBateria === "GEL") {
    return texto.includes("GEL");
  }
  if (tipoBateria === "AGM") {
    return texto.includes("AGM");
  }
  return true;
}

function getBateriaVoltaje(item) {
  const tec = item?.tec || {};
  const directo = Number(tec.vdcbatt || tec.vdcbat || tec.sist_tension || 0);
  if ([12, 24, 48].includes(directo)) return directo;

  const texto = `${item?.modelo || ""} ${item?.descripcion || ""}`.toUpperCase();
  if (/\b48\s*V\b|-48\b/.test(texto)) return 48;
  if (/\b24\s*V\b|-24\b/.test(texto)) return 24;
  if (/\b12\s*V\b|-12\b/.test(texto)) return 12;
  return 12;
}

function getPanelWp(item) {
  const tec = item?.tec || {};
  const directo = Number(tec.wp || tec.WP || tec.potencia_w || 0);
  if (directo > 0) return directo;

  const texto = `${item?.modelo || ""} ${item?.descripcion || ""}`;
  const matchW = texto.match(/(\d{3})\s*W(?:p)?\b/i);
  if (matchW) {
    const w = Number(matchW[1]);
    if (w >= 100 && w <= 800) return w;
  }
  return 0;
}

function getInversorKw(item) {
  const tec = item?.tec || {};
  const directo = Number(
    tec.kw || tec.potenciakw || tec.potencia_kw || tec.kvapico || 0
  );
  if (directo > 0) return directo;

  const texto = `${item?.modelo || ""} ${item?.descripcion || ""}`;
  const matchKw = texto.match(/(\d+(?:[.,]\d+)?)\s*k?w\b/i);
  if (matchKw) {
    const val = Number(matchKw[1].replace(",", "."));
    if (val > 0) return val >= 100 ? val / 1000 : val;
  }
  return 0;
}

function getInversorVdc(item) {
  const tec = item?.tec || {};
  const directo = Number(tec.vdcbatt || tec.vdcbat || tec.sist_tension || 0);
  if ([12, 24, 48].includes(directo)) return directo;

  const texto = `${item?.modelo || ""} ${item?.descripcion || ""}`.toUpperCase();
  if (/\b48\s*V\b|VDC\s*48/.test(texto)) return 48;
  if (/\b24\s*V\b|VDC\s*24/.test(texto)) return 24;
  if (/\b12\s*V\b|VDC\s*12/.test(texto)) return 12;
  return null;
}

export function calcularOffGrid(catalogService, state) {
  const params = catalogService.getParametros() || {};
  const reglas = params.reglas_ingenieria || {};

  const consumos =
    Array.isArray(state.consumos) && state.consumos.length > 0
      ? state.consumos
      : Array.isArray(params.consumos_base)
        ? params.consumos_base
        : [];

  const simultaneidad = Number(state.factor_simultaneidad) || 0.8;
  const diasAutonomia = Math.max(1, Number(state.dias_autonomia) || 1);
  const hsp = Math.max(1, Number(state.hsp) || 4.5);
  const perdidasFactor = Math.max(
    0.5,
    1 - Math.min(0.5, Math.max(0, (Number(state.perdidas_pct) ?? 15) / 100))
  );
  const rendimiento = Number(reglas.rendimiento_trabajo_offgrid) || 0.8;
  const tensionSistemaV = Number(state.tension_sistema_v) || 48;

  const energiaBrutaWh = consumos.reduce((acc, c) => {
    const cant = Number(c.cantidad) || 0;
    const pot = Number(c.potencia_w) || 0;
    const hs = Number(c.horas_dia) || 0;
    return acc + cant * pot * hs;
  }, 0);

  const potenciaTotalW = consumos.reduce((acc, c) => {
    const cant = Number(c.cantidad) || 0;
    const pot = Number(c.potencia_w) || 0;
    return acc + cant * pot;
  }, 0);

  const consumoMensualInputKwh = Number(state.consumo_mensual_kwh) || 0;
  const energiaPorConsumosKwh = Number(
    ((energiaBrutaWh * simultaneidad) / 1000).toFixed(2)
  );
  const energiaDiariaKwh =
    energiaPorConsumosKwh > 0
      ? energiaPorConsumosKwh
      : Number(((consumoMensualInputKwh / 30) * simultaneidad).toFixed(2));

  const potenciaSimultaneaKw =
    potenciaTotalW > 0
      ? Number(((potenciaTotalW * simultaneidad) / 1000).toFixed(2))
      : Number(Math.max(1, energiaDiariaKwh / 4).toFixed(2));

  // 1. Selección de batería estrictamente en categoría BATERIAS + topología Serie/Paralelo
  const tipoBateria = String(state.tipo_bateria || "LITIO").toUpperCase();
  const dodDefault =
    reglas.dod_por_bateria?.[tipoBateria] !== undefined
      ? Math.round(Number(reglas.dod_por_bateria[tipoBateria]) * 100)
      : tipoBateria === "LITIO"
        ? 80
        : 50;
  const dodPct = Number(state.dod_pct) > 0 ? Number(state.dod_pct) : dodDefault;
  const dod = Math.min(0.95, Math.max(0.15, dodPct / 100));

  const energiaBancoRequeridaKwh =
    (energiaDiariaKwh * diasAutonomia) / (dod * rendimiento);

  const bateriasCandidatas = catalogService
    .getAllItems()
    .filter(
      (it) =>
        normCategoria(it.categoria) === "BATERIAS" &&
        it.activo !== false &&
        (Number(it.precio_venta_usd) || 0) > 0 &&
        matchTipoBateria(it, tipoBateria)
    )
    .map((it) => {
      const vBat = getBateriaVoltaje(it);
      const compatible = tensionSistemaV % vBat === 0;
      const enSerie = compatible
        ? Math.max(1, Math.round(tensionSistemaV / vBat))
        : 1;
      const ah = Number(it.tec?.batah || it.tec?.bat_ah || 0);
      const kwhUnit =
        Number(it.tec?.kwh || it.tec?.energiakwh) ||
        (ah > 0 ? (vBat * ah) / 1000 : (vBat * 100) / 1000);
      const minUnidades = Math.max(
        1,
        Math.ceil(energiaBancoRequeridaKwh / Math.max(0.5, kwhUnit))
      );
      const paralelos = Math.max(1, Math.ceil(minUnidades / enSerie));
      const totalUnidades = enSerie * paralelos;
      const capacidadTotal = Number((totalUnidades * kwhUnit).toFixed(2));
      const costoTotal = totalUnidades * (Number(it.precio_venta_usd) || 0);

      return {
        item: it,
        compatible,
        vBat,
        enSerie,
        paralelos,
        totalUnidades,
        kwhUnit,
        capacidadTotal,
        costoTotal
      };
    })
    .filter((c) => c.compatible)
    .sort((a, b) => {
      if (a.paralelos !== b.paralelos) return a.paralelos - b.paralelos;
      return a.costoTotal - b.costoTotal;
    });

  const mejorBanco = bateriasCandidatas[0] || null;
  const bateriaSeleccionada = mejorBanco?.item || null;
  const unidadesEnSerie = mejorBanco?.enSerie || 1;
  const ramasParalelo = mejorBanco?.paralelos || 1;
  const cantBaterias = mejorBanco?.totalUnidades || 1;
  const kwhPorBateria = mejorBanco?.kwhUnit || 1.2;
  const capacidadBancoKwh = mejorBanco?.capacidadTotal || 1.2;
  const topologiaBanco = `${unidadesEnSerie}S${ramasParalelo}P (${tensionSistemaV}V)`;

  // 2. Dimensionamiento solar desde paneles activos del catálogo
  const panelesActivos =
    typeof catalogService.getPanelesActivos === "function"
      ? catalogService.getPanelesActivos()
      : [];

  const panelesCatalogo = (
    panelesActivos.length > 0 ? panelesActivos : catalogService.getAllItems()
  )
    .filter((it) => {
      const cat = normCategoria(it.categoria);
      return (
        cat.includes("PANEL") &&
        it.activo !== false &&
        (Number(it.precio_venta_usd) || 0) > 0
      );
    })
    .sort((a, b) => (getPanelWp(b) || 580) - (getPanelWp(a) || 580));

  const panelSeleccionado = panelesCatalogo[0] || null;
  const wpPanel = getPanelWp(panelSeleccionado) || 580;
  const kwpRequerido =
    energiaDiariaKwh / (rendimiento * perdidasFactor) / hsp;
  const cantPaneles = Math.max(1, Math.ceil((kwpRequerido * 1000) / wpPanel));
  const potenciaPicoKw = Number(((cantPaneles * wpPanel) / 1000).toFixed(2));

  // 3. Selección de inversor Off-Grid compatible con tensionSistemaV
  const factorPico = Number(reglas.factor_inversor_critico) || 1.25;
  const potRequeridaKw = Math.max(
    potenciaSimultaneaKw * factorPico,
    tensionSistemaV >= 24 ? 3 : 1
  );

  const inversoresActivos = catalogService
    .getAllItems()
    .filter((it) => {
      if (it.activo === false || (Number(it.precio_venta_usd) || 0) <= 0) {
        return false;
      }
      const cat = normCategoria(it.categoria);
      const desc = `${it.modelo || ""} ${it.descripcion || ""}`.toUpperCase();
      const esInversor =
        cat.includes("EQUIPO") ||
        cat.includes("INVERSOR") ||
        desc.includes("INVERSOR") ||
        desc.includes("OFFGRID") ||
        desc.includes("OFF-GRID") ||
        desc.includes("AXPERT");
      if (!esInversor) return false;

      const vdc = getInversorVdc(it);
      return vdc === null || vdc === tensionSistemaV;
    })
    .map((it) => ({ item: it, kw: getInversorKw(it) }))
    .filter((x) => x.kw > 0)
    .sort((a, b) => a.kw - b.kw);

  const elegidoObj =
    inversoresActivos.find((x) => x.kw >= potRequeridaKw) ||
    inversoresActivos[inversoresActivos.length - 1] ||
    null;

  const inversorSeleccionado = elegidoObj?.item || null;
  const potInversorKw =
    elegidoObj?.kw || Math.max(potRequeridaKw, Math.ceil(potenciaSimultaneaKw));

  const alertaDescarga =
    potInversorKw > 0.5 * capacidadBancoKwh
      ? `Potencia de inversor (${potInversorKw} kW) supera el 50% de la capacidad del banco (${capacidadBancoKwh} kWh): considerar ampliar baterías o moderar picos.`
      : null;

  const items = [];
  if (panelSeleccionado) {
    items.push(
      buildItem(
        catalogService,
        panelSeleccionado.modelo,
        cantPaneles,
        `${wpPanel} Wp`
      )
    );
  }
  if (bateriaSeleccionada) {
    items.push(
      buildItem(
        catalogService,
        bateriaSeleccionada.modelo,
        cantBaterias,
        `${tipoBateria} · ${topologiaBanco} · ${kwhPorBateria} kWh c/u`
      )
    );
  }
  if (inversorSeleccionado) {
    items.push(
      buildItem(
        catalogService,
        inversorSeleccionado.modelo,
        1,
        `Sistema Off-Grid ${tensionSistemaV}V`
      )
    );
  }

  const kitElec = catalogService.getKitReceta("OFFGRID_TABLERO_ELEC_FULL");
  if (kitElec) {
    for (const comp of kitElec.items) {
      items.push(
        buildItem(catalogService, comp.item, comp.cantidad, kitElec.kit)
      );
    }
  }

  if (!state.solo_materiales) {
    const tipoInst = String(state.tipo_instalacion_paneles || "TECHO").toUpperCase();
    const kitMo =
      tipoInst === "SUELO" ? "MO_ESTRU_SUELO_xP" : "MO_ESTRU_TECHO_CxP";
    if (catalogService.getKitReceta(kitMo)) {
      for (const comp of catalogService.getKitReceta(kitMo).items) {
        const qty = comp.por_panel ? comp.cantidad * cantPaneles : comp.cantidad;
        items.push(buildItem(catalogService, comp.item, qty, kitMo));
      }
    }

    const kms = Number(state.kms_ubicacion) || 0;
    const factorKm = Number(reglas.factor_viaticos_km) || 0.8;
    if (kms > 0 && catalogService.getItem("VIATICOS_KM")) {
      items.push(
        buildItem(
          catalogService,
          "VIATICOS_KM",
          Number((kms * factorKm).toFixed(1)),
          `${kms} km`
        )
      );
    }
  }

  const totales = summarizeItems(items, state.dolar_ars);

  return {
    sistema: "OFF-GRID",
    items,
    resumenTecnico: {
      energia_diaria_kwh: energiaDiariaKwh,
      potencia_simultanea_kw: potenciaSimultaneaKw,
      dias_autonomia: diasAutonomia,
      tipo_bateria: tipoBateria,
      topologia_banco: topologiaBanco,
      dod_pct: dodPct,
      capacidad_banco_kwh: capacidadBancoKwh,
      cantidad_baterias: cantBaterias,
      potencia_pico_kwp: potenciaPicoKw,
      cantidad_paneles: cantPaneles,
      inversor_modelo: inversorSeleccionado?.modelo || null,
      alerta_descarga_bateria: alertaDescarga
    },
    totales
  };
}
