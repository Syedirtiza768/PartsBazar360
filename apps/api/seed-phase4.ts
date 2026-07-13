import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CheckoutService } from './src/modules/checkout/checkout.service';
import { CartService } from './src/modules/cart/cart.service';
import { OrderService } from './src/modules/order/order.service';
import { ReservationService } from './src/modules/inventory/reservation.service';
import { ShippingService } from './src/modules/checkout/shipping.service';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient(adapter as any);

async function main() {
  console.log('Starting Phase 4 seed: Marketplace Commerce...');

  // 1. Setup a Buyer User
  const buyer = await prisma.user.create({
    data: { email: 'buyer@marketplace.local', name: 'John Buyer', role: 'BUYER' }
  });

  // 2. We need two items from potentially two sellers to demonstrate multi-seller cart
  const offers = await prisma.sellerOffer.findMany({
    take: 2,
    include: { inventory: true, canonicalPart: true }
  });

  if (offers.length === 0) {
    console.warn('No offers found to put in the cart. Run earlier seeds.');
    return;
  }

  // Ensure parts have weights for shipping calc
  for (const offer of offers) {
    if (!offer.canonicalPart?.weight) {
      await prisma.canonicalPart.update({
        where: { id: offer.canonicalPartId },
        data: { weight: 5.0 } // default 5kg
      });
    }
  }

  // 3. Initialize Services
  const cartService = new CartService(prisma as any);
  const reservationService = new ReservationService();
  const orderService = new OrderService(prisma as any);
  const shippingService = new ShippingService();
  const checkoutService = new CheckoutService(cartService, reservationService, orderService, shippingService, prisma as any);

  // 4. Create Cart and Add Items
  let cart = await cartService.getOrCreateCart(buyer.id);
  console.log(`Created Cart: ${cart.id}`);

  for (const offer of offers) {
    if (offer.inventory.length > 0 && offer.inventory[0].quantity > 0) {
      await cartService.addItem(cart.id, offer.id, 1);
      console.log(`Added offer ${offer.id} to cart`);
    }
  }

  // 5. Perform Checkout
  const shippingAddress = { line1: '123 Fake Street', city: 'Dubai', country: 'UAE' };
  
  try {
    const checkoutResult = await checkoutService.processCheckout(cart.id, buyer.id, shippingAddress);
    console.log(`\nCheckout Successful!`);
    console.log(`Parent Order ID: ${checkoutResult.order.id}`);
    console.log(`Total Amount (incl Shipping): ${checkoutResult.order.totalAmount} ${checkoutResult.order.currency}`);
    console.log(`Payment Intent Status: ${checkoutResult.paymentIntent.status} via ${checkoutResult.paymentIntent.provider}`);
    console.log(`Seller Orders Split Count: ${checkoutResult.order.sellerOrders.length}`);
  } catch (error) {
    console.error('Checkout failed:', error.message);
  }

  console.log('Phase 4 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
