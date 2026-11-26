// Genera public/modelos3d/region_magallanes.glb: una maqueta 3D de la Región de Magallanes con relieve real.
// Costa: la misma de la carta 3D (js/region-geo.js). Relieve: Terrain Tiles en AWS Open Data (SRTM, GMTED2010
// y ETOPO1), teselas "terrarium" de zoom 7 que se descargan la primera vez a una carpeta de trabajo.
// Coordenadas, las de la carta: x = (lon − LON0) · KX, z = −(lat − LAT0) · KZ. La altura es la real
// multiplicada por EXAGERACION.
// Uso: node scripts/generar-region-glb.mjs [carpeta-de-teselas]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from '../js/region-geo.js';
import { gx, gz, LON0, LAT0, KX, KZ } from '../js/mapa-region.js';

const DESTINO = resolve(dirname(fileURLToPath(import.meta.url)), '../public/modelos3d/region_magallanes.glb');
const CARPETA_TESELAS = resolve(process.argv[2] ?? join(tmpdir(), 'teselas-elevacion-magallanes'));

// Alturas en unidades de la carta (1 unidad ≈ 11 km): el nivel del mar del relieve queda en y = 0
const NIVEL_MAR = -0.06;
const NIVEL_ARGENTINA = -0.03;
const FONDO = -1.6;
// Malla del relieve: celdas de unos 1,35 km de lado
const PASO_LON = 0.02;
const PASO_LAT = 0.0125;
// El relieve real casi no se notaría a esta escala: se multiplica para que se lea
const EXAGERACION = 8;
const METROS_POR_UNIDAD = 111195 / KZ;   // un grado de latitud mide unos 111,2 km
const ESCALA_Y = EXAGERACION / METROS_POR_UNIDAD;
// Altitud en la que el relieve llega a su color más claro
const METROS_CLAROS = 1800;
// Sombreado fijo en los colores, con luz desde el noroeste a 45°: así el relieve se lee aunque
// el visor ilumine parejo. El terreno plano no cambia de color; las laderas se aclaran u oscurecen.
const LUZ = new THREE.Vector3(-1, Math.SQRT2, -1).normalize();
const CONTRASTE = 0.55;
const SOMBRA_MAXIMA = 0.6;

// Terrain Tiles: cada píxel guarda la altitud en metros como R · 256 + G + B / 256 − 32768
const ORIGEN_TESELAS = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const ZOOM = 7;
const LADO = 256;

const COLOR = {
  mar: '#11304f',
  argentina: '#3d5871',
  bajo: '#5f7f86',
  alto: '#eaf4f8',
  corte: '#46626b'
};

// GLTFExporter arma el .glb con FileReader, que Node no trae
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((datos) => {
      this.result = datos;
      this.onloadend?.();
    });
  }
};

const { b: BORDE } = GEO;
const colorBajo = new THREE.Color(COLOR.bajo);
const colorAlto = new THREE.Color(COLOR.alto);
const colorCorte = new THREE.Color(COLOR.corte);

function colorSegunMetros(metros, destino = new THREE.Color()) {
  return destino.copy(colorBajo).lerp(colorAlto, Math.min(1, Math.max(0, metros / METROS_CLAROS)));
}

/* ============ 1. ELEVACIÓN ============ */

