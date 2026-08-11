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
// FUNCIONES AUXILIARES
// =====================================================

async function obtenerOCrearCliente(telefono, nombre) {

    // Buscar cliente existente
    const { data: clienteExistente, error: errorBusqueda } =
        await supabase
            .from("clientes")
            .select("*")
            .eq("telefono", telefono)
            .maybeSingle();

    if (errorBusqueda) {
        throw new Error(
            "Error buscando cliente: " + errorBusqueda.message
        );
    }

    // Si existe, actualizar última interacción
    if (clienteExistente) {

        const { data: clienteActualizado, error: errorActualizacion } =
            await supabase
                .from("clientes")
                .update({
                    nombre: nombre || clienteExistente.nombre,
                    ultima_interaccion: new Date().toISOString()
                })
                .eq("id", clienteExistente.id)
                .select()
                .single();

        if (errorActualizacion) {
            throw new Error(
                "Error actualizando cliente: " +
                errorActualizacion.message
            );
        }

        return clienteActualizado;
    }


    // Crear nuevo cliente
    const { data: nuevoCliente, error: errorCreacion } =
        await supabase
            .from("clientes")
            .insert({
                telefono: telefono,
                nombre: nombre || "Sin nombre",
                activo: true,
                baja_comunicaciones: false,
                fecha_alta: new Date().toISOString(),
                ultima_interaccion: new Date().toISOString()
            })
            .select()
            .single();

    if (errorCreacion) {
        throw new Error(
            "Error creando cliente: " +
            errorCreacion.message
        );
    }

    console.log("Nuevo cliente creado:", nuevoCliente.id);

    return nuevoCliente;
}


// =====================================================
// OBTENER O CREAR CONVERSACIÓN
// =====================================================

async function obtenerOCrearConversacion(clienteId) {

    // Buscar conversación abierta
    const { data: conversacionExistente, error: errorBusqueda } =
        await supabase
            .from("conversaciones")
            .select("*")
            .eq("cliente_id", clienteId)
            .eq("estado", "abierta")
            .order("ultima_interaccion", {
                ascending: false
            })
            .limit(1)
            .maybeSingle();

    if (errorBusqueda) {
        throw new Error(
            "Error buscando conversación: " +
            errorBusqueda.message
        );
    }


    // Si ya existe, actualizar interacción
    if (conversacionExistente) {

        const { data: conversacionActualizada, error: errorActualizacion } =
            await supabase
                .from("conversaciones")
                .update({
                    ultima_interaccion: new Date().toISOString()
                })
                .eq("id", conversacionExistente.id)
                .select()
                .single();

        if (errorActualizacion) {
            throw new Error(
                "Error actualizando conversación: " +
                errorActualizacion.message
            );
        }

        return conversacionActualizada;
    }


    // Crear conversación nueva
    const { data: nuevaConversacion, error: errorCreacion } =
        await supabase
            .from("conversaciones")
            .insert({
                cliente_id: clienteId,
                estado: "abierta",
                ultima_interaccion: new Date().toISOString(),
                creado_en: new Date().toISOString()
            })
            .select()
            .single();

    if (errorCreacion) {
        throw new Error(
            "Error creando conversación: " +
            errorCreacion.message
        );
    }

    console.log(
        "Nueva conversación creada:",
        nuevaConversacion.id
    );

    return nuevaConversacion;
}


// =====================================================
// GUARDAR MENSAJE
// =====================================================

