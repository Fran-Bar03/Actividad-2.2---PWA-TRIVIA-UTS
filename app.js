"use strict"; // Modo estricto: errores comunes se vuelven errores reales

/* ==========================================================
   1. CONFIGURACIÓN
   Todo lo ajustable vive aquí.
   ========================================================== */
const API_BASE_URL = "https://userapi-m8ef.onrender.com";
const API_AUTH_PATH = "/api/Auth";
const AUTH_URL = `${API_BASE_URL}${API_AUTH_PATH}`;

// Endpoints. Se ELIMINÓ userById porque ya no se busca por id contra la API.
const ENDPOINTS = Object.freeze({
    users: () => `${AUTH_URL}/Get/Users`,
    createUser: () => `${AUTH_URL}/Create/User`,
    updateUser: () => `${AUTH_URL}/Update/User`,
    deleteUser: id => `${AUTH_URL}/Delete/User/${encodeURIComponent(id)}`
});

// Verbos HTTP en constantes
const HTTP = Object.freeze({ GET: "GET", POST: "POST", PUT: "PUT", DELETE: "DELETE" });

// Códigos HTTP reintentables (servidor ocupado/dormido)
const RETRYABLE_STATUS = Object.freeze([408, 429, 502, 503, 504]);

// Roles: 0 = jugador, 1 = admin
const ROLES = Object.freeze({ PLAYER: 0, ADMIN: 1 });
const ROLE_BADGES = Object.freeze({
    [ROLES.PLAYER]: { text: "Usuario", className: "" },
    [ROLES.ADMIN]:  { text: "Administrador", className: "admin" }
});

// Tipos de operación de la cola
const OPS = Object.freeze({ CREATE: "create", UPDATE: "update", DELETE: "delete" });

// Configuración general
const CONFIG = Object.freeze({
    pageSize: 5,
    mobileBreakpoint: 900,
    toastDurationMs: 4000,
    toastErrorDurationMs: 6500,
    maxToasts: 4,
    slowServerMs: 4000,
    requestTimeoutMs: 60000,
    cacheKey: "usuarios-cache",
    queueKey: "usuarios-pendientes",
    tempIdPrefix: "tmp-",
    serviceWorkerPath: "./sw.js"
});

/* ==========================================================
   2. MENSAJES
   Todos los textos visibles al usuario, centralizados.
   ========================================================== */
