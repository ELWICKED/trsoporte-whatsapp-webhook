const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

// =====================================================
// VARIABLES DE ENTORNO
// =====================================================

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

console.log("Cliente de Supabase inicializado.");

// =====================================================
// UTILIDADES HTTP
// =====================================================

function responderJSON(res, statusCode, datos) {

    res.writeHead(
        statusCode,
        {
            "Content-Type": "application/json; charset=utf-8"
        }
    );

    res.end(
        JSON.stringify(datos)
    );
}

function responderTexto(res, statusCode, texto) {

    res.writeHead(
        statusCode,
        {
            "Content-Type": "text/plain; charset=utf-8"
        }
    );

    res.end(texto);
}

function leerBody(req) {

    return new Promise(
        (resolve, reject) => {

            let body = "";

            req.on(
                "data",
                chunk => {
                    body += chunk.toString();
                }
            );

            req.on(
                "end",
                () => {

                    if (!body) {
                        resolve({});
                        return;
                    }

                    try {

                        resolve(
                            JSON.parse(body)
                        );

                    } catch (error) {

                        reject(
                            new Error(
                                "JSON inválido."
                            )
                        );
                    }
                }
            );

            req.on(
                "error",
                reject
            );
        }
    );
}

// =====================================================
// HISTORIAL
// =====================================================

async function guardarHistorial(
    conversacionId,
    agenteId,
    accion,
    detalle
) {

    const {
        error
    } = await supabase
        .from("ticket_historial")
        .insert({

            conversacion_id:
                conversacionId,

            agente_id:
                agenteId || null,

            accion:
                accion,

            detalle:
                detalle
        });

    if (error) {
        throw error;
    }
}

// =====================================================
// ACTUALIZAR ÚLTIMA INTERACCIÓN
// =====================================================

async function actualizarUltimaInteraccion(
    conversacionId
) {

    const ahora =
        new Date().toISOString();

    const {
        data: conversacion,
        error: errorConversacion
    } = await supabase
        .from("conversaciones")
        .select("cliente_id")
        .eq(
            "id",
            conversacionId
        )
        .single();

    if (errorConversacion) {
        throw errorConversacion;
    }

    const {
        error: errorActualizacion
    } = await supabase
        .from("conversaciones")
        .update({

            ultima_interaccion:
                ahora

        })
        .eq(
            "id",
            conversacionId
        );

    if (errorActualizacion) {
        throw errorActualizacion;
    }

    // También actualizamos el cliente

    if (conversacion?.cliente_id) {

        const {
            error: errorCliente
        } = await supabase
            .from("clientes")
            .update({

                ultima_interaccion:
                    ahora

            })
            .eq(
                "id",
                conversacion.cliente_id
            );

        if (errorCliente) {
            console.error(
                "No se pudo actualizar última interacción del cliente:",
                errorCliente.message
            );
        }
    }
}

// =====================================================
// FUNCIÓN: ENVIAR MENSAJE WHATSAPP
// =====================================================

