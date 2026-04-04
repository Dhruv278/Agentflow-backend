import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { KeyVaultService } from './key-vault.service.js';
import { SaveOrKeyDto } from './dto/save-or-key.dto.js';
import { OrKeyStatusResponseDto } from './dto/or-key-status-response.dto.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';

@ApiTags('Settings')
@Controller('settings')
export class KeyVaultController {
  constructor(private readonly keyVaultService: KeyVaultService) {}

  @Patch('or-key')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save or update OpenRouter API key' })
  @ApiResponse({ status: 200, description: 'Key saved successfully' })
  @ApiResponse({ status: 403, description: 'Plan does not allow key storage' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async saveOrKey(@CurrentUser() user: RequestUser, @Body() dto: SaveOrKeyDto) {
    await this.keyVaultService.saveKey(user.id, dto.key);
    return { data: { message: 'OpenRouter key saved successfully' } };
  }

  @Delete('or-key')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove stored OpenRouter API key' })
  @ApiResponse({ status: 204, description: 'Key removed' })
  async deleteOrKey(@CurrentUser() user: RequestUser) {
    await this.keyVaultService.deleteKey(user.id);
  }

  @Get('or-key/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get OpenRouter key status (never returns the key itself)',
  })
  @ApiResponse({ status: 200, type: OrKeyStatusResponseDto })
  async getOrKeyStatus(@CurrentUser() user: RequestUser) {
    const status = await this.keyVaultService.getKeyStatus(user.id);
    return { data: status };
  }
}
