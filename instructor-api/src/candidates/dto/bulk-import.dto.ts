import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

class BulkCandidateRow {
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
}

export class BulkImportDto {
  @IsString()
  sessionId!: string;

  // PINs are always auto-generated for a bulk import — there's no sane way
  // to ask an admin to type one per row for a whole class.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkCandidateRow)
  candidates!: BulkCandidateRow[];
}
