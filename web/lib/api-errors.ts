/**
 * API error classes with consistent HTTP status codes and error types
 * usage: throw new NotFound("Plugin", id) -> 404 with proper shape
 */

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details })
    };
  }
}

// 400 bad request
export class BadRequest extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("BAD_REQUEST", message, 400, details);
  }
}

// 401 unauthorized
export class Unauthorized extends ApiError {
  constructor(message: string = "Authentication required", details?: Record<string, unknown>) {
    super("UNAUTHORIZED", message, 401, details);
  }
}

// 403 forbidden
export class Forbidden extends ApiError {
  constructor(message: string = "Insufficient permissions", details?: Record<string, unknown>) {
    super("FORBIDDEN", message, 403, details);
  }
}

// 404 not found
export class NotFound extends ApiError {
  constructor(resource: string, identifier?: string, details?: Record<string, unknown>) {
    const message = identifier ? `${resource} not found` : `${resource} not found`;
    const baseDetails = identifier ? { resource, id: identifier } : { resource };
    super("NOT_FOUND", message, 404, { ...baseDetails, ...details });
  }
}

// 409 conflict
export class Conflict extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, 409, details);
  }
}

// 422 validation
export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 422, details);
  }
}

// 429 rate limit
export class RateLimitExceeded extends ApiError {
  constructor(message: string = "Rate limit exceeded", details?: Record<string, unknown>) {
    super("RATE_LIMIT_EXCEEDED", message, 429, details);
  }
}

// 500 internal server error
export class InternalServerError extends ApiError {
  constructor(message: string = "Internal server error", details?: Record<string, unknown>) {
    super("INTERNAL_SERVER_ERROR", message, 500, details);
  }
}

// 503 service unavailable
export class ServiceUnavailable extends ApiError {
  constructor(message: string = "Service unavailable", details?: Record<string, unknown>) {
    super("SERVICE_UNAVAILABLE", message, 503, details);
  }
}

// 410 gone
export class Gone extends ApiError {
  constructor(message: string = "Resource no longer available", details?: Record<string, unknown>) {
    super("GONE", message, 410, details);
  }
}
