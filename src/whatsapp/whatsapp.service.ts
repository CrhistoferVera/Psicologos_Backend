import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baseUrl: string;
  private readonly instance: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.getOrThrow<string>('EVOLUTION_API_URL');
    this.instance = this.configService.getOrThrow<string>('EVOLUTION_API_INSTANCE');
    this.apiKey = this.configService.getOrThrow<string>('EVOLUTION_API_KEY');
  }

  async sendText(phoneNumber: string, text: string): Promise<void> {
    const url = `${this.baseUrl}/message/sendText/${this.instance}`;

    // Evolution API expects the number without "+" but with country code
    const number = phoneNumber.replace(/^\+/, '');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify({ number, text }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Evolution API error ${response.status}: ${body}`);
      throw new InternalServerErrorException('Error al enviar mensaje de WhatsApp');
    }

    this.logger.log(`WhatsApp enviado a ${number}`);
  }
}
