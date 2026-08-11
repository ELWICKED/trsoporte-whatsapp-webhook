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

// =====================================================
// ALMACENAMIENTO MULTIMEDIA
// =====================================================

const WHATSAPP_MEDIA_BUCKET =
    "whatsapp-media";

console.log(
    "Cliente de Supabase inicializado."
);

// =====================================================
// RESPONDER JSON
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
// LEER BODY
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
                error => {

                    reject(error);

                }
            );
        }
    );
}

// =====================================================
// MULTIMEDIA DE WHATSAPP
// =====================================================

function obtenerExtensionMedia(
    mimeType,
    nombreArchivo = ""
) {

    const nombre =
        String(
            nombreArchivo || ""
        ).trim();

    if (nombre.includes(".")) {

        const extension =
            nombre
                .split(".")
                .pop()
                .toLowerCase();

        if (
            extension &&
            extension.length <= 10
        ) {
            return extension;
        }
    }

    const mapa = {

        "image/jpeg": "jpg",

        "image/jpg": "jpg",

        "image/png": "png",

        "image/webp": "webp",

        "image/gif": "gif",

        "video/mp4": "mp4",

        "video/3gpp": "3gp",

        "audio/aac": "aac",

        "audio/amr": "amr",

        "audio/mpeg": "mp3",

        "audio/mp4": "m4a",

        "audio/ogg": "ogg",

        "application/pdf": "pdf",

        "application/msword": "doc",

        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            "docx",

        "application/vnd.ms-excel": "xls",

        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            "xlsx",

        "application/vnd.ms-powerpoint": "ppt",

        "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            "pptx",

        "text/plain": "txt",

        "application/zip": "zip",

        "application/octet-stream": "bin"
    };

    return mapa[mimeType] || "bin";
}

async function descargarMediaWhatsApp(
    mediaId
) {

    if (!mediaId) {

        throw new Error(
            "Falta media_id de WhatsApp."
        );
    }

    const mediaInfoUrl =
        `https://graph.facebook.com/v26.0/${mediaId}`;

    const infoResponse =
        await fetch(
            mediaInfoUrl,
            {
                method: "GET",

                headers: {
                    "Authorization":
                        `Bearer ${ACCESS_TOKEN}`
                }
            }
        );

    const info =
        await infoResponse.json();

    if (
        !infoResponse.ok ||
        !info.url
    ) {

        throw new Error(
            info?.error?.message ||
            "No se pudo obtener la URL del archivo multimedia desde Meta."
        );
    }

    const mediaResponse =
        await fetch(
            info.url,
            {
                method: "GET",

                headers: {
                    "Authorization":
                        `Bearer ${ACCESS_TOKEN}`
                }
            }
        );

    if (!mediaResponse.ok) {

        const errorTexto =
            await mediaResponse.text();

        throw new Error(
            `No se pudo descargar el archivo multimedia de WhatsApp. ${errorTexto}`
        );
    }

    const buffer =
        Buffer.from(
            await mediaResponse.arrayBuffer()
        );

    return {

        buffer: buffer,

        mimeType:
            info.mime_type ||
            mediaResponse.headers.get(
                "content-type"
            ) ||
            "application/octet-stream",

        sha256:
            info.sha256 ||
            null
    };
}

async function guardarMediaWhatsApp(
    mediaId,
    mimeType,
    nombreArchivo,
    buffer
) {

    const extension =
        obtenerExtensionMedia(
            mimeType,
            nombreArchivo
        );

    const nombreSeguro =
        String(
            nombreArchivo ||
            `media_${mediaId}`
        )
        .replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        );

    const timestamp =
        Date.now();

    const ruta =
        `${timestamp}_${mediaId}_${nombreSeguro}`;

    const {
        error
    } =
        await supabase.storage
            .from(
                WHATSAPP_MEDIA_BUCKET
            )
            .upload(
                ruta,
                buffer,
                {
                    contentType:
                        mimeType,

                    upsert:
                        false
                }
            );

    if (error) {

        throw new Error(
            "Error guardando multimedia en Supabase Storage: " +
            error.message
        );
    }

    const {
        data
    } =
        supabase.storage
            .from(
                WHATSAPP_MEDIA_BUCKET
            )
            .getPublicUrl(
                ruta
            );

    return {

        ruta: ruta,

        url:
            data?.publicUrl ||
            null,

        extension:
            extension
    };
}

// =====================================================
// CREAR BUCKET MULTIMEDIA
// =====================================================

async function asegurarBucketMultimedia() {

    try {

        const {
            data: buckets,
            error
        } =
            await supabase
                .storage
                .listBuckets();

        if (error) {

            console.log(
                "No se pudieron consultar los buckets de Supabase:",
                error.message
            );

            return;
        }

        const existe =
            buckets.some(
                bucket =>
                    bucket.name ===
                    WHATSAPP_MEDIA_BUCKET
            );

        if (existe) {

            console.log(
                `Bucket "${WHATSAPP_MEDIA_BUCKET}" encontrado.`
            );

            return;
        }

        const {
            error: crearError
        } =
            await supabase
                .storage
                .createBucket(
                    WHATSAPP_MEDIA_BUCKET,
                    {
                        public: true
                    }
                );

        if (crearError) {

            console.log(
                "No se pudo crear el bucket multimedia:",
                crearError.message
            );

            return;
        }

        console.log(
            `Bucket "${WHATSAPP_MEDIA_BUCKET}" creado correctamente.`
        );

    } catch (error) {

        console.log(
            "Error comprobando bucket multimedia:",
            error.message
        );
    }
}

// =====================================================
// TEXTO DE MENSAJE
// =====================================================

function obtenerTextoMensaje(
    message
) {

    if (
        !message ||
        !message.type
    ) {

        return "";
    }

    switch (
        message.type
    ) {

        case "text":

            return (
                message.text?.body ||
                ""
            );

        case "image":

            return (
                message.image?.caption ||
                ""
            );

        case "video":

            return (
                message.video?.caption ||
                ""
            );

        case "document":

            return (
                message.document?.caption ||
                ""
            );

        case "audio":

            return "";

        case "sticker":

            return "";

        default:

            return "";
    }
}

