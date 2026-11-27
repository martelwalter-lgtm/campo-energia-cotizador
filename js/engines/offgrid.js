// 1. Selección de batería en categoría BATERIAS + topología Serie/Paralelo óptima
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
      // Prioriza bancos sin paralelo (1 rama: ej. 2S1P) y luego menor costo total
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
