import { IsArray, IsBoolean, IsInt, IsString, Min, MinLength } from 'class-validator';

export class ConceptGroupDto {
  @IsString()
  @MinLength(1)
  canonicalTerm!: string;

  @IsArray()
  @IsString({ each: true })
  synonyms!: string[]; // additional acceptable terms, on top of canonicalTerm

  @IsInt()
  @Min(0)
  marks!: number;

  @IsBoolean()
  required!: boolean;
}
