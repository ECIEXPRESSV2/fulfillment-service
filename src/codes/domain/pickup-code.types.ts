/**
 * Motivos de rechazo al validar un código (UC-03). NO es un enum de DB: es un tipo TS que
 * se devuelve en la respuesta de validación, no se persiste (CLAUDE.md §5).
 */
export enum ValidationError {
  CODE_NOT_FOUND = 'CODE_NOT_FOUND',
  CODE_EXPIRED = 'CODE_EXPIRED',
  CODE_ALREADY_USED = 'CODE_ALREADY_USED',
  CODE_INVALIDATED = 'CODE_INVALIDATED',
  WRONG_STORE = 'WRONG_STORE',
}

/** Datos del pedido que se devuelven cuando el código es válido. */
export interface ValidatedOrder {
  orderId: string;
  orderNumber: string;
  buyerId: string;
  storeId: string;
  expiresAt: Date;
}

/** Resultado de validar un código: válido (con datos del pedido) o rechazado (con motivo). */
export type ValidationResult =
  | { valid: true; order: ValidatedOrder }
  | { valid: false; validationError: ValidationError };

/** Entrada para generar el código de retiro de un pedido confirmado (UC-01). */
export interface GenerateCodeInput {
  orderId: string;
  buyerId: string;
  storeId: string;
  /** Vencimiento del pedido; si falta, se usa el fallback configurable. */
  pickupExpiresAt?: Date | null;
  /** Correlación del evento que originó la generación. */
  correlationId?: string;
}
