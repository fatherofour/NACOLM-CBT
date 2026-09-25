import { IsInt, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class FreezePaperDto {
  @IsString()
  sessionId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  // Server-side half of the "type-to-confirm" step — must equal `title`
  // (case-insensitive). Freezing produces a signed artifact the exam centre
  // will trust, so a single accidental click must not be enough.
  @IsString()
  confirmationPhrase!: string;

  // Ignored if sent: the controller sets it from the signed-in user.
  @IsOptional()
  @IsString()
  frozenBy!: string;

  // Only meaningful the first time this paper is created — see
  // PapersService.freeze. Needed by the venue package (timing, pass/fail),
  // not asked for anywhere earlier in the wizard.
  @IsOptional()
  @IsInt()
  @IsPositive()
  durationMinutes?: number;

  @IsOptional()
  @Min(0)
  passMark?: number;
}
