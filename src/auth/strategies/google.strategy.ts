import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(config: ConfigService) {
        super({
            clientID: config.get('GOOGLE_CLIENT_ID') as string,
            clientSecret: config.get('GOOGLE_CLIENT_SECRET') as string,
            callbackURL: config.get('GOOGLE_REDIRECT_URI') as string,
            scope: ['email', 'profile'], // Qué datos pedimos
        });
    } 

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: any,
        done: VerifyCallback,
    ): Promise<any> {
        const { name, emails, photos } = profile;

        // Armamos un objeto de usuario temporal con lo que nos dio Google
        const user = {
            email: emails[0].value,
            firstName: name.givenName,
            lastName: name.familyName,
            picture: photos[0].value,
            accessToken,
        };

        done(null, user);
    }
}