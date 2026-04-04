import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { AdminService } from './admin.service.js';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminGuard: AdminGuard,
  ) {}

  @Get('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if current user is admin' })
  async checkAdmin(@Req() req: Request) {
    try {
      const context = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as import('@nestjs/common').ExecutionContext;
      this.adminGuard.canActivate(context);
      return { data: { isAdmin: true } };
    } catch {
      return { data: { isAdmin: false } };
    }
  }

  @Get('stats')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get platform dashboard stats' })
  async getStats() {
    const stats = await this.adminService.getDashboardStats();
    return { data: stats };
  }

  @Get('users')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all users with usage info' })
  async getUsers(@Query('page') page?: string, @Query('limit') limit?: string) {
    const result = await this.adminService.getUsers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
    return {
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      },
    };
  }

  @Get('agents')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all library agents WITH system prompts' })
  async getAgents() {
    const agents = await this.adminService.getLibraryAgents();
    return { data: agents };
  }

  @Patch('agents/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a library agent (name, prompt, etc.)' })
  async updateAgent(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      category?: string;
      role?: string;
    },
  ) {
    const agent = await this.adminService.updateLibraryAgent(
      id,
      body as Parameters<typeof this.adminService.updateLibraryAgent>[1],
    );
    return { data: agent };
  }

  @Get('templates')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all templates with agents and connections' })
  async getTemplates() {
    const templates = await this.adminService.getTemplates();
    return { data: templates };
  }

  @Patch('templates/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a template (name, goal, model, etc.)' })
  async updateTemplate(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      goal?: string;
      model?: string;
      category?: string;
    },
  ) {
    const template = await this.adminService.updateTemplate(id, body);
    return { data: template };
  }

  @Get('runs')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get recent runs across all users' })
  async getRecentRuns(@Query('limit') limit?: string) {
    const runs = await this.adminService.getRecentRuns(
      limit ? parseInt(limit, 10) : 20,
    );
    return { data: runs };
  }

  @Get('credits')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get API credit balances (OpenRouter, OpenAI)' })
  async getCredits() {
    const credits = await this.adminService.getApiCredits();
    return { data: credits };
  }
}
