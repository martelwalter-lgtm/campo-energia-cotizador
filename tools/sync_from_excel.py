import json
import os
import openpyxl


def main(excel_path="Excel Inteligente Calculo v3-2.xlsx"):
    wb_v = openpyxl.load_workbook(excel_path, data_only=True)

    # 1. Proveedores y márgenes
    ws_prov = wb_v["TABLAS_PROVEEDORES"]
    proveedores = {}
    for r in range(4, ws_prov.max_row + 1):
        p = ws_prov.cell(r, 2).value
        m = ws_prov.cell(r, 3).value
        if p is not None and str(p).strip() != "":
            proveedores[str(p).strip()] = float(m) if m is not None else 0.0

    # 2. Tablas técnicas
    ws_t = wb_v["TABLAS_TECNICAS"]
    rango_inv = []
    for r in range(4, 8):
        if ws_t.cell(r, 1).value is not None or ws_t.cell(r, 2).value is not None:
            rango_inv.append({
                "consumo_hasta_kwh": ws_t.cell(r, 1).value,
                "inversor_kw": ws_t.cell(r, 2).value,
                "modelo_sugerido": ws_t.cell(r, 3).value,
            })

    hsp_tabla = {}
    for r in range(4, 7):
        k = ws_t.cell(r, 5).value
        v = ws_t.cell(r, 6).value
        if k is not None:
            hsp_tabla[str(k).strip()] = v

    rango_kwp = []
    for r in range(4, 9):
        if ws_t.cell(r, 8).value is not None or ws_t.cell(r, 10).value is not None:
            rango_kwp.append({
                "kwp_min": ws_t.cell(r, 8).value,
                "kwp_max": ws_t.cell(r, 9).value,
                "inversor_kw": ws_t.cell(r, 10).value,
            })

    paneles_tec = {}
    for r in range(4, 16):
        mod = ws_t.cell(r, 12).value
        if mod is not None and str(mod).strip() != "":
            paneles_tec[str(mod).strip()] = {
                "wp": ws_t.cell(r, 13).value,
                "voc": ws_t.cell(r, 14).value,
                "isc": ws_t.cell(r, 15).value,
                "vmp": ws_t.cell(r, 16).value,
                "imp": ws_t.cell(r, 17).value,
            }

    # 3. TABLAS_PRECIOS
    ws_p = wb_v["TABLAS_PRECIOS"]
    headers = {}
    for c in range(1, ws_p.max_column + 1):
        h = ws_p.cell(3, c).value
        if h is not None:
            headers[c] = str(h).strip()

    catalogo = []
    for r in range(4, ws_p.max_row + 1):
        modelo = ws_p.cell(r, 2).value
        if modelo is None or str(modelo).strip() == "":
            continue
        m_str = str(modelo).strip()
        prov = str(ws_p.cell(r, 3).value or "").strip()
        desc = str(ws_p.cell(r, 4).value or "").strip()
        desc_corta = str(ws_p.cell(r, 5).value or "").strip()
        cat = str(ws_p.cell(r, 6).value or "").strip()
        iva = ws_p.cell(r, 7).value
        costo_base = ws_p.cell(r, 8).value
        desc_pct = ws_p.cell(r, 9).value
        costo_usa = ws_p.cell(r, 11).value
        pv_usa = ws_p.cell(r, 12).value
        iva105_usa = ws_p.cell(r, 13).value
        iva21_usa = ws_p.cell(r, 14).value
        pvc_iva_usa = ws_p.cell(r, 15).value

        margen = proveedores.get(prov, 0.0)
        if costo_usa is None and costo_base is not None:
            costo_usa = float(costo_base) * (1.0 - float(desc_pct or 0.0))
        if pv_usa is None and costo_usa is not None:
            pv_usa = float(costo_usa) * (1.0 + margen)
        iva_num = float(iva) if iva is not None else 0.21
        if iva105_usa is None and pv_usa is not None and abs(iva_num - 0.105) < 1e-6:
            iva105_usa = float(pv_usa) * 0.105
        if iva21_usa is None and pv_usa is not None and abs(iva_num - 0.21) < 1e-6:
            iva21_usa = float(pv_usa) * 0.21
        if pvc_iva_usa is None and pv_usa is not None:
            pvc_iva_usa = (
                float(pv_usa) + float(iva105_usa or 0.0) + float(iva21_usa or 0.0)
            )

        tec = {}
        for c in range(21, 38):
            val = ws_p.cell(r, c).value
            if val is not None and str(val).strip() != "":
                tec[headers.get(c, str(c))] = val
        if m_str in paneles_tec:
            tec.update(paneles_tec[m_str])

        catalogo.append({
            "modelo": m_str,
            "proveedor": prov,
            "margen": margen,
            "descripcion": desc,
            "descripcion_corta": desc_corta if desc_corta else desc,
            "categoria": cat,
            "iva": iva_num,
            "costo_base_usd": float(costo_base) if costo_base is not None else None,
            "descuento_pct": float(desc_pct) if desc_pct is not None else 0.0,
            "costo_unit_usd": round(float(costo_usa), 4) if costo_usa is not None else None,
            "precio_venta_usd": round(float(pv_usa), 4) if pv_usa is not None else None,
            "iva105_usd": round(float(iva105_usa), 4) if iva105_usa is not None else 0.0,
            "iva21_usd": round(float(iva21_usa), 4) if iva21_usa is not None else 0.0,
            "precio_final_usd": round(float(pvc_iva_usa), 4) if pvc_iva_usa is not None else None,
            "tec": tec,
        })

    # 4. TABLAS_KIT
    ws_k = wb_v["TABLAS_KIT"]
    kits_receta = {}
    for r in range(4, ws_k.max_row + 1):
        kit_code = ws_k.cell(r, 2).value
        item_code = ws_k.cell(r, 4).value
        qty = ws_k.cell(r, 7).value
        if kit_code and item_code:
            k_str = str(kit_code).strip()
            kits_receta.setdefault(k_str, {
                "kit": k_str,
                "descripcion": str(ws_k.cell(r, 3).value or "").strip(),
                "items": [],
            })
            kits_receta[k_str]["items"].append({
                "item": str(item_code).strip(),
                "descripcion": str(ws_k.cell(r, 5).value or "").strip(),
                "proveedor": str(ws_k.cell(r, 6).value or "").strip(),
                "cantidad": float(qty) if qty is not None else 1.0,
            })

    # 5. KIT_VENTAS
    ws_kv = wb_v["KIT_VENTAS"]
    kits_ventas = {}
    for r in range(2, ws_kv.max_row + 1):
        k_id = ws_kv.cell(r, 1).value
        comp = ws_kv.cell(r, 7).value
        cant = ws_kv.cell(r, 6).value
        if k_id and comp:
            k_str = str(k_id).strip()
            kits_ventas.setdefault(k_str, {
                "kit_id": k_str,
                "sistema": str(ws_kv.cell(r, 2).value or "").strip(),
                "tipo": str(ws_kv.cell(r, 3).value or "").strip(),
                "tension": str(ws_kv.cell(r, 4).value or "").strip(),
                "titulo": str(ws_kv.cell(r, 5).value or "").strip(),
                "componentes": [],
            })
            kits_ventas[k_str]["componentes"].append({
                "modelo": str(comp).strip(),
                "descripcion": str(ws_kv.cell(r, 8).value or "").strip(),
                "cantidad": float(cant) if cant is not None else 1.0,
            })

    os.makedirs("data", exist_ok=True)
    with open("data/catalogo_ce.json", "w", encoding="utf-8") as f:
        json.dump({"proveedores": proveedores, "catalogo": catalogo}, f, ensure_ascii=False, indent=2)

    with open("data/kits_y_mo.json", "w", encoding="utf-8") as f:
        json.dump({"kits_receta": kits_receta, "kits_ventas": kits_ventas}, f, ensure_ascii=False, indent=2)

    print(f"OK -> Catálogo: {len(catalogo)} ítems | Kits receta: {len(kits_receta)} | Kits ventas: {len(kits_ventas)}")


if __name__ == "__main__":
    main()
