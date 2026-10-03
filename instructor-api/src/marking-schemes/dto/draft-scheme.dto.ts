import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class DraftSchemeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  modelAnswer!: string;

  @IsNumber()
  @Min(0.5)
  totalMarks!: number;
}
