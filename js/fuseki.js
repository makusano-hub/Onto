// Consultas SPARQL del sitio. Las responde:
//  · Fuseki, si está en marcha (Vite reenvía /fuseki a localhost:3030; ver vite.config.mjs);
//  · si no, el motor SPARQL del navegador (js/motor-local.js) sobre los archivos publicados en datos/.
// El sitio publicado en GitHub Pages no tiene Fuseki: allí siempre responde el navegador.
export const ENDPOINT = "/fuseki/turismo/query";

// Solo existen si Fuseki se inicia con fuseki/config.ttl:
// los mismos datos más lo que deduce el razonador, y la validación con SHACL
export const ENDPOINT_INFERIDO = "/fuseki/turismo-inferido/query";
export const ENDPOINT_SHACL = "/fuseki/turismo/shacl";

const RESULTADOS = "application/sparql-results+json";

// Grafo del motor del navegador que equivale a cada endpoint del sitio.
// Una dirección completa de Fuseki (la que usa la compilación) no está aquí: siempre va por HTTP.
const GRAFO_LOCAL = { [ENDPOINT]: "declarado", [ENDPOINT_INFERIDO]: "inferido" };

let origen; // promesa: se decide una vez por página

// "fuseki" o "navegador": quién responde las consultas en esta página
export function origenDeDatos() {
    origen ??= sondear();
    return origen;
}

async function sondear() {
    try {
        const respuesta = await fetch(`${ENDPOINT}?${new URLSearchParams({ query: "ASK {}" })}`, {
            headers: { Accept: RESULTADOS }
        });
        // Un servidor de archivos responde 404, o 200 con una página: solo vale una respuesta SPARQL
        if (respuesta.ok && typeof (await respuesta.json()).boolean === "boolean") return "fuseki";
    } catch {
        // Sin conexión, o la respuesta no es JSON
    }
    return "navegador";
}

async function pedirAFuseki(consulta, endpoint) {
    const parametros = new URLSearchParams({ query: consulta });

    const respuesta = await fetch(`${endpoint}?${parametros.toString()}`, {
        headers: { Accept: RESULTADOS }
    });

    if (!respuesta.ok) {
        // Fuseki explica los errores de sintaxis en el cuerpo de la respuesta
        const detalle = (await respuesta.text()).trim();
        const error = new Error(`Error en Fuseki: ${respuesta.status}`);
        error.detalle = detalle;
        error.estado = respuesta.status;
        throw error;
    }

    return respuesta.json();
}

// Respuesta completa: variables, filas con su tipo (uri / literal) y tiempo que tardó
export async function consultarSPARQLDetallado(consulta, endpoint = ENDPOINT) {
    const grafo = GRAFO_LOCAL[endpoint];
    const enNavegador = Boolean(grafo) && (await origenDeDatos()) === "navegador";
    const inicio = performance.now();

    const datos = enNavegador
        ? await (await import("./motor-local.js")).consultar(consulta, grafo)
        : await pedirAFuseki(consulta, endpoint);

    return {
        variables: datos.head?.vars ?? [],
        filas: datos.results?.bindings ?? [],
        booleano: datos.boolean,
        ms: Math.round(performance.now() - inicio)
    };
}

// Filas simplificadas a { variable: valor }
export async function consultarSPARQL(consulta, endpoint = ENDPOINT) {
    const { filas } = await consultarSPARQLDetallado(consulta, endpoint);

    return filas.map(fila => {
        const objeto = {};

        for (const variable in fila) {
            objeto[variable] = fila[variable].value;
        }

        return objeto;
    });
}