const MESSAGES = Object.freeze({
    // Conexión
    statusOnline: "En línea",
    statusOffline: "Sin conexión",
    online: "Conexión restablecida.",
    offline: "Sin conexión. Puedes seguir trabajando: los cambios se enviarán cuando vuelva el internet.",
    network: "No se pudo conectar con el servidor. Revisa tu conexión.",
    timeout: "El servidor tardó demasiado en responder. Intenta de nuevo.",

    // Carga
    loading: "Cargando usuarios…",
    slowServer: "El servidor está despertando, puede tardar hasta un minuto…",
    loadError: "No se pudo cargar la lista de usuarios.",
    cachedData: "Mostrando los últimos datos guardados.",
    noUsers: "Aún no hay usuarios registrados",
    noMatches: "Ningún usuario coincide con la búsqueda",

    // Formulario
    validation: "Completa nombre, usuario y contraseña.",
    selected: "Usuario seleccionado. Escribe la contraseña para poder actualizarlo.",

    // Agregar
    creating: "Agregando…",
    created: name => `Usuario «${name}» agregado correctamente.`,

    // Actualizar
    updating: "Actualizando…",
    updated: name => `Usuario «${name}» actualizado correctamente.`,

    // Eliminar
    deleting: "Eliminando…",
    deleteTitle: "Eliminar usuario",
    deleteConfirm: name => `¿Seguro que quieres eliminar a «${name}»? Esta acción no se puede deshacer.`,
    deleteOk: "Eliminar",
    deleted: name => `Usuario «${name}» eliminado correctamente.`,
    deletedLocal: name => `Usuario «${name}» eliminado. Aún no se había enviado al servidor.`,

    // Mensajes por tipo de operación encolada
    queued: Object.freeze({
        [OPS.CREATE]: name => `Usuario «${name}» guardado. Se agregará al servidor cuando haya conexión.`,
        [OPS.UPDATE]: name => `Cambios de «${name}» guardados. Se enviarán al servidor cuando haya conexión.`,
        [OPS.DELETE]: name => `«${name}» eliminado. Se borrará del servidor cuando haya conexión.`
    }),

    // Sincronización
    syncing: "Sincronizando…",
    pendingCount: n => `${n} pendiente${n === 1 ? "" : "s"}`,
    syncStart: n => `Enviando ${n} cambio${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"} al servidor…`,
    syncDone: n => `Se sincronizó${n === 1 ? "" : "ron"} ${n} cambio${n === 1 ? "" : "s"} correctamente.`,
    syncFailed: (name, reason) => `No se pudo sincronizar «${name}»: ${reason}`,
    syncInterrupted: n => `Se perdió la conexión con el servidor. Quedan ${n} cambio${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"}; se reintentará.`,
    syncOffline: "Sin conexión: los cambios pendientes se enviarán cuando vuelva el internet.",
    syncBusy: "Sincronizando cambios, intenta de nuevo en unos segundos.",
    nothingToSync: "No hay cambios pendientes.",

    // Instalación PWA
    installed: "Aplicación instalada correctamente.",
    installCancelled: "Instalación cancelada. Puedes instalarla cuando quieras.",
    installIos: "En iPhone o iPad: toca Compartir y luego «Agregar a pantalla de inicio»."
});

/* ==========================================================
   3. UTILIDADES
   ========================================================== */
