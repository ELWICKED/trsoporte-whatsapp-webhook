const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

console.log("Cliente de Supabase inicializado.");


// =====================================================
// ENVIAR MENSAJE DE TEXTO POR WHATSAPP
// =====================================================

async function enviarMensajeWhatsApp(to, message) {

    try {

        const whatsappUrl =
            `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

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

                    recipient_type:
                        "individual",

                    to: to,

                    type: "text",

                    text: {
                        body: message
                    }

                })
            }
        );


        const result = await response.json();


        console.log("=================================");
        console.log("RESPUESTA ENVIADA A WHATSAPP");
        console.log("Teléfono:", to);
        console.log("Mensaje:", message);
        console.log("Respuesta de Meta:", result);
        console.log("=================================");


        if (!response.ok) {

            throw new Error(
                `Meta devolvió error: ${JSON.stringify(result)}`
            );

        }


        return result;

    } catch (error) {

        console.error(
            "ERROR ENVIANDO MENSAJE DE WHATSAPP:"
        );

        console.error(error);

        throw error;
    }
}


// =====================================================
// PROCESAR MENSAJE DE WHATSAPP
// =====================================================

async function procesarMensajeWhatsApp(body) {

    try {

        const entry = body.entry?.[0];

        if (!entry) {
            console.log("Evento sin entry.");
            return;
        }


        const change = entry.changes?.[0];

        if (!change) {
            console.log("Evento sin changes.");
            return;
        }


        const value = change.value;

        if (!value) {
            console.log("Evento sin value.");
            return;
        }


        const messages = value.messages;

        if (!messages || messages.length === 0) {
            console.log("Evento sin mensajes.");
            return;
        }


        for (const message of messages) {

            const whatsappMessageId =
                message.id;

            const telefono =
                message.from;

            let tipo =
                message.type;

            let contenido =
                "";


            // -----------------------------------------
            // OBTENER CONTENIDO
            // -----------------------------------------

            if (tipo === "text") {

                contenido =
                    message.text?.body || "";

            } else {

                contenido =
                    `[Mensaje de tipo ${tipo}]`;

            }


            console.log("=================================");
            console.log("MENSAJE DE WHATSAPP");
            console.log("Teléfono:", telefono);
            console.log("Tipo:", tipo);
            console.log("Contenido:", contenido);
            console.log("ID:", whatsappMessageId);
            console.log("=================================");


            // -----------------------------------------
            // 1. BUSCAR CLIENTE
            // -----------------------------------------

            let {
                data: cliente,
                error: errorCliente
            } = await supabase

                .from("clientes")

                .select("*")

                .eq("telefono", telefono)

                .maybeSingle();


            if (errorCliente) {
                throw errorCliente;
            }


            // -----------------------------------------
            // 2. CREAR CLIENTE SI NO EXISTE
            // -----------------------------------------

            if (!cliente) {

                const nombre =
                    value.contacts?.[0]?.profile?.name ||
                    "Cliente WhatsApp";


                const {
                    data: nuevoCliente,
                    error
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
                            false,

                        ultima_interaccion:
                            new Date().toISOString()

                    })

                    .select()

                    .single();


                if (error) {
                    throw error;
                }


                cliente =
                    nuevoCliente;


                console.log(
                    "Nuevo cliente creado:",
                    cliente.id
                );

            } else {

                console.log(
                    "Cliente existente:",
                    cliente.id
                );


                await supabase

                    .from("clientes")

                    .update({

                        ultima_interaccion:
                            new Date().toISOString()

                    })

                    .eq(
                        "id",
                        cliente.id
                    );

            }


            // -----------------------------------------
            // 3. BUSCAR CONVERSACIÓN ABIERTA
            // -----------------------------------------

            let conversacion = null;

            let esNuevaConversacion =
                false;


            const {
                data: conversacionAbierta,
                error: errorConversacion
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
                        ascending: false
                    }
                )

                .limit(1)

                .maybeSingle();


            if (errorConversacion) {
                throw errorConversacion;
            }


            conversacion =
                conversacionAbierta;


            // -----------------------------------------
            // 4. SI NO HAY TICKET ABIERTO
            //    BUSCAR UNO CERRADO RECIENTEMENTE
            // -----------------------------------------

            if (!conversacion) {

                const {
                    data: ticketReciente,
                    error: errorTicketReciente
                } = await supabase

                    .from("conversaciones")

                    .select("*")

                    .eq(
                        "cliente_id",
                        cliente.id
                    )

                    .eq(
                        "estado",
                        "cerrado"
                    )

                    .gte(
                        "cerrado_en",
                        new Date(
                            Date.now() -
                            4 * 60 * 60 * 1000
                        ).toISOString()
                    )

                    .order(
                        "cerrado_en",
                        {
                            ascending: false
                        }
                    )

                    .limit(1)

                    .maybeSingle();


                if (errorTicketReciente) {
                    throw errorTicketReciente;
                }


                if (ticketReciente) {

                    // ---------------------------------
                    // REABRIR TICKET
                    // ---------------------------------

                    const {
                        data: ticketReabierto,
                        error: errorReapertura
                    } = await supabase

                        .from("conversaciones")

                        .update({

                            estado:
                                "abierta",

                            cerrado_en:
                                null,

                            ultima_interaccion:
                                new Date().toISOString()

                        })

                        .eq(
                            "id",
                            ticketReciente.id
                        )

                        .select()

                        .single();


                    if (errorReapertura) {
                        throw errorReapertura;
                    }


                    conversacion =
                        ticketReabierto;


                    console.log(
                        "Ticket reabierto:",
                        conversacion.numero_ticket
                    );


                    // ---------------------------------
                    // HISTORIAL
                    // ---------------------------------

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
                                "ticket_reabierto",

                            detalle:
                                "Ticket reabierto automáticamente porque el cliente volvió a escribir dentro de las 4 horas."

                        });


                    if (errorHistorial) {
                        throw errorHistorial;
                    }

                }

            }


            // -----------------------------------------
            // 5. CREAR NUEVO TICKET SI NO EXISTE
            // -----------------------------------------

            if (!conversacion) {

                esNuevaConversacion =
                    true;


                const {
                    data: nuevaConversacion,
                    error
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


                if (error) {
                    throw error;
                }


                conversacion =
                    nuevaConversacion;


                console.log(
                    "Nuevo ticket creado:",
                    conversacion.numero_ticket
                );


                // -----------------------------------------
                // HISTORIAL TICKET CREADO
                // -----------------------------------------

                const {
                    error: errorHistorial
                } = await supabase

                    .from("ticket_historial")

                    .insert({

                        conversacion_id:
                            conversacion.id,

                        agente_id:
                            null,

                        accion:
                            "ticket_creado",

                        detalle:
                            "Ticket creado desde WhatsApp."

                    });


                if (errorHistorial) {
                    throw errorHistorial;
                }

            }


            // -----------------------------------------
            // 6. ACTUALIZAR ÚLTIMA INTERACCIÓN
            // -----------------------------------------

            await supabase

                .from("conversaciones")

                .update({

                    ultima_interaccion:
                        new Date().toISOString()

                })

                .eq(
                    "id",
                    conversacion.id
                );


            // -----------------------------------------
            // 7. GUARDAR MENSAJE ENTRANTE
            // -----------------------------------------

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
                "Mensaje guardado correctamente:",
                mensajeGuardado.id
            );


            // -----------------------------------------
            // 8. ACTUALIZAR CLIENTE
            // -----------------------------------------

            await supabase

                .from("clientes")

                .update({

                    ultima_interaccion:
                        new Date().toISOString()

                })

                .eq(
                    "id",
                    cliente.id
                );


            // -----------------------------------------
            // 9. RESPUESTA DE BIENVENIDA
            //    SOLAMENTE PARA TICKET NUEVO
            // -----------------------------------------

            if (
                tipo === "text" &&
                esNuevaConversacion
            ) {

                const respuesta =
                    "Hola 👋 Bienvenido a TR Soporte. ¿En qué podemos ayudarte?";


                const resultado =
                    await enviarMensajeWhatsApp(
                        telefono,
                        respuesta
                    );


                // -------------------------------------
                // GUARDAR BIENVENIDA COMO MENSAJE
                // -------------------------------------

                const whatsappMessageIdSalida =
                    resultado.messages?.[0]?.id ||
                    null;


                const {
                    error: errorMensajeSalida
                } = await supabase

                    .from("mensajes")

                    .insert({

                        cliente_id:
                            cliente.id,

                        conversacion_id:
                            conversacion.id,

                        whatsapp_message_id:
                            whatsappMessageIdSalida,

                        direccion:
                            "saliente",

                        tipo:
                            "text",

                        contenido:
                            respuesta,

                        estado:
                            "enviado"

                    });


                if (errorMensajeSalida) {
                    throw errorMensajeSalida;
                }


                // -------------------------------------
                // HISTORIAL
                // -------------------------------------

                const {
                    error: errorHistorialSalida
                } = await supabase

                    .from("ticket_historial")

                    .insert({

                        conversacion_id:
                            conversacion.id,

                        agente_id:
                            null,

                        accion:
                            "mensaje_enviado",

                        detalle:
                            "Mensaje automático de bienvenida enviado al cliente."

                    });


                if (errorHistorialSalida) {
                    throw errorHistorialSalida;
                }

            }

        }

    } catch (error) {

        console.error(
            "ERROR PROCESANDO MENSAJE:"
        );

        console.error(error);

    }

}


// =====================================================
// SERVIDOR HTTP
// =====================================================

const server =
    http.createServer(
        (req, res) => {

            const parsedUrl =
                url.parse(
                    req.url,
                    true
                );


            // =========================================
            // PÁGINA PRINCIPAL
            // =========================================

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


            // =========================================
            // VERIFICACIÓN WEBHOOK META
            // =========================================

            if (
                req.method === "GET" &&
                parsedUrl.pathname === "/webhook"
            ) {

                const mode =
                    parsedUrl.query["hub.mode"];

                const token =
                    parsedUrl.query[
                        "hub.verify_token"
                    ];

                const challenge =
                    parsedUrl.query[
                        "hub.challenge"
                    ];


                if (
                    mode === "subscribe" &&
                    token === VERIFY_TOKEN
                ) {

                    console.log(
                        "Webhook verificado correctamente."
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
                        "Error de verificación del Webhook."
                    );


                    res.writeHead(403);

                    res.end(
                        "Forbidden"
                    );

                }


                return;
            }


            // =========================================
            // RECEPCIÓN DE WHATSAPP
            // =========================================

            if (
                req.method === "POST" &&
                parsedUrl.pathname === "/webhook"
            ) {

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
                    async () => {

                        try {

                            const data =
                                JSON.parse(body);


                            console.log(
                                "================================="
                            );

                            console.log(
                                "EVENTO RECIBIDO DE WHATSAPP"
                            );

                            console.log(
                                "================================="
                            );

                            console.log(
                                JSON.stringify(data)
                            );


                            await procesarMensajeWhatsApp(
                                data
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
                                    status:
                                        "received"
                                })
                            );


                        } catch (error) {

                            console.error(
                                "ERROR EN WEBHOOK:"
                            );

                            console.error(
                                error
                            );


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
                                        error.message

                                })
                            );

                        }

                    }
                );


                return;
            }


            // =========================================
            // ENVIAR MENSAJE DESDE EL PANEL
            // =========================================

            if (
                req.method === "POST" &&
                parsedUrl.pathname === "/send-message"
            ) {

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


                            // ---------------------------------
                            // VALIDAR
                            // ---------------------------------

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


                            // ---------------------------------
                            // ENVIAR A WHATSAPP
                            // ---------------------------------

                            const resultado =
                                await enviarMensajeWhatsApp(
                                    to,
                                    message
                                );


                            // ---------------------------------
                            // GUARDAR EN SUPABASE
                            // ---------------------------------

                            if (conversacionId) {

                                const {
                                    data: conversacion,
                                    error:
                                        errorConversacion
                                } = await supabase

                                    .from(
                                        "conversaciones"
                                    )

                                    .select(
                                        "cliente_id"
                                    )

                                    .eq(
                                        "id",
                                        conversacionId
                                    )

                                    .single();


                                if (
                                    errorConversacion
                                ) {

                                    throw
                                        errorConversacion;

                                }


                                const whatsappMessageId =
                                    resultado
                                        .messages?.[0]?.id ||
                                    null;


                                // -------------------------
                                // GUARDAR MENSAJE
                                // -------------------------

                                const {
                                    error:
                                        errorMensaje
                                } = await supabase

                                    .from(
                                        "mensajes"
                                    )

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

                                    throw
                                        errorMensaje;

                                }


                                // -------------------------
                                // ACTUALIZAR INTERACCIÓN
                                // -------------------------

                                const {
                                    error:
                                        errorActualizacion
                                } = await supabase

                                    .from(
                                        "conversaciones"
                                    )

                                    .update({

                                        ultima_interaccion:
                                            new Date()
                                                .toISOString()

                                    })

                                    .eq(
                                        "id",
                                        conversacionId
                                    );


                                if (
                                    errorActualizacion
                                ) {

                                    throw
                                        errorActualizacion;

                                }


                                // -------------------------
                                // HISTORIAL
                                // -------------------------

                                const {
                                    error:
                                        errorHistorial
                                } = await supabase

                                    .from(
                                        "ticket_historial"
                                    )

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

                                    throw
                                        errorHistorial;

                                }

                            }


                            // ---------------------------------
                            // RESPUESTA AL PANEL
                            // ---------------------------------

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
                                        resultado

                                })
                            );


                        } catch (error) {

                            console.error(
                                "ERROR EN /send-message:"
                            );

                            console.error(
                                error
                            );


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


            // =========================================
            // RUTA NO ENCONTRADA
            // =========================================

            res.writeHead(404);

            res.end(
                "Not Found"
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
