# Fulfillment Service — Casos de uso (MVP)

Microservicio de **logística y entrega** de ECIxpress. Genera y valida los códigos de
retiro (QR) de los pedidos, confirma entregas y publica los eventos que disparan el pago
al vendedor (Financial) y las notificaciones al comprador (Notification).

>
> **Puerto:** 3005 · **DB:** `fulfillment_db` (Neon, propia) · **ORM:** Prisma 7 ·
> **Bus:** RabbitMQ (CloudAMQP), exchange `eciexpress_events`, cola `fulfillment_service_queue`.

---

## 1. Alcance del MVP

**Fulfillment posee:** la generación del código de retiro, su validación, la confirmación
de entrega (por QR o manual), el registro de entregas fallidas, la expiración de códigos y
la invalidación por cancelación. Mantiene proyecciones locales de contexto de pedido y de
staff de tienda para operar sin llamadas síncronas a otros servicios.

**Fulfillment NO hace** (límites estrictos):
- No actualiza el estado del pedido — eso lo posee **Order**. Fulfillment solo emite
  `delivery.confirmed` / `delivery.failed`; Order consume y mueve su propio estado.
- No mueve dinero — solo emite el evento; **Financial** retiene/libera.
- No envía notificaciones — solo emite el evento; **Notification** decide canales y textos.
- No conoce métodos de pago — por eso se dispara con `order.order.confirmed`, no con un
  evento de Financial.

**Fuera del MVP (fase 2):** regenerar código (`qr.regenerated`), evento `qr.invalidated`,
manejo de cancelación-posterior-a-entrega con evento de disputa, detalle enriquecido de
entrega para soporte.

---

## 2. Actores

| Actor | Descripción |
|---|---|
| **Order (evento)** | Dispara la generación del código (`order.order.confirmed`) y la invalidación (`order.order.cancelled`). |
| **Comprador** | Consulta su código de retiro para mostrarlo en el punto de venta. |
| **Vendedor** | Valida el código y confirma la entrega; registra entregas manuales o fallidas. |
| **Sistema (job)** | Expira los códigos vencidos de forma programada. |
| **Identity (evento)** | Alimenta la proyección de autorización de tienda. |

---

## 3. Convenciones transversales

- **Credencial de retiro:** token opaco aleatorio de alta entropía, guardado en DB (no es
  un JWT; el estado vive en la base porque el código es de un solo uso, invalidable y
  regenerable). El QR codifica ese token.
- **Código corto legible:** alternativa tecleable del mismo código, base32 sin caracteres
  ambiguos (sin `0/O`, `1/I/L`), formato `XXXX-XXXX` (ej. `A7K9-P2MX`). Sirve cuando la
  cámara falla. **No** es lo mismo que "entrega manual".
- **Imagen del QR:** Fulfillment expone `GET /fulfillment/qr/{token}.png` (público pero
  inadivinable) para que Notification lo use en correo/WhatsApp. La app móvil/web renderiza
  el QR del lado del cliente desde el token.
- **Idempotencia:** toda mutación acepta `Idempotency-Key`; los consumidores de eventos
  deduplican por `idempotencyKey` del evento. Reprocesar un evento nunca produce efectos
  duplicados.
- **Correlation ID:** se propaga por `X-Correlation-Id` (HTTP) y en el payload de cada
  evento del outbox.
- **Outbox transaccional:** ningún evento se publica directo. Se escribe en `outbox_events`
  dentro de la misma transacción Prisma que el cambio de negocio; un worker publica con
  reintentos y backoff. Garantiza que `delivery.confirmed` (que mueve dinero) nunca se
  pierda.
- **Autorización:** Fulfillment confía en los headers que inyecta el API Gateway
  (`x-user-id`, rol). La pertenencia vendedor↔tienda se verifica contra la proyección
  local de staff.
- **Sobre de eventos:** JSON **plano** (sin subnodo `payload`), routing key
  `fulfillment.<entidad>.<accion>` en snake_case, `persistent: true`,
  `contentType: application/json`. Cada evento incluye `idempotencyKey` y `occurredAt`.

