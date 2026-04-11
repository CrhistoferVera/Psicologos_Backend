import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baseUrl: string | null;
  private readonly instance: string | null;
  private readonly apiKey: string | null;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('EVOLUTION_API_URL') ?? null;
    this.instance = this.configService.get<string>('EVOLUTION_API_INSTANCE') ?? null;
    this.apiKey = this.configService.get<string>('EVOLUTION_API_KEY') ?? null;

    this.enabled = Boolean(this.baseUrl && this.instance && this.apiKey);
    if (!this.enabled) {
      this.logger.warn(
        'WhatsApp deshabilitado: faltan EVOLUTION_API_URL/EVOLUTION_API_INSTANCE/EVOLUTION_API_KEY.',
      );
    }
  }

  async sendText(phoneNumber: string, text: string): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`WhatsApp omitido para ${phoneNumber}: servicio no configurado.`);
      return;
    }

    const baseUrl = this.baseUrl!;
    const instance = this.instance!;
    const apiKey = this.apiKey!;
    const url = `${baseUrl}/message/sendText/${instance}`;

    // Evolution API expects the number without "+" but with country code
    const number = phoneNumber.replace(/^\+/, '');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
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
