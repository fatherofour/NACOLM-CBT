import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GenerateSimilarDto {
  @IsString()
  sessionId!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}