// =====================================================
// OBTENER INFORMACIÓN MULTIMEDIA
// =====================================================

function obtenerInformacionMedia(
    message
) {

    if (
        !message ||
        !message.type
    ) {

        return null;
    }

    let media = null;

    switch (
        message.type
    ) {

        case "image":

            media =
                message.image;

            break;

        case "video":

            media =
                message.video;

            break;

        case "audio":

            media =
                message.audio;

            break;

        case "document":

            media =
                message.document;

            break;

        case "sticker":

            media =
                message.sticker;

            break;

        default:

            return null;
    }

    if (!media) {

        return null;
    }

    return {

        mediaId:
            media.id ||
            null,

        mimeType:
            media.mime_type ||
            null,

        sha256:
            media.sha256 ||
            null,

        filename:
            media.filename ||
            null,

        caption:
            media.caption ||
            ""
    };
}

// =====================================================
// DESCRIPCIÓN DEL MENSAJE
// =====================================================

function obtenerDescripcionMensaje(
    message,
    mediaInfo = null
) {

    if (
        !message ||
        !message.type
    ) {

        return "";
    }

    const tipo =
        message.type;

    if (tipo === "text") {

        return (
            message.text?.body ||
            ""
        );
    }

    if (mediaInfo) {

        if (
            mediaInfo.caption
        ) {

            return mediaInfo.caption;
        }

        if (
            mediaInfo.filename
        ) {

            return mediaInfo.filename;
        }
    }

    return `[Mensaje de tipo ${tipo}]`;
}

// =====================================================
// PROCESAR MULTIMEDIA
// =====================================================

async function procesarMultimedia(
    message
) {

    const mediaInfo =
        obtenerInformacionMedia(
            message
        );

    if (!mediaInfo) {

        return null;
    }

    if (!mediaInfo.mediaId) {

        throw new Error(
            "El mensaje multimedia no contiene media_id."
        );
    }

    console.log(
        `Procesando multimedia: ${message.type} - ${mediaInfo.mediaId}`
    );

    const descargado =
        await descargarMediaWhatsApp(
            mediaInfo.mediaId
        );

    const mimeType =
        mediaInfo.mimeType ||
        descargado.mimeType;

    const guardado =
        await guardarMediaWhatsApp(
            mediaInfo.mediaId,
            mimeType,
            mediaInfo.filename,
            descargado.buffer
        );

    console.log(
        "Multimedia guardada:",
        guardado.url
    );

    return {

        media_id:
            mediaInfo.mediaId,

        media_url:
            guardado.url,

        media_path:
            guardado.ruta,

        mime_type:
            mimeType,

        nombre_archivo:
            mediaInfo.filename ||
            null,

        sha256:
            mediaInfo.sha256 ||
            descargado.sha256 ||
            null,

        extension:
            guardado.extension
    };
}

// =====================================================
// OBTENER NÚMERO DE TELÉFONO DEL CONTACTO
// =====================================================

function obtenerTelefonoContacto(
    value
) {

    if (!value) {
        return "";
    }

    return String(value).trim();
}

// =====================================================
// OBTENER NOMBRE DEL CONTACTO
// =====================================================

function obtenerNombreContacto(
    contact
) {

    if (!contact) {
        return "Cliente";
    }

    return (
        contact.profile?.name ||
        contact.wa_id ||
        "Cliente"
    );
}

// =====================================================
// BUSCAR CLIENTE POR TELÉFONO
// =====================================================

