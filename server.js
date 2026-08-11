const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

// =====================================================
// VARIABLES DE ENTORNO
// =====================================================

const VERIFY_TOKEN =
    process.env.META_VERIFY_TOKEN;

const ACCESS_TOKEN =
    process.env.META_ACCESS_TOKEN;

const PHONE_NUMBER_ID =
    process.env.META_PHONE_NUMBER_ID;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

console.log(
    "Cliente de Supabase inicializado."
);

// =====================================================
// FUNCIONES GENERALES
// =====================================================

function responderJSON(
    res,
    statusCode,
    data
) {
    res.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8"
        }
    );

    res.end(
        JSON.stringify(data)
    );
}

// =====================================================
// LEER BODY JSON
// =====================================================

function leerBody(req) {

    return new Promise(
        (resolve, reject) => {

            let body = "";

            req.on(
                "data",
                chunk => {
                    body +=
                        chunk.toString();
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

                        const data =
                            JSON.parse(body);

                        resolve(data);

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
                error => {
                    reject(error);
                }
            );
        }
    );
}

// =====================================================
// OBTENER ID DESDE /tickets/:id
// =====================================================

function obtenerIdTicket(
    pathname
) {

    const partes =
        pathname.split("/")
            .filter(Boolean);

    if (
        partes.length !== 2 ||
        partes[0] !== "tickets"
    ) {
        return null;
    }

    const id =
        Number(partes[1]);

    if (
        !Number.isInteger(id) ||
        id <= 0
    ) {
        return null;
    }

    return id;
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

                body: JSON.stringify({

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
// FUNCIÓN: GUARDAR MENSAJE SALIENTE
// =====================================================

async function guardarMensajeSaliente(
    conversacion,
    mensaje,
    agenteId = null,
    whatsappMessageId = null
) {

    // =================================================
    // GUARDAR MENSAJE
    // =================================================

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

    // =================================================
    // ACTUALIZAR CONVERSACIÓN
    // =================================================

    const {
        error: errorActualizacion
    } = await supabase
        .from("conversaciones")
        .update({

            ultima_interaccion:
                new Date().toISOString()

        })
        .eq(
            "id",
            conversacion.id
        );

    if (errorActualizacion) {
        throw errorActualizacion;
    }

    // =================================================
    // HISTORIAL
    // =================================================

    const {
        error: errorHistorial
    } = await supabase
        .from("ticket_historial")
        .insert({

            conversacion_id:
                conversacion.id,

            agente_id:
                agenteId,

            accion:
                "mensaje_enviado",

            detalle:
                "Mensaje automático enviado al cliente por WhatsApp."
        });

    if (errorHistorial) {
        throw errorHistorial;
    }
}

// =====================================================
// FUNCIÓN: OBTENER TICKET COMPLETO
// =====================================================

async function obtenerTicketCompleto(
    conversacionId
) {

    // =================================================
    // TICKET + CLIENTE
    // =================================================

    const {
        data: ticket,
        error: errorTicket
    } = await supabase
        .from("conversaciones")
        .select("*")
        .eq(
            "id",
            conversacionId
        )
        .single();

    if (errorTicket) {
        throw errorTicket;
    }

    if (!ticket) {
        throw new Error(
            "Ticket no encontrado."
        );
    }

    // =================================================
    // CLIENTE
    // =================================================

    const {
        data: cliente,
        error: errorCliente
    } = await supabase
        .from("clientes")
        .select("*")
        .eq(
            "id",
            ticket.cliente_id
        )
        .maybeSingle();

    if (errorCliente) {
        throw errorCliente;
    }

    // =================================================
    // AGENTE
    // =================================================

    let agente = null;

    if (ticket.agente_id) {

        const {
            data: agenteData,
            error: errorAgente
        } = await supabase
            .from("agentes")
            .select("*")
            .eq(
                "id",
                ticket.agente_id
            )
            .maybeSingle();

        if (errorAgente) {
            throw errorAgente;
        }

        agente =
            agenteData;
    }

    // =================================================
    // MENSAJES
    // =================================================

    const {
        data: mensajes,
        error: errorMensajes
    } = await supabase
        .from("mensajes")
        .select("*")
        .eq(
            "conversacion_id",
            conversacionId
        )
        .order(
            "id",
            {
                ascending: true
            }
        );

    if (errorMensajes) {
        throw errorMensajes;
    }

    // =================================================
    // HISTORIAL
    // =================================================

    const {
        data: historial,
        error: errorHistorial
    } = await supabase
        .from("ticket_historial")
        .select("*")
        .eq(
            "conversacion_id",
            conversacionId
        )
        .order(
            "id",
            {
                ascending: true
            }
        );

    if (errorHistorial) {
        throw errorHistorial;
    }

    // =================================================
    // DEVOLVER
    // =================================================

    return {

        ...ticket,

        cliente:
            cliente || null,

        agente:
            agente || null,

        mensajes:
            mensajes || [],

        historial:
            historial || []
    };
}

// =====================================================
// FUNCIÓN: REGISTRAR HISTORIAL
// =====================================================

async function registrarHistorial(
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
// FUNCIÓN: OBTENER AGENTE
// =====================================================

async function obtenerAgente(
    agenteId
) {

    const {
        data,
        error
    } = await supabase
        .from("agentes")
        .select("*")
        .eq(
            "id",
            agenteId
        )
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
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

            const pathname =
                parsedUrl.pathname;

            // =================================================
            // HEALTH CHECK
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/health"
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
            // VERIFICACIÓN WEBHOOK META
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/webhook"
            ) {

                const mode =
                    parsedUrl.query[
                        "hub.mode"
                    ];

                const token =
                    parsedUrl.query[
                        "hub.verify_token"
                    ];

                const challenge =
                    parsedUrl.query[
                        "hub.challenge"
                    ];

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

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "text/plain"
                        }
                    );

                    res.end(
                        challenge
                    );

                } else {

                    console.log(
                        "Token de verificación incorrecto."
                    );

                    res.writeHead(
                        403,
                        {
                            "Content-Type":
                                "text/plain"
                        }
                    );

                    res.end(
                        "Forbidden"
                    );
                }

                return;
            }

            // =================================================
            // RECIBIR WEBHOOK WHATSAPP
            // =================================================

            if (
                req.method === "POST" &&
                pathname === "/webhook"
            ) {

                try {

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

                    // -----------------------------------------
                    // ENTRIES
                    // -----------------------------------------

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

                            // ---------------------------------
                            // MENSAJES
                            // ---------------------------------

                            for (
                                const message of messages
                            ) {

                                console.log("");

                                console.log(
                                    "-----------------------------------------"
                                );

                                console.log(
                                    "MENSAJE DE WHATSAPP"
                                );

                                console.log(
                                    "-----------------------------------------"
                                );

                                const whatsappMessageId =
                                    message.id ||
                                    null;

                                const telefono =
                                    message.from ||
                                    null;

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

                                // ---------------------------------
                                // VALIDACIÓN
                                // ---------------------------------

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

                                    if (
                                        errorDuplicado
                                    ) {
                                        throw errorDuplicado;
                                    }

                                    if (
                                        mensajeExistente
                                    ) {

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

                                if (
                                    errorCliente
                                ) {
                                    throw errorCliente;
                                }

                                // ---------------------------------
                                // EXISTENTE
                                // ---------------------------------

                                if (
                                    clienteExistente
                                ) {

                                    cliente =
                                        clienteExistente;

                                    console.log(
                                        "Cliente encontrado:",
                                        cliente.id
                                    );

                                }

                                // ---------------------------------
                                // NUEVO
                                // ---------------------------------

                                else {

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

                                    if (
                                        errorNuevoCliente
                                    ) {
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

                                if (
                                    errorConversaciones
                                ) {
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

                                if (
                                    !conversacion
                                ) {

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
                                                new Date().toISOString()

                                        })
                                        .select()
                                        .single();

                                    if (
                                        errorNuevaConversacion
                                    ) {
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

                                if (
                                    errorConteo
                                ) {
                                    throw errorConteo;
                                }

                                const numeroMensaje =
                                    (
                                        mensajesEntrantesAntes ||
                                        0
                                    ) + 1;

                                console.log(
                                    "Mensaje entrante número:",
                                    numeroMensaje
                                );

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

                                if (
                                    errorMensaje
                                ) {
                                    throw errorMensaje;
                                }

                                console.log(
                                    "Mensaje guardado:",
                                    mensajeGuardado.id
                                );

                                // =================================================
                                // ACTUALIZAR INTERACCIÓN
                                // =================================================

                                const {
                                    error: errorActualizacion
                                } = await supabase
                                    .from("conversaciones")
                                    .update({

                                        ultima_interaccion:
                                            new Date().toISOString()

                                    })
                                    .eq(
                                        "id",
                                        conversacion.id
                                    );

                                if (
                                    errorActualizacion
                                ) {
                                    throw errorActualizacion;
                                }

                                // =================================================
                                // HISTORIAL
                                // =================================================

                                if (
                                    ticketCreado
                                ) {

                                    await registrarHistorial(

                                        conversacion.id,

                                        conversacion.agente_id ||
                                        null,

                                        "ticket_creado",

                                        "Ticket creado automáticamente desde WhatsApp."

                                    );

                                    console.log(
                                        "Historial: ticket_creado"
                                    );

                                } else {

                                    await registrarHistorial(

                                        conversacion.id,

                                        conversacion.agente_id ||
                                        null,

                                        "mensaje_recibido",

                                        "El cliente envió un nuevo mensaje por WhatsApp."

                                    );

                                    console.log(
                                        "Historial: mensaje_recibido"
                                    );
                                }

                                // =================================================
                                // RESPUESTAS AUTOMÁTICAS
                                // =================================================

                                let respuestaAutomatica =
                                    null;

                                // -----------------------------------------
                                // PRIMER MENSAJE
                                // -----------------------------------------

                                if (
                                    numeroMensaje === 1
                                ) {

                                    respuestaAutomatica =
                                        "Hola 👋 Gracias por comunicarte con TR Soporte. Recibimos tu mensaje correctamente.\n\nMientras tanto, contanos brevemente cuál es el problema que estás teniendo para que podamos ayudarte mejor. 🛠️";
                                }

                                // -----------------------------------------
                                // SEGUNDO MENSAJE
                                // -----------------------------------------

                                else if (
                                    numeroMensaje === 2
                                ) {

                                    respuestaAutomatica =
                                        `📋 Tu número de caso es #${conversacion.numero_ticket}.\n\nGracias por la información. Un agente de soporte revisará tu solicitud y se comunicará con vos.\n\nPor favor, aguardá el contacto del agente.`;
                                }

                                // -----------------------------------------
                                // TERCERO EN ADELANTE
                                // -----------------------------------------

                                else {

                                    console.log(
                                        "No se envía respuesta automática."
                                    );
                                }

                                // =================================================
                                // ENVIAR RESPUESTA
                                // =================================================

                                if (
                                    respuestaAutomatica
                                ) {

                                    console.log(
                                        "Enviando respuesta automática..."
                                    );

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

                } catch (error) {

                    console.error("");

                    console.error(
                        "========================================="
                    );

                    console.error(
                        "ERROR PROCESANDO WEBHOOK"
                    );

                    console.error(
                        "========================================="
                    );

                    console.error(error);

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

                return;
            }

            // =================================================
            // LISTAR AGENTES
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/agentes"
            ) {

                try {

                    const {
                        data: agentes,
                        error
                    } = await supabase
                        .from("agentes")
                        .select("*")
                        .order(
                            "nombre",
                            {
                                ascending: true
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
                                agentes || []
                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // LISTAR TICKETS
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/tickets"
            ) {

                try {

                    const {
                        data: conversaciones,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .select("*")
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

                    const tickets =
                        [];

                    for (
                        const conversacion
                        of conversaciones || []
                    ) {

                        const {
                            data: cliente,
                            error: errorCliente
                        } = await supabase
                            .from("clientes")
                            .select("*")
                            .eq(
                                "id",
                                conversacion.cliente_id
                            )
                            .maybeSingle();

                        if (errorCliente) {
                            throw errorCliente;
                        }

                        let agente =
                            null;

                        if (
                            conversacion.agente_id
                        ) {

                            const {
                                data: agenteData,
                                error: errorAgente
                            } = await supabase
                                .from("agentes")
                                .select("*")
                                .eq(
                                    "id",
                                    conversacion.agente_id
                                )
                                .maybeSingle();

                            if (errorAgente) {
                                throw errorAgente;
                            }

                            agente =
                                agenteData;
                        }

                        tickets.push({

                            id:
                                conversacion.id,

                            numero_ticket:
                                conversacion.numero_ticket,

                            estado:
                                conversacion.estado,

                            prioridad:
                                conversacion.prioridad,

                            categoria:
                                conversacion.categoria,

                            ultima_interaccion:
                                conversacion.ultima_interaccion,

                            creado_en:
                                conversacion.creado_en,

                            cerrado_en:
                                conversacion.cerrado_en,

                            cliente_id:
                                conversacion.cliente_id,

                            cliente_nombre:
                                cliente?.nombre ||
                                null,

                            cliente_telefono:
                                cliente?.telefono ||
                                null,

                            cliente_empresa:
                                cliente?.empresa ||
                                null,

                            agente_id:
                                conversacion.agente_id ||
                                null,

                            agente_nombre:
                                agente?.nombre ||
                                null,

                            cliente:
                                cliente ||
                                null,

                            agente:
                                agente ||
                                null

                        });
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            tickets:
                                tickets

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // OBTENER TICKET COMPLETO
            // =================================================

            if (
                req.method === "GET" &&
                pathname.startsWith("/tickets/")
            ) {

                const id =
                    obtenerIdTicket(
                        pathname
                    );

                if (!id) {

                    responderJSON(
                        res,
                        400,
                        {

                            success:
                                false,

                            error:
                                "ID de ticket inválido."

                        }
                    );

                    return;
                }

                try {

                    const ticket =
                        await obtenerTicketCompleto(
                            id
                        );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket,

                            mensajes:
                                ticket.mensajes,

                            historial:
                                ticket.historial

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // ASIGNAR TICKET
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/assign")
            ) {

                try {

                    const partes =
                        pathname.split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {
                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    const data =
                        await leerBody(req);

                    const agenteId =
                        data.agente_id;

                    if (agenteId === undefined) {
                        throw new Error(
                            "Falta agente_id."
                        );
                    }

                    let agente =
                        null;

                    // Si viene un ID, verificar que el agente exista.
                    if (agenteId !== null) {

                        agente =
                            await obtenerAgente(
                                agenteId
                            );

                        if (!agente) {
                            throw new Error(
                                "El agente no existe."
                            );
                        }
                    }

                    // -----------------------------------------
                    // ACTUALIZAR
                    // -----------------------------------------

                    const {
                        data: ticketActualizado,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            agente_id:
                                agenteId

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    // -----------------------------------------
                    // HISTORIAL
                    // -----------------------------------------

                    await registrarHistorial(

                        id,

                        agenteId,

                        agenteId === null
                            ? "ticket_desasignado"
                            : "ticket_asignado",

                        agenteId === null
                            ? "Ticket desasignado."
                            : `Ticket asignado a ${agente.nombre}.`

                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticketActualizado,

                            agente:
                                agente

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // CAMBIAR ESTADO
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/status")
            ) {

                try {

                    const partes =
                        pathname.split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {
                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    const data =
                        await leerBody(req);

                    const estado =
                        data.estado;

                    const agenteId =
                        data.agente_id ||
                        null;

                    if (
                        !estado
                    ) {
                        throw new Error(
                            "Falta estado."
                        );
                    }

                    const estadosPermitidos =
                        [
                            "abierta",
                            "en_proceso",
                            "en_espera",
                            "resuelta",
                            "cerrada"
                        ];

                    if (
                        !estadosPermitidos.includes(
                            estado
                        )
                    ) {
                        throw new Error(
                            "Estado no válido."
                        );
                    }

                    const campos =
                        {
                            estado:
                                estado
                        };

                    if (
                        estado === "cerrada"
                    ) {

                        campos.cerrado_en =
                            new Date()
                                .toISOString();

                    } else {

                        campos.cerrado_en =
                            null;
                    }

                    const {
                        data: ticketActualizado,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update(
                            campos
                        )
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

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

                            ticket:
                                ticketActualizado

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // CAMBIAR PRIORIDAD
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/priority")
            ) {

                try {

                    const partes =
                        pathname.split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {
                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    const data =
                        await leerBody(req);

                    const prioridad =
                        data.prioridad;

                    const agenteId =
                        data.agente_id ||
                        null;

                    if (
                        !prioridad
                    ) {
                        throw new Error(
                            "Falta prioridad."
                        );
                    }

                    const prioridadesPermitidas =
                        [
                            "baja",
                            "normal",
                            "alta",
                            "urgente"
                        ];

                    if (
                        !prioridadesPermitidas.includes(
                            prioridad
                        )
                    ) {
                        throw new Error(
                            "Prioridad no válida."
                        );
                    }

                    const {
                        data: ticketActualizado,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            prioridad:
                                prioridad

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

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

                            ticket:
                                ticketActualizado

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // CAMBIAR CATEGORÍA
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/category")
            ) {

                try {

                    const partes =
                        pathname.split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {
                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    const data =
                        await leerBody(req);

                    const categoria =
                        data.categoria;

                    const agenteId =
                        data.agente_id ||
                        null;

                    const {
                        data: ticketActualizado,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            categoria:
                                categoria ||
                                null

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

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

                            ticket:
                                ticketActualizado

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // CERRAR TICKET
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/close")
            ) {

                try {

                    const partes =
                        pathname.split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {
                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    const data =
                        await leerBody(req);

                    const agenteId =
                        data.agente_id ||
                        null;

                    const {
                        data: ticketActualizado,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            estado:
                                "cerrada",

                            cerrado_en:
                                new Date()
                                    .toISOString()

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

                        agenteId,

                        "ticket_cerrado",

                        "Ticket cerrado por el agente."

                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticketActualizado

                        }
                    );

                } catch (error) {

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

                return;
            }

            // =================================================
            // ENVIAR MENSAJE WHATSAPP
            // =================================================

            if (
                req.method === "POST" &&
                pathname === "/send-message"
            ) {

                try {

                    const data =
                        await leerBody(req);

                    const to =
                        data.to;

                    const message =
                        data.message;

                    const conversacionId =
                        data.conversacion_id;

                    const agenteId =
                        data.agente_id ||
                        null;

                    // -----------------------------------------
                    // VALIDACIÓN
                    // -----------------------------------------

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
                    // ENVIAR WHATSAPP
                    // -----------------------------------------

                    const result =
                        await enviarWhatsApp(
                            to,
                            message
                        );

                    // -----------------------------------------
                    // GUARDAR SUPABASE
                    // -----------------------------------------

                    if (
                        conversacionId
                    ) {

                        const whatsappMessageId =
                            result
                                ?.messages?.[0]?.id ||
                            null;

                        const {
                            data: conversacion,
                            error: errorConversacion
                        } = await supabase
                            .from("conversaciones")
                            .select("*")
                            .eq(
                                "id",
                                conversacionId
                            )
                            .single();

                        if (
                            errorConversacion
                        ) {
                            throw errorConversacion;
                        }

                        await guardarMensajeSaliente(

                            conversacion,

                            message,

                            agenteId,

                            whatsappMessageId

                        );

                    }

                    // -----------------------------------------
                    // RESPUESTA
                    // -----------------------------------------

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

                } catch (error) {

                    console.error(
                        "Error enviando mensaje:"
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

                return;
            }

            // =================================================
            // RUTA RAÍZ
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/"
            ) {

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8"
                    }
                );

                res.end(
                    "TR Soporte - WhatsApp Webhook funcionando."
                );

                return;
            }

            // =================================================
            // RUTA NO ENCONTRADA
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
