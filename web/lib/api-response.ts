/**
 * consistent API response utilities
 * usage:
 *   throw new NotFound("Plugin", id)
 *   return apiSuccess({ data })
 *   return apiError(error)
 */

import { NextResponse, NextRequest } from 'next/server';
import { ApiError } from './api-errors';
import { randomUUID } from 'crypto';
import { recordRequest, extractRoute } from './api-metrics';

export interface ApiResponseSuccess<T = unknown> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiResponseError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}

export type ApiResponse<T = unknown> = ApiResponseSuccess<T> | ApiResponseError;

/**
 * generate request ID for tracing
 */
export function generateRequestId(): string {
  return `req_${randomUUID().slice(0, 8)}`;
}

/**
 * successful response wrapper
 */
export function apiSuccess<T>(data: T, requestId?: string, status: number = 200): NextResponse {
  const body: ApiResponseSuccess<T> = {
    success: true,
    data,
    requestId: requestId ?? generateRequestId()
  };
  return NextResponse.json(body, { status });
}

/**
 * error response from ApiError instance
 */
export function apiError(error: unknown, requestId?: string): NextResponse {
  const id = requestId ?? generateRequestId();

  // ApiError instances
  if (error instanceof ApiError) {
    const body: ApiResponseError = {
      success: false,
      error: error.toJSON(),
      requestId: id
    };
    return NextResponse.json(body, { status: error.statusCode });
  }

  // standard Error
  const isDev = process.env.NODE_ENV !== "production";
  if (error instanceof Error) {
    const body: ApiResponseError = {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: isDev ? error.message : "An unexpected error occurred"
      },
      requestId: id
    };
    if (isDev) console.error(`[API ${id}]`, error.message);
    return NextResponse.json(body, { status: 500 });
  }

  // unknown error type
  const body: ApiResponseError = {
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: isDev ? String(error) : "An unexpected error occurred"
    },
    requestId: id
  };
  return NextResponse.json(body, { status: 500 });
}

/**
 * route handler wrapper with automatic error handling
 * two variants:
 * 1. static routes: export const POST = withErrorHandling(async (req) => { ... })
 * 2. dynamic routes: export const GET = withErrorHandling(async (req, ctx) => { ... })
 */
export function withErrorHandling(
  handler: (req: NextRequest) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse>;
export function withErrorHandling<
  C extends { params: Promise<Record<string, string>> }
>(
  handler: (req: NextRequest, context: C) => Promise<NextResponse>
): (req: NextRequest, context: C) => Promise<NextResponse>;
export function withErrorHandling<
  C extends { params: Promise<Record<string, string>> } = { params: Promise<Record<string, string>> }
>(
  handler: (req: NextRequest, context?: C) => Promise<NextResponse>
): (req: NextRequest, context?: C) => Promise<NextResponse> {
  return async (req, context = {} as C) => {
    const requestId = generateRequestId();
    const start = performance.now();
    try {
      const response = await handler(req, context);
      const duration = Math.round(performance.now() - start);
      if (response.headers.get('x-request-id') !== requestId) {
        response.headers.set('x-request-id', requestId);
      }
      response.headers.set('x-response-time', `${duration}ms`);
      recordRequest(req.method, req.url, duration, response.status);
      if (process.env.NODE_ENV !== 'production' && duration > 500) {
        console.warn(`[SLOW] ${req.method} ${extractRoute(req.url)} ${duration}ms`);
      }
      return response;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      const errorResponse = apiError(error, requestId);
      errorResponse.headers.set('x-request-id', requestId);
      errorResponse.headers.set('x-response-time', `${duration}ms`);
      recordRequest(req.method, req.url, duration, errorResponse.status);
      return errorResponse;
    }
  };
}

/**
 * extract request ID from headers or generate new one
 */
export function getRequestId(req: Request): string {
  const headerId = req.headers.get('x-request-id');
  return headerId ?? generateRequestId();
}
