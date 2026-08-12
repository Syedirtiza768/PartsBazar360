import { SmsGlobalService } from './smsglobal.service';

describe('SmsGlobalService', () => {
  const originalApiKey = process.env.SMSGLOBAL_API_KEY;
  const originalApiSecret = process.env.SMSGLOBAL_API_SECRET;

  beforeEach(() => {
    process.env.SMSGLOBAL_API_KEY = 'test-key';
    process.env.SMSGLOBAL_API_SECRET = 'test-secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.SMSGLOBAL_API_KEY = originalApiKey;
    process.env.SMSGLOBAL_API_SECRET = originalApiSecret;
  });

  it('logs a redacted provider response body for failed sends', async () => {
    const service = new SmsGlobalService();
    const logger = (
      service as unknown as {
        logger: { error: (...args: unknown[]) => unknown };
      }
    ).logger;
    const errorLog = jest.spyOn(logger, 'error');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'x-request-id': 'provider-request-123' }),
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          error: 'invalid_sender',
          message: 'Sender 123456 is not authorized for +971 58 503 8663',
          destination: '+971585038663',
          authorization: 'MAC id=test-key, mac=test-secret',
        }),
      ),
    } as Response);

    await expect(service.sendOtpSms('+971585038663', '123456')).rejects.toThrow(
      'Failed to send SMS verification code',
    );

    const logged = errorLog.mock.calls[0][0] as string;
    expect(logged).toContain('"status":400');
    expect(logged).toContain('invalid_sender');
    expect(logged).toContain('provider-request-123');
    expect(logged).toContain('[REDACTED]');
    expect(logged).not.toContain('123456');
    expect(logged).not.toContain('+971585038663');
    expect(logged).not.toContain('test-secret');
  });

  it('sends an order confirmation without exposing the phone in the message', async () => {
    const service = new SmsGlobalService();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers(),
    } as Response);

    await service.sendOrderConfirmationSms('+971585038663', {
      orderId: 'order-123',
      totalAmount: 250,
      currency: 'AED',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.smsglobal.com/v2/sms/',
      expect.objectContaining({
        body: expect.stringContaining(
          'PartsBazar360: Order order-123 is confirmed. Total AED 250.00',
        ),
      }),
    );
    const requestBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    ) as { messages: Array<{ message: string }> };
    expect(requestBody.messages[0].message).not.toContain('+971585038663');
  });
});