// Lee un PNG de 8 bits sin entrelazar (RGB o RGBA), que es como vienen las teselas
function leerPng(datos) {
  if (!datos.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('no es un PNG');
  let canales = 0;
  const comprimido = [];
  for (let p = 8; p + 12 <= datos.length;) {
    const largo = datos.readUInt32BE(p);
    const tipo = datos.toString('latin1', p + 4, p + 8);
    const cuerpo = datos.subarray(p + 8, p + 8 + largo);
    if (tipo === 'IHDR') {
      const [bits, color, , , entrelazado] = cuerpo.subarray(8);
      if (cuerpo.readUInt32BE(0) !== LADO || cuerpo.readUInt32BE(4) !== LADO) throw new Error(`no mide ${LADO} × ${LADO}`);
      if (bits !== 8 || (color !== 2 && color !== 6) || entrelazado !== 0) throw new Error('formato de PNG no previsto');
      canales = color === 2 ? 3 : 4;
    } else if (tipo === 'IDAT') {
      comprimido.push(cuerpo);
    } else if (tipo === 'IEND') {
      break;
    }
    p += 12 + largo;
  }
  if (!canales) throw new Error('PNG sin cabecera');

  const fila = LADO * canales;
  const crudo = inflateSync(Buffer.concat(comprimido), { maxOutputLength: (fila + 1) * LADO });
  if (crudo.length !== (fila + 1) * LADO) throw new Error('PNG incompleto');
  // Cada fila viene filtrada: guarda la diferencia con los píxeles vecinos ya leídos
  const pixeles = new Uint8Array(fila * LADO);
  for (let y = 0; y < LADO; y++) {
    const filtro = crudo[y * (fila + 1)];
    const origen = y * (fila + 1) + 1;
    const destino = y * fila;
    for (let x = 0; x < fila; x++) {
      const a = x >= canales ? pixeles[destino + x - canales] : 0;
      const b = y > 0 ? pixeles[destino + x - fila] : 0;
      const c = x >= canales && y > 0 ? pixeles[destino + x - fila - canales] : 0;
      let previsto = 0;
      if (filtro === 1) previsto = a;
      else if (filtro === 2) previsto = b;
      else if (filtro === 3) previsto = (a + b) >> 1;
      else if (filtro === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        previsto = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filtro !== 0) throw new Error('filtro de PNG desconocido');
      pixeles[destino + x] = (crudo[origen + x] + previsto) & 255;
    }
  }
  return { pixeles, canales };
}

// Posición de un punto en la cuadrícula de teselas (proyección de Mercator)
const teselaX = (lon) => ((lon + 180) / 360) * 2 ** ZOOM;
const teselaY = (lat) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** ZOOM;

// Junta las teselas que cubren el mapa y devuelve la función que da la altitud (en metros) de un punto.
// El mar queda en 0: la batimetría no se usa.
async function cargarElevacion() {
  const x0 = Math.floor(teselaX(BORDE.w));
  const x1 = Math.floor(teselaX(BORDE.e));
  const y0 = Math.floor(teselaY(BORDE.n));
  const y1 = Math.floor(teselaY(BORDE.s));
  const ancho = (x1 - x0 + 1) * LADO;
  const alto = (y1 - y0 + 1) * LADO;
  const metros = new Float32Array(ancho * alto);

  mkdirSync(CARPETA_TESELAS, { recursive: true });
  let descargadas = 0;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const nombre = `${ZOOM}/${tx}/${ty}.png`;
    const archivo = join(CARPETA_TESELAS, `${ZOOM}-${tx}-${ty}.png`);
    let tesela;
    try {
      if (existsSync(archivo)) {
        tesela = leerPng(readFileSync(archivo));
      } else {
        const respuesta = await fetch(`${ORIGEN_TESELAS}/${nombre}`, { signal: AbortSignal.timeout(60000) });
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const datos = Buffer.from(await respuesta.arrayBuffer());
        tesela = leerPng(datos);
        // Solo se guarda si se pudo leer, para no dejar una tesela dañada en la carpeta
        writeFileSync(archivo, datos);
        descargadas++;
      }
    } catch (error) {
      throw new Error(`No se pudo usar la tesela de elevación ${nombre}: ${error.message}`, { cause: error });
    }
    const { pixeles, canales } = tesela;
    for (let y = 0; y < LADO; y++) for (let x = 0; x < LADO; x++) {
      const p = (y * LADO + x) * canales;
      const altitud = pixeles[p] * 256 + pixeles[p + 1] + pixeles[p + 2] / 256 - 32768;
      metros[((ty - y0) * LADO + y) * ancho + (tx - x0) * LADO + x] = Math.max(altitud, 0);
    }
  }
  const total = (x1 - x0 + 1) * (y1 - y0 + 1);
  console.log(`Elevación: ${total} teselas en ${CARPETA_TESELAS} (${descargadas} descargadas ahora)`);

  const muestra = (lon, lat) => {
    const fx = Math.min(ancho - 1.001, Math.max(0, (teselaX(lon) - x0) * LADO - 0.5));
    const fy = Math.min(alto - 1.001, Math.max(0, (teselaY(lat) - y0) * LADO - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const k = j * ancho + i;
    return (metros[k] * (1 - u) + metros[k + 1] * u) * (1 - v) + (metros[k + ancho] * (1 - u) + metros[k + ancho + 1] * u) * v;
  };
  // Las teselas son casi el doble de finas que la malla: se promedian cuatro muestras por vértice
  const dx = PASO_LON / 4;
  const dy = PASO_LAT / 4;
  return (lon, lat) => (muestra(lon - dx, lat - dy) + muestra(lon + dx, lat - dy) + muestra(lon - dx, lat + dy) + muestra(lon + dx, lat + dy)) / 4;
}

/* ============ 2. TIERRA PLANA CON LA COSTA REAL ============ */

// Pinta toda la geometría de un color, para poder unirla con el relieve
function pintar(geometria, color) {
  const cantidad = geometria.attributes.position.count;
  const colores = new Float32Array(cantidad * 3);
  for (let i = 0; i < cantidad; i++) color.toArray(colores, i * 3);
  geometria.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  return geometria;
}

// Quita las caras que miran hacia abajo: quedan dentro del bloque del mar y nunca se ven
function sinCarasInferiores(geometria) {
  const { position: p, normal: n } = geometria.attributes;
  const posiciones = [];
  const normales = [];
  for (let i = 0; i < p.count; i += 3) {
    if (n.getY(i) + n.getY(i + 1) + n.getY(i + 2) < -1.5) continue;
    for (let k = i; k < i + 3; k++) {
      posiciones.push(p.getX(k), p.getY(k), p.getZ(k));
      normales.push(n.getX(k), n.getY(k), n.getZ(k));
    }
  }
  const limpia = new THREE.BufferGeometry();
  limpia.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  limpia.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3));
  return limpia;
}

