import { ApiProperty } from '@nestjs/swagger';

export class AgentRunStepResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() role!: string;
  @ApiProperty({ nullable: true }) output!: string | null;
  @ApiProperty() tokenCount!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: Date;
}

export class AgentRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() teamId!: string;
  @ApiProperty() goal!: string;
  @ApiProperty() model!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) startedAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty({ nullable: true }) errorMessage!: string | null;
  @ApiProperty() totalTokensUsed!: number;
  @ApiProperty({ type: [AgentRunStepResponseDto] })
  steps!: AgentRunStepResponseDto[];
  @ApiProperty() createdAt!: Date;
}

export class AgentRunListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() teamId!: string;
  @ApiProperty() teamName!: string;
  @ApiProperty() goal!: string;
  @ApiProperty() model!: string;
  @ApiProperty() status!: string;
  @ApiProperty() totalTokensUsed!: number;
  @ApiProperty({ nullable: true }) startedAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
