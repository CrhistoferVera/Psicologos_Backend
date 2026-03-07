import { IsString, IsNotEmpty } from "class-validator";

export class EditPhoneNumberDto {
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;
}