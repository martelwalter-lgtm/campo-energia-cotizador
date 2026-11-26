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

export function calcularOnGrid(catalogService, state) {
  const params = catalogService.getParametros() || {};
  const consumoMensual = Number(state.consumo_mensual_kwh) || 75;
  const cobertura = (Number(state.cobertura_ongrid_pct) || 50) / 100;
  const hsp = Math.max(1, Number(state.hsp) || 4.5);
  const perdidasPct = Number(state.perdidas_pct) || 15;
  const factorEficiencia = Math.max(0.1, 1 - perdidasPct / 100);

  const energiaObjetivoDia = (consumoMensual * cobertura) / 30;
  const kwpRequerido = energiaObjetivoDia / (hsp * factorEficiencia);

  // Paneles activos desde la pestaña PRECIOS de Google Sheets
  const panelesActivos =
    typeof catalogService.getPanelesActivos === "function"
      ? catalogService.getPanelesActivos()
      : catalogService.getAllItems().filter((it) => {
          const cat = String(it.categoria || "").toUpperCase();
          return (
            it.activo !== false &&
            (Number(it.precio_venta_usd) || 0) > 0 &&
            cat.includes("PANEL") &&
            (Number(it.tec?.wp) || 0) > 0
          );
        });

  const panelSeleccionado =
    panelesActivos.find((p) => (Number(p.tec?.wp) || 0) >= 550) ||
    panelesActivos[0] ||
    null;

  const wpPanel = Number(panelSeleccionado?.tec?.wp) || 580;
  const vocPanel = Number(panelSeleccionado?.tec?.voc) || 0;
  const iscPanel = Number(panelSeleccionado?.tec?.isc) || 0;
  const vmpPanel = Number(panelSeleccionado?.tec?.vmp) || 0;
  const impPanel = Number(panelSeleccionado?.tec?.imp) || 0;

  const cantPaneles = Math.max(
    1,
    Math.ceil((kwpRequerido * 1000) / wpPanel)
  );
  const potenciaPicoKw = Number(((cantPaneles * wpPanel) / 1000).toFixed(2));

  // Inversor On-Grid activo según tensión y potencia pico
  const esTrifasico = String(state.tension || "")
    .toLowerCase()
    .includes("tri");

  const inversores = catalogService
    .getAllItems()
    .filter((it) => {
      if (it.activo === false || (Number(it.precio_venta_usd) || 0) <= 0) {
        return false;
      }
      const cat = String(it.categoria || "").toUpperCase();
      const desc = `${it.modelo || ""} ${it.descripcion || ""}`.toUpperCase();
      const esInv =
        cat.includes("EQUIPO") ||
        cat.includes("INVERSOR") ||
        desc.includes("INVERSOR");
      const esOnGrid = desc.includes("ONGRID") || desc.includes("ON-GRID");
      const matchFase = esTrifasico
        ? desc.includes("3F") || desc.includes("TRIF")
        : !desc.includes("3F") && !desc.includes("TRIF");
      return esInv && (esOnGrid || cat.includes("EQUIPO")) && matchFase;
    })
    .map((it) => ({ item: it, kw: getInversorKw(it) }))
    .filter((x) => x.kw > 0)
    .sort((a, b) => a.kw - b.kw);

  const elegidoInv =
    inversores.find((x) => x.kw >= potenciaPicoKw * 0.8) ||
    inversores[inversores.length - 1] ||
    null;

  const inversorSeleccionado = elegidoInv?.item || null;

  // Validación de tensión de string vs ventana MPPT usando Voc del panel activo
  const vmpptMin = Number(inversorSeleccionado?.tec?.vmppt_min || 0);
  const vmpptMax = Number(inversorSeleccionado?.tec?.vmppt_max || 0);
  const vocEstimadoSerie = Number((vocPanel * cantPaneles).toFixed(1));
  const alertaMppt =
    vocPanel > 0 && vmpptMax > 0 && vocEstimadoSerie > vmpptMax
      ? `Voc estimado (${vocEstimadoSerie}V) supera Vmppt máx (${vmpptMax}V): dividir en strings en paralelo.`
      : vocPanel > 0 && vmpptMin > 0 && vocEstimadoSerie < vmpptMin
        ? `Voc estimado (${vocEstimadoSerie}V) por debajo de Vmppt mín (${vmpptMin}V).`
        : null;

  const items = [];
  if (panelSeleccionado) {
    items.push(
      buildItem(
        catalogService,
        panelSeleccionado.modelo,
        cantPaneles,
        `${wpPanel} Wp c/u`
      )
    );
  }
  if (inversorSeleccionado) {
    items.push(
      buildItem(
        catalogService,
        inversorSeleccionado.modelo,
        1,
        "Inversor On-Grid"
      )
    );
  }

  // Kit eléctrico y mano de obra (salvo solo materiales)
  const kitElecModelo = esTrifasico
    ? "ONGRIDTRI_ELEC_V1"
    : "ONGRIDMONO_ELEC_V1";
  if (catalogService.getKitReceta(kitElecModelo)) {
    for (const comp of catalogService.getKitReceta(kitElecModelo).items) {
      items.push(
        buildItem(catalogService, comp.item, comp.cantidad, kitElecModelo)
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
    const factorKm =
      Number(params.reglas_ingenieria?.factor_viaticos_km) || 0.8;
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

  const generacionMensualKwh = Math.round(
    potenciaPicoKw * hsp * 30 * factorEficiencia
  );
  const generacionAnualKwh = generacionMensualKwh * 12;
  const tarifaKwh = Number(state.tarifa_kwh_ars) || 172;
  const dolarArs = Number(state.dolar_ars) || 1625;
  const ahorroAnualUsd = Number(
    ((generacionAnualKwh * tarifaKwh) / Math.max(1, dolarArs)).toFixed(2)
  );

  const totales = summarizeItems(items, dolarArs);
  const roiAnios =
    ahorroAnualUsd > 0
      ? Number((totales.total_usd / ahorroAnualUsd).toFixed(1))
      : null;

  return {
    sistema: "ON-GRID",
    items,
    resumenTecnico: {
      consumo_mensual_kwh: consumoMensual,
      cobertura_pct: Number(state.cobertura_ongrid_pct) || 50,
      hsp,
      perdidas_pct: perdidasPct,
      potencia_pico_kwp: potenciaPicoKw,
      cantidad_paneles: cantPaneles,
      panel_modelo: panelSeleccionado?.modelo || null,
      panel_specs: {
        wp: wpPanel,
        voc: vocPanel,
        isc: iscPanel,
        vmp: vmpPanel,
        imp: impPanel
      },
      inversor_modelo: inversorSeleccionado?.modelo || null,
      generacion_mensual_kwh: generacionMensualKwh,
      generacion_anual_kwh: generacionAnualKwh,
      ahorro_anual_usd: ahorroAnualUsd,
      roi_estimado_anios: roiAnios,
      alerta_mppt: alertaMppt
    },
    totales
  };
}
