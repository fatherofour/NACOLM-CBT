import { IsString, MinLength } from 'class-validator';

export class UpdateCourseDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
