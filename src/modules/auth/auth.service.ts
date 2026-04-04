import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Response, Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SetPasswordDto } from './dto/set-password.dto.js';
import type { ResendVerificationDto } from './dto/resend-verification.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { UserResponseDto } from './dto/user-response.dto.js';
import type { JwtPayload } from './strategies/jwt.strategy.js';
import type { User } from '@prisma/client';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const EMAIL_VERIFY_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Registration (email-only, no password) ───

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing && existing.emailVerified) {
      throw new ConflictException('Email already registered');
    }

    let user: User;

    if (existing && !existing.emailVerified) {
      // Reuse unverified account: update name, invalidate old tokens
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { name: dto.name },
      });

      await this.prisma.verificationToken.updateMany({
        where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
        data: { usedAt: new Date() },
      });
    } else {
      // Create new user with dummy password (user cannot login until they set a real one)
      const dummyHash = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        BCRYPT_ROUNDS,
      );

      user = await this.prisma.user.create({
        data: {
          email,
          name: dto.name,
          passwordHash: dummyHash,
        },
      });
    }

    const { rawToken, tokenHash } = this.generateVerificationToken();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS),
      },
    });

    await this.emailService.sendVerificationEmail(email, user.name, rawToken);

    this.logger.log({ userId: user.id, email }, 'Verification email sent');

    return { message: 'Verification email sent. Please check your inbox.' };
  }

  // ─── Set Password (from email verification link) ───

  async setPassword(dto: SetPasswordDto): Promise<{ user: UserResponseDto }> {
    const verificationToken = await this.validateToken(
      dto.token,
      'EMAIL_VERIFY',
    );

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: verificationToken.userId },
        data: {
          passwordHash,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      await tx.verificationToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() },
      });

      return updated;
    });

    this.logger.log({ userId: user.id }, 'Email verified and password set');

    // Send welcome email (non-blocking — don't fail the response if this errors)
    this.emailService
      .sendWelcomeEmail(user.email, user.name, user.plan)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn({ userId: user.id, error: msg }, 'Failed to send welcome email');
      });

    return { user: AuthService.toUserResponse(user) };
  }

  // ─── Resend Verification Email ───

  async resendVerification(
    dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const email = dto.email.toLowerCase().trim();
    const genericMessage =
      'If an account exists with this email, a new verification link has been sent.';

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.emailVerified) {
      return { message: genericMessage };
    }

    // Invalidate existing verification tokens
    await this.prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
      data: { usedAt: new Date() },
    });

    const { rawToken, tokenHash } = this.generateVerificationToken();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS),
      },
    });

    await this.emailService.sendVerificationEmail(email, user.name, rawToken);

    this.logger.log({ userId: user.id }, 'Verification email resent');

    return { message: genericMessage };
  }

  // ─── Forgot Password ───

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const email = dto.email.toLowerCase().trim();
    const genericMessage =
      'If an account exists with this email, a password reset link has been sent.';

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.emailVerified) {
      return { message: genericMessage };
    }

    // Invalidate existing password reset tokens
    await this.prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    });

    const { rawToken, tokenHash } = this.generateVerificationToken();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
      },
    });

    await this.emailService.sendPasswordResetEmail(email, user.name, rawToken);

    this.logger.log({ userId: user.id }, 'Password reset email sent');

    return { message: genericMessage };
  }

  // ─── Reset Password (from forgot-password link) ───

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const verificationToken = await this.validateToken(
      dto.token,
      'PASSWORD_RESET',
    );

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: { passwordHash },
      });

      await tx.verificationToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() },
      });

      // Invalidate all existing sessions (force re-login with new password)
      await tx.session.deleteMany({
        where: { userId: verificationToken.userId },
      });
    });

    this.logger.log(
      { userId: verificationToken.userId },
      'Password reset completed',
    );

    return { message: 'Password has been reset. You can now log in.' };
  }

  // ─── Login ───

  async login(
    dto: LoginDto,
    res: Response,
  ): Promise<{ user: UserResponseDto }> {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account suspended');
    }

    const tokens = this.generateTokens(user);
    await this.createSession(user.id, tokens.refreshToken);
    this.setCookies(res, tokens.accessToken, tokens.refreshToken);

    return { user: AuthService.toUserResponse(user) };
  }

  // ─── Refresh ───

  async refreshTokens(
    req: Request,
    res: Response,
  ): Promise<{ user: UserResponseDto }> {
    const refreshToken = req.cookies?.['refresh_token'] as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hashedToken = this.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { token: hashedToken },
    });

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid user');
    }

    const newTokens = this.generateTokens(user);

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        token: this.hashToken(newTokens.refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_COOKIE_MAX_AGE),
      },
    });

    this.setCookies(res, newTokens.accessToken, newTokens.refreshToken);

    return { user: AuthService.toUserResponse(user) };
  }

  // ─── Logout ───

  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.['refresh_token'] as string | undefined;

    if (refreshToken) {
      const hashedToken = this.hashToken(refreshToken);
      await this.prisma.session.deleteMany({
        where: { token: hashedToken },
      });
    }

    this.clearCookies(res);
  }

  // ─── Get Current User ───

  async getMe(userId: string): Promise<{ user: UserResponseDto }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { user: AuthService.toUserResponse(user) };
  }

  // ─── Private: Token Validation ───

  private async validateToken(
    rawToken: string,
    type: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
  ) {
    const tokenHash = this.hashToken(rawToken);

    const verificationToken = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verificationToken) {
      throw new BadRequestException('Invalid or expired token');
    }

    if (verificationToken.type !== type) {
      throw new BadRequestException('Invalid or expired token');
    }

    if (verificationToken.usedAt) {
      throw new BadRequestException('This token has already been used');
    }

    if (verificationToken.expiresAt < new Date()) {
      throw new BadRequestException('This token has expired');
    }

    return verificationToken;
  }

  // ─── Private: Token Generation ───

  private generateVerificationToken(): {
    rawToken: string;
    tokenHash: string;
  } {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  private generateTokens(user: User): {
    accessToken: string;
    refreshToken: string;
  } {
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, jti: crypto.randomUUID() },
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: ACCESS_TOKEN_EXPIRY,
      },
    );

    const refreshToken = this.jwtService.sign(
      { sub: user.id, email: user.email, jti: crypto.randomUUID() },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TOKEN_EXPIRY,
      },
    );

    return { accessToken, refreshToken };
  }

  // ─── Private: Session ───

  private async createSession(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    const hashedToken = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE);

    await this.prisma.session.create({
      data: { userId, token: hashedToken, expiresAt },
    });
  }

  // ─── Private: Cookies ───

  private setCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      ...(isProduction ? { sameSite: 'none' as const } : {}),
      path: '/',
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }

  private clearCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }

  // ─── Private: Hashing ───

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ─── Private: Response Mapping ───

  private static toUserResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      status: user.status,
      emailVerified: user.emailVerified,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
