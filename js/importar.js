// Importación de inscriptos desde Excel (.xlsx/.xls/.csv) o PDF.
// Resultado: { inscriptos: [{orden, numero, piloto, navegante, clase, auto, revisar}], avisos: [] }
// Siempre se muestra una vista previa editable antes de guardar.

const COLUMNAS = [
  ["orden", /^orden$/i],
  ["numero", /^(n[º°o]?\.?|nro\.?|n[uú]mero|auto n[º°o]?)$/i],
  ["piloto_navegante", /piloto.*(navegante|copiloto)/i],
  ["piloto", /^piloto$/i],
  ["navegante", /^(navegante|copiloto)$/i],
  ["clase", /^clase$/i],
  ["auto", /^(auto|veh[ií]culo|marca|modelo)$/i],
];

function normalizarClase(c) {
  const t = String(c || "").trim();
  return /^inv\.?$/i.test(t) || /^invitad[oa]$/i.test(t) ? "Invitado" : t;
}

function separarTripulacion(texto) {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  const i = t.indexOf(" - ");
  if (i >= 0) return [t.slice(0, i).trim(), t.slice(i + 3).trim()];
  const j = t.lastIndexOf("-");
  if (j > 0) return [t.slice(0, j).trim(), t.slice(j + 1).trim()];
  return [t, ""];
}

// filas: array de arrays de texto (como una planilla). Busca el encabezado y arma los inscriptos.
function interpretarTabla(filas) {
  const avisos = [];
  const limpio = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const iEnc = filas.findIndex((f) => f.some((c) => /piloto/i.test(limpio(c))) && f.some((c) => /^clase$/i.test(limpio(c))));
  if (iEnc < 0) return { inscriptos: [], avisos: ["No encontré el encabezado (una fila con PILOTO y CLASE)."] };

  const col = {};
  filas[iEnc].forEach((c, j) => {
    const t = limpio(c);
    for (const [nombre, re] of COLUMNAS) if (!(nombre in col) && re.test(t)) { col[nombre] = j; break; }
  });
  if (!("numero" in col)) avisos.push("No encontré la columna del número (Nº).");

  const inscriptos = [];
  for (const f of filas.slice(iEnc + 1)) {
    const v = (k) => (k in col ? limpio(f[col[k]]) : "");
    const numero = v("numero").replace(/\D/g, "");
    if (!numero) continue;
    let piloto = v("piloto"), navegante = v("navegante");
    if ("piloto_navegante" in col) [piloto, navegante] = separarTripulacion(v("piloto_navegante"));
    const ins = { orden: Number(v("orden")) || null, numero, piloto, navegante,
                  clase: normalizarClase(v("clase")), auto: v("auto"), revisar: false };
    ins.revisar = !ins.piloto || !ins.clase;
    inscriptos.push(ins);
  }
  const vistos = new Set();
  for (const ins of inscriptos) {
    if (vistos.has(ins.numero)) { ins.revisar = true; avisos.push(`El número ${ins.numero} está repetido.`); }
    vistos.add(ins.numero);
  }
  return { inscriptos, avisos };
}

async function leerExcel(archivo) {
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return interpretarTabla(XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" }));
}

// PDF: se agrupan los textos por renglón (misma altura) y cada renglón se reparte
// en las columnas del encabezado. Si un renglón no encaja, queda marcado para revisar.
async function leerPdf(archivo) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: await archivo.arrayBuffer() }).promise;
  const renglones = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pag = await pdf.getPage(p);
    const items = (await pag.getTextContent()).items
      .filter((it) => it.str.trim())
      .map((it) => ({ txt: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width }));
    const grupos = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const g = grupos.find((g) => Math.abs(g.y - it.y) < 3);
      g ? g.items.push(it) : grupos.push({ y: it.y, items: [it] });
    }
    for (const g of grupos) renglones.push(g.items.sort((a, b) => a.x - b.x));
  }

  const iEnc = renglones.findIndex((r) => r.some((i) => /piloto/i.test(i.txt)) && r.some((i) => /^clase$/i.test(i.txt)));
  if (iEnc < 0) return { inscriptos: [], avisos: ["No encontré el encabezado en el PDF (una fila con PILOTO y CLASE)."] };
  const enc = renglones[iEnc];
  const n = enc.length;

  const filas = [enc.map((i) => i.txt)];
  let dudosos = 0;
  for (const r of renglones.slice(iEnc + 1)) {
    let celdas = r.map((i) => ({ ...i }));
    // Unir pedazos pegados (un mismo texto partido en dos) hasta que entre en las columnas.
    while (celdas.length > n) {
      let mejor = 1, menor = Infinity;
      for (let k = 1; k < celdas.length; k++) {
        const hueco = celdas[k].x - (celdas[k - 1].x + celdas[k - 1].w);
        if (hueco < menor) { menor = hueco; mejor = k; }
      }
      const a = celdas[mejor - 1], b = celdas[mejor];
      celdas.splice(mejor - 1, 2, { txt: a.txt + " " + b.txt, x: a.x, w: b.x + b.w - a.x });
    }
    if (celdas.length < n) dudosos++;
    while (celdas.length < n) celdas.push({ txt: "" });
    filas.push(celdas.map((c) => c.txt));
  }
  const res = interpretarTabla(filas);
  if (dudosos) res.avisos.push(`${dudosos} renglones tenían celdas vacías: revisalos en la vista previa.`);
  return res;
}
