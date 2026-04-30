import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';

const BANECO_TIMEOUT_MS = 12_000;
const DEFAULT_TOKEN_TTL_MS = 14 * 60 * 1_000;
const TOKEN_EXPIRY_SKEW_MS = 45 * 1_000;

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
  reqId?: string;
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

interface TokenContext {
  token: string;
  source: 'cached' | 'new';
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
  private tokenExpiresAt = 0;
  private loginInFlight: Promise<TokenContext> | null = null;

  constructor(private readonly config: ConfigService) {
    this.base = this.readNormalizedEnv('BANECO_API_BASE');
    this.aesKey = this.readNormalizedEnv('BANECO_AES_KEY');
    this.username = this.readNormalizedEnv('BANECO_USERNAME');
    this.password = this.readNormalizedEnv('BANECO_PASSWORD');
    this.accountCredit = this.readNormalizedEnv('BANECO_ACCOUNT_CREDIT');
    const rawCurrency = this.readNormalizedEnv('BANECO_CURRENCY').toUpperCase();
    this.currency = rawCurrency === 'USD' ? 'USD' : 'BOB';

    this.logEnvDiagnostics();
  }

  private newReqId() {
    return Math.random().toString(36).slice(2, 9);
  }

  private readNormalizedEnv(key: string): string {
    const raw = this.config.get<string>(key) ?? '';
    const trimmed = raw.trim();
    const quoteWrapped =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"));
    const withoutQuotes =
      quoteWrapped && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed;
    return withoutQuotes.replace(/[\r\n]+/g, '');
  }

  private logEnvDiagnostics() {
    const keys = [
      'BANECO_API_BASE',
      'BANECO_AES_KEY',
      'BANECO_USERNAME',
      'BANECO_PASSWORD',
      'BANECO_ACCOUNT_CREDIT',
      'BANECO_CURRENCY',
      'BANECO_USD_TO_BOB',
      'BANECO_QR_TTL_DAYS',
    ] as const;

    this.logger.log('[QR][config] Baneco env diagnostics start');
    for (const key of keys) {
      const raw = this.config.get<string>(key) ?? '';
      const trimmed = raw.trim();
      const quoteWrapped =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"));
      const hasNewLines = /[\r\n]/.test(raw);
      const changedByTrim = raw !== trimmed;
      this.logger.log(
        `[QR][config] ${key} present=${raw.length > 0 ? 'yes' : 'no'} len=${trimmed.length} trimChanged=${changedByTrim ? 'yes' : 'no'} quoteWrapped=${quoteWrapped ? 'yes' : 'no'} multiline=${hasNewLines ? 'yes' : 'no'}`,
      );
    }

    let baseHost = '(invalid-url)';
    try {
      baseHost = this.base ? new URL(this.base).host : '(empty)';
    } catch {
      baseHost = '(invalid-url)';
    }
    this.logger.log(
      `[QR][config] BANECO_API_BASE host=${baseHost} envGuess=${this.base.includes('apimkt') ? 'test/sandbox' : 'unknown-or-prod'}`,
    );
  }

  private ensureConfig() {
    if (!this.base || !this.aesKey || !this.username || !this.password || !this.accountCredit) {
      this.logger.error(
        `[QR][config] Config incompleta base=${!!this.base} aesKey=${!!this.aesKey} user=${!!this.username} pass=${!!this.password} account=${!!this.accountCredit}`,
      );
      throw new ServiceUnavailableException('Baneco QR no esta configurado.');
    }
  }

