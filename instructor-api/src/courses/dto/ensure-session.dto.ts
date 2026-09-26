import { IsString, MinLength } from 'class-validator';

export class EnsureSessionDto {
  @IsString()
  @MinLength(1)
  courseId!: string;

  @IsString()
  @MinLength(1)
  sessionLabel!: string;
}
