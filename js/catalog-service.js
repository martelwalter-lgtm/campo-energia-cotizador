const STORAGE_KEY_OVERRIDES = "ce_cotizador_price_overrides_v1";

export async function obtenerDolarBnaVenta(fallbackValor = 1625) {
  try {
    const resp = await fetch("https://dolarapi.com/v1/dolares/oficial", {
      cache: "no-store"
    });
    if (resp.ok) {
      const data = await resp.json();
      const venta = Number(data?.venta);
      if (Number.isFinite(venta) && venta > 0) {
        return venta;
      }
    }
  } catch {
    // Respaldo automático al valor de referencia si falla la consulta o CORS
  }
  return Number(fallbackValor) || 1625;
}

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

function normKey(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickField(row, candidates) {
  const entries = Object.entries(row);
  for (const cand of candidates) {
    const target = normKey(cand);
    const found = entries.find(([k]) => normKey(k) === target);
    if (found && String(found[1]).trim() !== "") {
      return found[1];
    }
  }
  return null;
}

function toNumber(val, fallback = null) {
  if (val === undefined || val === null || String(val).trim() === "") {
    return fallback;
  }
  let s = String(val)
    .replace(/%/g, "")
    .replace(/\$/g, "")
    .replace(/u\$s/gi, "")
    .replace(/us/gi, "")
    .replace(/\s+/g, "");

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const num = Number(s);
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
    selectorUrl = "./data/selector.json",
    sheetsPreciosCsvUrl = "",
    sheetsProveedoresCsvUrl = ""
  } = {}) {
    this.kitsUrl = kitsUrl;
    this.parametrosUrl = parametrosUrl;
    this.selectorUrl = selectorUrl;
    this.sheetsPreciosCsvUrl = sheetsPreciosCsvUrl;
    this.sheetsProveedoresCsvUrl = sheetsProveedoresCsvUrl;

    this.proveedores = {};
    this.catalogo = [];
    this.catalogoByModelo = new Map();
    this.kitsReceta = {};
    this.kitsVentas = {};
    this.parametros = {};
    this.selectorConfig = {};
    this.estadoInicial = {};
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
      const provRaw = pickField(r, ["Proveedor", "Marca"]);
      if (!provRaw) continue;
      const prov = String(provRaw).trim();
      const margenRaw = pickField(r, ["MargenProveedor", "Margen", "Margen_Proveedor"]);
      proveedores[prov] = normalizeMargin(margenRaw);
    }

    const catalogo = [];
    for (const r of preciosRows) {
      const modeloRaw = pickField(r, ["Modelo", "Codigo", "Item"]);
      if (!modeloRaw) continue;
      const modelo = String(modeloRaw).trim();

      const prov = String(pickField(r, ["Proveedor", "Marca"]) || "").trim();
      const desc = String(
        pickField(r, ["Descripcion", "Detalle", "Nombre"]) || modelo
      ).trim();
      const descCorta = String(
        pickField(r, ["Descripcion_Corta", "DescripcionCorta", "Corta"]) || desc
      ).trim();
      const cat = String(
        pickField(r, ["Categoria", "Rubro", "Tipo"]) || "GENERAL"
      ).trim();
      const ivaRate = normalizeIva(pickField(r, ["IVA", "AlicuotaIVA"]) ?? 0.21);

      const costoBase = toNumber(
        pickField(r, [
          "Costo[u$sbna]",
          "Costo_Base_USD",
          "CostoBaseUSD",
          "CostoBase",
          "Costo"
        ]),
        null
      );

      const descPctRaw = toNumber(
        pickField(r, ["Descuento[%]", "Descuento_Pct", "Descuento", "DescPct"]),
        0
      );
      const descPct = descPctRaw > 1 ? descPctRaw / 100 : descPctRaw;

      const provKeyMatch = Object.keys(proveedores).find(
        (k) => k.toLowerCase() === prov.toLowerCase()
      );
      const margen = provKeyMatch !== undefined ? proveedores[provKeyMatch] : 0;

      const costoUnitSheet = toNumber(
        pickField(r, [
          "Costo_UnitarioUSA",
          "Costo_Unit_USD",
          "CostoUnitUSD",
          "CostoUSA"
        ]),
        null
      );
      const costoUnit =
        costoUnitSheet !== null
          ? costoUnitSheet
          : costoBase !== null
            ? Number((costoBase * (1 - descPct)).toFixed(4))
            : null;

      let precioVenta = toNumber(
        pickField(r, [
          "PrecioVentaUSA",
          "Precio_Venta_USD",
          "PrecioVentaUSD",
          "PrecioVenta",
          "PV_USA"
        ]),
        null
      );

      if ((precioVenta === null || precioVenta === 0) && costoUnit !== null && costoUnit > 0) {
        precioVenta = Number((costoUnit * (1 + margen)).toFixed(4));
      }

      const iva105Sheet = toNumber(pickField(r, ["PrecioVenta_IVA105_USA"]), null);
      const iva21Sheet = toNumber(pickField(r, ["PrecioVenta_IVA21_USA"]), null);
      const precioFinalSheet = toNumber(pickField(r, ["PrecioVenta_c_ivaUSA"]), null);

      const iva105 =
        iva105Sheet !== null
          ? iva105Sheet
          : precioVenta !== null && Math.abs(ivaRate - 0.105) < 1e-6
            ? Number((precioVenta * 0.105).toFixed(4))
            : 0;

      const iva21 =
        iva21Sheet !== null
          ? iva21Sheet
          : precioVenta !== null && Math.abs(ivaRate - 0.21) < 1e-6
            ? Number((precioVenta * 0.21).toFixed(4))
            : 0;

      const precioFinal =
        precioFinalSheet !== null
          ? precioFinalSheet
          : precioVenta !== null
            ? Number((precioVenta + iva105 + iva21).toFixed(4))
            : null;

      const tec = {};
      const techFields = [
        "SubCategoria",
        "Marca",
        "Tipo",
        "Sist_Tension",
        "Bat_Ah",
        "Energia_kWh",
        "VdcBAT",
        "kW",
        "kVApico",
        "Max PV Array Power [W]",
        "NroMppt",
        "Vmppt_min",
        "Vmppt_max",
        "Vdc_max",
        "Start-up Voltaje",
        "Rated_PV_Input_Voltage",
        "Max Solar Charge Current [A]",
        "wp",
        "voc",
        "isc",
        "vmp",
        "imp"
      ];

      for (const tf of techFields) {
        const rawVal = pickField(r, [tf]);
        if (rawVal !== null) {
          const numVal = toNumber(rawVal, null);
          tec[tf] = numVal !== null ? numVal : String(rawVal).trim();
          tec[normKey(tf)] = numVal !== null ? numVal : String(rawVal).trim();
        }
      }

      if (tec.energiakwh !== undefined && tec.kwh === undefined) {
        tec.kwh = tec.energiakwh;
      }
      if (tec.kw !== undefined && tec.potenciakw === undefined) {
        tec.potenciakw = tec.kw;
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
    const [kitsResp, paramsResp, selectorResp] = await Promise.all([
      fetch(this.kitsUrl),
      fetch(this.parametrosUrl),
      fetch(this.selectorUrl)
    ]);

    if (!kitsResp.ok || !paramsResp.ok || !selectorResp.ok) {
      throw new Error(
        "Error al cargar kits_y_mo.json, parametros_ingenieria.json o selector.json."
      );
    }

    const kitsJson = await kitsResp.json();
    const paramsJson = await paramsResp.json();
    const selectorJson = await selectorResp.json();

    this.kitsReceta = kitsJson.kits_receta || {};
    this.kitsVentas = kitsJson.kits_ventas || {};
    this.parametros = paramsJson || {};
    this.selectorConfig = selectorJson || {};

    this.estadoInicial = {
      ...(this.selectorConfig.defaults_selector || {}),
      consumos_base: Array.isArray(this.parametros.consumos_base)
        ? structuredClone(this.parametros.consumos_base)
        : []
    };

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
        "Falta configurar google_sheets_precios_csv en data/parametros_ingenieria.json."
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

  getSelectorConfig() {
    return this.selectorConfig;
  }

  getEstadoInicial() {
    return this.estadoInicial;
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
