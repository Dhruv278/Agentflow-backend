import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { OpenRouterService } from '../openrouter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KeyVaultService } from '../../key-vault/key-vault.service';

describe('OpenRouterService', () => {
  let service: OpenRouterService;
  let prisma: Record<string, any>;
  let keyVault: Record<string, any>;
  let configService: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      agent: { findUnique: jest.fn() },
      agentLibraryItem: { findUnique: jest.fn() },
    };

    keyVault = { getDecryptedKey: jest.fn() };

    configService = {
      get: jest.fn((key: string, defaultVal?: string) => {
        const map: Record<string, string> = {
          OPENROUTER_PLATFORM_KEY: 'sk-or-platform-test-key',
          APP_URL: 'http://localhost:3000',
        };
        return map[key] ?? defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenRouterService,
        { provide: PrismaService, useValue: prisma },
        { provide: KeyVaultService, useValue: keyVault },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(OpenRouterService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('validateModelForUser', () => {
    it('should allow any model when user has own key', () => {
      expect(() =>
        service.validateModelForUser('any-vendor/any-model-xyz', 'FREE', true),
      ).not.toThrow();
    });

    it('should allow registry model on FREE without own key', () => {
      expect(() =>
        service.validateModelForUser(
          'mistralai/mistral-small-3.1-24b-instruct',
          'FREE',
          false,
        ),
      ).not.toThrow();
    });

    it('should block non-registry model on FREE without own key', () => {
      expect(() =>
        service.validateModelForUser('openai/gpt-4o', 'FREE', false),
      ).toThrow(ForbiddenException);
    });

    it('should allow gpt-4o on PRO without own key', () => {
      expect(() =>
        service.validateModelForUser('openai/gpt-4o', 'PRO', false),
      ).not.toThrow();
    });

    it('should block unknown model on PRO without own key', () => {
      expect(() =>
        service.validateModelForUser('unknown/model-xyz', 'PRO', false),
      ).toThrow(ForbiddenException);
    });

    it('should allow unknown model on PRO WITH own key', () => {
      expect(() =>
        service.validateModelForUser('unknown/model-xyz', 'PRO', true),
      ).not.toThrow();
    });
  });

  describe('resolveApiKey', () => {
    it('should return own key + hasOwnKey:true for BYOK user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        plan: 'BYOK',
        encryptedOrKey: 'enc',
      });
      keyVault.getDecryptedKey.mockResolvedValue('sk-or-user-key');

      const result = await service.resolveApiKey('user-1');
      expect(result).toEqual({ apiKey: 'sk-or-user-key', hasOwnKey: true });
    });

    it('should return own key + hasOwnKey:true for PRO user with key', async () => {
      prisma.user.findUnique.mockResolvedValue({
        plan: 'PRO',
        encryptedOrKey: 'enc',
      });
      keyVault.getDecryptedKey.mockResolvedValue('sk-or-user-key');

      const result = await service.resolveApiKey('user-1');
      expect(result).toEqual({ apiKey: 'sk-or-user-key', hasOwnKey: true });
    });

    it('should return platform key + hasOwnKey:false for PRO without key', async () => {
      prisma.user.findUnique.mockResolvedValue({
        plan: 'PRO',
        encryptedOrKey: null,
      });

      const result = await service.resolveApiKey('user-1');
      expect(result).toEqual({
        apiKey: 'sk-or-platform-test-key',
        hasOwnKey: false,
      });
    });

    it('should return platform key + hasOwnKey:false for FREE user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        plan: 'FREE',
        encryptedOrKey: null,
      });

      const result = await service.resolveApiKey('user-1');
      expect(result).toEqual({
        apiKey: 'sk-or-platform-test-key',
        hasOwnKey: false,
      });
    });

    it('should throw for BYOK user without key', async () => {
      prisma.user.findUnique.mockResolvedValue({
        plan: 'BYOK',
        encryptedOrKey: null,
      });
      keyVault.getDecryptedKey.mockResolvedValue(null);

      await expect(service.resolveApiKey('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resolveApiKey('nonexistent')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('userHasOwnKey', () => {
    it('should return true when user has encrypted key', async () => {
      prisma.user.findUnique.mockResolvedValue({
        encryptedOrKey: 'some-encrypted-data',
      });
      expect(await service.userHasOwnKey('user-1')).toBe(true);
    });

    it('should return false when user has no key', async () => {
      prisma.user.findUnique.mockResolvedValue({ encryptedOrKey: null });
      expect(await service.userHasOwnKey('user-1')).toBe(false);
    });
  });

  describe('getMaxTokensForPlan', () => {
    it('should return 2048 for FREE', () => {
      expect(service.getMaxTokensForPlan('FREE')).toBe(2048);
    });

    it('should return 4096 for PRO', () => {
      expect(service.getMaxTokensForPlan('PRO')).toBe(4096);
    });

    it('should return 8192 for BYOK', () => {
      expect(service.getMaxTokensForPlan('BYOK')).toBe(8192);
    });
  });
});
