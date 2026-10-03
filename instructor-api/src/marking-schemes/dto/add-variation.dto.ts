import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddVariationDto {
  @IsString()
  @MinLength(1)
  canonicalTerm!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  phrase!: string;
}
