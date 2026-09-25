import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SESSION_COOKIE, readCookie } from './auth.service.js';
import { CurrentUser, Public, type SessionUser } from './decorators.js';
import { LoginDto } from './dto/login.dto.js';

const secureCookies = () => process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt, user } = await this.auth.login(dto.serviceNumber, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(),
      path: '/',
      expires: expiresAt,
    });
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req.headers.cookie, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { signedOut: true };
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { user };
  }
}
