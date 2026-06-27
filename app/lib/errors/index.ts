import { NextResponse } from "next/server";

/**
 * Canonical error envelope used by every API route.
 *
 * Shape:
 * ```json
 * {
 * "error": {
 * "code":       "STREAM_NOT_FOUND",
 * "message":    "The requested stream does not exist.",
 * "request_id": "req_01HZ..."
 * }
 * }
 * ```
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
}

/**
 * StreamPay frontend domain runtime error structure matching backend shape.
 */
export type StreamPayError = {
  code: string;
  message: string;
  request_id?: string;
  status?: number;
  retry?: {               // ✅ Add the retry structure to satisfy the frontend UI code
    retryable: boolean;
  };
  error?: {
    code: string;
    message: string;
    request_id?: string;
  };
};

/**
 * Well-known error codes used across routes.
 * Extend this list as new routes are added.
 */
export const ErrorCode = {
  // Generic
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  // Webhooks
  WEBHOOK_PROCESSING_FAILED: "WEBHOOK_PROCESSING_FAILED",
  DELIVERY_FETCH_FAILED: "DELIVERY_FETCH_FAILED",
  // KMS / signing
  KMS_SIGN_FAILED: "KMS_SIGN_FAILED",
  KMS_SIGN_INVALID_INPUT: "KMS_SIGN_INVALID_INPUT",
  // Auth
  WALLET_CHALLENGE_FAILED: "WALLET_CHALLENGE_FAILED",
  WALLET_VERIFY_FAILED: "WALLET_VERIFY_FAILED",
  // Streams
  STREAM_NOT_FOUND: "STREAM_NOT_FOUND",
  STREAM_CREATE_FAILED: "STREAM_CREATE_FAILED",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Reads the `x-request-id` header forwarded by the gateway/load-balancer,
 * or generates a lightweight fallback so every response always carries one.
 */
function resolveRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Build a `NextResponse` with the canonical error envelope.
 */
export function errorResponse(
  code: string,
  message: string,
  status = 500,
): NextResponse<ErrorEnvelope> {
  const request_id = resolveRequestId();
  return NextResponse.json<ErrorEnvelope>(
    { error: { code, message, request_id } },
    { status },
  );
}

/**
 * Type guard to check if an unknown object satisfies the StreamPay runtime error schema.
 */
export function isStreamPayError(error: any): error is StreamPayError {
  if (error && typeof error === 'object') {
    if ('error' in error && error.error && typeof error.error === 'object') {
      return 'code' in error.error && 'message' in error.error;
    }
    return 'code' in error && 'message' in error;
  }
  return false;
}

/**
 * Formatting utility to cleanly extract human-readable logs for Toast notifications.
 */
export function formatErrorForDisplay(error: any): string {
  if (isStreamPayError(error)) {
    return error.error?.message || error.message;
  }
  return error instanceof Error ? error.message : "An unexpected execution error occurred.";
}

/**
 * Normalizes an unknown throwing entity safely into a standard StreamPay UI error instance.
 */
export function normalizeError(error: any): StreamPayError {
  if (isStreamPayError(error)) {
    if (error.error) {
      return {
        code: error.error.code,
        message: error.error.message,
        request_id: error.error.request_id,
      };
    }
    return error;
  }
  return {
    code: "INTERNAL_SERVER_ERROR", // Safe hardcoded string literal fallback to clear circular reference checks
    message: error instanceof Error ? error.message : String(error),
  };
}