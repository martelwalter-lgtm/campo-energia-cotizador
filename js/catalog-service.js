const STORAGE_KEY_OVERRIDES = "ce_cotizador_price_overrides_v1";

export class CatalogService {
  constructor({
    catalogoUrl = "./data/catalogo_ce.json",
    kitsUrl = "./data/kits_y_mo.json",
    parametrosUrl = "./data/parametros_ingenieria.json"
  } = {}) {
    this.catalogoUrl = catalogoUrl;
    this.kitsUrl = kitsUrl;
    this.parametrosUrl = parametrosUrl;

    this.proveedores = {};
    this.catalogo = [];
    this.catalogoByModelo = new Map();
    this.kitsReceta = {};
    this.kitsVentas = {};
    this.parametros = {};
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
      console.warn("No se pudieron guardar ajustes de precios:", err);
    }
  }

  async init() {
    const [catResp, kitsResp, paramsResp] = await Promise.all([
      fetch(this.catalogoUrl),
      fetch(this.kitsUrl),
      fetch(this.parametrosUrl)
    ]);

    if (!catResp.ok || !kitsResp.ok || !paramsResp.ok) {
      throw new Error("Error al cargar uno o más archivos JSON desde /data.");
    }

    const catJson = await catResp.json();
    const kitsJson = await kitsResp.json();
    const paramsJson = await paramsResp.json();

    this.proveedores = catJson.proveedores || {};
    this.catalogo = Array.isArray(catJson.catalogo) ? catJson.catalogo : [];
    this.kitsReceta = kitsJson.kits_receta || {};
    this.kitsVentas = kitsJson.kits_ventas || {};
    this.parametros = paramsJson || {};

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
      } else if (typeof item.costo_unit_usd === "number" && typeof margenOverride === "number") {
        precioVentaUsd = Number((item.costo_unit_usd * (1 + margenEfectivo)).toFixed(4));
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

  // Punto de extensión futuro para Google Sheets o Supabase
  async syncFromExternalSource(_providerFn) {
    throw new Error("Adaptador externo pendiente de configurar.");
  }
}
