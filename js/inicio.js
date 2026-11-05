import { obtenerFiltros, buscarAtracciones } from './ontologia.js';

const lista = document.getElementById('lista-atracciones');
const total = document.getElementById('total-atracciones');

const grupos = [
  { campo: 'comuna', contenedor: document.getElementById('filtro-comuna'), todas: 'Todas' },
  { campo: 'tipo', contenedor: document.getElementById('filtro-tipo'), todas: 'Todos' }
];

// Los filtros se guardan en la dirección para conservarlos al volver desde una atracción
const parametros = new URLSearchParams(window.location.search);
const filtros = {};

// Cada búsqueda es una consulta a Fuseki: solo se muestra la respuesta de la más reciente
let ultimaBusqueda = 0;

iniciar();

async function iniciar() {
  total.textContent = 'Buscando…';

  try {
    const opciones = await obtenerFiltros();

    grupos.forEach((grupo) => {
      const inicial = parametros.get(grupo.campo);
      filtros[grupo.campo] = opciones[grupo.campo].some(({ id }) => id === inicial) ? inicial : '';
      crearBotones(grupo, opciones[grupo.campo]);
    });
  } catch (error) {
    mostrarError(error);
    return;
  }

  mostrarAtracciones();
}

function crearBotones({ campo, contenedor, todas }, opciones) {
  [{ id: '', nombre: todas }, ...opciones].forEach(({ id, nombre }) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'button outline boton-filtro';
    boton.textContent = nombre;
    boton.setAttribute('aria-pressed', String(filtros[campo] === id));

    boton.addEventListener('click', () => {
      filtros[campo] = id;
      contenedor.querySelectorAll('button').forEach((otro) => {
        otro.setAttribute('aria-pressed', String(otro === boton));
      });
      guardarFiltros();
      mostrarAtracciones();
    });

    contenedor.appendChild(boton);
  });
}

function guardarFiltros() {
  const nuevos = new URLSearchParams();
  Object.entries(filtros).forEach(([campo, valor]) => {
    if (valor) nuevos.set(campo, valor);
  });

  const consulta = nuevos.toString();
  history.replaceState(null, '', consulta ? `?${consulta}` : window.location.pathname);
}

async function mostrarAtracciones() {
  const busqueda = ++ultimaBusqueda;
  total.textContent = 'Buscando…';

  try {
    const visibles = await buscarAtracciones(filtros);
    if (busqueda !== ultimaBusqueda) return;

    lista.replaceChildren(...visibles.map(crearTarjeta));
    total.textContent = textoTotal(visibles.length);
  } catch (error) {
    if (busqueda === ultimaBusqueda) mostrarError(error);
  }
}

function textoTotal(cantidad) {
  if (cantidad === 1) return '1 atracción';
  if (cantidad > 1) return `${cantidad} atracciones`;

  return Object.values(filtros).some(Boolean)
    ? 'No hay atracciones con estos filtros.'
    : 'Fuseki no tiene atracciones. Comprueba que turismo.rdf esté cargado en el dataset turismo.';
}

function mostrarError(error) {
  console.error('Error consultando Fuseki:', error);
  lista.replaceChildren();
  total.textContent = 'No se pudo conectar con Fuseki. Comprueba que esté en ejecución y recarga la página.';
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
