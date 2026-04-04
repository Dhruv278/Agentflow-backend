import { Module } from '@nestjs/common';
import { KeyVaultService } from './key-vault.service.js';
import { KeyVaultController } from './key-vault.controller.js';

@Module({
  controllers: [KeyVaultController],
  providers: [KeyVaultService],
  exports: [KeyVaultService],
})
export class KeyVaultModule {}
