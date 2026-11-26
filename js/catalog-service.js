const STORAGE_KEY_OVERRIDES = "ce_cotizador_price_overrides_v1";

function parseCsvLine(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text) {
  const cleanText = String(text || "").replace(/^\uFEFF/, "");
  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cols[idx] ?? "";
    });
    return row;
  });
}

function toNumber(val, fallback = null) {
  if (val === undefined || val === null || String(val).trim() === "") {
    return fallback;
  }
  const normalized = String(val)
    .replace(/\$/g, "")
    .replace(/US/gi, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeMargin(val) {
  const n = toNumber(val, 0);
  return n > 1 ? n / 100 : n;
}

function normalizeIva(val) {
  const n = toNumber(val, 0.21);
  return n > 1 ? n / 100 : n;
}

export class CatalogService {
  constructor({
    kitsUrl = "./data/kits_y_mo.json",
    parametrosUrl = "./data/parametros_ingenieria.json",
    sheetsPreciosCsvUrl = "",
    sheetsProveedoresCsvUrl = ""
  } = {}) {
    this.kitsUrl = kitsUrl;
    this.parametrosUrl = parametrosUrl;
    this.sheetsPreciosCsvUrl = sheetsPreciosCsvUrl;
    this.sheetsProveedoresCsvUrl = sheetsProveedoresCsvUrl;

    this.proveedores = {};
    this.catalogo = [];
    this.catalogoByModelo = new Map();
    this.kitsReceta = {};
    this.kitsVentas = {};
    this.parametros = {};
    this.fuenteDatos = "Google Sheets";
    this.overrides = this._loadOverrides();
  }

  _loadOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OVERRIDES);
      return raw ? JSON.parse(raw) : { margins: {}, prices: {} };
    } catch {
      return { margins: {}, prices: {} };
    }
  }

  _saveOverrides() {
    try {
      localStorage.setItem(STORAGE_KEY_OVERRIDES, JSON.stringify(this.overrides));
    } catch (err) {
      console.warn("No se pudieron guardar ajustes temporales de sesión:", err);
    }
  }

  _mapSheetsRowsToCatalogo(preciosRows, proveedoresRows) {
    const proveedores = {};
    for (const r of proveedoresRows) {
      const prov = String(r.Proveedor || r.proveedor || "").trim();
      if (!prov) continue;
      proveedores[prov] = normalizeMargin(r.Margen ?? r.margen ?? 0);
    }

    const catalogo = [];
    for (const r of preciosRows) {
      const modelo = String(r.Modelo || r.modelo || "").trim();
      if (!modelo) continue;

      const prov = String(r.Proveedor || r.proveedor || "").trim();
      const desc = String(r.Descripcion || r.descripcion || modelo).trim();
      const descCorta = String(
        r.Descripcion_Corta || r.descripcion_corta || desc
      ).trim();
      const cat = String(r.Categoria || r.categoria || "GENERAL").trim();
      const ivaRate = normalizeIva(r.IVA ?? r.iva ?? 0.21);

      const costoBase = toNumber(r.Costo_Base_USD ?? r.costo_base_usd, null);
      const descPctRaw = toNumber(r.Descuento_Pct ?? r.descuento_pct, 0);
      const descPct = descPctRaw > 1 ? descPctRaw / 100 : descPctRaw;
      const margen = proveedores[prov] ?? 0;

      const costoUnit =
        costoBase !== null
          ? Number((costoBase * (1 - descPct)).toFixed(4))
          : toNumber(r.Costo_Unit_USD ?? r.costo_unit_usd, null);

      let precioVenta = toNumber(
        r.Precio_Venta_USD ?? r.precio_venta_usd,
        null
      );
      if (precioVenta === null && costoUnit !== null) {
        precioVenta = Number((costoUnit * (1 + margen)).toFixed(4));
      }

      const iva105 =
        precioVenta !== null && Math.abs(ivaRate - 0.105) < 1e-6
          ? Number((precioVenta * 0.105).toFixed(4))
          : 0;
      const iva21 =
        precioVenta !== null && Math.abs(ivaRate - 0.21) < 1e-6
          ? Number((precioVenta * 0.21).toFixed(4))
          : 0;
      const precioFinal =
        precioVenta !== null
          ? Number((precioVenta + iva105 + iva21).toFixed(4))
          : null;

      const tec = {};
      for (const [k, v] of Object.entries(r)) {
        const keyLower = k.toLowerCase();
        if (
          [
            "wp",
            "voc",
            "isc",
            "vmp",
            "imp",
            "kwh",
            "potencia_kw",
            "kw",
            "vmppt_min",
            "vmppt_max",
            "tension_v",
            "vdc"
          ].includes(keyLower) &&
          String(v).trim() !== ""
        ) {
          tec[keyLower] = toNumber(v, v);
        }
      }

      catalogo.push({
        modelo,
        proveedor: prov,
        margen,
        descripcion: desc,
        descripcion_corta: descCorta,
        categoria: cat,
        iva: ivaRate,
        costo_base_usd: costoBase,
        descuento_pct: descPct,
        costo_unit_usd: costoUnit,
        precio_venta_usd: precioVenta,
        iva105_usd: iva105,
        iva21_usd: iva21,
        precio_final_usd: precioFinal,
        tec
      });
    }

    return { proveedores, catalogo };
  }

  async init() {
    const [kitsResp, paramsResp] = await Promise.all([
      fetch(this.kitsUrl),
      fetch(this.parametrosUrl)
    ]);

    if (!kitsResp.ok || !paramsResp.ok) {
      throw new Error("Error al cargar kits_y_mo.json o parametros_ingenieria.json.");
    }

    const kitsJson = await kitsResp.json();
    const paramsJson = await paramsResp.json();

    this.kitsReceta = kitsJson.kits_receta || {};
    this.kitsVentas = kitsJson.kits_ventas || {};
    this.parametros = paramsJson || {};

    const sheetsPreciosUrl = String(
      this.sheetsPreciosCsvUrl ||
        this.parametros.fuentes_datos?.google_sheets_precios_csv ||
        ""
    ).trim();
    const sheetsProvUrl = String(
      this.sheetsProveedoresCsvUrl ||
        this.parametros.fuentes_datos?.google_sheets_proveedores_csv ||
        ""
    ).trim();

    if (!sheetsPreciosUrl || sheetsPreciosUrl.startsWith("PEGA_AQUI")) {
      throw new Error(
        "Falta configurar google_sheets_precios_csv en data/parametros_ingenieria.json. Google Sheets es la única fuente de precios."
      );
    }

    const preciosBust = `${sheetsPreciosUrl}${sheetsPreciosUrl.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    const preciosResp = await fetch(preciosBust);
    if (!preciosResp.ok) {
      throw new Error(
        `No se pudo leer PRECIOS desde Google Sheets (HTTP ${preciosResp.status}).`
      );
    }
    const preciosRows = parseCsv(await preciosResp.text());

    let proveedoresRows = [];
    if (sheetsProvUrl && !sheetsProvUrl.startsWith("PEGA_AQUI")) {
      const provBust = `${sheetsProvUrl}${sheetsProvUrl.includes("?") ? "&" : "?"}_t=${Date.now()}`;
      const provResp = await fetch(provBust);
      if (!provResp.ok) {
        throw new Error(
          `No se pudo leer PROVEEDORES desde Google Sheets (HTTP ${provResp.status}).`
        );
      }
      proveedoresRows = parseCsv(await provResp.text());
    }

    const mapped = this._mapSheetsRowsToCatalogo(preciosRows, proveedoresRows);
    if (mapped.catalogo.length === 0) {
      throw new Error("La pestaña PRECIOS en Google Sheets no devolvió ítems válidos.");
    }

    this.proveedores = mapped.proveedores;
    this.catalogo = mapped.catalogo;
    this.fuenteDatos = "Google Sheets";

    this._rebuildIndex();
    return this;
  }

  _rebuildIndex() {
    this.catalogoByModelo.clear();
    for (const item of this.catalogo) {
      if (!item?.modelo) continue;

      const margenOverride = this.overrides.margins?.[item.proveedor];
      const precioOverride = this.overrides.prices?.[item.modelo];

      const margenEfectivo =
        typeof margenOverride === "number" ? margenOverride : (item.margen ?? 0);

      let precioVentaUsd = item.precio_venta_usd;
      if (typeof precioOverride === "number") {
        precioVentaUsd = precioOverride;
      } else if (
        typeof item.costo_unit_usd === "number" &&
        typeof margenOverride === "number"
      ) {
        precioVentaUsd = Number(
          (item.costo_unit_usd * (1 + margenEfectivo)).toFixed(4)
        );
      }

      const ivaRate = typeof item.iva === "number" ? item.iva : 0.21;
      const iva105Usd =
        typeof precioVentaUsd === "number" && Math.abs(ivaRate - 0.105) < 1e-6
          ? Number((precioVentaUsd * 0.105).toFixed(4))
          : 0;
      const iva21Usd =
        typeof precioVentaUsd === "number" && Math.abs(ivaRate - 0.21) < 1e-6
          ? Number((precioVentaUsd * 0.21).toFixed(4))
          : 0;
      const precioFinalUsd =
        typeof precioVentaUsd === "number"
          ? Number((precioVentaUsd + iva105Usd + iva21Usd).toFixed(4))
          : item.precio_final_usd;

      this.catalogoByModelo.set(item.modelo, {
        ...item,
        margen: margenEfectivo,
        precio_venta_usd: precioVentaUsd,
        iva105_usd: iva105Usd,
        iva21_usd: iva21Usd,
        precio_final_usd: precioFinalUsd
      });
    }
  }

  getItem(modelo) {
    if (!modelo) return null;
    return this.catalogoByModelo.get(String(modelo).trim()) || null;
  }

  getAllItems() {
    return Array.from(this.catalogoByModelo.values());
  }

  getKitReceta(codigoKit) {
    if (!codigoKit) return null;
    return this.kitsReceta[String(codigoKit).trim()] || null;
  }

  getKitVenta(codigoKitVenta) {
    if (!codigoKitVenta) return null;
    return this.kitsVentas[String(codigoKitVenta).trim()] || null;
  }

  getParametros() {
    return this.parametros;
  }

  getFuenteDatos() {
    return this.fuenteDatos;
  }

  setProveedorMargen(proveedor, nuevoMargen) {
    this.overrides.margins[proveedor] = Number(nuevoMargen);
    this._saveOverrides();
    this._rebuildIndex();
  }

  setItemPrecioVentaUsd(modelo, nuevoPrecioUsd) {
    this.overrides.prices[modelo] = Number(nuevoPrecioUsd);
    this._saveOverrides();
    this._rebuildIndex();
  }

  clearOverrides() {
    this.overrides = { margins: {}, prices: {} };
    this._saveOverrides();
    this._rebuildIndex();
  }
}
