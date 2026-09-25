import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { ConceptGroupDto } from './concept-group.dto.js';

export class SaveMarkingSchemeDto {
  @IsInt()
  @Min(1)
  totalMarks!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  ceilingPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minWordCount?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConceptGroupDto)
  conceptGroups!: ConceptGroupDto[];

  // Marks must sum to totalMarks unless the instructor explicitly
  // acknowledges leaving some unallocated — see the brief's live totals bar.
  @IsOptional()
  @IsBoolean()
  acknowledgeUnallocated?: boolean;
}
