import { IsString, MinLength } from 'class-validator';

export class RejectQuestionDto {
  // Required by the brief: rejections feed back into what to avoid next
  // time, even without AI involvement in marking.
  @IsString()
  @MinLength(3)
  reason!: string;
}
