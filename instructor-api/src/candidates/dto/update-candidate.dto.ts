import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCandidateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  rank?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
