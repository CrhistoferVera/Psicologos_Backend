import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StripeService } from './stripe.service';

interface JwtUser {
  userId: string;
}

@ApiTags('Stripe')
@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  // El cliente llama este endpoint para iniciar el pago
  // Devuelve el clientSecret que el frontend usa para mostrar el formulario de Stripe
  @Post('create-payment-intent')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear PaymentIntent para comprar un paquete de créditos' })
  createPaymentIntent(
    @CurrentUser() user: JwtUser,
    @Body('packageId') packageId: string,
    @Body('saveCard') saveCard = false,
  ) {
    return this.stripeService.createPaymentIntent(user.userId, packageId, saveCard);
  }

  @Post('package/:packageId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear PaymentIntent para comprar un paquete (por param)' })
  createPaymentIntentByParam(
    @CurrentUser() user: JwtUser,
    @Param('packageId') packageId: string,
  ) {
    return this.stripeService.createPaymentIntent(user.userId, packageId, false);
  }

  @Get('deposit-status/:depositId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Consultar estado de un DepositRequest por ID' })
  async getDepositStatus(
    @CurrentUser() user: JwtUser,
    @Param('depositId') depositId: string,
  ) {
    return this.stripeService.getDepositStatus(user.userId, depositId);
  }

  @Get('payment-methods')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar tarjetas guardadas del usuario' })
  getSavedPaymentMethods(@CurrentUser() user: JwtUser) {
    return this.stripeService.getSavedPaymentMethods(user.userId);
  }

  @Post('ephemeral-key')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generar ephemeral key para el frontend' })
  createEphemeralKey(@CurrentUser() user: JwtUser) {
    return this.stripeService.createEphemeralKey(user.userId);
  }

  // Stripe llama este endpoint automáticamente cuando ocurre un evento
  // NO lleva JWT — Stripe no tiene token, se verifica con la firma del webhook
  @Post('webhook')
  @ApiOperation({ summary: 'Webhook de Stripe — no llamar manualmente' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const event = this.stripeService.constructWebhookEvent(req.rawBody!, signature);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.stripeService.handlePaymentSuccess(
          (event.data.object as { id: string; metadata?: Record<string, string> }).id,
          (event.data.object as { id: string; metadata?: Record<string, string> }).metadata,
        );
        break;
      case 'payment_intent.payment_failed':
        await this.stripeService.handlePaymentFailed(
          (event.data.object as { id: string; metadata?: Record<string, string> }).id,
          (event.data.object as { id: string; metadata?: Record<string, string> }).metadata,
        );
        break;
    }

    return { received: true };
  }
}
