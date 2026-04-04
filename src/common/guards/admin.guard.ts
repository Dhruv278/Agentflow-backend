import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { RequestUser } from '../decorators/current-user.decorator.js';

@Injectable()
export class AdminGuard implements CanActivate {
  private adminEmails: string[] = [];

  constructor(private readonly configService: ConfigService) {
    const emails = this.configService.get<string>('ADMIN_EMAILS', '');
    this.adminEmails = emails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as RequestUser | undefined;

    if (!user || !this.adminEmails.includes(user.email.toLowerCase())) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
