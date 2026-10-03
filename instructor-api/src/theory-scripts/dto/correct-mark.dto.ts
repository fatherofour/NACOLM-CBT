import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class CorrectMarkDto {
  @IsNumber()
  @Min(0)
  score!: number;

  @IsString()
  @MinLength(5)
  reason!: string;
}