async function enviarWhatsApp(
    to,
    message
) {

    const whatsappUrl =
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;

    const response =
        await fetch(
            whatsappUrl,
            {
                method: "POST",

                headers: {

                    "Authorization":
                        `Bearer ${ACCESS_TOKEN}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({

                        messaging_product:
                            "whatsapp",

                        to:
                            to,

                        type:
                            "text",

                        text: {

                            body:
                                message
                        }

                    })
            }
        );

    const result =
        await response.json();

    console.log(
        "Respuesta de Meta:",
        result
    );

    if (!response.ok) {

        throw new Error(
            result?.error?.message ||
            "Meta rechazó el mensaje."
        );
    }

    return result;
}

// =====================================================
// GUARDAR MENSAJE SALIENTE
// =====================================================

async function guardarMensajeSaliente(
    conversacion,
    mensaje,
    agenteId = null,
    whatsappMessageId = null
) {

    const {
        error: errorMensaje
    } = await supabase
        .from("mensajes")
        .insert({

            cliente_id:
                conversacion.cliente_id,

            conversacion_id:
                conversacion.id,

            whatsapp_message_id:
                whatsappMessageId,

            direccion:
                "saliente",

            tipo:
                "text",

            contenido:
                mensaje,

            estado:
                "enviado"
        });

    if (errorMensaje) {
        throw errorMensaje;
    }

    await actualizarUltimaInteraccion(
        conversacion.id
    );

    await guardarHistorial(
        conversacion.id,
        agenteId,
        "mensaje_enviado",
        agenteId
            ? "El agente envió un mensaje al cliente por WhatsApp."
            : "Mensaje automático enviado al cliente por WhatsApp."
    );
}

// =====================================================
// SERVIDOR
// =====================================================

const server =
    http.createServer(
        async (req, res) => {

            const parsedUrl =
                url.parse(
                    req.url,
                    true
                );

            try {

                // =================================================
                // HEALTH CHECK
                // =================================================

                if (
                    req.method === "GET" &&
                    parsedUrl.pathname === "/health"
                ) {

                    try {

                        const {
                            error
                        } = await supabase
                            .from("agentes")
                            .select("id")
                            .limit(1);

                        if (error) {

                            responderJSON(
                                res,
                                200,
                                {

                                    servidor:
                                        "OK",

                                    supabase:
                                        "ERROR",

                                    estado:
                                        "DEGRADED",

                                    error:
                                        error.message
                                }
                            );

                            return;
                        }

                        responderJSON(
                            res,
                            200,
                            {

                                servidor:
                                    "OK",

                                supabase:
                                    "OK",

                                estado:
                                    "ONLINE"
                            }
                        );

                    } catch (error) {

                        responderJSON(
                            res,
                            500,
                            {

                                servidor:
                                    "OK",

                                supabase:
                                    "ERROR",

                                estado:
                                    "ERROR",

                                error:
                                    error.message
                            }
                        );
                    }

                    return;
                }

                // =================================================
                // VERIFICACIÓN META
                // =================================================

                if (
                    req.method === "GET" &&
                    parsedUrl.pathname === "/webhook"
                ) {

                    const mode =
                        parsedUrl.query["hub.mode"];

                    const token =
                        parsedUrl.query["hub.verify_token"];

                    const challenge =
                        parsedUrl.query["hub.challenge"];

                    console.log(
                        "Solicitud de verificación de Meta."
                    );

                    if (
                        mode === "subscribe" &&
                        token === VERIFY_TOKEN
                    ) {

                        console.log(
                            "Webhook de Meta verificado correctamente."
                        );

                        responderTexto(
                            res,
                            200,
                            challenge
                        );

                    } else {

                        console.log(
                            "Token de verificación incorrecto."
                        );

                        responderTexto(
                            res,
                            403,
                            "Forbidden"
                        );
                    }

                    return;
                }

                // =================================================
                // WEBHOOK WHATSAPP
                // =================================================

                if (
                    req.method === "POST" &&
                    parsedUrl.pathname === "/webhook"
                ) {

                    const data =
                        await leerBody(req);

                    console.log("");
                    console.log(
                        "========================================="
                    );

                    console.log(
                        "WEBHOOK DE WHATSAPP RECIBIDO"
                    );

                    console.log(
                        "========================================="
                    );

                    console.log(
                        JSON.stringify(
                            data,
                            null,
                            2
                        )
                    );

                    const entries =
                        data.entry || [];

                    for (
                        const entry of entries
                    ) {

                        const changes =
                            entry.changes || [];

                        for (
                            const change of changes
                        ) {

                            const value =
                                change.value;

                            if (!value) {
                                continue;
                            }

                            const messages =
                                value.messages || [];

                            // -------------------------------------
                            // MENSAJES
                            // -------------------------------------

                            for (
                                const message of messages
                            ) {

                                const whatsappMessageId =
                                    message.id || null;

                                const telefono =
                                    message.from || null;

                                const tipo =
                                    message.type ||
                                    "unknown";

                                let contenido =
                                    null;

                                // ---------------------------------
                                // TEXTO
                                // ---------------------------------

                                if (
                                    message.type === "text" &&
                                    message.text
                                ) {

                                    contenido =
                                        message.text.body;
                                }

                                // ---------------------------------
                                // OTROS TIPOS
                                // ---------------------------------

                                else {

                                    contenido =
                                        `[Mensaje de tipo ${tipo}]`;
                                }

                                console.log("");
                                console.log(
                                    "MENSAJE DE WHATSAPP"
                                );

                                console.log(
                                    "ID:",
                                    whatsappMessageId
                                );

                                console.log(
                                    "TELÉFONO:",
                                    telefono
                                );

                                console.log(
                                    "TIPO:",
                                    tipo
                                );

                                console.log(
                                    "CONTENIDO:",
                                    contenido
                                );

                                if (!telefono) {

                                    console.log(
                                        "Mensaje ignorado: no tiene teléfono."
                                    );

                                    continue;
                                }

                                // =================================================
                                // EVITAR DUPLICADOS
                                // =================================================

                                if (
                                    whatsappMessageId
                                ) {

                                    const {
                                        data: mensajeExistente,
                                        error: errorDuplicado
                                    } = await supabase
                                        .from("mensajes")
                                        .select("id")
                                        .eq(
                                            "whatsapp_message_id",
                                            whatsappMessageId
                                        )
                                        .maybeSingle();

                                    if (errorDuplicado) {
                                        throw errorDuplicado;
                                    }

                                    if (mensajeExistente) {

                                        console.log(
                                            "Mensaje duplicado ignorado:",
                                            whatsappMessageId
                                        );

                                        continue;
                                    }
                                }

                                // =================================================
                                // BUSCAR CLIENTE
                                // =================================================

                                let cliente =
                                    null;

                                const {
                                    data: clienteExistente,
                                    error: errorCliente
                                } = await supabase
                                    .from("clientes")
                                    .select("*")
                                    .eq(
                                        "telefono",
                                        telefono
                                    )
                                    .maybeSingle();

                                if (errorCliente) {
                                    throw errorCliente;
                                }

                                if (
                                    clienteExistente
                                ) {

                                    cliente =
                                        clienteExistente;

                                    console.log(
                                        "Cliente encontrado:",
                                        cliente.id
                                    );

                                } else {

                                    const nombre =
                                        value.contacts?.[0]?.profile?.name ||
                                        telefono;

                                    const {
                                        data: nuevoCliente,
                                        error: errorNuevoCliente
                                    } = await supabase
                                        .from("clientes")
                                        .insert({

                                            telefono:
                                                telefono,

                                            nombre:
                                                nombre,

                                            activo:
                                                true,

                                            baja_comunicaciones:
                                                false
                                        })
                                        .select()
                                        .single();

                                    if (errorNuevoCliente) {
                                        throw errorNuevoCliente;
                                    }

                                    cliente =
                                        nuevoCliente;

                                    console.log(
                                        "Cliente nuevo creado:",
                                        cliente.id
                                    );
                                }

                                // =================================================
                                // BUSCAR CONVERSACIÓN ABIERTA
                                // =================================================

                                const {
                                    data: conversacionesAbiertas,
                                    error: errorConversaciones
                                } = await supabase
                                    .from("conversaciones")
                                    .select("*")
                                    .eq(
                                        "cliente_id",
                                        cliente.id
                                    )
                                    .eq(
                                        "estado",
                                        "abierta"
                                    )
                                    .order(
                                        "ultima_interaccion",
                                        {
                                            ascending:
                                                false,

                                            nullsFirst:
                                                false
                                        }
                                    )
                                    .limit(1);

                                if (errorConversaciones) {
                                    throw errorConversaciones;
                                }

                                let conversacion =
                                    null;

                                if (
                                    conversacionesAbiertas &&
                                    conversacionesAbiertas.length > 0
                                ) {

                                    conversacion =
                                        conversacionesAbiertas[0];

                                    console.log(
                                        "Conversación abierta encontrada:",
                                        conversacion.id
                                    );
                                }

                                // =================================================
                                // CREAR CONVERSACIÓN
                                // =================================================

                                let ticketCreado =
                                    false;

                                if (!conversacion) {

                                    const {
                                        data: nuevaConversacion,
                                        error: errorNuevaConversacion
                                    } = await supabase
                                        .from("conversaciones")
                                        .insert({

                                            cliente_id:
                                                cliente.id,

                                            estado:
                                                "abierta",

                                            ultima_interaccion:
                                                new Date().toISOString(),

                                            prioridad:
                                                "normal"
                                        })
                                        .select()
                                        .single();

                                    if (errorNuevaConversacion) {
                                        throw errorNuevaConversacion;
                                    }

                                    conversacion =
                                        nuevaConversacion;

                                    ticketCreado =
                                        true;

                                    console.log(
                                        "Nueva conversación creada:",
                                        conversacion.id
                                    );

                                    console.log(
                                        "Número de ticket:",
                                        conversacion.numero_ticket
                                    );
                                }

                                // =================================================
                                // CONTAR MENSAJES ENTRANTES
                                // =================================================

                                const {
                                    count: mensajesEntrantesAntes,
                                    error: errorConteo
                                } = await supabase
                                    .from("mensajes")
                                    .select(
                                        "id",
                                        {
                                            count:
                                                "exact",

                                            head:
                                                true
                                        }
                                    )
                                    .eq(
                                        "conversacion_id",
                                        conversacion.id
                                    )
                                    .eq(
                                        "direccion",
                                        "entrante"
                                    );

                                if (errorConteo) {
                                    throw errorConteo;
                                }

                                const numeroMensaje =
                                    (mensajesEntrantesAntes || 0) + 1;

                                // =================================================
                                // GUARDAR MENSAJE ENTRANTE
                                // =================================================

                                const {
                                    data: mensajeGuardado,
                                    error: errorMensaje
                                } = await supabase
                                    .from("mensajes")
                                    .insert({

                                        cliente_id:
                                            cliente.id,

                                        conversacion_id:
                                            conversacion.id,

                                        whatsapp_message_id:
                                            whatsappMessageId,

                                        direccion:
                                            "entrante",

                                        tipo:
                                            tipo,

                                        contenido:
                                            contenido,

                                        estado:
                                            "recibido"
                                    })
                                    .select()
                                    .single();

                                if (errorMensaje) {
                                    throw errorMensaje;
                                }

                                console.log(
                                    "Mensaje guardado:",
                                    mensajeGuardado.id
                                );

                                // =================================================
                                // ACTUALIZAR ÚLTIMA INTERACCIÓN
                                // =================================================

                                await actualizarUltimaInteraccion(
                                    conversacion.id
                                );

                                // =================================================
                                // HISTORIAL
                                // =================================================

                                if (ticketCreado) {

                                    await guardarHistorial(
                                        conversacion.id,
                                        conversacion.agente_id || null,
                                        "ticket_creado",
                                        "Ticket creado automáticamente desde WhatsApp."
                                    );

                                } else {

                                    await guardarHistorial(
                                        conversacion.id,
                                        conversacion.agente_id || null,
                                        "mensaje_recibido",
                                        "El cliente envió un nuevo mensaje por WhatsApp."
                                    );
                                }

                                // =================================================
                                // RESPUESTAS AUTOMÁTICAS
                                // =================================================

                                let respuestaAutomatica =
                                    null;

                                if (
                                    numeroMensaje === 1
                                ) {

                                    respuestaAutomatica =
                                        "Hola 👋 Gracias por comunicarte con TR Soporte. Recibimos tu mensaje correctamente.\n\nMientras tanto, contanos brevemente cuál es el problema que estás teniendo para que podamos ayudarte mejor. 🛠️";

                                } else if (
                                    numeroMensaje === 2
                                ) {

                                    respuestaAutomatica =
                                        `📋 Tu número de caso es #${conversacion.numero_ticket}.\n\nGracias por la información. Un agente de soporte revisará tu solicitud y se comunicará con vos.\n\nPor favor, aguardá el contacto del agente.`;

                                } else {

                                    console.log(
                                        "No se envía respuesta automática."
                                    );
                                }

                                // =================================================
                                // ENVIAR RESPUESTA AUTOMÁTICA
                                // =================================================

                                if (
                                    respuestaAutomatica
                                ) {

                                    const resultadoWhatsApp =
                                        await enviarWhatsApp(
                                            telefono,
                                            respuestaAutomatica
                                        );

                                    const whatsappRespuestaId =
                                        resultadoWhatsApp
                                            ?.messages?.[0]?.id ||
                                        null;

                                    await guardarMensajeSaliente(
                                        conversacion,
                                        respuestaAutomatica,
                                        null,
                                        whatsappRespuestaId
                                    );

                                    console.log(
                                        "Respuesta automática enviada correctamente."
                                    );
                                }
                            }
                        }
                    }

                    responderJSON(
                        res,
                        200,
                        {
                            success:
                                true
                        }
                    );

                    return;
                }

                // =================================================
                // LISTAR AGENTES
                // =================================================

                if (
                    req.method === "GET" &&
                    parsedUrl.pathname === "/agentes"
                ) {

                    const {
                        data,
                        error
                    } = await supabase
                        .from("agentes")
                        .select(
                            "id,nombre,rol,area,activo,creado_en"
                        )
                        .eq(
                            "activo",
                            true
                        )
                        .order(
                            "nombre",
                            {
                                ascending:
                                    true
                            }
                        );

                    if (error) {
                        throw error;
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            agentes:
                                data || []
                        }
                    );

                    return;
                }

                // =================================================
                // LISTAR TICKETS
                // =================================================

                if (
                    req.method === "GET" &&
                    parsedUrl.pathname === "/tickets"
                ) {

                    const {
                        data,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .select(`
                            id,
                            numero_ticket,
                            estado,
                            prioridad,
                            categoria,
                            ultima_interaccion,
                            creado_en,
                            cerrado_en,
                            cliente_id,
                            agente_id,
                            cliente:clientes!conversaciones_cliente_id_fkey(
                                id,
                                nombre,
                                telefono,
                                empresa
                            ),
                            agente:agentes!conversaciones_agente_id_fkey(
                                id,
                                nombre,
                                rol,
                                area
                            )
                        `)
                        .order(
                            "ultima_interaccion",
                            {
                                ascending:
                                    false
                            }
                        );

                    if (error) {
                        throw error;
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            tickets:
                                data || []
                        }
                    );

                    return;
                }

                // =================================================
                // OBTENER TICKET + MENSAJES + HISTORIAL
                // =================================================

                const ticketMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)$/
                    );

                if (
                    req.method === "GET" &&
                    ticketMatch
                ) {

                    const ticketId =
                        Number(
                            ticketMatch[1]
                        );

                    const {
                        data: ticket,
                        error: errorTicket
                    } = await supabase
                        .from("conversaciones")
                        .select(`
                            *,
                            cliente:clientes!conversaciones_cliente_id_fkey(
                                *
                            ),
                            agente:agentes!conversaciones_agente_id_fkey(
                                *
                            )
                        `)
                        .eq(
                            "id",
                            ticketId
                        )
                        .single();

                    if (errorTicket) {
                        throw errorTicket;
                    }

                    const {
                        data: mensajes,
                        error: errorMensajes
                    } = await supabase
                        .from("mensajes")
                        .select("*")
                        .eq(
                            "conversacion_id",
                            ticketId
                        )
                        .order(
                            "id",
                            {
                                ascending:
                                    true
                            }
                        );

                    if (errorMensajes) {
                        throw errorMensajes;
                    }

                    const {
                        data: historial,
                        error: errorHistorial
                    } = await supabase
                        .from("ticket_historial")
                        .select(`
                            *,
                            agente:agentes!ticket_historial_agente_fk(
                                id,
                                nombre,
                                rol,
                                area
                            )
                        `)
                        .eq(
                            "conversacion_id",
                            ticketId
                        )
                        .order(
                            "id",
                            {
                                ascending:
                                    true
                            }
                        );

                    if (errorHistorial) {
                        throw errorHistorial;
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket,

                            mensajes:
                                mensajes || [],

                            historial:
                                historial || []
                        }
                    );

                    return;
                }

                // =================================================
                // ASIGNAR AGENTE
                // =================================================

                const assignMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)\/assign$/
                    );

                if (
                    req.method === "POST" &&
                    assignMatch
                ) {

                    const ticketId =
                        Number(
                            assignMatch[1]
                        );

                    const body =
                        await leerBody(req);

                    const agenteId =
                        body.agente_id == null ||
                        body.agente_id === ""
                            ? null
                            : Number(
                                body.agente_id
                            );

                    // Validar agente si se está asignando

                    if (
                        agenteId !== null
                    ) {

                        const {
                            data: agente,
                            error: errorAgente
                        } = await supabase
                            .from("agentes")
                            .select("id,nombre,activo")
                            .eq(
                                "id",
                                agenteId
                            )
                            .single();

                        if (errorAgente) {
                            throw errorAgente;
                        }

                        if (!agente.activo) {

                            responderJSON(
                                res,
                                400,
                                {

                                    success:
                                        false,

                                    error:
                                        "El agente seleccionado está inactivo."
                                }
                            );

                            return;
                        }
                    }

                    const {
                        data: ticketAnterior,
                        error: errorAnterior
                    } = await supabase
                        .from("conversaciones")
                        .select(
                            "agente_id,numero_ticket"
                        )
                        .eq(
                            "id",
                            ticketId
                        )
                        .single();

                    if (errorAnterior) {
                        throw errorAnterior;
                    }

                    const {
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            agente_id:
                                agenteId

                        })
                        .eq(
                            "id",
                            ticketId
                        );

                    if (error) {
                        throw error;
                    }

                    let detalle =
                        "Ticket desasignado.";

                    if (
                        agenteId !== null
                    ) {

                        const {
                            data: agente
                        } = await supabase
                            .from("agentes")
                            .select("nombre")
                            .eq(
                                "id",
                                agenteId
                            )
                            .single();

                        detalle =
                            `Ticket asignado al agente ${agente?.nombre || agenteId}.`;
                    }

                    await guardarHistorial(
                        ticketId,
                        agenteId,
                        "agente_asignado",
                        detalle
                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket_id:
                                ticketId,

                            agente_id:
                                agenteId,

                            numero_ticket:
                                ticketAnterior.numero_ticket
                        }
                    );

                    return;
                }

                // =================================================
                // CAMBIAR ESTADO
                // =================================================

                const statusMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)\/status$/
                    );

                if (
                    req.method === "POST" &&
                    statusMatch
                ) {

                    const ticketId =
                        Number(
                            statusMatch[1]
                        );

                    const body =
                        await leerBody(req);

                    const estado =
                        String(
                            body.estado ||
                            ""
                        ).trim();

                    const agenteId =
                        body.agente_id == null ||
                        body.agente_id === ""
                            ? null
                            : Number(
                                body.agente_id
                            );

                    if (!estado) {

                        responderJSON(
                            res,
                            400,
                            {

                                success:
                                    false,

                                error:
                                    "Falta el campo 'estado'."
                            }
                        );

                        return;
                    }

                    const campos = {

                        estado:
                            estado,

                        agente_id:
                            agenteId

                    };

                    if (
                        estado.toLowerCase() ===
                        "cerrada"
                    ) {

                        campos.cerrado_en =
                            new Date().toISOString();

                    } else {

                        campos.cerrado_en =
                            null;
                    }

                    const {
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update(
                            campos
                        )
                        .eq(
                            "id",
                            ticketId
                        );

                    if (error) {
                        throw error;
                    }

                    await actualizarUltimaInteraccion(
                        ticketId
                    );

                    await guardarHistorial(
                        ticketId,
                        agenteId,
                        "estado_cambiado",
                        `Estado del ticket cambiado a "${estado}".`
                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket_id:
                                ticketId,

                            estado:
                                estado
                        }
                    );

                    return;
                }

                // =================================================
                // CAMBIAR PRIORIDAD
                // =================================================

                const priorityMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)\/priority$/
                    );

                if (
                    req.method === "POST" &&
                    priorityMatch
                ) {

                    const ticketId =
                        Number(
                            priorityMatch[1]
                        );

                    const body =
                        await leerBody(req);

                    const prioridad =
                        String(
                            body.prioridad ||
                            ""
                        ).trim();

                    const agenteId =
                        body.agente_id == null ||
                        body.agente_id === ""
                            ? null
                            : Number(
                                body.agente_id
                            );

                    if (!prioridad) {

                        responderJSON(
                            res,
                            400,
                            {

                                success:
                                    false,

                                error:
                                    "Falta el campo 'prioridad'."
                            }
                        );

                        return;
                    }

                    const {
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            prioridad:
                                prioridad,

                            agente_id:
                                agenteId

                        })
                        .eq(
                            "id",
                            ticketId
                        );

                    if (error) {
                        throw error;
                    }

                    await actualizarUltimaInteraccion(
                        ticketId
                    );

                    await guardarHistorial(
                        ticketId,
                        agenteId,
                        "prioridad_cambiada",
                        `Prioridad cambiada a "${prioridad}".`
                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket_id:
                                ticketId,

                            prioridad:
                                prioridad
                        }
                    );

                    return;
                }

                // =================================================
                // CAMBIAR CATEGORÍA
                // =================================================

                const categoryMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)\/category$/
                    );

                if (
                    req.method === "POST" &&
                    categoryMatch
                ) {

                    const ticketId =
                        Number(
                            categoryMatch[1]
                        );

                    const body =
                        await leerBody(req);

                    const categoria =
                        body.categoria == null
                            ? null
                            : String(
                                body.categoria
                            ).trim();

                    const agenteId =
                        body.agente_id == null ||
                        body.agente_id === ""
                            ? null
                            : Number(
                                body.agente_id
                            );

                    const {
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            categoria:
                                categoria,

                            agente_id:
                                agenteId

                        })
                        .eq(
                            "id",
                            ticketId
                        );

                    if (error) {
                        throw error;
                    }

                    await actualizarUltimaInteraccion(
                        ticketId
                    );

                    await guardarHistorial(
                        ticketId,
                        agenteId,
                        "categoria_cambiada",
                        categoria
                            ? `Categoría cambiada a "${categoria}".`
                            : "Categoría eliminada."
                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket_id:
                                ticketId,

                            categoria:
                                categoria
                        }
                    );

                    return;
                }

                // =================================================
                // CERRAR TICKET
                // =================================================

                const closeMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)\/close$/
                    );

                if (
                    req.method === "POST" &&
                    closeMatch
                ) {

                    const ticketId =
                        Number(
                            closeMatch[1]
                        );

                    const body =
                        await leerBody(req);

                    const agenteId =
                        body.agente_id == null ||
                        body.agente_id === ""
                            ? null
                            : Number(
                                body.agente_id
                            );

                    const ahora =
                        new Date().toISOString();

                    const {
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            estado:
                                "cerrada",

                            cerrado_en:
                                ahora,

                            agente_id:
                                agenteId,

                            ultima_interaccion:
                                ahora

                        })
                        .eq(
                            "id",
                            ticketId
                        );

                    if (error) {
                        throw error;
                    }

                    await guardarHistorial(
                        ticketId,
                        agenteId,
                        "ticket_cerrado",
                        "El ticket fue cerrado por el agente."
                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket_id:
                                ticketId,

                            estado:
                                "cerrada",

                            cerrado_en:
                                ahora
                        }
                    );

                    return;
                }

                // =================================================
                // REABRIR TICKET
                // =================================================

                const reopenMatch =
                    parsedUrl.pathname.match(
                        /^\/tickets\/(\d+)\/reopen$/
                    );

                if (
                    req.method === "POST" &&
                    reopenMatch
                ) {

                    const ticketId =
                        Number(
                            reopenMatch[1]
                        );

                    const body =
                        await leerBody(req);

                    const agenteId =
                        body.agente_id == null ||
                        body.agente_id === ""
                            ? null
                            : Number(
                                body.agente_id
                            );

                    const ahora =
                        new Date().toISOString();

                    const {
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            estado:
                                "abierta",

                            cerrado_en:
                                null,

                            agente_id:
                                agenteId,

                            ultima_interaccion:
                                ahora

                        })
                        .eq(
                            "id",
                            ticketId
                        );

                    if (error) {
                        throw error;
                    }

                    await guardarHistorial(
                        ticketId,
                        agenteId,
                        "ticket_reabierto",
                        "El ticket fue reabierto por el agente."
                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket_id:
                                ticketId,

                            estado:
                                "abierta"
                        }
                    );

                    return;
                }

                // =================================================
                // ENVIAR MENSAJE WHATSAPP
                // =================================================

                if (
                    req.method === "POST" &&
                    parsedUrl.pathname === "/send-message"
                ) {

                    const data =
                        await leerBody(req);

                    const to =
                        data.to;

                    const message =
                        data.message;

                    const conversacionId =
                        data.conversacion_id;

                    const agenteId =
                        data.agente_id == null ||
                        data.agente_id === ""
                            ? null
                            : Number(
                                data.agente_id
                            );

                    if (
                        !to ||
                        !message
                    ) {

                        responderJSON(
                            res,
                            400,
                            {

                                success:
                                    false,

                                error:
                                    "Faltan los campos 'to' y 'message'."
                            }
                        );

                        return;
                    }

                    // -----------------------------------------
                    // SI TENEMOS TICKET, VERIFICARLO
                    // -----------------------------------------

                    let conversacion =
                        null;

                    if (
                        conversacionId
                    ) {

                        const {
                            data: conversacionEncontrada,
                            error: errorConversacion
                        } = await supabase
                            .from("conversaciones")
                            .select(
                                "id,cliente_id,estado,agente_id,numero_ticket"
                            )
                            .eq(
                                "id",
                                conversacionId
                            )
                            .single();

                        if (errorConversacion) {
                            throw errorConversacion;
                        }

                        conversacion =
                            conversacionEncontrada;

                        if (
                            conversacion.estado ===
                            "cerrada"
                        ) {

                            responderJSON(
                                res,
                                400,
                                {

                                    success:
                                        false,

                                    error:
                                        "No se puede enviar un mensaje porque el ticket está cerrado."
                                }
                            );

                            return;
                        }
                    }

                    // -----------------------------------------
                    // ENVIAR A META
                    // -----------------------------------------

                    const result =
                        await enviarWhatsApp(
                            to,
                            message
                        );

                    const whatsappMessageId =
                        result
                            ?.messages?.[0]?.id ||
                        null;

                    // -----------------------------------------
                    // GUARDAR EN SUPABASE
                    // -----------------------------------------

                    if (
                        conversacion
                    ) {

                        const {
                            error: errorMensaje
                        } = await supabase
                            .from("mensajes")
                            .insert({

                                cliente_id:
                                    conversacion.cliente_id,

                                conversacion_id:
                                    conversacion.id,

                                whatsapp_message_id:
                                    whatsappMessageId,

                                direccion:
                                    "saliente",

                                tipo:
                                    "text",

                                contenido:
                                    message,

                                estado:
                                    "enviado"
                            });

                        if (errorMensaje) {
                            throw errorMensaje;
                        }

                        await actualizarUltimaInteraccion(
                            conversacion.id
                        );

                        await guardarHistorial(
                            conversacion.id,
                            agenteId ||
                                conversacion.agente_id ||
                                null,
                            "mensaje_enviado",
                            "El agente envió un mensaje al cliente por WhatsApp."
                        );
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            whatsapp:
                                result
                        }
                    );

                    return;
                }

                // =================================================
                // RUTA RAÍZ
                // =================================================

                if (
                    req.method === "GET" &&
                    parsedUrl.pathname === "/"
                ) {

                    responderTexto(
                        res,
                        200,
                        "TR Soporte - WhatsApp Webhook funcionando."
                    );

                    return;
                }

                // =================================================
                // NO ENCONTRADO
                // =================================================

                responderJSON(
                    res,
                    404,
                    {

                        success:
                            false,

                        error:
                            "Ruta no encontrada."
                    }
                );

            } catch (error) {

                console.error("");
                console.error(
                    "========================================="
                );

                console.error(
                    "ERROR DEL SERVIDOR"
                );

                console.error(
                    "========================================="
                );

                console.error(
                    error
                );

                responderJSON(
                    res,
                    500,
                    {

                        success:
                            false,

                        error:
                            error.message
                    }
                );
            }
        }
    );

// =====================================================
// INICIAR SERVIDOR
// =====================================================

server.listen(
    PORT,
    () => {

        console.log(
            `Servidor iniciado en el puerto ${PORT}`
        );

    }
);
