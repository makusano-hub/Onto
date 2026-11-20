import { obtenerFiltros, buscarAtracciones } from './ontologia.js';

const lista = document.getElementById('lista-atracciones');
const total = document.getElementById('total-atracciones');
const tarjetasCategoria = document.getElementById('categorias-portada');

const grupos = [
  { campo: 'comuna', contenedor: document.getElementById('filtro-comuna'), todas: 'Todas' },
  { campo: 'categoria', contenedor: document.getElementById('filtro-categoria'), todas: 'Todas' }
];

// Los filtros se guardan en la dirección para conservarlos al volver desde una atracción
const parametros = new URLSearchParams(window.location.search);
const filtros = {};

// Cada búsqueda es una consulta a Fuseki: solo se muestra la respuesta de la más reciente
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
  total.textContent = 'Buscando…';

  try {
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
  tarjetasCategoria.replaceChildren(...categorias.map(({ id, nombre, total: cantidad }) => {
    const elemento = document.createElement('li');
    const enlace = document.createElement('a');
    const titulo = document.createElement('strong');
    const detalle = document.createElement('span');

    enlace.href = `?categoria=${id}#atracciones`;
    enlace.dataset.valor = id;
    titulo.textContent = nombre;
    detalle.textContent = cantidad === 1 ? '1 lugar' : cantidad ? `${cantidad} lugares` : 'Próximamente';
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
  total.textContent = 'Buscando…';

  try {
    const visibles = await buscarAtracciones(filtros);
    if (busqueda !== ultimaBusqueda) return;

    // Sin filtros y sin resultados: Fuseki responde, pero no con esta ontología (dataset vacío o un turismo.rdf anterior)
    if (!visibles.length && !Object.values(filtros).some(Boolean)) {
      mostrarSinDatos(SIN_ONTOLOGIA);
      return;
    }

    lista.replaceChildren(...visibles.map(crearTarjeta));
    delete lista.dataset.estatica; // desde aquí la lista viene de Fuseki, no de la compilación
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

const SIN_CONEXION = 'No se pudo conectar con Fuseki. Comprueba que esté en ejecución y recarga la página.';
const SIN_ONTOLOGIA = 'Fuseki no tiene atracciones de esta ontología. Carga el turismo.rdf actual en el dataset turismo (sus identificadores cambiaron: una copia anterior no sirve) y recarga la página.';

function mostrarError(error) {
  console.error('Error consultando Fuseki:', error);
  mostrarSinDatos(SIN_CONEXION);
}

// Fuseki no sirve los datos: se retiran los filtros y las tarjetas de categoría, que dependen de él,
// para no dejar sus títulos sin nada debajo
function mostrarSinDatos(motivo) {
  document.querySelector('.filtros').hidden = true;
  tarjetasCategoria.hidden = true;

  // El sitio compilado trae la lista ya escrita (scripts/publicacion.mjs): se conserva
  if (lista.dataset.estatica !== undefined && lista.children.length) {
    total.textContent = `${textoTotal(lista.children.length)} · lista guardada al compilar; los filtros necesitan Fuseki con la ontología cargada.`;
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
  enlace.href = `atraccion.html?id=${encodeURIComponent(id)}`;
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
