import { IsOptional, IsString, MinLength } from 'class-validator';

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
}
