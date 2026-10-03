import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { ConceptGroupDto } from './concept-group.dto.js';

export class SampleAnswerDto {
  @IsString()
  @MaxLength(20)
  label!: string;

  @IsString()
  @MaxLength(2000)
  text!: string;
}

export class SaveMarkingSchemeDto {
  @IsNumber()
  @Min(0.5)
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

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  modelAnswer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  partialCreditNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  zeroCreditNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SampleAnswerDto)
  sampleAnswers?: SampleAnswerDto[];

  // Marks must sum to totalMarks unless the instructor explicitly
  // acknowledges leaving some unallocated — see the brief's live totals bar.
  @IsOptional()
  @IsBoolean()
  acknowledgeUnallocated?: boolean;
}
