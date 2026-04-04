import {
  Injectable,
  Logger,
  OnModuleInit,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class KeyVaultService implements OnModuleInit {
  private readonly logger = new Logger(KeyVaultService.name);
  private vaultKey!: Buffer;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    const secret = this.configService.get<string>('VAULT_SECRET');
    if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) {
      throw new Error(
        'VAULT_SECRET must be a 64-character hex string (32 bytes). App refusing to start.',
      );
    }
    this.vaultKey = Buffer.from(secret, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.vaultKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    try {
      const data = Buffer.from(ciphertext, 'base64');
      const iv = data.subarray(0, IV_LENGTH);
      const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, this.vaultKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      this.logger.error('Failed to decrypt stored key');
      throw new BadRequestException('Failed to decrypt key');
    }
  }

  async saveKey(userId: string, plainKey: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.plan === 'FREE') {
      throw new ForbiddenException(
        'Free plan does not allow storing an API key. Upgrade to Pro or BYOK.',
      );
    }

    const encryptedOrKey = this.encrypt(plainKey);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        encryptedOrKey,
        orKeyAddedAt: new Date(),
        orKeyLastUsedAt: null,
      },
    });

    this.logger.log({ userId }, 'OpenRouter key saved');
  }

  async getDecryptedKey(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedOrKey: true },
    });

    if (!user?.encryptedOrKey) {
      return null;
    }

    return this.decrypt(user.encryptedOrKey);
  }

  async deleteKey(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        encryptedOrKey: null,
        orKeyAddedAt: null,
        orKeyLastUsedAt: null,
      },
    });

    this.logger.log({ userId }, 'OpenRouter key deleted');
  }

  async getKeyStatus(userId: string): Promise<{
    hasKey: boolean;
    addedAt: Date | null;
    lastUsedAt: Date | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        encryptedOrKey: true,
        orKeyAddedAt: true,
        orKeyLastUsedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      hasKey: !!user.encryptedOrKey,
      addedAt: user.orKeyAddedAt,
      lastUsedAt: user.orKeyLastUsedAt,
    };
  }

  async updateLastUsedAt(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { orKeyLastUsedAt: new Date() },
    });
  }
}
