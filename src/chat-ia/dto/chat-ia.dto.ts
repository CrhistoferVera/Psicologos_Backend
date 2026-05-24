import { IsString, IsArray, IsIn, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'], description: 'Rol del mensaje' })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ description: 'Contenido del mensaje' })
  @IsString()
  content: string;
}

export class ChatRequestDto {
  @ApiProperty({ description: 'Mensaje del usuario' })
  @IsString()
  message: string;

  @ApiProperty({ description: 'ID de sesión para memoria del asistente', required: false })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({ type: [ChatMessageDto], description: 'Historial de la conversación', required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}