// Cada polígono se levanta desde `base` hasta `tope`
function tierraPlana(poligonos, base, tope) {
  const anillo = (r) => {
    const puntos = [];
    for (let i = 0; i < r.length; i += 2) puntos.push(new THREE.Vector2(gx(r[i]), -gz(r[i + 1])));
    return puntos;
  };
  const formas = poligonos.map(([exterior, ...huecos]) => {
    const forma = new THREE.Shape(anillo(exterior));
    huecos.forEach((hueco) => forma.holes.push(new THREE.Path(anillo(hueco))));
    return forma;
  });
  const geometria = new THREE.ExtrudeGeometry(formas, { depth: tope - base, bevelEnabled: false, steps: 1, curveSegments: 1 });
  // La forma se dibuja en el plano XY y se levanta en Z: al girarla, Z pasa a ser la altura
  geometria.rotateX(-Math.PI / 2);
  geometria.translate(0, base, 0);
  return sinCarasInferiores(geometria.index ? geometria.toNonIndexed() : geometria);
}

/* ============ 3. RELIEVE ============ */

// Aristas [lon1, lat1, lon2, lat2] de todos los anillos
function aristasDe(poligonos) {
  const aristas = [];
  poligonos.flat().forEach((r) => {
    for (let i = 0; i < r.length; i += 2) {
      const k = (i + 2) % r.length;
      aristas.push([r[i], r[i + 1], r[k], r[k + 1]]);
    }
  });
  return aristas;
}

// Marca qué vértices de la malla caen dentro de los polígonos (relleno par-impar, fila por fila)
function mascara(aristas, nx, ny) {
  const dentro = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    // El desplazamiento mínimo evita que la fila pase justo por un vértice del contorno,
    // y deja dentro la primera fila, donde el mapa corta la tierra por el norte
    const lat = BORDE.n - j * PASO_LAT - 1e-7;
    const cortes = [];
    for (const [x1, y1, x2, y2] of aristas) {
      if ((y1 > lat) !== (y2 > lat)) cortes.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
    cortes.sort((a, b) => a - b);
    for (let c = 0; c + 1 < cortes.length; c += 2) {
      const desde = Math.max(0, Math.ceil((cortes[c] - BORDE.w) / PASO_LON));
      const hasta = Math.min(nx - 1, Math.floor((cortes[c + 1] - BORDE.w) / PASO_LON));
      for (let i = desde; i <= hasta; i++) dentro[j * nx + i] = 1;
    }
  }
  return dentro;
}