async function guardarMensaje({
    clienteId,
    conversacionId,
    whatsappMessageId,
    tipo,
    contenido
}) {

    // Evitar mensajes duplicados
    if (whatsappMessageId) {

        const { data: mensajeExistente, error: errorBusqueda } =
            await supabase
                .from("mensajes")
                .select("id")
                .eq(
                    "whatsapp_message_id",
                    whatsappMessageId
                )
                .maybeSingle();

        if (errorBusqueda) {
            throw new Error(
                "Error verificando mensaje existente: " +
                errorBusqueda.message
            );
        }

        if (mensajeExistente) {

            console.log(
                "Mensaje duplicado ignorado:",
                whatsappMessageId
            );

            return mensajeExistente;
        }
    }


    // Guardar mensaje
    const { data: mensaje, error } =
        await supabase
            .from("mensajes")
            .insert({
                cliente_id: clienteId,
                conversacion_id: conversacionId,
                whatsapp_message_id: whatsappMessageId,
                direccion: "entrante",
                tipo: tipo,
                contenido: contenido,
                estado: "recibido",
                recibido_en: new Date().toISOString()
            })
            .select()
            .single();

    if (error) {
        throw new Error(
            "Error guardando mensaje: " +
            error.message
        );
    }

    console.log(
        "Mensaje guardado correctamente. ID:",
        mensaje.id
    );

    return mensaje;
}


// =====================================================
// SERVIDOR HTTP
// =====================================================

