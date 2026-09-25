import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class DifficultyTargetsDto {
  @IsInt()
  @Min(0)
  easy!: number;

  // Shown as "Moderate" in the portal; stored as "medium" to match QuestionBankItem.difficulty.
  @IsInt()
  @Min(0)
  medium!: number;

  @IsInt()
  @Min(0)
  hard!: number;
}

export class CreateBlueprintDto {
  @IsString()
  sessionId!: string;

  @IsIn(['past_only', 'study_material_only', 'both'])
  sourceMode!: 'past_only' | 'study_material_only' | 'both';

  @IsOptional()
  @Min(0)
  pastQuestionRatio?: number;

  @IsInt()
  @Min(1)
  totalCount!: number;

  @IsInt()
  @Min(0)
  objectiveCount!: number;

  @IsInt()
  @Min(0)
  theoryCount!: number;

  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  topics!: string[];

  // Past-paper sessions (years) to draw bank questions from. Empty or absent:
  // only this session's own bank.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pastSessionIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DifficultyTargetsDto)
  difficultyTargets?: DifficultyTargetsDto;

  @IsOptional()
  @IsIn(['instant', 'hold'])
  resultsRelease?: 'instant' | 'hold';
}