// Relieve real sobre la tierra chilena. Los triángulos de la malla que cruzan el contorno se recortan
// en él: en la costa bajan al nivel del mar, y en la frontera con Argentina y en el borde norte del
// mapa quedan cortados con una pared, como una maqueta.
function relieve(elevacion) {
  const nx = Math.round((BORDE.e - BORDE.w) / PASO_LON) + 1;
  const ny = Math.round((BORDE.n - BORDE.s) / PASO_LAT) + 1;
  const total = nx * ny;
  const lonDe = (i) => BORDE.w + i * PASO_LON;
  const latDe = (j) => BORDE.n - j * PASO_LAT;

  const contorno = aristasDe(GEO.cl);
  const chile = mascara(contorno, nx, ny);
  const argentina = mascara(aristasDe(GEO.ar), nx, ny);
  // Aristas del contorno que pasan por cada franja de la malla (entre la fila j y la j + 1), con una de margen
  const franjas = Array.from({ length: ny - 1 }, () => []);
  for (const arista of contorno) {
    const desde = Math.max(0, Math.floor((BORDE.n - Math.max(arista[1], arista[3])) / PASO_LAT) - 1);
    const hasta = Math.min(ny - 2, Math.floor((BORDE.n - Math.min(arista[1], arista[3])) / PASO_LAT) + 1);
    for (let j = desde; j <= hasta; j++) franjas[j].push(arista);
  }

  const posiciones = [];
  const colores = [];
  const color = new THREE.Color();
  let masAlto = { metros: 0 };
  const agregar = (lon, lat, metros) => {
    posiciones.push(gx(lon), metros * ESCALA_Y, gz(lat));
    colorSegunMetros(metros, color).toArray(colores, colores.length);
    if (metros > masAlto.metros) masAlto = { metros, lon, lat };
    return posiciones.length / 3 - 1;
  };

  // Vértices de la malla, creados cuando algún triángulo los pide
  const numero = new Int32Array(total).fill(-1);
  const vertice = (k) => {
    if (numero[k] < 0) {
      const i = k % nx;
      const lon = lonDe(i);
      const lat = latDe((k - i) / nx);
      numero[k] = agregar(lon, lat, elevacion(lon, lat));
    }
    return numero[k];
  };

  // Vértice donde la arista de la malla que va de `a` (dentro) a `b` (fuera) cruza el contorno
  const cruces = new Map();
  const cruce = (a, b) => {
    const clave = a * total + b;
    if (cruces.has(clave)) return cruces.get(clave);
    const ia = a % nx;
    const ja = (a - ia) / nx;
    const ib = b % nx;
    const jb = (b - ib) / nx;
    const ax = lonDe(ia);
    const ay = latDe(ja);
    const rx = lonDe(ib) - ax;
    const ry = latDe(jb) - ay;
    // Primer cruce saliendo de `a`; si no aparece ninguno, la mitad de la arista
    let t = Infinity;
    for (const [px, py, qx, qy] of franjas[Math.min(ny - 2, ja, jb)]) {
      const sx = qx - px;
      const sy = qy - py;
      const divisor = rx * sy - ry * sx;
      if (Math.abs(divisor) < 1e-14) continue;
      const enMalla = ((px - ax) * sy - (py - ay) * sx) / divisor;
      const enContorno = ((px - ax) * ry - (py - ay) * rx) / divisor;
      if (enContorno >= -1e-9 && enContorno <= 1 + 1e-9 && enMalla > 1e-7 && enMalla < t) t = enMalla;
    }
    // Nunca justo sobre un extremo, para no crear triángulos sin área
    t = t <= 1 + 1e-9 ? Math.min(0.98, Math.max(0.02, t)) : 0.5;
    const lon = ax + rx * t;
    const lat = ay + ry * t;
    // Hacia el mar el terreno termina en la orilla; hacia Argentina sigue, así que conserva su altitud
    const n = agregar(lon, lat, argentina[b] ? elevacion(lon, lat) : 0);
    cruces.set(clave, n);
    return n;
  };

  const MINIMO = 1e-4;
  const y = (n) => posiciones[n * 3 + 1];
  const indices = [];
  const usos = new Map();   // arista → veces que aparece: las que aparecen una sola vez son el contorno del relieve
  const emitir = (p, q, r) => {
    // Los triángulos planos a nivel del mar repetirían la tierra plana que ya hay debajo
    if (Math.max(y(p), y(q), y(r)) < MINIMO) return;
    indices.push(p, q, r);
    [[p, q], [q, r], [r, p]].forEach(([desde, hasta]) => {
      const clave = Math.min(desde, hasta) * 2 ** 22 + Math.max(desde, hasta);
      const previo = usos.get(clave);
      if (previo) previo.veces++;
      else usos.set(clave, { desde, hasta, veces: 1 });
    });
  };
  const triangulo = (v0, v1, v2) => {
    const dentro = chile[v0] + chile[v1] + chile[v2];
    if (dentro === 0) return;
    if (dentro === 3) {
      emitir(vertice(v0), vertice(v1), vertice(v2));
    } else if (dentro === 1) {
      // Se gira el triángulo, sin cambiar su sentido, para que el vértice de dentro quede primero
      const [a, b, c] = chile[v0] ? [v0, v1, v2] : chile[v1] ? [v1, v2, v0] : [v2, v0, v1];
      emitir(vertice(a), cruce(a, b), cruce(a, c));
    } else {
      // Dos dentro: queda un cuadrilátero, que se parte en dos triángulos
      const [a, b, c] = !chile[v2] ? [v0, v1, v2] : !chile[v0] ? [v1, v2, v0] : [v2, v0, v1];
      const porB = cruce(b, c);
      emitir(vertice(a), vertice(b), porB);
      emitir(vertice(a), porB, cruce(a, c));
    }
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i;
    const b = a + 1;
    const d = a + nx;
    const e = d + 1;
    triangulo(a, d, b);
    triangulo(b, d, e);
  }

  const superficie = new THREE.BufferGeometry();
  superficie.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  superficie.setAttribute('color', new THREE.Float32BufferAttribute(colores, 3));
  superficie.setIndex(indices);
  superficie.computeVertexNormals();

  const { normal: normales, color: tonos } = superficie.attributes;
  for (let n = 0; n < normales.count; n++) {
    const luz = normales.getX(n) * LUZ.x + normales.getY(n) * LUZ.y + normales.getZ(n) * LUZ.z;
    const factor = Math.max(SOMBRA_MAXIMA, 1 + CONTRASTE * (luz - LUZ.y));
    tonos.setXYZ(n, Math.min(1, tonos.getX(n) * factor), Math.min(1, tonos.getY(n) * factor), Math.min(1, tonos.getZ(n) * factor));
  }

  // Paredes: bajan hasta y = 0 donde el contorno del relieve queda en alto
  const pared = [];
  const punto = (n, altura) => pared.push(posiciones[n * 3], altura, posiciones[n * 3 + 2]);
  for (const { desde, hasta, veces } of usos.values()) {
    if (veces !== 1) continue;
    // desde → hasta sigue el sentido del triángulo, así la pared mira hacia afuera.
    // Si un extremo ya está abajo, de ese lado no queda triángulo que dibujar.
    if (y(desde) >= MINIMO) { punto(desde, y(desde)); punto(desde, 0); punto(hasta, 0); }
    if (y(hasta) >= MINIMO) { punto(desde, y(desde)); punto(hasta, 0); punto(hasta, y(hasta)); }
  }
  const partes = [superficie.toNonIndexed()];
  if (pared.length) {
    const corte = new THREE.BufferGeometry();
    corte.setAttribute('position', new THREE.Float32BufferAttribute(pared, 3));
    corte.computeVertexNormals();
    partes.push(pintar(corte, colorCorte));
  }

  return { geometria: mergeGeometries(partes), masAlto, triangulosDePared: pared.length / 9 };
}

