// Arma las clasificaciones a partir de las filas de la función "resultados" de la base.
// Cada fila = un auto en una prueba: { prueba_id, numero, piloto, navegante, clase, auto,
//   hora_largada, total_seg, estado: ok | sin_llegada | sin_largada | abandono | excluido }

const TEXTO_FUERA = {
  excluido: "Excluido",
  abandono: "Abandono",
  en_carrera: "En carrera",
  incompleto: "Sin completar",
};

// Devuelve { clasificados: [...], fuera: [...] } para un conjunto de pruebas.
// Un auto clasifica solo si tiene tiempo en TODAS las pruebas del conjunto.
function clasificar(filas, pruebaIds, clase) {
  const ids = new Set(pruebaIds);
  const porAuto = new Map();
  for (const f of filas) {
    if (!ids.has(f.prueba_id)) continue;
    if (clase && f.clase !== clase) continue;
    if (!porAuto.has(f.numero)) porAuto.set(f.numero, { auto: f, pruebas: [] });
    porAuto.get(f.numero).pruebas.push(f);
  }

  const clasificados = [];
  const fuera = [];
  for (const { auto, pruebas } of porAuto.values()) {
    const base = { numero: auto.numero, piloto: auto.piloto, navegante: auto.navegante,
                   clase: auto.clase, modelo: auto.auto,
                   penal: pruebas.reduce((s, p) => s + Number(p.penalizacion_seg || 0), 0) };
    const ok = pruebas.filter((p) => p.estado === "ok" && p.total_seg !== null);
    const excluido = pruebas.some((p) => p.estado === "excluido");
    const abandono = pruebas.some((p) => p.estado === "abandono");
    const enCarrera = pruebas.some((p) => p.estado === "sin_llegada");

    if (excluido) {
      fuera.push({ ...base, motivo: "excluido", orden: 3 });
    } else if (ok.length === ids.size) {
      clasificados.push({ ...base, total: ok.reduce((s, p) => s + Number(p.total_seg), 0) });
    } else if (abandono) {
      fuera.push({ ...base, motivo: "abandono", orden: 2, hechas: ok.length });
    } else if (enCarrera && ids.size === 1) {
      fuera.push({ ...base, motivo: "en_carrera", orden: 1 });
    } else if (ok.length > 0 || enCarrera) {
      fuera.push({ ...base, motivo: "incompleto", orden: 1, hechas: ok.length });
    }
    // Si no largó ninguna prueba del conjunto, no aparece.
  }

  clasificados.sort((a, b) => a.total - b.total || compararNumero(a.numero, b.numero));
  clasificados.forEach((c, i) => {
    c.pos = i + 1;
    c.difPrimero = c.total - clasificados[0].total;
    c.difAnterior = i ? c.total - clasificados[i - 1].total : 0;
  });
  fuera.sort((a, b) => a.orden - b.orden || (b.hechas || 0) - (a.hechas || 0) ||
                       compararNumero(a.numero, b.numero));
  return { clasificados, fuera, totalPruebas: ids.size };
}

function compararNumero(a, b) {
  return (Number(a) - Number(b)) || String(a).localeCompare(String(b));
}
