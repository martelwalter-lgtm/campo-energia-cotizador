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

/**
 * Calcula un presupuesto manual a partir de líneas seleccionadas por el usuario
 * y/o kits comerciales cerrados (KIT_VENTAS).
 *
 * @param {CatalogService} catalogService
 * @param {Object} state
 * @param {Array<{modelo: string, cantidad: number, nota?: string}>} lineasManuales
 */
export function calcularManual(catalogService, state, lineasManuales = []) {
  const items = [];

  for (const linea of lineasManuales) {
    if (!linea?.modelo || !(Number(linea.cantidad) > 0)) continue;

    // Si el código corresponde a un kit cerrado de KIT_VENTAS, lo desglosa o agrega
    const kitVenta = catalogService.getKitVenta(linea.modelo);
    if (kitVenta && Array.isArray(kitVenta.componentes)) {
      for (const comp of kitVenta.componentes) {
        items.push(
          buildItem(
            catalogService,
            comp.modelo,
            (Number(comp.cantidad) || 1) * Number(linea.cantidad),
            `Kit ${kitVenta.kit_id}`
          )
        );
      }
      continue;
    }

    items.push(
      buildItem(
        catalogService,
        linea.modelo,
        Number(linea.cantidad),
        linea.nota || ""
      )
    );
  }

  // Agrupación de subtotales por categoría
  const subtotalesPorCategoria = {};
  for (const it of items) {
    const cat = it.categoria || "OTROS";
    if (!subtotalesPorCategoria[cat]) {
      subtotalesPorCategoria[cat] = {
        categoria: cat,
        neto_usd: 0,
        iva_usd: 0,
        total_usd: 0
      };
    }
    subtotalesPorCategoria[cat].neto_usd = Number(
      (subtotalesPorCategoria[cat].neto_usd + it.subtotal_usd).toFixed(2)
    );
    subtotalesPorCategoria[cat].iva_usd = Number(
      (
        subtotalesPorCategoria[cat].iva_usd +
        it.iva105_usd +
        it.iva21_usd
      ).toFixed(2)
    );
    subtotalesPorCategoria[cat].total_usd = Number(
      (subtotalesPorCategoria[cat].total_usd + it.total_usd).toFixed(2)
    );
  }

  const totales = summarizeItems(items, state.dolar_ars);

  return {
    sistema: "MANUAL",
    items,
    resumenTecnico: {
      cantidad_lineas: items.length,
      subtotales_por_categoria: Object.values(subtotalesPorCategoria)
    },
    totales
  };
}