---

## 4. Casos de uso

### UC-01 — Generar código de retiro

- **Actor:** Order (evento `order.order.confirmed`).
- **Historia:** *Como* sistema de pedidos, *quiero* que se genere un código de retiro
  único cuando un pedido queda confirmado, *para* que el comprador pueda recogerlo sin filas.
- **Disparador:** se consume `order.order.confirmed`.
- **Precondiciones:** el evento trae `orderId`, `buyerId`, `storeId` (y opcionalmente
  `pickupExpiresAt`).
- **Flujo principal:**
  1. Se recibe el evento y se deduplica por `idempotencyKey`/`orderId`.
  2. Se genera un token opaco + un código corto legible.
  3. Se calcula `expiresAt` desde `pickupExpiresAt`; si no viene, se aplica el fallback
     configurable.
  4. En una sola transacción: se persiste el código en estado `ACTIVE` y se escribe el
     evento `fulfillment.qr.generated` en el outbox.
  5. El worker publica `fulfillment.qr.generated` con `qrCode` = URL del PNG.
- **Reglas de negocio:** RN-01, RN-02, RN-08.
- **Criterios de aceptación:**
  - *Dado* un `order.order.confirmed` para un pedido sin código, *cuando* se procesa,
    *entonces* se crea exactamente un código `ACTIVE` y se publica `fulfillment.qr.generated`.
  - *Dado* que el mismo evento llega dos veces, *cuando* se reprocesa, *entonces* no se crea
    un segundo código y no se republica el evento (idempotente).
  - *Dado* que el evento no trae `pickupExpiresAt`, *cuando* se genera, *entonces* el
    `expiresAt` toma el valor del fallback configurado.
- **Evento publicado:** `fulfillment.qr.generated` → `{ orderId, buyerId, qrCode, shortCode, expiresAt }`.

### UC-02 — Consultar el código de retiro de un pedido

- **Actor:** Comprador.
- **Historia:** *Como* comprador, *quiero* ver el código de retiro de mi pedido, *para*
  mostrarlo (QR o código corto) al recoger.
- **Disparador:** `GET /fulfillment/orders/{orderId}/code`.
- **Precondiciones:** el `x-user-id` del header coincide con el `buyerId` del pedido.
- **Flujo principal:**
  1. Se valida que el solicitante sea el dueño del pedido.
  2. Se retorna el token (para render en cliente), el código corto, la URL del PNG, el
     estado y `expiresAt`.
- **Reglas de negocio:** RN-09.
- **Criterios de aceptación:**
  - *Dado* un comprador dueño del pedido, *cuando* consulta, *entonces* recibe el código y
    su estado actual.
  - *Dado* un usuario que no es el dueño, *cuando* consulta, *entonces* recibe `403`.
  - *Dado* un pedido sin código (aún no confirmado), *cuando* consulta, *entonces* recibe `404`.

### UC-03 — Validar código de retiro

- **Actor:** Vendedor.
- **Historia:** *Como* vendedor, *quiero* validar un código (escaneado o tecleado) **sin
  confirmar la entrega**, *para* ver el pedido y comprobar que el código es válido antes de
  entregar.
- **Disparador:** `POST /fulfillment/codes/validate` con `{ code }` (token o código corto).
- **Precondiciones:** vendedor autenticado por el gateway.
- **Flujo principal (operación de solo lectura, no cambia estado):**
  1. Se busca el código por token o código corto.
  2. Se comprueba: existe, está `ACTIVE`, no expirado, no usado, no invalidado.
  3. Se comprueba que el pedido pertenece a una tienda donde el vendedor está autorizado
     (proyección de staff).
  4. Se devuelve el resultado (válido + datos del pedido, o el motivo de rechazo).
