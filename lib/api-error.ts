import { NextRequest, NextResponse } from 'next/server';

/**
 * Structured API error. Throw these from inside a routeHandler wrapper
 * and they'll be converted into a proper JSON response automatically.
 *
 * Usage:
 *   throw new ApiError(400, 'Missing photo', 'No image attached', 'MISSING_IMAGE');
 *
 * The `error` field (2nd arg) is the user-facing summary.
 * The `detail` field (3rd arg) is the technical detail — still safe to show the user.
 * The `code` (4th arg) is a machine-readable code for frontend branching.
 */
export class ApiError extends Error {
  status: number;
  detail: string;
  code: string;
  context?: Record<string, unknown>;

  constructor(
    status: number,
    error: string,
    detail: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(error);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.context = context;
  }
}

/**
 * Wrap a route handler. Catches ApiError (→ structured 4xx/5xx response) and
 * any other thrown error (→ generic 500 with logged context).
 */
export function routeHandler<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (e: any) {
      if (e instanceof ApiError) {
        // Log at warn level — it's a known, handled failure
        console.warn('[api]', JSON.stringify({
          level: 'warn',
          code: e.code,
          status: e.status,
          error: e.message,
          detail: e.detail,
          context: e.context,
        }));
        return NextResponse.json(
          { error: e.message, detail: e.detail, code: e.code },
          { status: e.status }
        );
      }

      // Unexpected error — log everything we know
      console.error('[api]', JSON.stringify({
        level: 'error',
        code: 'INTERNAL_ERROR',
        status: 500,
        error: 'Something went wrong',
        detail: e?.message,
        stack: e?.stack?.split('\n').slice(0, 8).join('\n'),
      }));

      return NextResponse.json(
        {
          error: 'Something went wrong.',
          detail: e?.message || 'An unexpected error occurred.',
          code: 'INTERNAL_ERROR',
        },
        { status: 500 }
      );
    }
  }) as T;
}

/**
 * Convenience helpers for common cases. These throw, so use them inside
 * a routeHandler-wrapped function.
 */
export function requireAuthOrThrow(session: unknown): asserts session {
  if (!session) {
    throw new ApiError(401, 'Not signed in', 'Authentication required.', 'UNAUTHORIZED');
  }
}

export function badInput(detail: string): ApiError {
  return new ApiError(400, 'Invalid input', detail, 'BAD_INPUT');
}

export function notFound(what = 'Resource'): ApiError {
  return new ApiError(404, `${what} not found`, `${what} not found.`, 'NOT_FOUND');
}
