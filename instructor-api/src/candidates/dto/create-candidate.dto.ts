import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCandidateDto {
  @IsString()
  sessionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  armyNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  rank!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  // Left out: a random 6-digit PIN is generated and returned once, the same
  // as an omitted staff password.
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4 to 8 digits' })
  pin?: string;
}
