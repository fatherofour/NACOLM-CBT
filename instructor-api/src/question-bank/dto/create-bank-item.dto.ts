import { IsArray, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { QuestionSource, QuestionType } from '../../generated/prisma/enums.js';

export class CreateBankItemDto {
  @IsString()
  sessionId!: string;

  @IsString()
  @MinLength(1)
  topic!: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsEnum(QuestionSource)
  source!: QuestionSource;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  correctIndex?: number;

  @IsOptional()
  @IsString()
  citation?: string;

  @IsOptional()
  @IsString()
  citationExcerpt?: string;
}