- **Reglas de negocio:** RN-03, RN-04, RN-10, RN-11.
- **Criterios de aceptación:**
  - *Dado* un código `ACTIVE` válido de su tienda, *cuando* el vendedor valida, *entonces*
    recibe `valid: true` con el detalle del pedido y **el código sigue `ACTIVE`**.
  - *Dado* un código ya usado / expirado / invalidado / inexistente, *cuando* valida,
    *entonces* recibe `valid: false` con un `validationError` tipificado.
  - *Dado* un código de otra tienda, *cuando* valida, *entonces* recibe `valid: false` con
    `WRONG_STORE`.
  - *Dado* repetidos intentos fallidos por código corto, *cuando* se exceden, *entonces* se
    aplica rate-limit.
- **Evento publicado:** ninguno (operación de lectura; se registra en auditoría).

### UC-04 — Confirmar entrega (QR)

- **Actor:** Vendedor.
- **Historia:** *Como* vendedor, *quiero* confirmar la entrega tras validar el código,
  *para* registrar el retiro y liberar el pago.
- **Disparador:** `POST /fulfillment/codes/confirm` con `{ code }`.
- **Precondiciones:** el código está `ACTIVE` y pertenece a una tienda del vendedor.
- **Flujo principal:**
  1. Se revalidan las condiciones de UC-03 (defensa: no confiar en la validación previa).
  2. En una sola transacción: se marca el código `USED`, se crea el registro de entrega
     (`method: QR`, vendedor, tienda, `deliveredAt`) y se escribe `fulfillment.delivery.confirmed`
     en el outbox.
  3. Se registra la acción en auditoría.
- **Reglas de negocio:** RN-04, RN-05, RN-10, RN-12.
- **Criterios de aceptación:**
  - *Dado* un código `ACTIVE` válido, *cuando* el vendedor confirma, *entonces* el código
    pasa a `USED`, se crea la entrega con `method: QR` y se publica `delivery.confirmed`.
  - *Dado* un código ya `USED`, *cuando* se intenta confirmar de nuevo, *entonces* la
    operación es idempotente: no se crea una segunda entrega ni se republica el evento.
  - *Dado* un código expirado/invalidado, *cuando* se intenta confirmar, *entonces* se
    rechaza con el motivo correspondiente.
- **Evento publicado:** `fulfillment.delivery.confirmed` → `{ orderId, buyerId, storeId, method: "QR", deliveredAt }`.

### UC-05 — Registrar entrega manual (fallback)

- **Actor:** Vendedor con permiso elevado (o ADMIN).
- **Historia:** *Como* vendedor autorizado, *quiero* registrar una entrega manualmente
  cuando falla el flujo técnico, *para* no bloquear al comprador.
- **Disparador:** `POST /fulfillment/orders/{orderId}/manual-delivery` con `{ reason, note? }`.
- **Precondiciones:** permiso elevado; el pedido pertenece a una tienda del vendedor;
  `reason` obligatorio.
- **Flujo principal:**
  1. Se verifica permiso elevado y pertenencia a la tienda.
  2. En una sola transacción: se marca el código (si existe) como `USED`, se crea la
     entrega (`method: MANUAL`, vendedor, tienda, `deliveredAt`, `reason`, `note?`) y se
     escribe `fulfillment.delivery.confirmed` en el outbox.
  3. Se registra en auditoría con el motivo.
- **Reglas de negocio:** RN-06, RN-07, RN-12.
- **Criterios de aceptación:**
  - *Dado* un vendedor con permiso elevado y motivo, *cuando* registra la entrega manual,
    *entonces* se crea una entrega `MANUAL` y se publica `delivery.confirmed` con `method: "MANUAL"`.
  - *Dado* que falta el motivo, *cuando* se intenta, *entonces* se rechaza con `400`.
  - *Dado* un vendedor sin permiso elevado, *cuando* lo intenta, *entonces* recibe `403`.
- **Evento publicado:** `fulfillment.delivery.confirmed` → `{ orderId, buyerId, storeId, method: "MANUAL", deliveredAt }` (mismo evento que UC-04; los consumidores distinguen por `method`).

### UC-06 — Registrar entrega fallida

