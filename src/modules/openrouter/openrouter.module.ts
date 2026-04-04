import { Module } from '@nestjs/common';
import { OpenRouterService } from './openrouter.service.js';
import { KeyVaultModule } from '../key-vault/key-vault.module.js';

@Module({
  imports: [KeyVaultModule],
  providers: [OpenRouterService],
  exports: [OpenRouterService],
})
export class OpenRouterModule {}