/* ============ 4. MODELO ============ */

async function construir() {
  const ancho = (BORDE.e - BORDE.w) * KX;
  const largo = (BORDE.n - BORDE.s) * KZ;
  const material = (opciones) => new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.9, ...opciones });

  const mar = new THREE.Mesh(
    new THREE.BoxGeometry(ancho, NIVEL_MAR - FONDO, largo).translate((gx(BORDE.w) + gx(BORDE.e)) / 2, (NIVEL_MAR + FONDO) / 2, (gz(BORDE.n) + gz(BORDE.s)) / 2),
    material({ name: 'Mar', color: COLOR.mar, roughness: 0.55 })
  );
  mar.name = 'Mar';
  mar.geometry.deleteAttribute('uv');

  const argentina = new THREE.Mesh(tierraPlana(GEO.ar, NIVEL_MAR, NIVEL_ARGENTINA), material({ name: 'Argentina', color: COLOR.argentina }));
  argentina.name = 'Argentina';
  argentina.geometry = mergeVertices(argentina.geometry);

  const { geometria: cerros, masAlto, triangulosDePared } = relieve(await cargarElevacion());
  const llanura = pintar(tierraPlana(GEO.cl, NIVEL_MAR, 0), colorBajo);
  const magallanes = new THREE.Mesh(mergeVertices(mergeGeometries([llanura, cerros])), material({ name: 'Magallanes', vertexColors: true }));
  magallanes.name = 'Magallanes';
  // El nombre de la geometría pasa a ser el de la malla en el archivo
  [mar, argentina, magallanes].forEach((malla) => { malla.geometry.name = malla.name; });

  const region = new THREE.Group();
  region.name = 'RegionDeMagallanes';
  // Queda en "extras" del nodo: lo necesario para ubicar un punto sobre el modelo
  region.userData = {
    titulo: 'Región de Magallanes y de la Antártica Chilena (sin el Territorio Antártico)',
    coordenadas: 'x = (lon - lon0) * unidadesPorGradoLon; z = -(lat - lat0) * unidadesPorGradoLat; y = metros * unidadesPorMetro',
    lon0: LON0,
    lat0: LAT0,
    unidadesPorGradoLon: KX,
    unidadesPorGradoLat: KZ,
    unidadesPorMetro: ESCALA_Y,
    exageracionVertical: EXAGERACION,
    limites: { oeste: BORDE.w, este: BORDE.e, sur: BORDE.s, norte: BORDE.n },
    costa: 'Natural Earth 1:10m, recortada y simplificada',
    relieve: `Terrain Tiles (zoom ${ZOOM}): SRTM, GMTED2010 y ETOPO1`
  };
  region.add(mar, argentina, magallanes);

  const escena = new THREE.Scene();
  escena.name = 'Región de Magallanes';
  escena.add(region);
  return { escena, masAlto, triangulosDePared };
}

