import { atracciones } from './ontologia.js';

const lista = document.getElementById('lista-atracciones');
const total = document.getElementById('total-atracciones');

const grupos = [
  { campo: 'comuna', contenedor: document.getElementById('filtro-comuna'), todas: 'Todas' },
  { campo: 'tipo', contenedor: document.getElementById('filtro-tipo'), todas: 'Todos' }
];

// Los filtros se guardan en la dirección para conservarlos al volver desde una atracción
const parametros = new URLSearchParams(window.location.search);
const filtros = {};

grupos.forEach((grupo) => {
  const valores = valoresUnicos(grupo.campo);
  const inicial = parametros.get(grupo.campo);
  filtros[grupo.campo] = valores.includes(inicial) ? inicial : '';
  crearBotones(grupo, valores);
});

mostrarAtracciones();

function valoresUnicos(campo) {
  return [...new Set(atracciones.map((atraccion) => atraccion[campo]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

function crearBotones({ campo, contenedor, todas }, valores) {
  [{ valor: '', texto: todas }, ...valores.map((valor) => ({ valor, texto: valor }))]
    .forEach(({ valor, texto }) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'button outline boton-filtro';
      boton.textContent = texto;
      boton.setAttribute('aria-pressed', String(filtros[campo] === valor));

      boton.addEventListener('click', () => {
        filtros[campo] = valor;
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

function mostrarAtracciones() {
  const visibles = atracciones.filter((atraccion) =>
    Object.entries(filtros).every(([campo, valor]) => !valor || atraccion[campo] === valor)
  );

  lista.replaceChildren(...visibles.map(crearTarjeta));

  if (visibles.length === 0) {
    total.textContent = 'No hay atracciones con estos filtros.';
  } else {
    total.textContent = visibles.length === 1 ? '1 atracción' : `${visibles.length} atracciones`;
  }
}

function crearTarjeta({ id, nombre, comuna, tipo, modelo }) {
  const elemento = document.createElement('li');
  const enlace = document.createElement('a');
  const titulo = document.createElement('h3');
  const detalle = document.createElement('p');

  enlace.className = 'card tarjeta-atraccion';
  enlace.href = `atraccion.html?id=${encodeURIComponent(id)}`;
  titulo.textContent = nombre;
  detalle.textContent = comuna ? `${tipo} · ${comuna}` : tipo;
  enlace.append(titulo, detalle);

  if (modelo) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta-3d';
    etiqueta.textContent = 'Modelo 3D';
    enlace.appendChild(etiqueta);
  }

  elemento.appendChild(enlace);
  return elemento;
}
