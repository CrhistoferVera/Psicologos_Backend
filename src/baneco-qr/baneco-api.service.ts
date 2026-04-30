import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';

const BANECO_TIMEOUT_MS = 12_000;

interface RawResponse {
  status: number;
  body: string;
  contentType: string;
}

function rawRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;

    const opts: https.RequestOptions = {
      method,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      },
    };

    const req = lib.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        const rawCt = res.headers['content-type'] ?? '';
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: rawCt.split(';')[0].trim().toLowerCase(),
        });
      });
    });

    req.setTimeout(BANECO_TIMEOUT_MS, () => {
      req.destroy(new Error(`Baneco timeout after ${BANECO_TIMEOUT_MS}ms`));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export interface GenerateQrParams {
  transactionId: string;
  amount: number;
  currency?: 'BOB' | 'USD';
  description?: string;
  dueDate: string;
  singleUse?: boolean;
  modifyAmount?: boolean;
}

export interface GenerateQrResponse {
  qrId: string;
  qrImage: string;
}

export interface PaymentQR {
  qrId: string;
  transactionId: string;
  paymentDate: string;
  paymentTime: string;
  currency: string;
  amount: number;
  senderBankCode?: string;
  senderName?: string;
  senderDocumentId?: string;
  senderAccount?: string;
}

export interface StatusQrResponse {
  statusQrCode: 0 | 1 | 9;
  payment?: PaymentQR;
}

function mask(value: string, keep = 4): string {
  if (!value) return '(vacio)';
  if (value.length <= keep) return '*'.repeat(value.length);
  return `${value.slice(0, keep)}...(${value.length})`;
}

@Injectable()
export class BanecoApiService {
  private readonly logger = new Logger(BanecoApiService.name);

  private readonly base: string;
  private readonly aesKey: string;
  private readonly username: string;
  private readonly password: string;
  private readonly accountCredit: string;
  private readonly currency: 'BOB' | 'USD';

  private token: string | null = null;
  private tokenLoadedAt = 0;

  constructor(private readonly config: ConfigService) {
    this.base = this.config.get<string>('BANECO_API_BASE') ?? '';
    this.aesKey = this.config.get<string>('BANECO_AES_KEY') ?? '';
    this.username = this.config.get<string>('BANECO_USERNAME') ?? '';
    this.password = this.config.get<string>('BANECO_PASSWORD') ?? '';
    this.accountCredit = this.config.get<string>('BANECO_ACCOUNT_CREDIT') ?? '';
    this.currency = (this.config.get<string>('BANECO_CURRENCY') as 'BOB' | 'USD') ?? 'BOB';

    this.logger.log('=== Baneco config cargada ===');
    this.logger.log(`base: ${this.base || '(vacio)'}`);
    this.logger.log(`username: ${this.username || '(vacio)'}`);
    this.logger.log(`aesKey: ${mask(this.aesKey, 4)} (len=${this.aesKey.length})`);
    this.logger.log(`password: ${this.password ? `(len=${this.password.length})` : '(vacio)'}`);
    this.logger.log(`accountCredit: ${mask(this.accountCredit, 3)}`);
    this.logger.log(`currency: ${this.currency}`);
  }

  private ensureConfig() {
    if (!this.base || !this.aesKey || !this.username || !this.password || !this.accountCredit) {
      this.logger.error(
        `Config incompleta — base:${!!this.base} aesKey:${!!this.aesKey} user:${!!this.username} pass:${!!this.password} account:${!!this.accountCredit}`,
      );
      throw new ServiceUnavailableException('Baneco QR no esta configurado.');
    }
  }

  async encrypt(text: string): Promise<string> {
    this.ensureConfig();
    const url =
      `${this.base}/api/authentication/encrypt` +
      `?text=${encodeURIComponent(text)}&aesKey=${encodeURIComponent(this.aesKey)}`;

    this.logger.log(`[encrypt] GET ${this.base}/api/authentication/encrypt?text=${mask(text, 2)}&aesKey=${mask(this.aesKey, 4)}`);

    let res: RawResponse;
    try {
      res = await rawRequest(url, 'GET', {});
    } catch (err: any) {
      this.logger.error(`[encrypt] error de red: ${err?.message ?? err}`);
      throw new ServiceUnavailableException('Baneco encrypt: error de red.');
    }

    this.logger.log(`[encrypt] status=${res.status} bodyLen=${res.body.length} preview=${mask(res.body, 12)}`);

    if (res.status < 200 || res.status >= 300) {
      this.logger.error(`[encrypt] HTTP ${res.status} body=${res.body}`);
      throw new ServiceUnavailableException('Baneco encrypt fallo.');
    }
    return res.body.trim().replace(/^"|"$/g, '');
  }

  async login(): Promise<string> {
    this.ensureConfig();
    this.logger.log(`[login] iniciando para userName=${this.username}`);

    const encPass = await this.encrypt(this.password);
    this.logger.log(`[login] password cifrada OK (len=${encPass.length}, preview=${mask(encPass, 12)})`);

    const url = `${this.base}/api/authentication/authenticate`;
    const body = { userName: this.username, password: encPass };

    let res: RawResponse;
    try {
      res = await rawRequest(
        url,
        'POST',
        { 'Content-Type': 'application/json' },
        JSON.stringify(body),
      );
    } catch (err: any) {
      this.logger.error(`[login] error de red: ${err?.message ?? err}`);
      throw new ServiceUnavailableException('Baneco login: error de red.');
    }

    const raw = res.body;
    this.logger.log(`[login] status=${res.status} bodyLen=${raw.length}`);
    this.logger.log(`[login] body crudo: ${raw}`);

    let data: { responseCode?: number; message?: string; token?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      this.logger.error('[login] respuesta no es JSON valido');
      throw new ServiceUnavailableException('Baneco login: respuesta invalida.');
    }

    this.logger.log(
      `[login] responseCode=${data.responseCode} message="${data.message ?? ''}" token=${data.token ? 'OK' : 'NO'}`,
    );

    if (data.responseCode !== 0 || !data.token) {
      throw new ServiceUnavailableException(`Baneco login fallo: ${data.message ?? 'sin detalle'}`);
    }
    this.token = data.token;
    this.tokenLoadedAt = Date.now();
    return data.token;
  }

  private async ensureToken(): Promise<string> {
    if (!this.token) return this.login();
    return this.token;
  }

  private async authedCall<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
    opts?: { tolerateError?: boolean },
  ): Promise<T> {
    this.ensureConfig();
    let token = await this.ensureToken();

    const url = `${this.base}${path}`;
    const sendBody = body ? JSON.stringify(body) : undefined;
    const reqId = Math.random().toString(36).slice(2, 9);

    this.logger.log(`[QR][${reqId}] calling path=${path} method=${method}`);

    const exec = async () => {
      const startMs = Date.now();
      let r: RawResponse;
      try {
        r = await rawRequest(
          url,
          method,
          {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          sendBody,
        );
      } catch (netErr: any) {
        const durationMs = Date.now() - startMs;
        this.logger.error(
          `[QR][${reqId}] network/timeout error path=${path} durationMs=${durationMs} err=${netErr?.message ?? netErr}`,
        );
        throw new ServiceUnavailableException(
          'No se pudo generar el QR en este momento. Intenta nuevamente en unos minutos.',
        );
      }

      const durationMs = Date.now() - startMs;
      const isJsonContent =
        r.contentType === '' ||
        r.contentType === 'application/json' ||
        r.contentType.includes('application/json');

      this.logger.log(
        `[QR][${reqId}] Baneco response path=${path} status=${r.status} contentType=${r.contentType || '(none)'} durationMs=${durationMs}`,
      );

      let parsed: any;
      try {
        parsed = JSON.parse(r.body);
      } catch {
        const preview = r.body.slice(0, 500).replace(/[\r\n]+/g, ' ');
        this.logger.error(
          `[QR][${reqId}] Non-JSON response path=${path} status=${r.status} contentType=${r.contentType || '(none)'} preview="${preview}"`,
        );
        this.logger.error(`[QR][${reqId}] failed reason=NON_JSON_RESPONSE path=${path}`);

        // Si tolerateError está activo (ej: cancelQR) devolvemos placeholder sin lanzar
        if (opts?.tolerateError) {
          return {
            res: r,
            data: { responseCode: -1, message: 'NON_JSON_RESPONSE' } as any,
          };
        }

        const providerLabel =
          r.status === 401 || r.status === 403
            ? 'credenciales/permisos'
            : r.status >= 500
              ? 'proveedor caido'
              : r.status === 0
                ? 'timeout'
                : `status=${r.status}`;

        this.logger.error(
          `[QR][${reqId}] failed providerLabel=${providerLabel} path=${path}`,
        );

        throw new ServiceUnavailableException({
          message:
            'No se pudo generar el QR en este momento. Intenta nuevamente en unos minutos.',
          code: 'QR_PROVIDER_NON_JSON_RESPONSE',
          providerStatus: r.status,
          providerLabel,
        });
      }

      // Truncar log para no registrar base64 completo (qrImage puede ser enorme)
      const bodyPreview = JSON.stringify(parsed).slice(0, 300);
      this.logger.log(
        `[QR][${reqId}] parsed path=${path} responseCode=${parsed?.responseCode} bodyPreview=${bodyPreview}`,
      );

      // Advertir si status HTTP no-OK aunque haya JSON
      if (!isJsonContent && r.status >= 400) {
        const preview = r.body.slice(0, 200).replace(/[\r\n]+/g, ' ');
        this.logger.warn(
          `[QR][${reqId}] non-json content-type with status=${r.status} preview="${preview}"`,
        );
      }

      return { res: r, data: parsed as T & { responseCode?: number; message?: string } };
    };

    let { data } = await exec();

    if (data?.responseCode !== 0) {
      const looksLikeAuth =
        data?.responseCode === 401 ||
        /token|autentic|no valid/i.test(String(data?.message ?? ''));

      if (looksLikeAuth) {
        this.logger.warn(
          `[QR][${reqId}] responseCode=${data?.responseCode} msg="${data?.message}", renovando token y reintentando`,
        );
        token = await this.login();
        const retry = await exec();
        data = retry.data;
      }

      if (data?.responseCode !== 0) {
        if (opts?.tolerateError) return data;
        this.logger.error(
          `[QR][${reqId}] failed path=${path} responseCode=${data?.responseCode} msg="${data?.message ?? 'sin detalle'}"`,
        );
        throw new ServiceUnavailableException(
          `Baneco ${path} fallo: ${data?.message ?? 'sin detalle'}`,
        );
      }
    }

    this.logger.log(`[QR][${reqId}] success path=${path}`);
    return data;
  }

  async generateQR(params: GenerateQrParams): Promise<GenerateQrResponse & { responseCode: number }> {
    const accountEnc = await this.encrypt(this.accountCredit);
    return this.authedCall<GenerateQrResponse & { responseCode: number }>(
      '/api/qrsimple/generateQR',
      'POST',
      {
        transactionId: params.transactionId,
        accountCredit: accountEnc,
        currency: params.currency ?? this.currency,
        amount: Number(params.amount.toFixed(2)),
        description: params.description ?? '',
        dueDate: params.dueDate,
        singleUse: params.singleUse ?? true,
        modifyAmount: params.modifyAmount ?? false,
      },
    );
  }

  async statusQR(qrId: string): Promise<StatusQrResponse & { responseCode: number }> {
    return this.authedCall<StatusQrResponse & { responseCode: number }>(
      '/api/qrsimple/statusQR',
      'GET',
      { qrId },
    );
  }

  async cancelQR(qrId: string): Promise<{ responseCode: number; message?: string }> {
    return this.authedCall<{ responseCode: number; message?: string }>(
      '/api/qrsimple/cancelQR',
      'DELETE',
      { qrId },
      { tolerateError: true },
    );
  }
}
