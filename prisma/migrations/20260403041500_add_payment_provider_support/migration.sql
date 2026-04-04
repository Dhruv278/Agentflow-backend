-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'RAZORPAY');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "razorpay_payment_id" TEXT,
ALTER COLUMN "stripe_invoice_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "razorpay_plan_id" TEXT,
ADD COLUMN     "razorpay_subscription_id" TEXT,
ALTER COLUMN "stripe_customer_id" DROP NOT NULL,
ALTER COLUMN "stripe_subscription_id" DROP NOT NULL,
ALTER COLUMN "stripe_price_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "razorpay_customer_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_razorpay_payment_id_key" ON "invoices"("razorpay_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_razorpay_subscription_id_key" ON "subscriptions"("razorpay_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_razorpay_customer_id_key" ON "users"("razorpay_customer_id");