const Utils = {
    // Atajo de getElementById
    $: id => document.getElementById(id),

    // Escapa HTML para prevenir XSS al pintar datos de la API
    escapeHtml(value) {
        const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return String(value ?? "").replace(/[&<>"']/g, char => entities[char]);
    },

    // Genera un id único (timestamp + random)
    uid: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,

    // Lee localStorage con parseo seguro
    readStorage(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    },

    // Escribe localStorage de forma segura
    writeStorage(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignorado */ }
    }
};

/* ==========================================================
   4. MODELO
   Traduce entre la API y el formato interno.
   ========================================================== */
const UserModel = {
    // Normaliza lo que devuelve la API (acepta camelCase y PascalCase)
    normalize(raw = {}) {
        return {
            id: String(raw.id ?? raw.Id ?? ""),
            name: raw.name ?? raw.Name ?? "",
            userName: raw.userName ?? raw.UserName ?? raw.username ?? "",
            rol: Number(raw.rol ?? raw.Rol ?? ROLES.PLAYER)
        };
    },

    // Extrae la lista sin importar la forma ({data:[...]}, {users:[...]}, [...])
    extractList(data) {
        if (Array.isArray(data)) return data;
        if (data && typeof data === "object") {
            const inner = data.data ?? data.users ?? data.result ?? data.items;
            if (Array.isArray(inner)) return inner;
        }
        return [];
    },

    // Arma el cuerpo que se envía a la API
    toPayload({ id, name, userName, password, rol }, includeId = false) {
        const payload = { name, userName, password, rol: Number(rol) };
        if (includeId) payload.id = id;
        return payload;
    },

    // Búsqueda local por id, nombre o usuario
    matches(user, query) {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return [user.id, user.name, user.userName].some(v => String(v).toLowerCase().includes(q));
    }
};

/* ==========================================================
   5. SERVICIO DE API
   ========================================================== */
const UserService = {
    // Petición maestra con timeout y clasificación de errores
    async request(url, method = HTTP.GET, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

        try {
            const response = await fetch(url, {
                method,
                // Solo enviamos Content-Type si hay body (evita preflight CORS innecesario)
                headers: body !== undefined ? { "Content-Type": "application/json" } : {},
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            if (!response.ok) {
                let detail = "";
                try { detail = (await response.text()).slice(0, 160); } catch (_) {}
                const error = new Error(`Error ${response.status}${detail ? ": " + detail : ""}`);
                // 5xx o retryables → reintentar; 4xx → no reintentar
                error.retryable = response.status >= 500 || RETRYABLE_STATUS.includes(response.status);
                throw error;
            }

            const text = await response.text();
            if (!text) return null;
            try { return JSON.parse(text); } catch (_) { return text; }
        } catch (error) {
            // Timeout
            if (error.name === "AbortError") {
                const timeout = new Error(MESSAGES.timeout);
                timeout.retryable = true;
                throw timeout;
            }
            // Error de red
            if (error instanceof TypeError) {
                const network = new Error(MESSAGES.network);
                network.network = true;
                network.retryable = true;
                throw network;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    },

    // GET lista completa
    async getAll() {
        const data = await this.request(ENDPOINTS.users());
        return UserModel.extractList(data).map(UserModel.normalize);
    },

    // POST crear
    create(user) {
        return this.request(ENDPOINTS.createUser(), HTTP.POST, UserModel.toPayload(user));
    },

    // PUT actualizar
    update(user) {
        return this.request(ENDPOINTS.updateUser(), HTTP.PUT, UserModel.toPayload(user, true));
    },

    // PUT eliminar (según la API, usa PUT)
    remove(id) {
        return this.request(ENDPOINTS.deleteUser(id), HTTP.PUT);
    }
};

/* ==========================================================
   6. COLA DE CAMBIOS PENDIENTES
   ========================================================== */
const Queue = {
    items: Utils.readStorage(CONFIG.queueKey, []),

    get size() { return this.items.length; },

    save() { Utils.writeStorage(CONFIG.queueKey, this.items); },

    newTempId: () => `${CONFIG.tempIdPrefix}${Utils.uid()}`,
    isTemp: id => String(id).startsWith(CONFIG.tempIdPrefix),

    createOp(type, userId, name, payload) {
        return { opId: Utils.uid(), type, userId, name, payload, createdAt: Date.now() };
    },

    // Combina operaciones del mismo usuario para evitar redundancias
    add(op) {
        const sameUser = item => item.userId === op.userId;

        if (op.type === OPS.CREATE) {
            this.items.push(op);

        } else if (op.type === OPS.UPDATE) {
            // Si ya hay un create/update pendiente → fusionar datos
            const pending = this.items.find(item => sameUser(item) && item.type !== OPS.DELETE);
            if (pending) pending.payload = { ...op.payload };
            else this.items.push(op);

        } else if (op.type === OPS.DELETE) {
            const neverSent = this.items.some(item => sameUser(item) && item.type === OPS.CREATE);
            this.items = this.items.filter(item => !sameUser(item));
            // Si nunca llegó al server, no hay nada que borrar allí
            if (!neverSent) this.items.push(op);
        }
        this.save();
    },

    remove(opId) {
        this.items = this.items.filter(item => item.opId !== opId);
        this.save();
    },

    // Combina server + pendientes (lo que ve el usuario)
    apply(serverUsers) {
        let list = serverUsers.map(user => ({ ...user }));

        for (const op of this.items) {
            const data = op.payload ?? {};
            if (op.type === OPS.CREATE) {
                list.push({
                    id: op.userId,
                    name: data.name,
                    userName: data.userName,
                    rol: Number(data.rol),
                    pending: OPS.CREATE
                });
            } else if (op.type === OPS.UPDATE) {
                const user = list.find(item => item.id === op.userId);
                if (user) {
                    Object.assign(user, { name: data.name, userName: data.userName, rol: Number(data.rol) });
                    user.pending = user.pending ?? OPS.UPDATE;
                }
            } else if (op.type === OPS.DELETE) {
                list = list.filter(item => item.id !== op.userId);
            }
        }
        return list;
    }
};

/* ==========================================================
   7. SINCRONIZACIÓN
   ========================================================== */
const Sync = {
    running: false,

    send(op) {
        switch (op.type) {
            case OPS.CREATE: return UserService.create(op.payload);
            case OPS.UPDATE: return UserService.update({ ...op.payload, id: op.userId });
            case OPS.DELETE: return UserService.remove(op.userId);
            default: return Promise.resolve();
        }
    },

    async run() {
        if (this.running || !Queue.size) return null;
        this.running = true;
        const result = { sent: 0, failed: [], interrupted: false };

        try {
            for (const op of [...Queue.items]) {
                try {
                    await this.send(op);
                    Queue.remove(op.opId);
                    result.sent++;
                } catch (error) {
                    if (error.retryable) {
                        // Red/servidor ocupado → parar y conservar
                        result.interrupted = true;
                        break;
                    }
                    // API rechazó: descartar para no bloquear la cola
                    Queue.remove(op.opId);
                    result.failed.push({ name: op.name, reason: error.message });
                }
            }
        } finally {
            this.running = false;
        }
        return result;
    }
};

/* ==========================================================
   8. ESTADO
   ========================================================== */
const state = {
    users: [],
    page: 1,
    selectedId: null,
    busy: false
};

/* ==========================================================
   9. INTERFAZ
   ========================================================== */
const UI = {
    el: {},
    formFields: ["name", "userName", "password"],

    init() {
        [
            "netPill", "netText", "offlineBanner", "btnInstall", "btnSync",
            "userForm", "userId", "name", "userName", "password", "rol", "formMsg",
            "btnAdd", "btnUpdate", "btnDelete", "btnClear", "btnReload",
            "search", "totalText", "tbody", "pageText", "btnPrev", "btnNext",
            "toastStack", "confirmDialog", "dialogTitle", "dialogText", "dialogOk"
        ].forEach(id => { this.el[id] = Utils.$(id); });
    },

    // Muestra un toast. type: success | error | warning | info
    notify(type, text) {
        const icons = { success: "✓", error: "✕", warning: "!", info: "i" };
        const stack = this.el.toastStack;

        const item = document.createElement("div");
        item.className = `toast toast-${type}`;
        item.setAttribute("role", type === "error" ? "alert" : "status");

        const icon = document.createElement("span");
        icon.className = "toast-icon";
        icon.textContent = icons[type] ?? icons.info;

        const message = document.createElement("span");
        message.className = "toast-text";
        message.textContent = text; // textContent evita inyección HTML

        const close = document.createElement("button");
        close.type = "button";
        close.className = "toast-close";
        close.setAttribute("aria-label", "Cerrar mensaje");
        close.textContent = "×";

        item.append(icon, message, close);
        stack.append(item);
        while (stack.children.length > CONFIG.maxToasts) stack.firstElementChild.remove();

        // Un frame para que la transición se ejecute al añadir .show
        requestAnimationFrame(() => item.classList.add("show"));

        const remove = () => {
            item.classList.remove("show");
            setTimeout(() => item.remove(), 250);
        };
        close.addEventListener("click", remove);
        setTimeout(remove, type === "error" ? CONFIG.toastErrorDurationMs : CONFIG.toastDurationMs);
    },

    // Cuadro de confirmación (Promesa<boolean>)
    confirm({ title, text, okText }) {
        const { confirmDialog: dialog, dialogTitle, dialogText, dialogOk } = this.el;
        dialogTitle.textContent = title;
        dialogText.textContent = text;
        dialogOk.textContent = okText;
        dialog.returnValue = "";

        return new Promise(resolve => {
            dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
            dialog.showModal();
        });
    },

    // Actualiza el indicador visual de conexión
    setConnection(online) {
        this.el.offlineBanner.hidden = online;
        this.el.netPill.classList.toggle("off", !online);
        this.el.netText.textContent = online ? MESSAGES.statusOnline : MESSAGES.statusOffline;
    },

    // Actualiza el botón de sync (texto + estado + spinner)
    renderPending(count, syncing) {
        const button = this.el.btnSync;
        button.hidden = count === 0 && !syncing;
        button.disabled = syncing;
        button.classList.toggle("loading", syncing);
        button.textContent = syncing ? MESSAGES.syncing : MESSAGES.pendingCount(count);
    },

    // Mensaje dentro del formulario
    setMessage(text = "", type = "error") {
        this.el.formMsg.textContent = text;
        this.el.formMsg.className = text ? `form-msg ${type}` : "form-msg";
    },

    // Lee los valores del formulario
    getFormValues() {
        return {
            id: this.el.userId.value,
            name: this.el.name.value.trim(),
            userName: this.el.userName.value.trim(),
            password: this.el.password.value,
            rol: Number(this.el.rol.value)
        };
    },

    // Carga un usuario en el formulario (password vacío por seguridad)
    setFormValues(user) {
        this.el.userId.value = user.id;
        this.el.name.value = user.name;
        this.el.userName.value = user.userName;
        this.el.password.value = "";
        this.el.rol.value = String(user.rol);
    },

    // Limpia el formulario
    resetForm() {
        this.el.userForm.reset();
        this.el.userId.value = "";
        this.markInvalid({});
    },

    // Marca campos inválidos. Devuelve el primero (para focus)
    markInvalid(invalid) {
        let first = null;
        this.formFields.forEach(field => {
            const isInvalid = Boolean(invalid[field]);
            this.el[field].setAttribute("aria-invalid", String(isInvalid));
            if (isInvalid && !first) first = this.el[field];
        });
        return first;
    },

    // Habilita/deshabilita botones según selección y estado busy
    // Se ELIMINÓ btnSearchId.
    setActions(hasSelection, busy) {
        this.el.btnAdd.disabled = busy || hasSelection;
        this.el.btnUpdate.disabled = busy || !hasSelection;
        this.el.btnDelete.disabled = busy || !hasSelection;
    },

    // Botón en estado "en proceso" (guarda texto original en data-label)
    setBusy(button, busy, text) {
        if (busy) {
            button.dataset.label = button.textContent;
            button.textContent = text;
            button.classList.add("loading");
        } else {
            button.textContent = button.dataset.label ?? button.textContent;
            button.classList.remove("loading");
        }
    },

    // Estado de "cargando" inicial
    setLoading() {
        this.el.totalText.textContent = MESSAGES.loading;
        this.el.tbody.innerHTML =
            `<tr class="placeholder"><td class="empty" colspan="4">${MESSAGES.loading}</td></tr>`;
    },

    // HTML de una fila de la tabla (TODO dato del usuario se escapa)
    rowTemplate(user) {
        const badge = ROLE_BADGES[user.rol] ?? ROLE_BADGES[ROLES.PLAYER];
        const classes = [
            user.id === state.selectedId ? "selected" : "",
            user.pending ? "is-pending" : ""
        ].join(" ").trim();
        const id = Utils.escapeHtml(user.id);
        const idText = user.pending === OPS.CREATE ? "Se asignará al sincronizar" : id;
        const tag = user.pending
            ? `<span class="pending-tag" title="Se enviará al servidor cuando haya conexión">Pendiente</span>`
            : "";
        return `
            <tr tabindex="0" data-id="${id}" class="${classes}">
                <td class="id" title="${id}">${idText}</td>
                <td class="name">${Utils.escapeHtml(user.name)}${tag}</td>
                <td class="user">${Utils.escapeHtml(user.userName)}</td>
                <td class="rol"><span class="badge ${badge.className}">${badge.text}</span></td>
            </tr>`;
    },

    // Pinta tabla + paginación
    renderTable({ rows, count, page, pages, emptyText }) {
        this.el.tbody.innerHTML = rows.length
            ? rows.map(user => this.rowTemplate(user)).join("")
            : `<tr class="placeholder"><td class="empty" colspan="4">${emptyText}</td></tr>`;

        const plural = count === 1 ? "" : "s";
        this.el.totalText.textContent = `${count} usuario${plural} registrado${plural}`;
        this.el.pageText.textContent = `Página ${page} de ${pages}`;
        this.el.btnPrev.disabled = page <= 1;
        this.el.btnNext.disabled = page >= pages;
    }
};

/* ==========================================================
   10. CONTROLADOR
   ========================================================== */
const Controller = {
    isOnline: () => navigator.onLine,

    // Server + pendientes aplicados
    viewUsers() {
        return Queue.apply(state.users);
    },

    // Lo que se pinta: filtro local por query
    visibleUsers() {
        const query = UI.el.search.value;
        return this.viewUsers().filter(user => UserModel.matches(user, query));
    },

    // Render completo
    render() {
        const list = this.visibleUsers();
        const pages = Math.max(1, Math.ceil(list.length / CONFIG.pageSize));
        state.page = Math.min(state.page, pages);
        const start = (state.page - 1) * CONFIG.pageSize;

        UI.renderTable({
            rows: list.slice(start, start + CONFIG.pageSize),
            count: list.length,
            page: state.page,
            pages,
            emptyText: this.viewUsers().length ? MESSAGES.noMatches : MESSAGES.noUsers
        });
        UI.setActions(Boolean(state.selectedId), state.busy || Sync.running);
        UI.renderPending(Queue.size, Sync.running);
    },

    // Carga usuarios desde el server, con fallback al caché
    async loadUsers() {
        UI.setLoading();
        const slowTimer = setTimeout(() => UI.notify("info", MESSAGES.slowServer), CONFIG.slowServerMs);

        try {
            state.users = await UserService.getAll();
            Utils.writeStorage(CONFIG.cacheKey, state.users);
            if (!this.isOnline()) UI.notify("info", MESSAGES.cachedData);
        } catch (error) {
            const cached = Utils.readStorage(CONFIG.cacheKey);
            state.users = cached ?? [];
            if (cached) UI.notify("warning", MESSAGES.cachedData);
            else UI.notify("error", `${MESSAGES.loadError} ${error.message}`);
        } finally {
            clearTimeout(slowTimer);
        }

        state.page = 1;
        this.render();
    },

    // Selecciona un usuario: lo carga en el formulario
    selectUser(id) {
        const user = this.viewUsers().find(item => item.id === id);
        if (!user) return;

        state.selectedId = user.id;
        UI.setFormValues(user);
        UI.markInvalid({});
        UI.setMessage(MESSAGES.selected, "info");
        this.render();

        // En móvil, scroll al formulario
        if (window.innerWidth < CONFIG.mobileBreakpoint) {
            UI.el.userForm.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    },

    // Limpia la selección y el formulario
    clearSelection() {
        state.selectedId = null;
        UI.resetForm();
        UI.setMessage();
        this.render();
    },

    // Cambia de página (+1 o -1)
    changePage(step) {
        state.page += step;
        this.render();
    },

    // Validación del formulario
    validate(values) {
        const invalid = {
            name: !values.name,
            userName: !values.userName,
            password: !values.password
        };
        const first = UI.markInvalid(invalid);
        if (first) {
            UI.setMessage(MESSAGES.validation);
            first.focus();
            return false;
        }
        UI.setMessage();
        return true;
    },

    // Solo envía directo si estás online Y no hay cola pendiente
    canSendNow() {
        return this.isOnline() && Queue.size === 0;
    },

    // Flujo central de escritura
    async submit(op, button, busyText) {
        if (state.busy) return;
        if (Sync.running) return UI.notify("info", MESSAGES.syncBusy);

        state.busy = true;
        UI.setBusy(button, true, busyText);
        this.render();

        try {
            if (this.canSendNow()) {
                try {
                    await Sync.send(op);
                    UI.notify("success", this.doneMessage(op));
                    this.clearSelection();
                    await this.loadUsers();
                } catch (error) {
                    if (!error.network) throw error; // error de API → mostrar
                    this.enqueue(op, false);         // error de red → encolar
                }
            } else {
                this.enqueue(op, true);
            }
        } catch (error) {
            UI.setMessage(error.message);
            UI.notify("error", error.message);
        } finally {
            state.busy = false;
            UI.setBusy(button, false);
            this.render();
        }
    },

    // Mensaje de éxito según tipo de operación
    doneMessage(op) {
        if (op.type === OPS.CREATE) return MESSAGES.created(op.name);
        if (op.type === OPS.UPDATE) return MESSAGES.updated(op.name);
        return MESSAGES.deleted(op.name);
    },

    // Encola y notifica
    enqueue(op, trySync) {
        Queue.add(op);

        const neverSent = op.type === OPS.DELETE && Queue.isTemp(op.userId);
        if (neverSent) UI.notify("success", MESSAGES.deletedLocal(op.name));
        else UI.notify("info", MESSAGES.queued[op.type](op.name));

        this.clearSelection();
        if (trySync && this.isOnline()) this.sync();
    },

    submitCreate() {
        if (state.selectedId) return;

        const values = UI.getFormValues();
        if (!this.validate(values)) return;
        const op = Queue.createOp(OPS.CREATE, Queue.newTempId(), values.name, UserModel.toPayload(values));
        this.submit(op, UI.el.btnAdd, MESSAGES.creating);
    },

    submitUpdate() {
        const values = UI.getFormValues();
        if (!state.selectedId || !this.validate(values)) return;
        const op = Queue.createOp(OPS.UPDATE, values.id, values.name, UserModel.toPayload(values));
        this.submit(op, UI.el.btnUpdate, MESSAGES.updating);
    },

    async submitDelete() {
        const { id, name } = UI.getFormValues();
        if (!id) return;

        const accepted = await UI.confirm({
            title: MESSAGES.deleteTitle,
            text: MESSAGES.deleteConfirm(name),
            okText: MESSAGES.deleteOk
        });
        if (!accepted) return;

        const op = Queue.createOp(OPS.DELETE, id, name, null);
        this.submit(op, UI.el.btnDelete, MESSAGES.deleting);
    },

    // Sincroniza la cola al servidor
    async sync({ manual = false } = {}) {
        if (Sync.running) return;
        if (!Queue.size) {
            if (manual) UI.notify("info", MESSAGES.nothingToSync);
            return;
        }
        if (!this.isOnline()) {
            if (manual) UI.notify("warning", MESSAGES.syncOffline);
            return;
        }

        UI.notify("info", MESSAGES.syncStart(Queue.size));
        const running = Sync.run();
        this.render();
        const result = await running;

        this.reportSync(result);
        await this.loadUsers();
    },

    // Reporta resultados de sync
    reportSync(result) {
        if (!result) return;
        if (result.sent > 0) UI.notify("success", MESSAGES.syncDone(result.sent));
        result.failed.forEach(item => UI.notify("error", MESSAGES.syncFailed(item.name, item.reason)));
        if (result.interrupted) UI.notify("warning", MESSAGES.syncInterrupted(Queue.size));
    },

    // Cambio de conexión
    onConnectionChange(online) {
        UI.setConnection(online);
        UI.notify(online ? "success" : "warning", online ? MESSAGES.online : MESSAGES.offline);
        this.render();
        if (!online) return;
        if (Queue.size) this.sync();
        else this.loadUsers();
    },

    // Registra todos los listeners
    bindEvents() {
        const el = UI.el;

        el.userForm.addEventListener("submit", e => { e.preventDefault(); this.submitCreate(); });
        el.btnUpdate.addEventListener("click", () => this.submitUpdate());
        el.btnDelete.addEventListener("click", () => this.submitDelete());
        el.btnClear.addEventListener("click", () => this.clearSelection());
        el.btnSync.addEventListener("click", () => this.sync({ manual: true }));

        // Al escribir en un campo, quitar el aria-invalid
        UI.formFields.forEach(field => {
            el[field].addEventListener("input", () => el[field].setAttribute("aria-invalid", "false"));
        });

        el.btnReload.addEventListener("click", () => this.loadUsers());

        // Buscador: filtra en tiempo real, 100 % local
        el.search.addEventListener("input", () => {
            state.page = 1;
            this.render();
        });

        el.btnPrev.addEventListener("click", () => this.changePage(-1));
        el.btnNext.addEventListener("click", () => this.changePage(1));

        // Click en fila → seleccionar
        el.tbody.addEventListener("click", e => {
            const row = e.target.closest("tr[data-id]");
            if (row) this.selectUser(row.dataset.id);
        });
        // Enter/Espacio en fila enfocada → seleccionar (accesibilidad)
        el.tbody.addEventListener("keydown", e => {
            if (e.key !== "Enter" && e.key !== " ") return;
            const row = e.target.closest("tr[data-id]");
            if (row) { e.preventDefault(); this.selectUser(row.dataset.id); }
        });

        // Cerrar dialog al tocar el fondo
        el.confirmDialog.addEventListener("click", e => {
            if (e.target === el.confirmDialog) el.confirmDialog.close();
        });

        // Eventos del navegador
        window.addEventListener("online", () => this.onConnectionChange(true));
        window.addEventListener("offline", () => this.onConnectionChange(false));
    },

    // Arranque
    init() {
        UI.init();
        this.bindEvents();
        UI.setConnection(this.isOnline());

        // Pintar caché de inmediato (UX instantánea)
        state.users = Utils.readStorage(CONFIG.cacheKey, []);
        this.render();

        if (!this.isOnline()) UI.notify("warning", MESSAGES.offline);

        // Sincronizar pendientes de sesión anterior o cargar
        if (this.isOnline() && Queue.size) this.sync();
        else this.loadUsers();
    }
};

/* ==========================================================
   11. INSTALACIÓN DE LA PWA
   ========================================================== */
const Installer = {
    deferredPrompt: null,

    isStandalone() {
        return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    },

    isIOS() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent);
    },

    init() {
        const button = Utils.$("btnInstall");
        if (this.isStandalone()) return;

        // Chrome/Edge disparan este evento cuando la PWA es instalable
        window.addEventListener("beforeinstallprompt", event => {
            event.preventDefault();
            this.deferredPrompt = event;
            button.hidden = false;
        });

        // Al instalarse, limpiar y avisar
        window.addEventListener("appinstalled", () => {
            this.deferredPrompt = null;
            button.hidden = true;
            UI.notify("success", MESSAGES.installed);
        });

        // iOS no tiene beforeinstallprompt → mostrar botón para instrucciones
        if (this.isIOS()) button.hidden = false;

        button.addEventListener("click", async () => {
            if (this.deferredPrompt) {
                this.deferredPrompt.prompt();
                const { outcome } = await this.deferredPrompt.userChoice;
                this.deferredPrompt = null;
                button.hidden = true;
                if (outcome === "dismissed") UI.notify("info", MESSAGES.installCancelled);
            } else if (this.isIOS()) {
                UI.notify("info", MESSAGES.installIos);
            }
        });
    }
};

/* ==========================================================
   12. SERVICE WORKER Y ARRANQUE
   ========================================================== */
async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        await navigator.serviceWorker.register(CONFIG.serviceWorkerPath);
    } catch (error) {
        console.log("Fallo en el registro del service worker", error);
    }
}

// Registrar el instalador ANTES del load para no perder beforeinstallprompt
Installer.init();

// Esperar al load para registrar el SW y arrancar el controller
window.addEventListener("load", () => {
    registerServiceWorker();
    Controller.init();
});