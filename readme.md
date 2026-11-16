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
- `shacl.js`: envía las reglas SHACL a Fuseki y lee su informe.

## Fuseki, inferencia y validación

Inicia Fuseki desde la carpeta del proyecto con la configuración del repositorio (ajusta la ruta de Fuseki):

```bash
java -jar C:\apache-jena-fuseki-6.2.0\fuseki-server.jar --config=fuseki/config.ttl
```

Carga `ontologia/turismo.rdf` al arrancar, así que no hay que subir el archivo a mano. Después de editar la ontología, reinicia Fuseki.

| Endpoint | Qué ofrece |
| --- | --- |
| `/turismo` | Los datos tal como están en el archivo. Es el que usa el sitio. |
| `/turismo-inferido` | Los mismos datos más lo que deduce el razonador (OWL Micro): tipos por `rdfs:subClassOf`, propiedades por `rdfs:subPropertyOf` e inversas por `owl:inverseOf`. En el panel: casilla *Con inferencia* de la pestaña *Consultas SPARQL*. |
| `/turismo/shacl` | Validación con las reglas de `ontologia/turismo.shacl.ttl`. En el panel: bloque *Reglas SHACL* de la pestaña *Validación*. |

Las reglas SHACL también se pueden aplicar sin Fuseki en marcha:

```bash
java -cp C:\apache-jena-fuseki-6.2.0\fuseki-server.jar shacl.shacl validate --shapes ontologia/turismo.shacl.ttl --data ontologia/turismo.rdf --text
```

Si inicias Fuseki de otra forma (un dataset `turismo` vacío al que subes el archivo), el sitio funciona igual, pero el panel avisa de que faltan la inferencia y SHACL.

## Agregar contenido sin tocar el código

1. Modelo 3D: copia el `.glb` a `public/modelos3d/` y añade `t:tieneModelo3D "modelos3d/archivo.glb"`.
2. Imagen: cópiala a `public/imagenes/` y añade `t:tieneImagen "imagenes/archivo.jpg"`.
3. Enlace: `t:tieneEnlace "https://…"` (puede repetirse).
4. Coordenadas: `t:Latitud` y `t:Longitud` en grados decimales. La carta 3D ubica el lugar con ellas; sin coordenadas lo dibuja alrededor de su ciudad o comuna.
5. Mismo lugar en Wikidata: `owl:sameAs <http://www.wikidata.org/entity/Q…>`. Cada entidad de Wikidata se enlaza con un solo individuo.
6. Individuo nuevo: usa la pestaña *Nuevo individuo* del panel, que genera el Turtle o el `INSERT DATA`.
7. Reinicia Fuseki (o recarga el dataset `turismo` si lo subes a mano) y revisa la pestaña *Validación*.
8. Si cambiaste `ontologia/turismo.rdf`, regenera la copia de respaldo de la carta 3D con `node scripts/generar-copia.mjs`.

Las clases y propiedades están alineadas con schema.org (`rdfs:subClassOf`, `rdfs:subPropertyOf`). El `@type` del JSON-LD de cada ficha sale de esa alineación: para que una clase nueva tenga tipo, hazla subclase de una clase de `https://schema.org/`.

La bandera y el escudo se leen de `public/identidad/bandera.svg` y `public/identidad/escudo.svg`.
