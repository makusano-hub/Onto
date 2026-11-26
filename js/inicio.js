import { obtenerFiltros, buscarAtracciones } from './ontologia.js';
import { origenDeDatos } from './fuseki.js';

const lista = document.getElementById('lista-atracciones');
const total = document.getElementById('total-atracciones');
const tarjetasCategoria = document.getElementById('categorias-portada');

// El sitio compilado trae la lista ya escrita, con enlaces a las fichas estáticas (scripts/publicacion.mjs)
const fichasEstaticas = new Set([...lista.querySelectorAll('a')].map((enlace) => enlace.getAttribute('href')));
let sinFuseki = false; // las consultas las responde el navegador, con los mismos datos de la compilación

const grupos = [
  { campo: 'comuna', contenedor: document.getElementById('filtro-comuna'), todas: 'Todas' },
  { campo: 'categoria', contenedor: document.getElementById('filtro-categoria'), todas: 'Todas' }
];

// Los filtros se guardan en la dirección para conservarlos al volver desde una atracción
const parametros = new URLSearchParams(window.location.search);
const filtros = {};

// Cada búsqueda es una consulta SPARQL: solo se muestra la respuesta de la más reciente
let ultimaBusqueda = 0;

mostrarIdentidad();
iniciar();

// Bandera y escudo: archivos en public/identidad/. Si faltan, se indica dónde ponerlos.
function mostrarIdentidad() {
  document.querySelectorAll('#identidad img').forEach((imagen) => {
    const reemplazar = () => {
      const aviso = document.createElement('span');
      aviso.className = `falta-identidad ${imagen.dataset.falta}-falta`;
      aviso.textContent = `${imagen.dataset.falta}.svg`;
      aviso.title = `Copia el archivo en public/identidad/${imagen.dataset.falta}.svg`;
      imagen.replaceWith(aviso);
    };
    if (imagen.complete && imagen.naturalWidth === 0) reemplazar();
    else imagen.addEventListener('error', reemplazar, { once: true });
  });
}

async function iniciar() {
  // Con la lista ya escrita se conserva su total mientras llegan los filtros
  // (sin Fuseki, antes hay que descargar el motor SPARQL del navegador)
  if (lista.dataset.estatica === undefined) total.textContent = 'Buscando…';
  else total.textContent = `${textoTotal(lista.children.length)} · preparando los filtros…`;

  try {
    sinFuseki = (await origenDeDatos()) === 'navegador';
    const opciones = await obtenerFiltros();

    grupos.forEach((grupo) => {
      const inicial = parametros.get(grupo.campo);
      filtros[grupo.campo] = opciones[grupo.campo].some(({ id }) => id === inicial) ? inicial : '';
      crearBotones(grupo, opciones[grupo.campo]);
    });

    crearTarjetasCategoria(opciones.categoria.filter(({ portada }) => portada));
  } catch (error) {
    mostrarError(error);
    return;
  }

  mostrarAtracciones();
}

function elegir(campo, valor) {
  filtros[campo] = valor;
  grupos.find((grupo) => grupo.campo === campo).contenedor.querySelectorAll('button').forEach((boton) => {
    boton.setAttribute('aria-pressed', String(boton.dataset.valor === valor));
  });
  if (campo === 'categoria') marcarTarjetas();
  guardarFiltros();
  mostrarAtracciones();
}

function crearBotones({ campo, contenedor, todas }, opciones) {
  [{ id: '', nombre: todas }, ...opciones].forEach(({ id, nombre, total: cantidad }) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'button outline boton-filtro';
    boton.dataset.valor = id;
    boton.textContent = cantidad === undefined ? nombre : `${nombre} (${cantidad})`;
    boton.setAttribute('aria-pressed', String(filtros[campo] === id));
    boton.addEventListener('click', () => elegir(campo, id));
    contenedor.appendChild(boton);
  });
}

// Los seis accesos grandes de la portada: monumentos, museos, plazas, actividades, restaurantes y hoteles
function crearTarjetasCategoria(categorias) {
  tarjetasCategoria.replaceChildren(...categorias.map(({ id, nombre, total: cantidad, unidad: [una, varias] }) => {
    const elemento = document.createElement('li');
    const enlace = document.createElement('a');
    const titulo = document.createElement('strong');
    const detalle = document.createElement('span');

    enlace.href = `?categoria=${id}#atracciones`;
    enlace.dataset.valor = id;
    titulo.textContent = nombre;
    // Cada categoría dice qué cuenta: lugares o, en "Actividades", actividades (js/catalogo.js)
    detalle.textContent = cantidad === 1 ? `1 ${una}` : cantidad ? `${cantidad} ${varias}` : 'Próximamente';
    enlace.append(titulo, detalle);

    enlace.addEventListener('click', (evento) => {
      evento.preventDefault();
      elegir('categoria', filtros.categoria === id ? '' : id);
      document.getElementById('atracciones').scrollIntoView();
    });

    elemento.appendChild(enlace);
    return elemento;
  }));
  marcarTarjetas();
}

