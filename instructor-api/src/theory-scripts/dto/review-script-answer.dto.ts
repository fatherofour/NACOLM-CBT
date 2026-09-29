import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ReviewScriptAnswerDto {
  @IsNumber()
  @Min(0)
  score!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
