import { PartialType } from '@nestjs/swagger';
import { CreateSessionOfferingDto } from './create-session-offering.dto';

export class UpdateSessionOfferingDto extends PartialType(CreateSessionOfferingDto) {}
