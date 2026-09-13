import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

// RFC 9457 problem details. Every error the API returns has this shape and the
// application/problem+json media type, exactly as the contract promises.
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { field: string; message: string }[];
}

const PROBLEM_BASE = 'https://api.example.ph/problems/';

export class ProblemException extends Error {
  constructor(
    public readonly status: number,
    public readonly slug: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: { field: string; message: string }[],
    public readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? title);
  }

  static badRequest(detail: string) {
    return new ProblemException(400, 'bad-request', 'Malformed request', detail);
  }
  static unauthorized(detail = 'Missing or invalid token') {
    return new ProblemException(401, 'unauthorized', 'Unauthorized', detail);
  }
  static forbidden(detail = 'Not allowed') {
    return new ProblemException(403, 'forbidden', 'Forbidden', detail);
  }
  static notFound(detail = 'Not found') {
    return new ProblemException(404, 'not-found', 'Not found', detail);
  }
  static conflict(detail: string) {
    return new ProblemException(409, 'conflict', 'Conflict', detail);
  }
  static validation(errors: { field: string; message: string }[]) {
    return new ProblemException(422, 'validation', 'Validation failed', 'One or more fields are invalid', errors);
  }
  static locked(detail: string) {
    return new ProblemException(423, 'locked', 'Locked', detail);
  }
  static rateLimited(retryAfterSeconds: number, detail = 'Too many requests') {
    return new ProblemException(429, 'rate-limited', 'Too many requests', detail, undefined, {
      'Retry-After': String(retryAfterSeconds),
    });
  }

  toBody(instance?: string): ProblemBody {
    return {
      type: PROBLEM_BASE + this.slug,
      title: this.title,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}

/** Parse with a zod schema; a failure becomes a 422 (body) or 400 (query/params) problem. */
export function parseOr<T>(schema: ZodType<T>, value: unknown, where: 'body' | 'query' | 'params' = 'body'): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const errors = r.error.issues.map((i) => ({ field: i.path.join('.') || where, message: i.message }));
  if (where === 'body') throw ProblemException.validation(errors);
  throw new ProblemException(400, 'bad-request', 'Malformed request', 'Invalid query or path parameter', errors);
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    let problem: ProblemException;

    if (exception instanceof ProblemException) {
      problem = exception;
    } else if (exception instanceof ZodError) {
      problem = ProblemException.validation(
        exception.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      problem = new ProblemException(
        status,
        HttpStatus[status]?.toLowerCase().replaceAll('_', '-') ?? 'error',
        exception.message,
        Array.isArray(detail) ? detail.join('; ') : detail,
      );
    } else {
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
      problem = new ProblemException(500, 'internal', 'Internal server error');
    }

    for (const [k, v] of Object.entries(problem.headers)) res.setHeader(k, v);
    res.status(problem.status).type('application/problem+json').send(problem.toBody(req.originalUrl));
  }
}
