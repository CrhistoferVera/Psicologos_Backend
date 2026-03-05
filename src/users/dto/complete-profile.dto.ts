import { IsEnum, IsOptional, IsString } from "class-validator";
import { Country } from "./create-user.dto";

export class CompleteProfileDto {

    @IsString()
    password: string;
    @IsOptional()
    @IsString()
    phoneNumber?: string;
    @IsEnum(Country)
    country: Country;
}