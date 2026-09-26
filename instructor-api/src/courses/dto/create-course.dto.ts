import { IsString, Matches, MinLength } from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 /-]{0,19}$/, { message: 'Course code must be 1-20 characters: letters, numbers, spaces, / or -' })
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
