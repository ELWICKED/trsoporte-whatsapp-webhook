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
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
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

        console.error("ERROR ENVIANDO MENSAJE DE WHATSAPP:");
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

            const whatsappMessageId = message.id;
            const telefono = message.from;

            let tipo = message.type;
            let contenido = "";

            if (tipo === "text") {

                contenido = message.text?.body || "";

            } else {

                contenido = `[Mensaje de tipo ${tipo}]`;

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

            let { data: cliente, error: errorCliente } =
                await supabase
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

                const { data: nuevoCliente, error } =
                    await supabase
                        .from("clientes")
                        .insert({
                            telefono: telefono,
                            nombre: nombre,
                            activo: true,
                            baja_comunicaciones: false
                        })
                        .select()
                        .single();

                if (error) {
                    throw error;
                }

                cliente = nuevoCliente;

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
                    .eq("id", cliente.id);
            }


            // -----------------------------------------
            // 3. BUSCAR CONVERSACIÓN ABIERTA
            // -----------------------------------------

            let { data: conversacion, error: errorConversacion } =
                await supabase
                    .from("conversaciones")
                    .select("*")
                    .eq("cliente_id", cliente.id)
                    .eq("estado", "abierta")
                    .order("ultima_interaccion", {
                        ascending: false
                    })
                    .limit(1)
                    .maybeSingle();

            if (errorConversacion) {
                throw errorConversacion;
            }


            // -----------------------------------------
            // 4. CREAR CONVERSACIÓN SI NO EXISTE
            // -----------------------------------------

            if (!conversacion) {

                const {
                    data: nuevaConversacion,
                    error
                } = await supabase
                    .from("conversaciones")
                    .insert({
                        cliente_id: cliente.id,
                        estado: "abierta"
                    })
                    .select()
                    .single();

                if (error) {
                    throw error;
                }

                conversacion = nuevaConversacion;

                console.log(
                    "Nueva conversación creada:",
                    conversacion.id
                );

            } else {

                console.log(
                    "Conversación existente:",
                    conversacion.id
                );

                await supabase
                    .from("conversaciones")
                    .update({
                        ultima_interaccion:
                            new Date().toISOString()
                    })
                    .eq("id", conversacion.id);
            }


            // -----------------------------------------
            // 5. GUARDAR MENSAJE ENTRANTE
            // -----------------------------------------

            const {
                data: mensajeGuardado,
                error: errorMensaje
            } = await supabase
                .from("mensajes")
                .insert({
                    cliente_id: cliente.id,
                    conversacion_id: conversacion.id,
                    whatsapp_message_id: whatsappMessageId,
                    direccion: "entrante",
                    tipo: tipo,
                    contenido: contenido,
                    estado: "recibido"
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
            // 6. RESPUESTA AUTOMÁTICA
            // -----------------------------------------

            if (tipo === "text") {

                const respuesta =
                    "Hola 👋 Gracias por comunicarte con TR Soporte. ¿En qué podemos ayudarte?";

                await enviarMensajeWhatsApp(
                    telefono,
                    respuesta
                );

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

const server = http.createServer((req, res) => {

    const parsedUrl = url.parse(req.url, true);


    // -----------------------------------------
    // PÁGINA PRINCIPAL
    // -----------------------------------------

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/"
    ) {

        res.writeHead(200, {
            "Content-Type": "text/plain"
        });

        res.end(
            "TR Soporte - WhatsApp Webhook funcionando."
        );

        return;
    }


    // -----------------------------------------
    // VERIFICACIÓN DEL WEBHOOK DE META
    // -----------------------------------------

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


    // -----------------------------------------
    // RECEPCIÓN DE EVENTOS DE WHATSAPP
    // -----------------------------------------

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

                const data = JSON.parse(body);

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

                await procesarMensajeWhatsApp(data);

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });

                res.end(
                    JSON.stringify({
                        status: "received"
                    })
                );

            } catch (error) {

                console.error(
                    "ERROR EN WEBHOOK:"
                );

                console.error(error);

                res.writeHead(400, {
                    "Content-Type": "application/json"
                });

                res.end(
                    JSON.stringify({
                        error: error.message
                    })
                );
            }

        });

        return;
    }


    // -----------------------------------------
    // RUTA NO ENCONTRADA
    // -----------------------------------------

    res.writeHead(404);

    res.end("Not Found");

});


// =====================================================
// INICIAR SERVIDOR
// =====================================================

server.listen(PORT, () => {

    console.log(
        `Servidor iniciado en el puerto ${PORT}`
    );

});