const { escena, masAlto, triangulosDePared } = await construir();
const glb = await new GLTFExporter().parseAsync(escena, {
  binary: true,
  copyright: 'Costa: Natural Earth. Relieve: SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey; ETOPO1 terrain data, U.S. National Oceanic and Atmospheric Administration (Terrain Tiles, AWS Open Data).'
});

mkdirSync(dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, Buffer.from(glb));

const triangulos = (malla) => (malla.geometry.index ? malla.geometry.index.count : malla.geometry.attributes.position.count) / 3;
const tamano = new THREE.Box3().setFromObject(escena).getSize(new THREE.Vector3());
console.log(`Modelo escrito en ${DESTINO}`);
console.log(`  ${(glb.byteLength / 1024 / 1024).toFixed(2)} MB`);
escena.traverse((objeto) => {
  if (objeto.isMesh) console.log(`  ${objeto.name}: ${triangulos(objeto)} triángulos, ${objeto.geometry.attributes.position.count} vértices`);
});
console.log(`  tamaño ${tamano.x.toFixed(1)} × ${tamano.y.toFixed(2)} × ${tamano.z.toFixed(1)} unidades; ${triangulosDePared} triángulos de pared`);
console.log(`  punto más alto: ${Math.round(masAlto.metros)} m en ${masAlto.lat.toFixed(2)}°, ${masAlto.lon.toFixed(2)}°`);
