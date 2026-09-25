import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

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
}
