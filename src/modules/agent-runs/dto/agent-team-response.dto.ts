import { ApiProperty } from '@nestjs/swagger';

export class AgentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() role!: string;
  @ApiProperty() systemPrompt!: string;
  @ApiProperty() order!: number;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class AgentTeamResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() goal!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ type: [AgentResponseDto] }) agents!: AgentResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AgentTeamListResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() goal!: string;
  @ApiProperty() model!: string;
  @ApiProperty() agentCount!: number;
  @ApiProperty({ nullable: true }) lastRunAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
