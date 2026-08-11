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
// FUNCIÓN: ENVIAR MENSAJE WHATSAPP
// =====================================================

async function enviarWhatsApp(to, message) {

    const whatsappUrl =
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;

    const response = await fetch(
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

    const result = await response.json();

    console.log("Respuesta de Meta:", result);

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

    // Actualizar última interacción

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

    // Guardar historial

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
// SERVIDOR
// =====================================================

const server = http.createServer(async (req, res) => {

    const parsedUrl =
        url.parse(req.url, true);

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

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "application/json"
                    }
                );

                res.end(
                    JSON.stringify({

                        servidor:
                            "OK",

                        supabase:
                            "ERROR",

                        estado:
                            "DEGRADED",

                        error:
                            error.message

                    })
                );

                return;
            }

            res.writeHead(
                200,
                {
                    "Content-Type":
                        "application/json"
                }
            );

            res.end(
                JSON.stringify({

                    servidor:
                        "OK",

                    supabase:
                        "OK",

                    estado:
                        "ONLINE"

                })
            );

        } catch (error) {

            res.writeHead(
                500,
                {
                    "Content-Type":
                        "application/json"
                }
            );

            res.end(
                JSON.stringify({

                    servidor:
                        "OK",

                    supabase:
                        "ERROR",

                    estado:
                        "ERROR",

                    error:
                        error.message

                })
            );
        }

        return;
    }

    // =================================================
    // VERIFICACIÓN DEL WEBHOOK DE META
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

            res.writeHead(
                200,
                {
                    "Content-Type":
                        "text/plain"
                }
            );

            res.end(challenge);

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

            res.end("Forbidden");
        }

        return;
    }

    // =================================================
    // RECIBIR WEBHOOK DE WHATSAPP
    // =================================================

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/webhook"
    ) {

        let body = "";

        req.on(
            "data",
            chunk => {
                body += chunk.toString();
            }
        );

        req.on(
            "end",
            async () => {

                try {

                    const data =
                        JSON.parse(body);

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
                    // RECORRER ENTRIES
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

                            // -------------------------------------
                            // PROCESAR CADA MENSAJE
                            // -------------------------------------

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
                                // 0. EVITAR MENSAJES DUPLICADOS
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
                                // 1. BUSCAR CLIENTE
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
                                // CLIENTE EXISTENTE
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
                                // CLIENTE NUEVO
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
                                // 2. BUSCAR CONVERSACIÓN ABIERTA
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
                                // 3. CREAR CONVERSACIÓN SI NO EXISTE
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
                                // 4. CONTAR MENSAJES ENTRANTES
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
                                    (mensajesEntrantesAntes || 0) + 1;

                                console.log(
                                    "Mensaje entrante número:",
                                    numeroMensaje
                                );

                                // =================================================
                                // 5. GUARDAR MENSAJE ENTRANTE
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
                                // 6. ACTUALIZAR ÚLTIMA INTERACCIÓN
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
                                // 7. GUARDAR HISTORIAL
                                // =================================================

                                if (
                                    ticketCreado
                                ) {

                                    const {
                                        error: errorHistorial
                                    } = await supabase
                                        .from("ticket_historial")
                                        .insert({

                                            conversacion_id:
                                                conversacion.id,

                                            agente_id:
                                                conversacion.agente_id ||
                                                null,

                                            accion:
                                                "ticket_creado",

                                            detalle:
                                                "Ticket creado automáticamente desde WhatsApp."

                                        });

                                    if (
                                        errorHistorial
                                    ) {
                                        throw errorHistorial;
                                    }

                                    console.log(
                                        "Historial: ticket_creado"
                                    );

                                } else {

                                    const {
                                        error: errorHistorial
                                    } = await supabase
                                        .from("ticket_historial")
                                        .insert({

                                            conversacion_id:
                                                conversacion.id,

                                            agente_id:
                                                conversacion.agente_id ||
                                                null,

                                            accion:
                                                "mensaje_recibido",

                                            detalle:
                                                "El cliente envió un nuevo mensaje por WhatsApp."

                                        });

                                    if (
                                        errorHistorial
                                    ) {
                                        throw errorHistorial;
                                    }

                                    console.log(
                                        "Historial: mensaje_recibido"
                                    );
                                }

                                // =================================================
                                // 8. RESPUESTAS AUTOMÁTICAS
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
                                        `📋 Tu número de caso es #${conversacion.numero_ticket}.

Gracias por la información. Un agente de soporte revisará tu solicitud y se comunicará con vos.

Por favor, aguardá el contacto del agente.`;

                                }

                                // -----------------------------------------
                                // TERCER MENSAJE EN ADELANTE
                                // -----------------------------------------

                                else {

                                    console.log(
                                        "No se envía respuesta automática. El cliente ya recibió las respuestas iniciales y el caso está esperando al agente."
                                    );
                                }

                                // =================================================
                                // 9. ENVIAR RESPUESTA AUTOMÁTICA
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

                    // =================================================
                    // RESPONDER A META
                    // =================================================

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify({

                            success:
                                true

                        })
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

                    res.writeHead(
                        500,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify({

                            success:
                                false,

                            error:
                                error.message

                        })
                    );
                }

            }
        );

        return;
    }

    // =================================================
    // LISTAR TICKETS ABIERTOS
    // =================================================

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/tickets"
    ) {

        try {

            console.log(
                "Solicitud recibida: GET /tickets"
            );

            const {
                data: tickets,
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
                    cliente:clientes (
                        id,
                        nombre,
                        telefono,
                        empresa
                    ),
                    agente:agentes (
                        id,
                        nombre
                    )
                `)
                .eq(
                    "estado",
                    "abierta"
                )
                .order(
                    "ultima_interaccion",
                    {
                        ascending:
                            false
                    }
                );

            if (
                error
            ) {
                throw error;
            }

            console.log(
                "Tickets encontrados:",
                tickets?.length || 0
            );

            res.writeHead(
                200,
                {
                    "Content-Type":
                        "application/json"
                }
            );

            res.end(
                JSON.stringify({

                    success:
                        true,

                    tickets:
                        tickets || []

                })
            );

        } catch (error) {

            console.error("");
            console.error(
                "========================================="
            );

            console.error(
                "ERROR OBTENIENDO TICKETS"
            );

            console.error(
                "========================================="
            );

            console.error(error);

            res.writeHead(
                500,
                {
                    "Content-Type":
                        "application/json"
                }
            );

            res.end(
                JSON.stringify({

                    success:
                        false,

                    error:
                        error.message

                })
            );
        }

        return;
    }

    // =================================================
    // ENVIAR MENSAJE DE WHATSAPP
    // =================================================

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/send-message"
    ) {

        let body = "";

        req.on(
            "data",
            chunk => {
                body += chunk.toString();
            }
        );

        req.on(
            "end",
            async () => {

                try {

                    const data =
                        JSON.parse(body);

                    const to =
                        data.to;

                    const message =
                        data.message;

                    const conversacionId =
                        data.conversacion_id;

                    const agenteId =
                        data.agente_id;

                    if (
                        !to ||
                        !message
                    ) {

                        res.writeHead(
                            400,
                            {
                                "Content-Type":
                                    "application/json"
                            }
                        );

                        res.end(
                            JSON.stringify({

                                error:
                                    "Faltan los campos 'to' y 'message'."

                            })
                        );

                        return;
                    }

                    // -----------------------------------------
                    // ENVIAR A WHATSAPP
                    // -----------------------------------------

                    const result =
                        await enviarWhatsApp(
                            to,
                            message
                        );

                    // -----------------------------------------
                    // GUARDAR EN SUPABASE
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
                            .select("cliente_id")
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

                        const {
                            error: errorMensaje
                        } = await supabase
                            .from("mensajes")
                            .insert({

                                cliente_id:
                                    conversacion.cliente_id,

                                conversacion_id:
                                    conversacionId,

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

                        if (
                            errorMensaje
                        ) {
                            throw errorMensaje;
                        }

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
                                conversacionId
                            );

                        if (
                            errorActualizacion
                        ) {
                            throw errorActualizacion;
                        }

                        const {
                            error: errorHistorial
                        } = await supabase
                            .from("ticket_historial")
                            .insert({

                                conversacion_id:
                                    conversacionId,

                                agente_id:
                                    agenteId ||
                                    null,

                                accion:
                                    "mensaje_enviado",

                                detalle:
                                    "El agente envió un mensaje al cliente por WhatsApp."

                            });

                        if (
                            errorHistorial
                        ) {
                            throw errorHistorial;
                        }
                    }

                    // -----------------------------------------
                    // RESPUESTA
                    // -----------------------------------------

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify({

                            success:
                                true,

                            whatsapp:
                                result

                        })
                    );

                } catch (error) {

                    console.error(
                        "Error enviando mensaje:"
                    );

                    console.error(error);

                    res.writeHead(
                        500,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify({

                            error:
                                error.message

                        })
                    );
                }

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

        res.writeHead(
            200,
            {
                "Content-Type":
                    "text/plain"
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

    res.writeHead(
        404,
        {
            "Content-Type":
                "text/plain"
        }
    );

    res.end("Not Found");
});

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