function marcarTarjetas() {
  tarjetasCategoria.querySelectorAll('a').forEach((enlace) => {
    enlace.setAttribute('aria-current', String(enlace.dataset.valor === filtros.categoria));
  });
}

function guardarFiltros() {
  const nuevos = new URLSearchParams();
  Object.entries(filtros).forEach(([campo, valor]) => {
    if (valor) nuevos.set(campo, valor);
  });

  const consulta = nuevos.toString();
  history.replaceState(null, '', `${consulta ? `?${consulta}` : window.location.pathname}#atracciones`);
}

async function mostrarAtracciones() {
  const busqueda = ++ultimaBusqueda;
  if (lista.dataset.estatica === undefined) total.textContent = 'Buscando…';

  try {
    const visibles = await buscarAtracciones(filtros);
    if (busqueda !== ultimaBusqueda) return;

    // Sin filtros y sin resultados: Fuseki responde, pero no con esta ontología (dataset vacío o un turismo.rdf anterior)
    if (!visibles.length && !Object.values(filtros).some(Boolean)) {
      mostrarSinDatos(SIN_ONTOLOGIA);
      return;
    }

    lista.replaceChildren(...visibles.map(crearTarjeta));
    delete lista.dataset.estatica; // desde aquí la lista viene de una consulta, no de la compilación
    total.textContent = textoTotal(visibles.length);
  } catch (error) {
    if (busqueda === ultimaBusqueda) mostrarError(error);
  }
}

function textoTotal(cantidad) {
  if (cantidad === 1) return '1 atracción';
  if (cantidad > 1) return `${cantidad} atracciones`;
  return 'Aún no hay atracciones con estos filtros.';
}

const SIN_CONEXION = 'No se pudieron consultar los datos: Fuseki no responde y el motor SPARQL del navegador no se pudo cargar. Recarga la página.';
const SIN_ONTOLOGIA = 'Fuseki no tiene atracciones de esta ontología. Carga el turismo.rdf actual en el dataset turismo (sus identificadores cambiaron: una copia anterior no sirve) y recarga la página.';

function mostrarError(error) {
  console.error('Error consultando los datos:', error);
  mostrarSinDatos(SIN_CONEXION);
}

// No hay quien responda las consultas: se retiran los filtros y las tarjetas de categoría, que dependen
// de ellas, para no dejar sus títulos sin nada debajo
function mostrarSinDatos(motivo) {
  document.querySelector('.filtros').hidden = true;
  tarjetasCategoria.hidden = true;

  // El sitio compilado trae la lista ya escrita (scripts/publicacion.mjs): se conserva
  if (lista.dataset.estatica !== undefined && lista.children.length) {
    total.textContent = `${textoTotal(lista.children.length)} · lista guardada al compilar; los filtros no están disponibles.`;
    return;
  }

  lista.replaceChildren();
  total.textContent = motivo;
}

function crearTarjeta({ id, nombre, comuna, tipo, modelos }) {
  const elemento = document.createElement('li');
  const enlace = document.createElement('a');
  const titulo = document.createElement('h3');
  const detalle = document.createElement('p');

  enlace.className = 'card tarjeta-atraccion';
  // Sin Fuseki los datos son los de la compilación: se enlaza la ficha estática, que ya los trae escritos
  // y tiene dirección propia. Con Fuseki, la ficha que consulta en vivo.
  const estatica = `ficha/${encodeURIComponent(id)}.html`;
  enlace.href = sinFuseki && fichasEstaticas.has(estatica) ? estatica : `atraccion.html?id=${encodeURIComponent(id)}`;
  titulo.textContent = nombre;
  detalle.textContent = comuna ? `${tipo} · ${comuna}` : tipo;
  enlace.append(titulo, detalle);

  if (modelos.length) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta-3d';
    etiqueta.textContent = modelos.length > 1 ? `${modelos.length} modelos 3D` : 'Modelo 3D';
    enlace.appendChild(etiqueta);
  }

  elemento.appendChild(enlace);
  return elemento;
}