async function buscarClientePorTelefono(
    telefono
) {

    const {
        data,
        error
    } =
        await supabase
            .from("clientes")
            .select("*")
            .eq(
                "telefono",
                telefono
            )
            .maybeSingle();

    if (error) {

        throw new Error(
            "Error buscando cliente: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// CREAR CLIENTE
// =====================================================

async function crearCliente(
    telefono,
    nombre
) {

    const {
        data,
        error
    } =
        await supabase
            .from("clientes")
            .insert(
                {
                    telefono:
                        telefono,

                    nombre:
                        nombre,

                    activo:
                        true,

                    baja_comunicaciones:
                        false
                }
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error creando cliente: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// OBTENER O CREAR CLIENTE
// =====================================================

async function obtenerOCrearCliente(
    telefono,
    nombre
) {

    let cliente =
        await buscarClientePorTelefono(
            telefono
        );

    if (cliente) {

        // Actualizar nombre si tenemos
        // un nombre nuevo y el actual está vacío.
        if (
            nombre &&
            (
                !cliente.nombre ||
                cliente.nombre === "Cliente"
            )
        ) {

            const {
                data,
                error
            } =
                await supabase
                    .from("clientes")
                    .update(
                        {
                            nombre:
                                nombre,

                            ultima_interaccion:
                                new Date().toISOString()
                        }
                    )
                    .eq(
                        "id",
                        cliente.id
                    )
                    .select("*")
                    .single();

            if (!error && data) {

                cliente = data;
            }
        }

        return cliente;
    }

    return await crearCliente(
        telefono,
        nombre
    );
}

// =====================================================
// BUSCAR CONVERSACIÓN ABIERTA
// =====================================================

async function buscarConversacion(
    clienteId
) {

    const {
        data,
        error
    } =
        await supabase
            .from("conversaciones")
            .select("*")
            .eq(
                "cliente_id",
                clienteId
            )
            .neq(
                "estado",
                "cerrada"
            )
            .order(
                "ultima_interaccion",
                {
                    ascending: false
                }
            )
            .limit(1)
            .maybeSingle();

    if (error) {

        throw new Error(
            "Error buscando conversación: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// CREAR CONVERSACIÓN
// =====================================================

async function crearConversacion(
    clienteId
) {

    const ahora =
        new Date().toISOString();

    const {
        data,
        error
    } =
        await supabase
            .from("conversaciones")
            .insert(
                {
                    cliente_id:
                        clienteId,

                    estado:
                        "abierta",

                    ultima_interaccion:
                        ahora
                }
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error creando conversación: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// OBTENER O CREAR CONVERSACIÓN
// =====================================================

async function obtenerOCrearConversacion(
    clienteId
) {

    let conversacion =
        await buscarConversacion(
            clienteId
        );

    if (conversacion) {

        return conversacion;
    }

    return await crearConversacion(
        clienteId
    );
}

// =====================================================
// OBTENER ÚLTIMO TICKET DE CONVERSACIÓN
// =====================================================

async function buscarTicketPorConversacion(
    conversacionId
) {

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .select("*")
            .eq(
                "cliente_id",
                (
                    await supabase
                        .from("conversaciones")
                        .select("cliente_id")
                        .eq(
                            "id",
                            conversacionId
                        )
                        .single()
                ).data?.cliente_id
            )
            .order(
                "creado_en",
                {
                    ascending: false
                }
            )
            .limit(1)
            .maybeSingle();

    if (error) {

        throw new Error(
            "Error buscando ticket: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// OBTENER SIGUIENTE NÚMERO DE TICKET
// =====================================================

async function obtenerSiguienteNumeroTicket() {

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .select("numero_ticket")
            .order(
                "numero_ticket",
                {
                    ascending: false
                }
            )
            .limit(1)
            .maybeSingle();

    if (error) {

        throw new Error(
            "Error obteniendo número de ticket: " +
            error.message
        );
    }

    const ultimo =
        data &&
        data.numero_ticket
            ? Number(
                data.numero_ticket
            )
            : 100000;

    return ultimo + 1;
}

// =====================================================
// CREAR TICKET
// =====================================================

async function crearTicket(
    clienteId
) {

    const numeroTicket =
        await obtenerSiguienteNumeroTicket();

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .insert(
                {
                    numero_ticket:
                        numeroTicket,

                    cliente_id:
                        clienteId,

                    agente_id:
                        null,

                    estado:
                        "abierta",

                    prioridad:
                        "normal",

                    categoria:
                        null,

                    ultima_interaccion:
                        new Date().toISOString()
                }
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error creando ticket: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// OBTENER O CREAR TICKET
// =====================================================

async function obtenerOCrearTicket(
    clienteId,
    conversacionId
) {

    const ticket =
        await buscarTicketPorConversacion(
            conversacionId
        );

    if (ticket) {

        // Si existe pero está cerrado,
        // creamos uno nuevo para la nueva conversación.
        if (
            String(
                ticket.estado || ""
            ).toLowerCase() ===
            "cerrada"
        ) {

            return await crearTicket(
                clienteId
            );
        }

        return ticket;
    }

    return await crearTicket(
        clienteId
    );
}

// =====================================================
// GUARDAR MENSAJE
// =====================================================

async function guardarMensaje(
    {
        clienteId,
        conversacionId,
        whatsappMessageId,
        direccion,
        tipo,
        contenido,
        estado,
        recibidoEn,
        multimedia
    }
) {

    const datosMensaje = {

        cliente_id:
            clienteId,

        conversacion_id:
            conversacionId,

        whatsapp_message_id:
            whatsappMessageId,

        direccion:
            direccion,

        tipo:
            tipo,

        contenido:
            contenido,

        estado:
            estado,

        recibido_en:
            recibidoEn
    };

    /*
     * IMPORTANTE:
     *
     * No agregamos columnas multimedia
     * que no existan en tu tabla mensajes.
     *
     * La información multimedia se conserva
     * dentro de "contenido" en formato JSON.
     *
     * De esta forma no modificamos todavía
     * la estructura de Supabase.
     */

    if (multimedia) {

        datosMensaje.contenido =
            JSON.stringify(
                {
                    texto:
                        contenido || "",

                    media_id:
                        multimedia.media_id,

                    media_url:
                        multimedia.media_url,

                    media_path:
                        multimedia.media_path,

                    mime_type:
                        multimedia.mime_type,

                    nombre_archivo:
                        multimedia.nombre_archivo,

                    extension:
                        multimedia.extension,

                    sha256:
                        multimedia.sha256
                }
            );
    }

    const {
        data,
        error
    } =
        await supabase
            .from("mensajes")
            .insert(
                datosMensaje
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error guardando mensaje: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// ACTUALIZAR CLIENTE
// =====================================================

async function actualizarInteraccionCliente(
    clienteId
) {

    const {
        error
    } =
        await supabase
            .from("clientes")
            .update(
                {
                    ultima_interaccion:
                        new Date().toISOString()
                }
            )
            .eq(
                "id",
                clienteId
            );

    if (error) {

        console.log(
            "No se pudo actualizar última interacción del cliente:",
            error.message
        );
    }
}

// =====================================================
// ACTUALIZAR CONVERSACIÓN
// =====================================================

async function actualizarInteraccionConversacion(
    conversacionId
) {

    const {
        error
    } =
        await supabase
            .from("conversaciones")
            .update(
                {
                    estado:
                        "abierta",

                    ultima_interaccion:
                        new Date().toISOString()
                }
            )
            .eq(
                "id",
                conversacionId
            );

    if (error) {

        console.log(
            "No se pudo actualizar conversación:",
            error.message
        );
    }
}

// =====================================================
// REGISTRAR HISTORIAL
// =====================================================

async function registrarHistorial(
    conversacionId,
    agenteId,
    accion,
    detalle
) {

    const {
        error
    } =
        await supabase
            .from("historial")
            .insert(
                {
                    conversacion_id:
                        conversacionId,

                    agente_id:
                        agenteId || null,

                    accion:
                        accion,

                    detalle:
                        detalle,

                    creado_en:
                        new Date().toISOString()
                }
            );

    if (error) {

        console.log(
            "No se pudo registrar historial:",
            error.message
        );
    }
}

// =====================================================
// PROCESAR MENSAJE ENTRANTE
// =====================================================

async function procesarMensajeEntrante(
    message,
    contacto
) {

    const telefono =
        obtenerTelefonoContacto(
            message.from
        );

    if (!telefono) {

        throw new Error(
            "El mensaje no contiene número de teléfono."
        );
    }

    const nombre =
        obtenerNombreContacto(
            contacto
        );

    console.log(
        "Cliente:",
        nombre
    );

    console.log(
        "Teléfono:",
        telefono
    );

    console.log(
        "Tipo de mensaje:",
        message.type
    );

    // =================================================
    // CLIENTE
    // =================================================

    const cliente =
        await obtenerOCrearCliente(
            telefono,
            nombre
        );

    // =================================================
    // CONVERSACIÓN
    // =================================================

    const conversacion =
        await obtenerOCrearConversacion(
            cliente.id
        );

    // =================================================
    // TICKET
    // =================================================

    const ticket =
        await obtenerOCrearTicket(
            cliente.id,
            conversacion.id
        );

    // =================================================
    // MULTIMEDIA
    // =================================================

    let multimedia = null;

    if (
        message.type !==
        "text"
    ) {

        try {

            multimedia =
                await procesarMultimedia(
                    message
                );

        } catch (error) {

            console.error(
                "Error procesando multimedia:",
                error.message
            );

            // No detenemos el procesamiento
            // del mensaje completo.
            multimedia = null;
        }
    }

    // =================================================
    // CONTENIDO
    // =================================================

    let contenido =
        obtenerDescripcionMensaje(
            message,
            obtenerInformacionMedia(
                message
            )
        );

    if (
        multimedia &&
        multimedia.nombre_archivo
    ) {

        contenido =
            multimedia.nombre_archivo;

    } else if (
        message.type ===
        "image"
    ) {

        contenido =
            "[Imagen recibida]";

    } else if (
        message.type ===
        "video"
    ) {

        contenido =
            "[Video recibido]";

    } else if (
        message.type ===
        "audio"
    ) {

        contenido =
            "[Audio recibido]";

    } else if (
        message.type ===
        "document"
    ) {

        contenido =
            "[Documento recibido]";

    } else if (
        message.type ===
        "sticker"
    ) {

        contenido =
            "[Sticker recibido]";
    }

    // =================================================
    // GUARDAR MENSAJE
    // =================================================

    await guardarMensaje(
        {
            clienteId:
                cliente.id,

            conversacionId:
                conversacion.id,

            whatsappMessageId:
                message.id,

            direccion:
                "entrante",

            tipo:
                message.type,

            contenido:
                contenido,

            estado:
                "recibido",

            recibidoEn:
                new Date().toISOString(),

            multimedia:
                multimedia
        }
    );

    // =================================================
    // ACTUALIZAR FECHAS
    // =================================================

    await actualizarInteraccionCliente(
        cliente.id
    );

    await actualizarInteraccionConversacion(
        conversacion.id
    );

    // =================================================
    // HISTORIAL
    // =================================================

    await registrarHistorial(
        conversacion.id,
        null,
        "mensaje_recibido",
        multimedia
            ? `Mensaje multimedia recibido (${message.type}).`
            : "Mensaje recibido desde WhatsApp."
    );

    return {

        cliente:
            cliente,

        conversacion:
            conversacion,

        ticket:
            ticket,

        multimedia:
            multimedia
    };
}

// =====================================================
// PROCESAR EVENTO DE WHATSAPP
// =====================================================

async function procesarEventoWhatsApp(
    body
) {

    if (
        !body ||
        body.object !==
        "whatsapp_business_account"
    ) {

        return;
    }

    const entries =
        body.entry || [];

    for (
        const entry
        of entries
    ) {

        const changes =
            entry.changes || [];

        for (
            const change
            of changes
        ) {

            const value =
                change.value;

            if (!value) {
                continue;
            }

            const contactos =
                value.contacts || [];

            const mensajes =
                value.messages || [];

            for (
                const message
                of mensajes
            ) {

                let contacto =
                    contactos.find(
                        c =>
                            c.wa_id ===
                            message.from
                    );

                if (!contacto) {

                    contacto =
                        contactos[0] ||
                        null;
                }

                try {

                    await procesarMensajeEntrante(
                        message,
                        contacto
                    );

                    console.log(
                        "Mensaje procesado correctamente:",
                        message.id
                    );

                } catch (error) {

                    console.error(
                        "Error procesando mensaje:",
                        error
                    );
                }
            }
        }
    }
}


// =====================================================
// CREAR TICKET AUTOMÁTICAMENTE SI ES NECESARIO
// =====================================================

async function asegurarTicketParaConversacion(
    clienteId,
    conversacionId
) {

    const {
        data: tickets,
        error
    } =
        await supabase
            .from("tickets")
            .select("*")
            .eq(
                "cliente_id",
                clienteId
            )
            .order(
                "creado_en",
                {
                    ascending: false
                }
            )
            .limit(1);

    if (error) {

        throw new Error(
            "Error consultando tickets: " +
            error.message
        );
    }

    if (
        tickets &&
        tickets.length > 0
    ) {

        const ticket =
            tickets[0];

        if (
            String(
                ticket.estado || ""
            ).toLowerCase() !==
            "cerrada"
        ) {

            return ticket;
        }
    }

    return await crearTicket(
        clienteId
    );
}

// =====================================================
// BUSCAR TICKET POR ID
// =====================================================

async function obtenerTicketPorId(
    id
) {

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .select(`
                *,
                cliente:clientes(
                    id,
                    nombre,
                    telefono,
                    empresa
                ),
                agente:agentes(
                    id,
                    nombre,
                    rol,
                    area,
                    activo
                )
            `)
            .eq(
                "id",
                id
            )
            .maybeSingle();

    if (error) {

        throw new Error(
            "Error consultando ticket: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// OBTENER TICKETS
// =====================================================

async function obtenerTickets() {

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .select(`
                *,
                cliente:clientes(
                    id,
                    nombre,
                    telefono,
                    empresa
                ),
                agente:agentes(
                    id,
                    nombre,
                    rol,
                    area,
                    activo
                )
            `)
            .order(
                "creado_en",
                {
                    ascending: false
                }
            );

    if (error) {

        throw new Error(
            "Error obteniendo tickets: " +
            error.message
        );
    }

    return data || [];
}

// =====================================================
// OBTENER MENSAJES DE TICKET
// =====================================================

async function obtenerMensajesTicket(
    ticket
) {

    if (!ticket) {

        return [];
    }

    const {
        data,
        error
    } =
        await supabase
            .from("mensajes")
            .select("*")
            .eq(
                "cliente_id",
                ticket.cliente_id
            )
            .order(
                "recibido_en",
                {
                    ascending: true
                }
            );

    if (error) {

        throw new Error(
            "Error obteniendo mensajes: " +
            error.message
        );
    }

    return data || [];
}

// =====================================================
// NORMALIZAR MENSAJE PARA EL C#
/*
 * Esta función permite que el frontend pueda
 * reconocer fácilmente si el contenido corresponde
 * a multimedia.
 */
// =====================================================

function normalizarMensajeParaCliente(
    mensaje
) {

    if (!mensaje) {

        return mensaje;
    }

    const resultado = {
        ...mensaje
    };

    // -------------------------------------------------
    // Mensajes de texto
    // -------------------------------------------------

    if (
        mensaje.tipo ===
        "text"
    ) {

        return resultado;
    }

    // -------------------------------------------------
    // Intentar interpretar contenido multimedia
    // -------------------------------------------------

    if (
        mensaje.contenido &&
        typeof mensaje.contenido ===
        "string"
    ) {

        try {

            const multimedia =
                JSON.parse(
                    mensaje.contenido
                );

            if (
                multimedia &&
                typeof multimedia ===
                "object"
            ) {

                if (
                    multimedia.media_url
                ) {

                    resultado.media_url =
                        multimedia.media_url;
                }

                if (
                    multimedia.media_path
                ) {

                    resultado.media_path =
                        multimedia.media_path;
                }

                if (
                    multimedia.mime_type
                ) {

                    resultado.mime_type =
                        multimedia.mime_type;
                }

                if (
                    multimedia.nombre_archivo
                ) {

                    resultado.nombre_archivo =
                        multimedia.nombre_archivo;
                }

                if (
                    multimedia.media_id
                ) {

                    resultado.media_id =
                        multimedia.media_id;
                }

                resultado.texto =
                    multimedia.texto ||
                    "";

                return resultado;
            }

        } catch {
            // No era JSON multimedia.
        }
    }

    return resultado;
}

// =====================================================
// OBTENER AGENTES
// =====================================================

async function obtenerAgentes() {

    const {
        data,
        error
    } =
        await supabase
            .from("agentes")
            .select("*")
            .order(
                "id",
                {
                    ascending: true
                }
            );

    if (error) {

        throw new Error(
            "Error obteniendo agentes: " +
            error.message
        );
    }

    return data || [];
}

// =====================================================
// ACTUALIZAR AGENTE
// =====================================================

async function asignarAgente(
    ticketId,
    agenteId
) {

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .update(
                {
                    agente_id:
                        agenteId,

                    ultima_interaccion:
                        new Date().toISOString()
                }
            )
            .eq(
                "id",
                ticketId
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error asignando agente: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// ACTUALIZAR ESTADO
// =====================================================

async function actualizarEstadoTicket(
    ticketId,
    estado
) {

    const estadosValidos = [
        "abierta",
        "en_proceso",
        "cerrada"
    ];

    if (
        !estadosValidos.includes(
            estado
        )
    ) {

        throw new Error(
            "Estado no válido."
        );
    }

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .update(
                {
                    estado:
                        estado,

                    ultima_interaccion:
                        new Date().toISOString(),

                    cerrado_en:
                        estado === "cerrada"
                            ? new Date().toISOString()
                            : null
                }
            )
            .eq(
                "id",
                ticketId
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error actualizando estado: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// ACTUALIZAR PRIORIDAD
// =====================================================

async function actualizarPrioridadTicket(
    ticketId,
    prioridad
) {

    const prioridadesValidas = [
        "baja",
        "normal",
        "alta",
        "urgente"
    ];

    if (
        !prioridadesValidas.includes(
            String(
                prioridad
            ).toLowerCase()
        )
    ) {

        throw new Error(
            "Prioridad no válida."
        );
    }

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .update(
                {
                    prioridad:
                        String(
                            prioridad
                        ).toLowerCase(),

                    ultima_interaccion:
                        new Date().toISOString()
                }
            )
            .eq(
                "id",
                ticketId
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error actualizando prioridad: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// ACTUALIZAR CATEGORÍA
// =====================================================

async function actualizarCategoriaTicket(
    ticketId,
    categoria
) {

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .update(
                {
                    categoria:
                        categoria || null,

                    ultima_interaccion:
                        new Date().toISOString()
                }
            )
            .eq(
                "id",
                ticketId
            )
            .select("*")
            .single();

    if (error) {

        throw new Error(
            "Error actualizando categoría: " +
            error.message
        );
    }

    return data;
}

// =====================================================
// CERRAR TICKET
// =====================================================

async function cerrarTicket(
    ticketId,
    agenteId
) {

    const ahora =
        new Date().toISOString();

    const {
        data: ticket,
        error
    } =
        await supabase
            .from("tickets")
            .update(
                {
                    estado:
                        "cerrada",

                    cerrado_en:
                        ahora,

                    ultima_interaccion:
                        ahora,

                    agente_id:
                        agenteId || null
                }
            )
            .eq(
                "id",
                ticketId
            )
            .select(`
                *,
                cliente:clientes(
                    id,
                    nombre,
                    telefono,
                    empresa
                ),
                agente:agentes(
                    id,
                    nombre,
                    rol,
                    area
                )
            `)
            .single();

    if (error) {

        throw new Error(
            "Error cerrando ticket: " +
            error.message
        );
    }

    // -------------------------------------------------
    // Registrar historial
    // -------------------------------------------------

    let conversacionId =
        null;

    const {
        data: conversaciones
    } =
        await supabase
            .from("conversaciones")
            .select("id")
            .eq(
                "cliente_id",
                ticket.cliente_id
            )
            .order(
                "creado_en",
                {
                    ascending: false
                }
            )
            .limit(1);

    if (
        conversaciones &&
        conversaciones.length > 0
    ) {

        conversacionId =
            conversaciones[0].id;
    }

    if (conversacionId) {

        await registrarHistorial(
            conversacionId,
            agenteId,
            "ticket_cerrado",
            "El ticket fue cerrado por el agente."
        );

        await supabase
            .from("conversaciones")
            .update(
                {
                    estado:
                        "cerrada",

                    ultima_interaccion:
                        ahora
                }
            )
            .eq(
                "id",
                conversacionId
            );
    }

    // -------------------------------------------------
    // Enviar mensaje de cierre
    // -------------------------------------------------

    if (
        ticket.cliente &&
        ticket.cliente.telefono
    ) {

        const telefono =
            ticket.cliente.telefono;

        const mensaje =
            `Tu ticket #${ticket.numero_ticket} fue cerrado correctamente. Gracias por comunicarte con TR Soporte. Si lo deseas, puedes calificar la atención recibida.`;

        try {

            await enviarMensajeWhatsApp(
                telefono,
                mensaje,
                ticket.cliente_id,
                conversacionId,
                agenteId
            );

        } catch (errorMensaje) {

            console.error(
                "No se pudo enviar mensaje de cierre:",
                errorMensaje.message
            );
        }
    }

    return ticket;
}

// =====================================================
// ENVIAR MENSAJE DE WHATSAPP
// =====================================================

async function enviarMensajeWhatsApp(
    telefono,
    mensaje,
    clienteId = null,
    conversacionId = null,
    agenteId = null
) {

    if (!ACCESS_TOKEN) {

        throw new Error(
            "META_ACCESS_TOKEN no configurado."
        );
    }

    if (!PHONE_NUMBER_ID) {

        throw new Error(
            "META_PHONE_NUMBER_ID no configurado."
        );
    }

    const url =
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;

    const body = {

        messaging_product:
            "whatsapp",

        recipient_type:
            "individual",

        to:
            telefono,

        type:
            "text",

        text: {
            preview_url:
                false,

            body:
                mensaje
        }
    };

    const response =
        await fetch(
            url,
            {
                method: "POST",

                headers: {

                    "Authorization":
                        `Bearer ${ACCESS_TOKEN}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(body)
            }
        );

    const respuesta =
        await response.json();

    if (!response.ok) {

        throw new Error(
            respuesta?.error?.message ||
            "Error enviando mensaje de WhatsApp."
        );
    }

    // -------------------------------------------------
    // Guardar mensaje saliente
    // -------------------------------------------------

    if (
        clienteId &&
        conversacionId
    ) {

        const whatsappMessageId =
            respuesta?.messages?.[0]?.id ||
            null;

        await guardarMensaje(
            {
                clienteId:
                    clienteId,

                conversacionId:
                    conversacionId,

                whatsappMessageId:
                    whatsappMessageId,

                direccion:
                    "saliente",

                tipo:
                    "text",

                contenido:
                    mensaje,

                estado:
                    "enviado",

                recibidoEn:
                    new Date().toISOString(),

                multimedia:
                    null
            }
        );

        await registrarHistorial(
            conversacionId,
            agenteId,
            "mensaje_enviado",
            "El agente envió un mensaje al cliente por WhatsApp."
        );
    }

    return respuesta;
}

// =====================================================
// BUSCAR TICKET POR NÚMERO
// =====================================================

async function buscarTickets(
    texto
) {

    const textoBusqueda =
        String(
            texto || ""
        ).trim();

    if (!textoBusqueda) {

        return await obtenerTickets();
    }

    const {
        data,
        error
    } =
        await supabase
            .from("tickets")
            .select(`
                *,
                cliente:clientes(
                    id,
                    nombre,
                    telefono,
                    empresa
                ),
                agente:agentes(
                    id,
                    nombre,
                    rol,
                    area,
                    activo
                )
            `)
            .or(
                `numero_ticket.ilike.%${textoBusqueda}%`
            )
            .order(
                "creado_en",
                {
                    ascending: false
                }
            );

    if (error) {

        throw new Error(
            "Error buscando tickets: " +
            error.message
        );
    }

    return data || [];
}

// =====================================================
// RESPUESTA DE TICKET
// =====================================================

async function construirRespuestaTicket(
    ticket
) {

    if (!ticket) {

        return {
            success:
                false,

            error:
                "Ticket no encontrado."
        };
    }

    const mensajes =
        await obtenerMensajesTicket(
            ticket
        );

    return {

        success:
            true,

        ticket:
            ticket,

        mensajes:
            mensajes.map(
                normalizarMensajeParaCliente
            )
    };
}

// =====================================================
// HEALTH CHECK
// =====================================================

async function comprobarSupabase() {

    try {

        const {
            error
        } =
            await supabase
                .from("agentes")
                .select("id")
                .limit(1);

        if (error) {

            return false;
        }

        return true;

    } catch {

        return false;
    }
}

// =====================================================
// RUTA HEALTH
// =====================================================

async function manejarHealth(
    res
) {

    const supabaseOK =
        await comprobarSupabase();

    responderJSON(
        res,
        200,
        {
            servidor:
                "OK",

            supabase:
                supabaseOK
                    ? "OK"
                    : "ERROR",

            estado:
                supabaseOK
                    ? "ONLINE"
                    : "DEGRADED"
        }
    );
}


// =====================================================
// RUTA PRINCIPAL
// =====================================================

async function manejarInicio(
    res
) {

    responderJSON(
        res,
        200,
        {
            servidor:
                "TR Soporte WhatsApp Webhook",

            estado:
                "ONLINE"
        }
    );
}

// =====================================================
// WEBHOOK - VERIFICACIÓN DE META
// =====================================================

function verificarWebhookMeta(
    req,
    res,
    query
) {

    const mode =
        query["hub.mode"];

    const token =
        query["hub.verify_token"];

    const challenge =
        query["hub.challenge"];

    if (
        mode === "subscribe" &&
        token === VERIFY_TOKEN
    ) {

        console.log(
            "Webhook de WhatsApp verificado correctamente."
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

        return true;
    }

    console.log(
        "Falló la verificación del webhook."
    );

    responderJSON(
        res,
        403,
        {
            error:
                "Token de verificación inválido."
        }
    );

    return false;
}

// =====================================================
// WEBHOOK - RECIBIR MENSAJES
// =====================================================

async function manejarWebhook(
    req,
    res
) {

    try {

        const body =
            await leerBody(req);

        console.log(
            "========================================"
        );

        console.log(
            "WEBHOOK DE WHATSAPP RECIBIDO"
        );

        console.log(
            JSON.stringify(
                body,
                null,
                2
            )
        );

        console.log(
            "========================================"
        );

        await procesarEventoWhatsApp(
            body
        );

        responderJSON(
            res,
            200,
            {
                success:
                    true
            }
        );

    } catch (error) {

        console.error(
            "Error procesando webhook:",
            error
        );

        /*
         * WhatsApp necesita recibir una respuesta
         * válida para evitar reintentos innecesarios.
         */

        responderJSON(
            res,
            200,
            {
                success:
                    false,

                error:
                    error.message
            }
        );
    }
}

// =====================================================
// LEER JSON PARA POST
// =====================================================

async function leerJSON(
    req
) {

    try {

        return await leerBody(
            req
        );

    } catch (error) {

        throw new Error(
            "El cuerpo de la solicitud no contiene JSON válido."
        );
    }
}

// =====================================================
// RUTA /TICKETS
// =====================================================

async function manejarTickets(
    req,
    res
) {

    try {

        const tickets =
            await obtenerTickets();

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

        console.error(
            "Error en /tickets:",
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

// =====================================================
// RUTA /TICKETS/BUSCAR
// =====================================================

async function manejarBuscarTickets(
    req,
    res,
    query
) {

    try {

        const texto =
            query.q ||
            query.numero ||
            query.busqueda ||
            "";

        const tickets =
            await buscarTickets(
                texto
            );

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

        console.error(
            "Error en /tickets/buscar:",
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

// =====================================================
// RUTA /TICKETS/:ID
// =====================================================

async function manejarTicketIndividual(
    req,
    res,
    id
) {

    try {

        const ticket =
            await obtenerTicketPorId(
                id
            );

        if (!ticket) {

            responderJSON(
                res,
                404,
                {
                    success:
                        false,

                    error:
                        "Ticket no encontrado."
                }
            );

            return;
        }

        const respuesta =
            await construirRespuestaTicket(
                ticket
            );

        responderJSON(
            res,
            200,
            respuesta
        );

    } catch (error) {

        console.error(
            "Error obteniendo ticket:",
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

// =====================================================
// RUTA /AGENTES
// =====================================================

async function manejarAgentes(
    req,
    res
) {

    try {

        const agentes =
            await obtenerAgentes();

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                agentes:
                    agentes
            }
        );

    } catch (error) {

        console.error(
            "Error en /agentes:",
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

// =====================================================
// ASIGNAR AGENTE
// =====================================================

async function manejarAsignarAgente(
    req,
    res,
    ticketId
) {

    try {

        const body =
            await leerJSON(req);

        const agenteId =
            body.agente_id == null
                ? null
                : Number(
                    body.agente_id
                );

        if (
            agenteId !== null &&
            !Number.isFinite(
                agenteId
            )
        ) {

            responderJSON(
                res,
                400,
                {
                    success:
                        false,

                    error:
                        "agente_id inválido."
                }
            );

            return;
        }

        const ticket =
            await asignarAgente(
                ticketId,
                agenteId
            );

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                ticket:
                    ticket
            }
        );

    } catch (error) {

        console.error(
            "Error asignando agente:",
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

// =====================================================
// ACTUALIZAR ESTADO
// =====================================================

async function manejarActualizarEstado(
    req,
    res,
    ticketId
) {

    try {

        const body =
            await leerJSON(req);

        const estado =
            String(
                body.estado ||
                ""
            )
            .trim()
            .toLowerCase();

        const ticket =
            await actualizarEstadoTicket(
                ticketId,
                estado
            );

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                ticket:
                    ticket
            }
        );

    } catch (error) {

        console.error(
            "Error actualizando estado:",
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

// =====================================================
// ACTUALIZAR PRIORIDAD
// =====================================================

async function manejarActualizarPrioridad(
    req,
    res,
    ticketId
) {

    try {

        const body =
            await leerJSON(req);

        const prioridad =
            String(
                body.prioridad ||
                ""
            )
            .trim()
            .toLowerCase();

        const ticket =
            await actualizarPrioridadTicket(
                ticketId,
                prioridad
            );

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                ticket:
                    ticket
            }
        );

    } catch (error) {

        console.error(
            "Error actualizando prioridad:",
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

// =====================================================
// ACTUALIZAR CATEGORÍA
// =====================================================

async function manejarActualizarCategoria(
    req,
    res,
    ticketId
) {

    try {

        const body =
            await leerJSON(req);

        const categoria =
            body.categoria == null
                ? null
                : String(
                    body.categoria
                ).trim();

        const ticket =
            await actualizarCategoriaTicket(
                ticketId,
                categoria
            );

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                ticket:
                    ticket
            }
        );

    } catch (error) {

        console.error(
            "Error actualizando categoría:",
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

// =====================================================
// CERRAR TICKET
// =====================================================

async function manejarCerrarTicket(
    req,
    res,
    ticketId
) {

    try {

        const body =
            await leerJSON(req);

        const agenteId =
            body.agente_id == null
                ? null
                : Number(
                    body.agente_id
                );

        const ticket =
            await cerrarTicket(
                ticketId,
                agenteId
            );

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                ticket:
                    ticket
            }
        );

    } catch (error) {

        console.error(
            "Error cerrando ticket:",
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

// =====================================================
// ENVIAR MENSAJE
// =====================================================

async function manejarEnviarMensaje(
    req,
    res
) {

    try {

        const body =
            await leerJSON(req);

        const telefono =
            String(
                body.to ||
                ""
            ).trim();

        const mensaje =
            String(
                body.message ||
                ""
            ).trim();

        const clienteId =
            body.cliente_id == null
                ? null
                : Number(
                    body.cliente_id
                );

        const conversacionId =
            body.conversacion_id == null
                ? null
                : Number(
                    body.conversacion_id
                );

        const agenteId =
            body.agente_id == null
                ? null
                : Number(
                    body.agente_id
                );

        if (!telefono) {

            responderJSON(
                res,
                400,
                {
                    success:
                        false,

                    error:
                        "Falta el número de teléfono."
                }
            );

            return;
        }

        if (!mensaje) {

            responderJSON(
                res,
                400,
                {
                    success:
                        false,

                    error:
                        "Falta el mensaje."
                }
            );

            return;
        }

        const resultado =
            await enviarMensajeWhatsApp(
                telefono,
                mensaje,
                clienteId,
                conversacionId,
                agenteId
            );

        responderJSON(
            res,
            200,
            {
                success:
                    true,

                respuesta:
                    resultado
            }
        );

    } catch (error) {

        console.error(
            "Error enviando mensaje:",
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

// =====================================================
// ENRUTADOR PRINCIPAL
// =====================================================

async function manejarSolicitud(
    req,
    res
) {

    const parsedUrl =
        url.parse(
            req.url,
            true
        );

    const pathname =
        parsedUrl.pathname;

    const method =
        req.method;

    console.log(
        `${method} ${pathname}`
    );

    // =================================================
    // GET /
    // =================================================

    if (
        method === "GET" &&
        pathname === "/"
    ) {

        await manejarInicio(
            res
        );

        return;
    }

    // =================================================
    // GET /health
    // =================================================

    if (
        method === "GET" &&
        pathname === "/health"
    ) {

        await manejarHealth(
            res
        );

        return;
    }

    // =================================================
    // GET /webhook
    // =================================================

    if (
        method === "GET" &&
        pathname === "/webhook"
    ) {

        verificarWebhookMeta(
            req,
            res,
            parsedUrl.query
        );

        return;
    }

    // =================================================
    // POST /webhook
    // =================================================

    if (
        method === "POST" &&
        pathname === "/webhook"
    ) {

        await manejarWebhook(
            req,
            res
        );

        return;
    }

    // =================================================
    // GET /tickets
    // =================================================

    if (
        method === "GET" &&
        pathname === "/tickets"
    ) {

        await manejarTickets(
            req,
            res
        );

        return;
    }

    // =================================================
    // GET /tickets/buscar
    // =================================================

    if (
        method === "GET" &&
        pathname === "/tickets/buscar"
    ) {

        await manejarBuscarTickets(
            req,
            res,
            parsedUrl.query
        );

        return;
    }

    // =================================================
    // GET /agentes
    // =================================================

    if (
        method === "GET" &&
        pathname === "/agentes"
    ) {

        await manejarAgentes(
            req,
            res
        );

        return;
    }

    // =================================================
    // POST /send-message
    // =================================================

    if (
        method === "POST" &&
        pathname === "/send-message"
    ) {

        await manejarEnviarMensaje(
            req,
            res
        );

        return;
    }

    // =================================================
    // RUTAS DINÁMICAS DE TICKETS
    // =================================================

    const ticketMatch =
        pathname.match(
            /^\/tickets\/(\d+)$/
        );

    if (
        method === "GET" &&
        ticketMatch
    ) {

        await manejarTicketIndividual(
            req,
            res,
            ticketMatch[1]
        );

        return;
    }

    const assignMatch =
        pathname.match(
            /^\/tickets\/(\d+)\/assign$/
        );

    if (
        method === "POST" &&
        assignMatch
    ) {

        await manejarAsignarAgente(
            req,
            res,
            assignMatch[1]
        );

        return;
    }

    const statusMatch =
        pathname.match(
            /^\/tickets\/(\d+)\/status$/
        );

    if (
        method === "POST" &&
        statusMatch
    ) {

        await manejarActualizarEstado(
            req,
            res,
            statusMatch[1]
        );

        return;
    }

    const priorityMatch =
        pathname.match(
            /^\/tickets\/(\d+)\/priority$/
        );

    if (
        method === "POST" &&
        priorityMatch
    ) {

        await manejarActualizarPrioridad(
            req,
            res,
            priorityMatch[1]
        );

        return;
    }

    const categoryMatch =
        pathname.match(
            /^\/tickets\/(\d+)\/category$/
        );

    if (
        method === "POST" &&
        categoryMatch
    ) {

        await manejarActualizarCategoria(
            req,
            res,
            categoryMatch[1]
        );

        return;
    }

    const closeMatch =
        pathname.match(
            /^\/tickets\/(\d+)\/close$/
        );

    if (
        method === "POST" &&
        closeMatch
    ) {

        await manejarCerrarTicket(
            req,
            res,
            closeMatch[1]
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

// =====================================================
// SERVIDOR HTTP
// =====================================================

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            try {

                await manejarSolicitud(
                    req,
                    res
                );

            } catch (error) {

                console.error(
                    "Error no controlado:",
                    error
                );

                if (
                    !res.headersSent
                ) {

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

                } else {

                    res.end();
                }
            }
        }
    );

// =====================================================
// INICIAR SERVIDOR
// =====================================================

server.listen(
    PORT,
    async () => {

        console.log(
            "========================================"
        );

        console.log(
            "TR SOPORTE - WHATSAPP WEBHOOK"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Servidor escuchando en puerto ${PORT}`
        );

        console.log(
            "Supabase:",
            SUPABASE_URL
                ? "CONFIGURADO"
                : "NO CONFIGURADO"
        );

        console.log(
            "Meta Access Token:",
            ACCESS_TOKEN
                ? "CONFIGURADO"
                : "NO CONFIGURADO"
        );

        console.log(
            "WhatsApp Phone Number ID:",
            PHONE_NUMBER_ID
                ? "CONFIGURADO"
                : "NO CONFIGURADO"
        );

        console.log(
            "Webhook Verify Token:",
            VERIFY_TOKEN
                ? "CONFIGURADO"
                : "NO CONFIGURADO"
        );

        console.log(
            "Bucket multimedia:",
            WHATSAPP_MEDIA_BUCKET
        );

        console.log(
            "========================================"
        );

        await asegurarBucketMultimedia();
    }
);
