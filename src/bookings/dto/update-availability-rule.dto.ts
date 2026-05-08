import { PartialType } from '@nestjs/swagger';
import { CreateAvailabilityRuleDto } from './create-availability-rule.dto';

export class UpdateAvailabilityRuleDto extends PartialType(CreateAvailabilityRuleDto) {}
