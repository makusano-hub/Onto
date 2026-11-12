este programa es para poder realizar ontologias a una web, para proyecto de ramo universitario


## Estructura del sitio

| Página | Para qué |
| --- | --- |
| `index.html` | Portada pública: bandera y escudo, accesos por categoría (monumentos, museos, plazas, actividades, restaurantes, hoteles) y filtros por comuna. |
| `atraccion.html?id=…` | Ficha pública con el visor 3D. |
| `panel.html` | Panel interno: **Explorar**, **Validación**, **Consultas SPARQL** y **Nuevo individuo**. |
| `grafo.html` | Carta 3D de la región. |

Código compartido en `js/`:

- `catalogo.js`: registro central (categorías, clases raíz, nombres legibles). Una categoría nueva se añade solo aquí.
- `consultas.js`: todas las consultas SPARQL, con nombre; el panel las muestra y permite ejecutarlas.
- `ontologia.js`: convierte las respuestas de Fuseki en objetos de atracción.
- `ficha.js` y `visor3d.js`: ficha y visor Three.js reutilizables (los usan la ficha pública y el panel).
- `validacion.js`: reglas de validación (ontología, datos, modelo/imágenes e interfaz).

## Agregar contenido sin tocar el código

1. Modelo 3D: copia el `.glb` a `public/modelos3d/` y añade `t:tieneModelo3D "modelos3d/archivo.glb"`.
2. Imagen: cópiala a `public/imagenes/` y añade `t:tieneImagen "imagenes/archivo.jpg"`.
3. Enlace: `t:tieneEnlace "https://…"` (puede repetirse).
4. Individuo nuevo: usa la pestaña *Nuevo individuo* del panel, que genera el Turtle o el `INSERT DATA`.
5. Recarga el dataset `turismo` en Fuseki y revisa la pestaña *Validación*.

La bandera y el escudo se leen de `public/identidad/bandera.svg` y `public/identidad/escudo.svg`.