- **Actor:** Vendedor.
- **Historia:** *Como* vendedor, *quiero* registrar que un pedido no se pudo entregar,
  *para* dejar trazabilidad y permitir que Order/Reporting reaccionen.
- **Disparador:** `POST /fulfillment/orders/{orderId}/delivery-failure` con `{ reason, note? }`.
- **Precondiciones:** el pedido pertenece a una tienda del vendedor; `reason` tipificado;
  `note` obligatorio si `reason = OTHER`.
- **Flujo principal:**
  1. Se verifica pertenencia a la tienda y el `reason`.
  2. En una sola transacción: se registra el fallo y se escribe `fulfillment.delivery.failed`
     en el outbox. (El código no pasa a `USED`; queda según su estado, normalmente sigue
     `ACTIVE` hasta expirar.)
  3. Se registra en auditoría.
- **Reglas de negocio:** RN-13.
- **Criterios de aceptación:**
  - *Dado* un `reason` válido de entrega, *cuando* el vendedor registra el fallo,
    *entonces* se publica `delivery.failed` con ese motivo.
  - *Dado* `reason = OTHER` sin `note`, *cuando* se intenta, *entonces* se rechaza con `400`.
- **Evento publicado:** `fulfillment.delivery.failed` → `{ orderId, buyerId, reason }`.

> **Nota:** los motivos de *validación* (`CODE_NOT_FOUND`, `CODE_EXPIRED`,
> `CODE_ALREADY_USED`, `CODE_INVALIDATED`, `WRONG_STORE`) se devuelven como error de
> validación en UC-03 y **no** generan `delivery.failed`. Este caso es solo para fallos de
> *entrega* (`CUSTOMER_NO_SHOW`, `SELLER_REJECTED`, `ORDER_NOT_AVAILABLE`, `OTHER`).

### UC-07 — Expirar códigos vencidos (job)

- **Actor:** Sistema (job programado).
- **Historia:** *Como* sistema, *quiero* expirar los códigos vencidos automáticamente,
  *para* que ningún código siga siendo válido después de su ventana de recogida.
- **Disparador:** job periódico (ej. cada minuto).
- **Flujo principal:**
  1. Se buscan códigos `ACTIVE` con `expiresAt <= now`.
  2. Por cada uno, en transacción: se marca `EXPIRED` y se escribe `fulfillment.qr.expired`
     en el outbox.
- **Reglas de negocio:** RN-08, RN-14.
- **Criterios de aceptación:**
  - *Dado* un código `ACTIVE` cuyo `expiresAt` ya pasó, *cuando* corre el job, *entonces*
    pasa a `EXPIRED` y se publica `qr.expired` una sola vez.
  - *Dado* un código ya `USED` o `INVALIDATED`, *cuando* corre el job, *entonces* no se
    toca.
- **Evento publicado:** `fulfillment.qr.expired` → `{ orderId, buyerId }`.

### UC-08 — Invalidar código por cancelación

- **Actor:** Order (evento `order.order.cancelled`).
- **Historia:** *Como* sistema de pedidos, *quiero* que el código quede inutilizable si el
  pedido se cancela, *para* impedir un retiro de algo ya cancelado.
- **Disparador:** se consume `order.order.cancelled`.
- **Flujo principal:**
  1. Se busca el código del pedido.
  2. Si está `ACTIVE`, en transacción pasa a `INVALIDATED`.
  3. Comportamiento idempotente y seguro ante estados finales (ver criterios).
- **Reglas de negocio:** RN-04, RN-15.
- **Criterios de aceptación:**
  - *Dado* un código `ACTIVE`, *cuando* llega la cancelación, *entonces* pasa a `INVALIDATED`.
  - *Dado* un código ya `INVALIDATED` o `EXPIRED`, *cuando* llega la cancelación, *entonces*
    no falla y conserva su estado final.
  - *Dado* un código ya `USED` (pedido ya entregado), *cuando* llega la cancelación,
    *entonces* **no se "desentrega"**: se registra la inconsistencia en auditoría (en fase 2,
    se emitirá un evento de disputa).
