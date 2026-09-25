import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../../generated/prisma/enums.js';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  serviceNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  rank!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  // Left out: a strong one is generated and returned once, the same as the
  // create-user.mjs CLI script does.
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password?: string;
}
