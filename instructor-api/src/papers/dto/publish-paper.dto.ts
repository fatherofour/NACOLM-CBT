import { IsBoolean, IsDateString, IsInt, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class PublishPaperDto {
  @IsString()
  sessionId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  // Server-side half of the "type-to-confirm" step — must equal `title`
  // (case-insensitive). Publishing produces a signed artifact the exam
  // centre will trust, so a single accidental click must not be enough.
  @IsString()
  confirmationPhrase!: string;

  // The exam's planned date. Informational only: it doesn't control when
  // candidates can actually sit the exam — that's still the invigilator
  // releasing it at the venue, which runs fully offline with no connection
  // back to this portal's clock. It's here so the date lives on the record
  // you're actually publishing, not scattered across chat or email.
  @IsDateString()
  examDate!: string;

  // Ignored if sent: the controller sets it from the signed-in user.
  @IsOptional()
  @IsString()
  publishedBy!: string;

  // Only meaningful the first time this paper is created — see
  // PapersService.publish. Needed by the venue package (timing, pass/fail),
  // not asked for anywhere earlier in the wizard.
  @IsOptional()
  @IsInt()
  @IsPositive()
  durationMinutes?: number;

  @IsOptional()
  @Min(0)
  passMark?: number;

  // Theory written on QR answer sheets (default) rather than typed at the kiosk.
  @IsOptional()
  @IsBoolean()
  theoryOnPaper?: boolean;
}
