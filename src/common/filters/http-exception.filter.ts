import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const PRISMA_ERROR_MAP: Record<
  string,
  { status: number; error: string; message: string }
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'A record with this value already exists',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'This operation conflicts with existing data',
  },
  P2014: {
    status: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: 'Required relation constraint violated',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    error: 'Not Found',
    message: 'The requested resource was not found',
  },
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      this.handleHttpException(exception, response);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.handlePrismaError(exception, response);
      return;
    }

    this.handleUnknownError(exception, response);
  }

  private handleHttpException(
    exception: HttpException,
    response: Response,
  ): void {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
      error = exception.name;
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      const resp = exceptionResponse as Record<string, unknown>;
      message = (resp['message'] as string | string[]) ?? message;
      error = (resp['error'] as string) ?? exception.name;
    }

    if (status >= 500) {
      this.logger.error(
        { statusCode: status, message, stack: exception.stack },
        `HttpException ${status}`,
      );
    }

    response.status(status).json({ statusCode: status, error, message });
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
    response: Response,
  ): void {
    const mapped = PRISMA_ERROR_MAP[exception.code];

    if (mapped) {
      this.logger.warn(
        { code: exception.code, meta: exception.meta },
        `Prisma ${exception.code}: ${exception.message}`,
      );
      response.status(mapped.status).json({
        statusCode: mapped.status,
        error: mapped.error,
        message: mapped.message,
      });
      return;
    }

    this.logger.error(
      { code: exception.code, meta: exception.meta, stack: exception.stack },
      `Unhandled Prisma error ${exception.code}: ${exception.message}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  }

  private handleUnknownError(exception: unknown, response: Response): void {
    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      { stack: err.stack, name: err.constructor.name },
      `Unhandled exception: ${err.message}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  }
}
