import { IsString, MinLength } from "class-validator";

export class EditPasswordDto {
    @IsString()
    oldPassword: string;

    @IsString()
    @MinLength(6)
    newPassword: string;
}