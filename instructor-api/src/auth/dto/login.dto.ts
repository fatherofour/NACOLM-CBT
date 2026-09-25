import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  serviceNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