- **Evento publicado:** ninguno en MVP (en fase 2: `fulfillment.qr.invalidated`).

### UC-09 — Consultar estado de fulfillment por pedido

- **Actor:** Vendedor / Comprador (según permiso) / soporte.
- **Historia:** *Como* usuario autorizado, *quiero* ver el estado del proceso de retiro de
  un pedido, *para* saber si ya se entregó, expiró o falló — independiente del estado
  general del pedido.
- **Disparador:** `GET /fulfillment/orders/{orderId}`.
- **Flujo principal:** retorna estado del código, `expiresAt`, si fue validado/usado,
  método de entrega, `deliveredAt` y excepción registrada (si la hay).
- **Criterios de aceptación:**
  - *Dado* un pedido con proceso de fulfillment, *cuando* se consulta, *entonces* se retorna
    su estado actual.
  - *Dado* un pedido inexistente para Fulfillment, *cuando* se consulta, *entonces* `404`.

### UC-10 — Historial de entregas por tienda

- **Actor:** Vendedor / Administrador.
- **Historia:** *Como* vendedor o admin, *quiero* listar las entregas de una tienda,
  *para* control operativo y conciliación.
- **Disparador:** `GET /fulfillment/stores/{storeId}/deliveries`.
- **Flujo principal:** listado paginado con filtros (`method`, `from`, `to`, vendedor) y
  ordenamiento; restringido a tiendas donde el solicitante está autorizado.
- **Criterios de aceptación:**
  - *Dado* un vendedor de la tienda, *cuando* lista, *entonces* recibe las entregas
    paginadas con sus filtros.
  - *Dado* un usuario sin acceso a la tienda, *cuando* lista, *entonces* `403`.

---

## 5. Contratos de eventos

### Consumidos (binding: `order.#`, `identity.#`)

| Routing key | Uso | Campos que se usan |
|---|---|---|
| `order.order.confirmed` | Disparar UC-01 | `orderId*`, `buyerId*`, `storeId*`, `pickupExpiresAt?` |
| `order.order.cancelled` | Disparar UC-08 | `orderId*` |
| `identity.store.created` | Proyección de autorización | `storeId*`, `ownerId*` |
| `identity.store.staff_changed` | Proyección de autorización | `storeId*`, `userId*`, `action*` |

### Publicados (exchange `eciexpress_events`, vía outbox)

| Routing key | Disparado por | Campos |
|---|---|---|
| `fulfillment.qr.generated` | UC-01 | `orderId`, `buyerId`, `qrCode`, `shortCode`, `expiresAt` |
| `fulfillment.delivery.confirmed` | UC-04 / UC-05 | `orderId`, `buyerId`, `storeId`, `method` (`QR`\|`MANUAL`), `deliveredAt` |
| `fulfillment.delivery.failed` | UC-06 | `orderId`, `buyerId`, `reason` |
| `fulfillment.qr.expired` | UC-07 | `orderId`, `buyerId` |

> Todos incluyen además `idempotencyKey`, `occurredAt`, `source: "fulfillment-service"` y
> `correlationId`. `buyerId` se incluye en todos para que Notification pueda resolver al
> destinatario; Financial solo lee `orderId` de `delivery.confirmed`.

---

## 6. Enums

```
PickupCodeStatus      { ACTIVE, USED, EXPIRED, INVALIDATED }
DeliveryMethod        { QR, MANUAL }
DeliveryFailureReason { CUSTOMER_NO_SHOW, SELLER_REJECTED, ORDER_NOT_AVAILABLE, OTHER }
ValidationError       { CODE_NOT_FOUND, CODE_EXPIRED, CODE_ALREADY_USED, CODE_INVALIDATED, WRONG_STORE }
OutboxStatus          { PENDING, PUBLISHED, FAILED }
AuditAction           { CODE_GENERATED, CODE_VALIDATED, DELIVERY_CONFIRMED, MANUAL_DELIVERY, DELIVERY_FAILED, CODE_INVALIDATED, CODE_EXPIRED }
```

