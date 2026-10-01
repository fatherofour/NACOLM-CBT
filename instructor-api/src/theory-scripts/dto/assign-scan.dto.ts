import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AssignScanDto {
  @IsString()
  candidateId!: string;

  @IsString()
  questionId!: string;

  /** Add as the next page of the existing answer instead of replacing it. */
  @IsOptional()
  @IsBoolean()
  append?: boolean;
}
