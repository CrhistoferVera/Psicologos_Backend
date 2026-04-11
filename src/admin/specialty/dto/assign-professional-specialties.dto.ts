import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class AssignProfessionalSpecialtiesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  specialtyIds: string[];
}
