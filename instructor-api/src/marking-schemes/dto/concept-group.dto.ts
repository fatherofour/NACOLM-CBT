import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class ConceptGroupDto {
  @IsString()
  @MinLength(1)
  canonicalTerm!: string;

  @IsArray()
  @IsString({ each: true })
  synonyms!: string[]; // additional acceptable terms, on top of canonicalTerm

  // Halves and quarters are common on NACOLM papers.
  @IsNumber()
  @Min(0)
  marks!: number;

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
