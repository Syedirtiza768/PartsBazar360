import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class RegisterBuyerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

class SendPhoneOtpDto {
  @IsString()
  phone!: string;
}

class VerifyPhoneOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  @MinLength(4)
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  registerBuyer(@Body() body: RegisterBuyerDto) {
    return this.auth.registerBuyer(body);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { user: null };
    return this.auth.me(token).then((user) => ({ user }));
  }

  @Get('verify-email')
  verifyEmail(@Query('token') token: string) {
    return this.auth.verifyEmail(token);
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body.token, body.newPassword);
  }

  @Post('phone/otp/send')
  sendPhoneOtp(@Body() body: SendPhoneOtpDto) {
    return this.auth.sendPhoneOtp(body.phone);
  }

  @Post('phone/otp/verify')
  verifyPhoneOtp(@Body() body: VerifyPhoneOtpDto) {
    return this.auth.verifyPhoneOtp(body.phone, body.code, body.password);
  }
}
