import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { ConceptGroupDto } from './concept-group.dto.js';

class InlineSchemeDto {
  @IsNumber()
  @Min(0.5)
  totalMarks!: number;

  @IsInt()
  @Min(0)
  ceilingPercent!: number;

  @IsInt()
  @Min(0)
  minWordCount!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConceptGroupDto)
  conceptGroups!: ConceptGroupDto[];
}

// Stateless: scores an answer against a scheme definition supplied inline,
// so the "test your scheme" box works on the instructor's in-progress draft
// without requiring a save first.
export class TestSchemeDto {
  @IsString()
  @MinLength(1)
  answer!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InlineSchemeDto)
  scheme?: InlineSchemeDto;
}
