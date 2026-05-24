import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ChatRole = 'paciente' | 'psicologo';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatVideo {
  descripcion: string;
  video: string;
}

export interface ChatResponse {
  mensaje: string;
  imagenes: string[];
  videos: ChatVideo[];
}

@Injectable()
export class ChatIaService {
  private readonly logger = new Logger(ChatIaService.name);
  private readonly webhookUsuario: string;
  private readonly webhookAnfitriona: string;

  constructor(private configService: ConfigService) {
    this.webhookUsuario = this.configService.getOrThrow<string>('N8N_WEBHOOK_PACIENTE');
    this.webhookAnfitriona = this.configService.getOrThrow<string>('N8N_WEBHOOK_PSICOLOGO');
  }

  private readonly TIMEOUT_MS = 30000;

  async sendMessage(role: ChatRole, message: string, history: ChatMessage[], sessionId?: string): Promise<ChatResponse> {
    const url = role === 'paciente' ? this.webhookUsuario : this.webhookAnfitriona;
    const limitedHistory = (history ?? []).slice(-15);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: limitedHistory, sessionId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`n8n webhook error ${response.status}: ${body}`);
        throw new InternalServerErrorException('Error al contactar el asistente');
      }

      const data = await response.json();
      this.logger.log(`n8n response: ${JSON.stringify(data)}`);

      const raw = data.reply ?? data.output ?? data.text ?? data.mensaje ?? '';
      let parsed: ChatResponse;
      try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        parsed = {
          mensaje: obj.mensaje ?? String(raw),
          imagenes: Array.isArray(obj.imagenes)
            ? obj.imagenes.map((img: unknown) =>
                typeof img === 'string' ? img : (img as Record<string, string>).imagen ?? (img as Record<string, string>).url ?? ''
              ).filter(Boolean)
            : [],
          videos: Array.isArray(obj.videos) ? obj.videos : [],
        };
      } catch {
        parsed = { mensaje: String(raw) || 'Sin respuesta', imagenes: [], videos: [] };
      }
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('n8n webhook timeout');
        throw new InternalServerErrorException('El asistente tardó demasiado en responder');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
