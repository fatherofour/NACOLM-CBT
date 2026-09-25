import { IsString, MinLength } from 'class-validator';

export class EnsureSessionDto {
  @IsString()
  @MinLength(1)
  courseCode!: string;

  @IsString()
  @MinLength(1)
  courseName!: string;

  @IsString()
  @MinLength(1)
  sessionLabel!: string;
}
