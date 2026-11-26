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

function summarizeItems(items, dolarArs = 1590) {
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

export function calcularOffGrid(catalogService, state) {
  const params = catalogService.getParametros();
  const reglas = params.reglas_ingenieria || {};

  const consumos = Array.isArray(state.consumos) ? state.consumos : [];
  const simultaneidad = Number(state.factor_simultaneidad) || 0.8;
  const diasAutonomia = Math.max(1, Number(state.dias_autonomia) || 1);
  const hsp = Number(state.hsp) || 4.5;
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

  const potenciaSimultaneaKw = Number(
    ((potenciaTotalW * simultaneidad) / 1000).toFixed(2)
  );
  const energiaDiariaKwh = Number(
    ((energiaBrutaWh * simultaneidad) / 1000).toFixed(2)
  );

  // Selección de batería
  const dodPct = Number(state.dod_pct) || 80;
  const dod = Math.min(0.95, Math.max(0.2, dodPct / 100));
  const esLitio = dod >= 0.7;

  const baterias = catalogService
    .getAllItems()
    .filter((it) => {
      const cat = String(it.categoria).toUpperCase();
      const desc = `${it.modelo} ${it.descripcion}`.toUpperCase();
      const esBat = cat.includes("BATER") || desc.includes("BATER");
      if (!esBat) return false;
      const esBatLitio = desc.includes("LITIO") || desc.includes("LIFEPO4");
      return esLitio ? esBatLitio : !esBatLitio;
    });

  const bateriaSeleccionada = baterias[0] || null;
  const kwhPorBateria =
    Number(bateriaSeleccionada?.tec?.kwh) ||
    (esLitio ? 4.8 : (tensionSistemaV * 100) / 1000);

  const energiaBancoRequeridaKwh =
    (energiaDiariaKwh * diasAutonomia) / (dod * rendimiento);
  const cantBaterias = Math.max(
    1,
    Math.ceil(energiaBancoRequeridaKwh / Math.max(0.5, kwhPorBateria))
  );
  const capacidadBancoKwh = Number(
    (cantBaterias * kwhPorBateria).toFixed(2)
  );

  // Dimensionamiento solar (paneles)
  const paneles = catalogService
    .getAllItems()
    .filter((it) => String(it.categoria).toUpperCase().includes("PANEL"));
  const panelSeleccionado =
    paneles.find((p) => Number(p.tec?.wp || p.tec?.WP || 0) >= 450) ||
    paneles[0] ||
    null;
  const wpPanel = Number(
    panelSeleccionado?.tec?.wp || panelSeleccionado?.tec?.WP || 585
  );
  const kwpRequerido =
    (energiaDiariaKwh / rendimiento) / Math.max(1, hsp);
  const cantPaneles = Math.max(
    1,
    Math.ceil((kwpRequerido * 1000) / wpPanel)
  );
  const potenciaPicoKw = Number(((cantPaneles * wpPanel) / 1000).toFixed(2));

  // Selección de inversor Off-Grid / Cargador
  const inversores = catalogService
    .getAllItems()
    .filter((it) => {
      const cat = String(it.categoria).toUpperCase();
      const desc = `${it.modelo} ${it.descripcion}`.toUpperCase();
      return (
        cat.includes("EQUIPO") ||
        desc.includes("INVERSOR") ||
        desc.includes("OFFGRID") ||
        desc.includes("OFF-GRID")
      );
    })
    .sort(
      (a, b) =>
        (Number(a.tec?.potencia_kw || a.tec?.kw || 0) || 0) -
        (Number(b.tec?.potencia_kw || b.tec?.kw || 0) || 0)
    );

  const inversorSeleccionado =
    inversores.find(
      (inv) =>
        (Number(inv.tec?.potencia_kw || inv.tec?.kw || 0) || 0) >=
        potenciaSimultaneaKw
    ) ||
    inversores[inversores.length - 1] ||
    null;

  const potInversorKw =
    Number(inversorSeleccionado?.tec?.potencia_kw || inversorSeleccionado?.tec?.kw) ||
    Math.max(3, Math.ceil(potenciaSimultaneaKw));

  const alertaDescarga =
    potInversorKw > 0.5 * capacidadBancoKwh
      ? `Potencia de inversor (${potInversorKw} kW) supera el 50% de la capacidad del banco (${capacidadBancoKwh} kWh): considerar ampliar baterías o moderar picos.`
      : null;

  const items = [];
  if (panelSeleccionado) {
    items.push(
      buildItem(catalogService, panelSeleccionado.modelo, cantPaneles, `${wpPanel} Wp`)
    );
  }
  if (bateriaSeleccionada) {
    items.push(
      buildItem(
        catalogService,
        bateriaSeleccionada.modelo,
        cantBaterias,
        `${kwhPorBateria} kWh c/u`
      )
    );
  }
  if (inversorSeleccionado) {
    items.push(
      buildItem(catalogService, inversorSeleccionado.modelo, 1, "Sistema Off-Grid")
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