---

## 7. Entidades que se desprenden (preview del modelo de datos)

Esto es solo el puente hacia el modelo completo (que irá en el `CLAUDE.md`):

- **pickup_codes** — el código de retiro: `orderId`, `buyerId`, `storeId`, `token` (único),
  `shortCode` (único), `status`, `expiresAt`, timestamps. Invariante: máximo un código
  `ACTIVE` por `orderId`.
- **deliveries** — el registro de entrega: `orderId`, `storeId`, `confirmedByUserId`,
  `method`, `deliveredAt`, `reason?`, `note?`.
- **order_projection** — proyección de contexto de pedido desde eventos de Order:
  `orderId`, `buyerId`, `storeId`, `pickupExpiresAt?`.
- **store_staff_projection** — proyección de autorización desde eventos de Identity:
  `storeId`, `userId`, `role` (owner/staff).
- **outbox_events** — eventos pendientes de publicar (patrón Outbox).
- **audit_logs** — log append-only de acciones sensibles.

---

## 8. Reglas de negocio (MVP)

| # | Regla |
|---|---|
| RN-01 | El código de retiro se genera al consumir `order.order.confirmed`, nunca a partir de un evento de pago. Fulfillment es agnóstico al método de pago. |
| RN-02 | La generación es idempotente: un mismo pedido nunca tiene dos códigos `ACTIVE`. |
| RN-03 | Validar es una operación de solo lectura: no cambia el estado del código. |
| RN-04 | La validación y la confirmación exigen que el pedido pertenezca a una tienda donde el vendedor está autorizado (owner o staff). |
| RN-05 | Confirmar entrega marca el código `USED` y crea exactamente un registro de entrega. |
| RN-06 | La entrega manual exige permiso elevado y motivo obligatorio. |
| RN-07 | Entrega por QR y entrega manual publican el mismo evento `delivery.confirmed`, distinguidas por `method`. |
| RN-08 | Un código solo es válido si está `ACTIVE` y no ha expirado. |
| RN-09 | El comprador solo puede consultar el código de sus propios pedidos. |
| RN-10 | La confirmación revalida todas las condiciones (no confía en una validación previa). |
| RN-11 | El código corto legible se valida con rate-limit para evitar adivinación por fuerza bruta. |
| RN-12 | Toda confirmación/entrega manual queda registrada en auditoría con actor, tienda y timestamp. |
| RN-13 | Los motivos de entrega fallida son tipificados; `OTHER` exige descripción. |
| RN-14 | La expiración es idempotente y solo afecta códigos `ACTIVE`. |
| RN-15 | La invalidación por cancelación es idempotente; si el pedido ya fue entregado, no se revierte la entrega: se registra la inconsistencia. |
| RN-16 | Todo evento de salida pasa por el Outbox transaccional; ninguno se publica directo. |
| RN-17 | Ningún otro microservicio accede directamente a la base de datos de Fulfillment. |

---

## 9. Nota de coordinación con Order (no bloquea el MVP)

El catálogo actual de Notification documenta `order.order.confirmed` con solo
`{ orderId, buyerId }`. Fulfillment necesita además **`storeId`** (para autorización de
tienda) y, idealmente, **`pickupExpiresAt`** (para la expiración del código). Como Order se
construye desde cero, se define aquí ese contrato para que el equipo de Order lo honre:

```jsonc
// order.order.confirmed (contrato esperado por Fulfillment)
{
  "orderId": "ord_123",
  "buyerId": "usr_456",
  "storeId": "str_9",
  "pickupExpiresAt": "2026-06-17T18:00:00Z",   // opcional; si falta, Fulfillment usa fallback
  "idempotencyKey": "..."
}
```

Mientras Order no envíe `pickupExpiresAt`, la expiración usa un fallback configurable por
variable de entorno (ej. expira N horas después de generarse o al cierre del día operativo).
