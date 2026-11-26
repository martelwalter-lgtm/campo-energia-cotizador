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

export function calcularHibrido(catalogService, state) {
  const params = catalogService.getParametros() || {};
  const reglas = params.reglas_ingenieria || {};

  const consumoMensual = Number(state.consumo_mensual_kwh) || 75;
  const cobertura = (Number(state.cobertura_ongrid_pct) || 50) / 100;
  const hsp = Math.max(1, Number(state.hsp) || 4.5);
  const perdidasPct = Number(state.perdidas_pct) || 15;
  const factorEficiencia = Math.max(0.1, 1 - perdidasPct / 100);

  const potenciaCriticaW = Number(state.potencia_critica_w) || 600;
  const horasAutonomiaCritica = Number(state.horas_autonomia_critica) || 12;
  const factorInversorCritico = Number(reglas.factor_inversor_critico) || 1.25;
  const dodLitio = Number(reglas.dod_por_bateria?.LITIO) || 0.8;

  // 1. Potencia mínima del inversor híbrido por carga crítica
  const inversorMinKw = Number(
    ((potenciaCriticaW * factorInversorCritico) / 1000).toFixed(2)
  );

  // 2. Campo solar según consumo objetivo diario y paneles activos en Google Sheets
  const energiaObjetivoDia = (consumoMensual * cobertura) / 30;
  const kwpRequerido = energiaObjetivoDia / (hsp * factorEficiencia);

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

  // 3. Selección de inversor híbrido activo
  const esTrifasico = String(state.tension || "")
    .toLowerCase()
    .includes("tri");

  const inversoresHibridos = catalogService
    .getAllItems()
    .filter((it) => {
      if (it.activo === false || (Number(it.precio_venta_usd) || 0) <= 0) {
        return false;
      }
      const cat = String(it.categoria || "").toUpperCase();
      const desc = `${it.modelo || ""} ${it.descripcion || ""}`.toUpperCase();
      const esInv = cat.includes("EQUIPO") || desc.includes("INVERSOR");
      const esHib = desc.includes("HIBRID") || desc.includes("HÍBRID");
      const matchFase = esTrifasico
        ? desc.includes("3F") || desc.includes("TRIF")
        : !desc.includes("3F") && !desc.includes("TRIF");
      return esInv && esHib && matchFase;
    })
    .map((it) => ({ item: it, kw: getInversorKw(it) }))
    .filter((x) => x.kw > 0)
    .sort((a, b) => a.kw - b.kw);

  const potenciaRequeridaInv = Math.max(inversorMinKw, potenciaPicoKw * 0.8);
  const elegidoHib =
    inversoresHibridos.find((x) => x.kw >= potenciaRequeridaInv) ||
    inversoresHibridos[inversoresHibridos.length - 1] ||
    null;

  const inversorSeleccionado = elegidoHib?.item || null;

  // 4. Banco de baterías de litio 48V activo para respaldo crítico / nocturno
  const energiaCriticaKwh =
    (potenciaCriticaW * horasAutonomiaCritica) / 1000;
  const respaldoNocturnoKwh =
    energiaObjetivoDia * ((Number(state.respaldo_nocturno_pct) || 40) / 100);
  const energiaRespaldoObjetivo = Math.max(
    energiaCriticaKwh,
    respaldoNocturnoKwh
  );

  const bateriasLitio = catalogService.getAllItems().filter((it) => {
    if (it.activo === false || (Number(it.precio_venta_usd) || 0) <= 0) {
      return false;
    }
    const cat = String(it.categoria || "").toUpperCase();
    const desc = `${it.modelo || ""} ${it.descripcion || ""}`.toUpperCase();
    if (desc.startsWith("TIPO DE BATER")) return false;
    return (
      (cat.includes("BATER") || desc.includes("BATER")) &&
      (desc.includes("LITIO") || desc.includes("LIFEPO4") || desc.includes("48V"))
    );
  });

  const bateriaSeleccionada = bateriasLitio[0] || null;
  const kwhPorBateria =
    Number(bateriaSeleccionada?.tec?.kwh || bateriaSeleccionada?.tec?.energiakwh) ||
    4.8;
  const cantBaterias = Math.max(
    1,
    Math.ceil(energiaRespaldoObjetivo / (dodLitio * kwhPorBateria))
  );
  const capacidadBancoKwh = Number((cantBaterias * kwhPorBateria).toFixed(2));

  const items = [];
  if (panelSeleccionado) {
    items.push(
      buildItem(catalogService, panelSeleccionado.modelo, cantPaneles, `${wpPanel} Wp`)
    );
  }
  if (inversorSeleccionado) {
    items.push(
      buildItem(catalogService, inversorSeleccionado.modelo, 1, "Inversor Híbrido")
    );
  }
  if (bateriaSeleccionada) {
    items.push(
      buildItem(
        catalogService,
        bateriaSeleccionada.modelo,
        cantBaterias,
        `Litio 48V (${kwhPorBateria} kWh c/u)`
      )
    );
  }

  // Kit eléctrico (usa receta híbrida si existe, o fallback a tablero offgrid/ongrid)
  const kitElec =
    catalogService.getKitReceta("HIBRIDO_TABLERO_ELEC") ||
    catalogService.getKitReceta("OFFGRID_TABLERO_ELEC_FULL");
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

  const generacionMensualKwh = Math.round(
    potenciaPicoKw * hsp * 30 * factorEficiencia
  );
  const autonomiaEstimadaHoras =
    potenciaCriticaW > 0
      ? Number(
          ((capacidadBancoKwh * dodLitio * 1000) / potenciaCriticaW).toFixed(1)
        )
      : null;

  const totales = summarizeItems(items, state.dolar_ars);

  return {
    sistema: "HÍBRIDO",
    items,
    resumenTecnico: {
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
      inversor_min_critico_kw: inversorMinKw,
      capacidad_banco_kwh: capacidadBancoKwh,
      cantidad_baterias: cantBaterias,
      potencia_critica_w: potenciaCriticaW,
      autonomia_critica_estimada_hs: autonomiaEstimadaHoras,
      generacion_mensual_kwh: generacionMensualKwh
    },
    totales
  };
}