  async encrypt(text: string): Promise<string> {
    this.ensureConfig();
    const url =
      `${this.base}/api/authentication/encrypt` +
      `?text=${encodeURIComponent(text)}&aesKey=${encodeURIComponent(this.aesKey)}`;

    this.logger.log(
      `[QR][encrypt] endpoint=/api/authentication/encrypt textLen=${text.length} aesKeyLen=${this.aesKey.length}`,
    );

    let res: RawResponse;
    try {
      res = await rawRequest(url, 'GET', {});
    } catch (err: any) {
      this.logger.error(`[QR][encrypt] networkError=${err?.message ?? err}`);
      throw new ServiceUnavailableException('Baneco encrypt: error de red.');
    }

    this.logger.log(
      `[QR][encrypt] status=${res.status} contentType=${res.contentType || '(none)'} bodyLen=${res.body.length}`,
    );

    if (res.status < 200 || res.status >= 300) {
      this.logger.error(`[QR][encrypt] HTTP ${res.status}`);
      throw new ServiceUnavailableException('Baneco encrypt fallo.');
    }
    return res.body.trim().replace(/^"|"$/g, '');
  }

  private getTokenExpiryFromLogin(data: any): number | null {
    const now = Date.now();
    const absoluteCandidates = [
      data?.expiresAt,
      data?.expireAt,
      data?.expirationDate,
      data?.tokenExpiration,
    ];

    for (const value of absoluteCandidates) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms > now) return ms;
    }

    const ttlCandidates = [data?.expiresIn, data?.expireIn, data?.expiresInSeconds];
    for (const value of ttlCandidates) {
      const ttl = Number(value);
      if (Number.isFinite(ttl) && ttl > 0) {
        return now + ttl * 1_000;
      }
    }

    return null;
  }

  private invalidateToken(reqId: string, reason: string) {
    const hadToken = !!this.token;
    this.token = null;
    this.tokenLoadedAt = 0;
    this.tokenExpiresAt = 0;
    this.logger.warn(
      `[QR][${reqId}] Baneco token invalidated reason=${reason} hadToken=${hadToken ? 'yes' : 'no'}`,
    );
  }

  private async login(reqId: string): Promise<TokenContext> {
    this.ensureConfig();
    const authPath = '/api/authentication/authenticate';
    this.logger.log(`[QR][${reqId}] Baneco auth start endpoint=${authPath}`);

    const encPass = await this.encrypt(this.password);
    this.logger.log(
      `[QR][${reqId}] Baneco auth encryptedPassword=yes encryptedPasswordLen=${encPass.length}`,
    );

    const url = `${this.base}${authPath}`;
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
      this.logger.error(`[QR][${reqId}] Baneco auth networkError=${err?.message ?? err}`);
      throw new ServiceUnavailableException('Baneco login: error de red.');
    }

    this.logger.log(
      `[QR][${reqId}] Baneco auth response status=${res.status} contentType=${res.contentType || '(none)'} bodyLen=${res.body.length}`,
    );

    if (res.status === 401 || res.status === 403) {
      this.logger.error(`[QR][${reqId}] Baneco auth unauthorized status=${res.status}`);
      throw new ServiceUnavailableException({
        message: 'No se pudo generar el QR en este momento. Intenta nuevamente en unos minutos.',
        code: 'QR_PROVIDER_UNAUTHORIZED',
        providerStatus: res.status,
        providerLabel: 'credenciales/permisos',
      });
    }

    let data: { responseCode?: number; message?: string; token?: string };
    try {
      data = JSON.parse(res.body);
    } catch {
      this.logger.error(`[QR][${reqId}] Baneco auth invalid JSON response`);
      throw new ServiceUnavailableException('Baneco login: respuesta invalida.');
    }

    const expiry = this.getTokenExpiryFromLogin(data);
    this.logger.log(
      `[QR][${reqId}] Baneco auth parsed responseCode=${data.responseCode} token=${data.token ? 'yes' : 'no'} tokenLen=${data.token?.length ?? 0} expiry=${expiry ? new Date(expiry).toISOString() : `default_${DEFAULT_TOKEN_TTL_MS}ms`}`,
    );

    if (data.responseCode !== 0 || !data.token) {
      this.logger.error(
        `[QR][${reqId}] Baneco auth failed responseCode=${data.responseCode} message="${data.message ?? 'sin detalle'}"`,
      );
      throw new ServiceUnavailableException(`Baneco login fallo: ${data.message ?? 'sin detalle'}`);
    }

    const now = Date.now();
    this.token = data.token;
    this.tokenLoadedAt = now;
    this.tokenExpiresAt = expiry ?? now + DEFAULT_TOKEN_TTL_MS;
    return { token: data.token, source: 'new' };
  }

  private isTokenValid() {
    if (!this.token) return false;
    return this.tokenExpiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now();
  }

  private async ensureToken(reqId: string): Promise<TokenContext> {
    if (this.isTokenValid()) {
      const ageMs = Date.now() - this.tokenLoadedAt;
      const remainingMs = this.tokenExpiresAt - Date.now();
      this.logger.log(
        `[QR][${reqId}] using cached Baneco token ageMs=${ageMs} remainingMs=${remainingMs}`,
      );
      return { token: this.token!, source: 'cached' };
    }

    if (this.loginInFlight) {
      this.logger.log(`[QR][${reqId}] waiting in-flight Baneco auth`);
      return this.loginInFlight;
    }

    this.loginInFlight = this.login(reqId).finally(() => {
      this.loginInFlight = null;
    });

    return this.loginInFlight;
  }

  private unauthorizedException(
    reqId: string,
    path: string,
    status: number,
  ): ServiceUnavailableException {
    this.logger.error(`[QR][${reqId}] failed reason=QR_PROVIDER_UNAUTHORIZED path=${path}`);
    this.logger.error(`[QR][${reqId}] failed providerLabel=credenciales/permisos path=${path}`);
    return new ServiceUnavailableException({
      message: 'No se pudo generar el QR en este momento. Intenta nuevamente en unos minutos.',
      code: 'QR_PROVIDER_UNAUTHORIZED',
      providerStatus: status,
      providerLabel: 'credenciales/permisos',
    });
  }

  private nonJsonException(
    reqId: string,
    path: string,
    status: number,
    contentType: string,
    body: string,
  ): ServiceUnavailableException {
    const preview = body.slice(0, 500).replace(/[\r\n]+/g, ' ');
    this.logger.error(
      `[QR][${reqId}] Non-JSON response path=${path} status=${status} contentType=${contentType || '(none)'} preview="${preview}"`,
    );
    this.logger.error(`[QR][${reqId}] failed reason=NON_JSON_RESPONSE path=${path}`);

    const providerLabel =
      status >= 500 ? 'proveedor caido' : status === 0 ? 'timeout' : `status=${status}`;

    this.logger.error(`[QR][${reqId}] failed providerLabel=${providerLabel} path=${path}`);
    return new ServiceUnavailableException({
      message: 'No se pudo generar el QR en este momento. Intenta nuevamente en unos minutos.',
      code: 'QR_PROVIDER_NON_JSON_RESPONSE',
      providerStatus: status,
      providerLabel,
    });
  }

  private async authedCall<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
    opts?: { tolerateError?: boolean; reqId?: string; retryUnauthorizedOnce?: boolean },
  ): Promise<T> {
    this.ensureConfig();

    const reqId = opts?.reqId ?? this.newReqId();
    const retryUnauthorizedOnce = opts?.retryUnauthorizedOnce ?? true;

    let token = await this.ensureToken(reqId);
    const url = `${this.base}${path}`;
    const sendBody = body ? JSON.stringify(body) : undefined;

    this.logger.log(`[QR][${reqId}] calling path=${path} method=${method} tokenSource=${token.source}`);

    const exec = async (
      tokenCtx: TokenContext,
      attempt: 1 | 2,
    ): Promise<{ kind: 'success'; data: T; status: number } | { kind: 'unauthorized'; status: number }> => {
      const startMs = Date.now();
      let r: RawResponse;

      try {
        this.logger.log(
          `[QR][${reqId}] sending path=${path} attempt=${attempt} authorizationHeader=yes authType=Bearer tokenSource=${tokenCtx.source}`,
        );

        r = await rawRequest(
          url,
          method,
          {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenCtx.token}`,
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
      this.logger.log(
        `[QR][${reqId}] Baneco response path=${path} attempt=${attempt} status=${r.status} contentType=${r.contentType || '(none)'} durationMs=${durationMs}`,
      );

      if (r.status === 401 || r.status === 403) {
        this.logger.error(
          `[QR][${reqId}] unauthorized response path=${path} status=${r.status} contentType=${r.contentType || '(none)'}`,
        );
        return { kind: 'unauthorized', status: r.status };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(r.body);
      } catch {
        if (opts?.tolerateError) {
          return {
            kind: 'success',
            data: { responseCode: -1, message: 'NON_JSON_RESPONSE' } as T,
            status: r.status,
          };
        }

        throw this.nonJsonException(reqId, path, r.status, r.contentType, r.body);
      }

      const bodyPreview = JSON.stringify(parsed).slice(0, 300);
      this.logger.log(
        `[QR][${reqId}] parsed path=${path} responseCode=${parsed?.responseCode} bodyPreview=${bodyPreview}`,
      );

      if (parsed?.responseCode !== 0) {
        const looksLikeAuth =
          parsed?.responseCode === 401 ||
          /token|autentic|credencial|no valid|unauthor/i.test(String(parsed?.message ?? ''));

        if (looksLikeAuth) {
          return { kind: 'unauthorized', status: r.status || 401 };
        }

        if (opts?.tolerateError) {
          return { kind: 'success', data: parsed as T, status: r.status };
        }

        this.logger.error(
          `[QR][${reqId}] failed path=${path} responseCode=${parsed?.responseCode} msg="${parsed?.message ?? 'sin detalle'}"`,
        );
        throw new ServiceUnavailableException(`Baneco ${path} fallo: ${parsed?.message ?? 'sin detalle'}`);
      }

      return { kind: 'success', data: parsed as T, status: r.status };
    };

    let result = await exec(token, 1);

    if (result.kind === 'unauthorized') {
      if (!retryUnauthorizedOnce) {
        throw this.unauthorizedException(reqId, path, result.status);
      }

      this.logger.warn(
        `[QR][${reqId}] ${path === '/api/qrsimple/generateQR' ? 'generateQR' : path} 401, refreshing Baneco token and retrying once`,
      );

      this.invalidateToken(reqId, `unauthorized_status_${result.status}`);
      token = await this.ensureToken(reqId);
      result = await exec(token, 2);
      this.logger.log(`[QR][${reqId}] retry result status=${result.status} path=${path}`);

      if (result.kind === 'unauthorized') {
        throw this.unauthorizedException(reqId, path, result.status);
      }
    }

    this.logger.log(`[QR][${reqId}] success path=${path}`);
    return result.data;
  }

  async generateQR(params: GenerateQrParams): Promise<GenerateQrResponse & { responseCode: number }> {
    const reqId = params.reqId ?? this.newReqId();
    const accountEnc = await this.encrypt(this.accountCredit);

    this.logger.log(
      `[QR][${reqId}] generateQR payload transactionId=${params.transactionId} amount=${Number(params.amount.toFixed(2))} currency=${params.currency ?? this.currency} accountCreditEncryptedLen=${accountEnc.length} dueDate=${params.dueDate} singleUse=${params.singleUse ?? true} modifyAmount=${params.modifyAmount ?? false}`,
    );

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
      { reqId, retryUnauthorizedOnce: true },
    );
  }

  async statusQR(qrId: string, reqId?: string): Promise<StatusQrResponse & { responseCode: number }> {
    return this.authedCall<StatusQrResponse & { responseCode: number }>(
      '/api/qrsimple/statusQR',
      'GET',
      { qrId },
      { reqId },
    );
  }

  async cancelQR(qrId: string, reqId?: string): Promise<{ responseCode: number; message?: string }> {
    return this.authedCall<{ responseCode: number; message?: string }>(
      '/api/qrsimple/cancelQR',
      'DELETE',
      { qrId },
      { tolerateError: true, reqId },
    );
  }
}
