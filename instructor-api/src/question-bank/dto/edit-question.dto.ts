import { IsArray, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class EditQuestionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  correctIndex?: number;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  difficulty?: string;
}