const server = http.createServer((req, res) => {

    const parsedUrl = url.parse(
        req.url,
        true
    );


    // =================================================
    // PÁGINA PRINCIPAL
    // =================================================

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/"
    ) {

        res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        res.end(
            "TR Soporte - WhatsApp Webhook funcionando."
        );

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


        if (
            mode === "subscribe" &&
            token === VERIFY_TOKEN
        ) {

            console.log(
                "Webhook verificado correctamente."
            );

            res.writeHead(200, {
                "Content-Type": "text/plain"
            });

            res.end(challenge);

        } else {

            console.log(
                "Error de verificación del Webhook."
            );

            res.writeHead(403);

            res.end("Forbidden");
        }

        return;
    }


    // =================================================
    // RECEPCIÓN DE EVENTOS DE WHATSAPP
    // =================================================

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/webhook"
    ) {

        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });


        req.on("end", async () => {

            try {

                console.log(
                    "=========================================="
                );

                console.log(
                    "EVENTO RECIBIDO DE WHATSAPP"
                );

                console.log(
                    "=========================================="
                );


                const data = JSON.parse(body);

                console.log(
                    "Evento:",
                    JSON.stringify(data)
                );


                // -----------------------------------------
                // Validar estructura de WhatsApp
                // -----------------------------------------

                const entries = data.entry || [];


                for (const entry of entries) {

                    const changes =
                        entry.changes || [];


                    for (const change of changes) {

                        const value =
                            change.value;


                        // ---------------------------------
                        // MENSAJES
                        // ---------------------------------

                        if (
                            change.field === "messages" &&
                            value &&
                            value.messages
                        ) {

                            const contactos =
                                value.contacts || [];


                            for (
                                const message
                                of value.messages
                            ) {

                                const telefono =
                                    message.from;

                                const whatsappMessageId =
                                    message.id;


                                // -------------------------
                                // Nombre del contacto
                                // -------------------------

                                let nombre =
                                    "Sin nombre";


                                if (
                                    contactos.length > 0 &&
                                    contactos[0].profile
                                ) {

                                    nombre =
                                        contactos[0]
                                            .profile
                                            .name ||
                                        "Sin nombre";
                                }


                                // -------------------------
                                // Tipo de mensaje
                                // -------------------------

                                let tipo =
                                    message.type ||
                                    "desconocido";


                                // -------------------------
                                // Contenido
                                // -------------------------

                                let contenido = "";


                                if (
                                    message.type ===
                                    "text"
                                ) {

                                    contenido =
                                        message.text?.body ||
                                        "";

                                } else if (
                                    message.type ===
                                    "image"
                                ) {

                                    contenido =
                                        "[Imagen]";

                                } else if (
                                    message.type ===
                                    "audio"
                                ) {

                                    contenido =
                                        "[Audio]";

                                } else if (
                                    message.type ===
                                    "video"
                                ) {

                                    contenido =
                                        "[Video]";

                                } else if (
                                    message.type ===
                                    "document"
                                ) {

                                    contenido =
                                        "[Documento]";

                                } else if (
                                    message.type ===
                                    "location"
                                ) {

                                    contenido =
                                        "[Ubicación]";

                                } else {

                                    contenido =
                                        `[${tipo}]`;
                                }


                                console.log(
                                    "Teléfono:",
                                    telefono
                                );

                                console.log(
                                    "Nombre:",
                                    nombre
                                );

                                console.log(
                                    "Tipo:",
                                    tipo
                                );

                                console.log(
                                    "Contenido:",
                                    contenido
                                );


                                // -------------------------
                                // CLIENTE
                                // -------------------------

                                const cliente =
                                    await obtenerOCrearCliente(
                                        telefono,
                                        nombre
                                    );


                                // -------------------------
                                // CONVERSACIÓN
                                // -------------------------

                                const conversacion =
                                    await obtenerOCrearConversacion(
                                        cliente.id
                                    );


                                // -------------------------
                                // MENSAJE
                                // -------------------------

                                await guardarMensaje({
                                    clienteId:
                                        cliente.id,

                                    conversacionId:
                                        conversacion.id,

                                    whatsappMessageId:
                                        whatsappMessageId,

                                    tipo:
                                        tipo,

                                    contenido:
                                        contenido
                                });


                                console.log(
                                    "=========================================="
                                );

                                console.log(
                                    "MENSAJE PROCESADO CORRECTAMENTE"
                                );

                                console.log(
                                    "Cliente:",
                                    cliente.id
                                );

                                console.log(
                                    "Conversación:",
                                    conversacion.id
                                );

                                console.log(
                                    "=========================================="
                                );
                            }
                        }


                        // ---------------------------------
                        // ESTADOS DE MENSAJES
                        // ---------------------------------

                        if (
                            change.field === "messages" &&
                            value &&
                            value.statuses
                        ) {

                            console.log(
                                "Actualización de estado recibida."
                            );
                        }
                    }
                }


                // -----------------------------------------
                // RESPUESTA A META
                // -----------------------------------------

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        status: "received"
                    })
                );


            } catch (error) {

                console.error(
                    "ERROR PROCESANDO WEBHOOK:"
                );

                console.error(error);


                // Importante:
                // Respondemos 200 para evitar que Meta
                // reintente inmediatamente el evento.

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        status: "error",
                        message: error.message
                    })
                );
            }
        });

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

        req.on("data", chunk => {
            body += chunk.toString();
        });


        req.on("end", async () => {

            try {

                const data =
                    JSON.parse(body);


                const to =
                    data.to;

                const message =
                    data.message;


                if (!to || !message) {

                    res.writeHead(400, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(
                        JSON.stringify({
                            error:
                                "Faltan los campos 'to' y 'message'."
                        })
                    );

                    return;
                }


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
                                        "template",

                                    template: {
                                        name:
                                            "3p_direct_integration_test_template",

                                        language: {
                                            code:
                                                "en_US"
                                        }
                                    }
                                })
                        }
                    );


                const result =
                    await response.json();


                console.log(
                    "Respuesta de Meta:"
                );

                console.log(result);


                res.writeHead(
                    response.status,
                    {
                        "Content-Type":
                            "application/json"
                    }
                );

                res.end(
                    JSON.stringify(result)
                );


            } catch (error) {

                console.error(
                    "Error enviando mensaje:"
                );

                console.error(error);


                res.writeHead(500, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        error:
                            error.message
                    })
                );
            }
        });

        return;
    }


    // =================================================
    // RUTA NO ENCONTRADA
    // =================================================

    res.writeHead(404);

    res.end("Not Found");
});


// =====================================================
// INICIAR SERVIDOR
// =====================================================

server.listen(PORT, async () => {

    console.log(
        `Servidor iniciado en el puerto ${PORT}`
    );


    // Comprobar conexión con Supabase
    try {

        const { error } =
            await supabase
                .from("clientes")
                .select("id")
                .limit(1);


        if (error) {

            console.error(
                "ERROR CONECTANDO A SUPABASE:"
            );

            console.error(
                error.message
            );

        } else {

            console.log(
                "=========================================="
            );

            console.log(
                "SUPABASE CONECTADO CORRECTAMENTE"
            );

            console.log(
                "=========================================="
            );
        }

    } catch (error) {

        console.error(
            "Error comprobando Supabase:"
        );

        console.error(error);
    }
});
