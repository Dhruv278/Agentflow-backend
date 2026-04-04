-- AlterTable
ALTER TABLE "users" ADD COLUMN     "encrypted_or_key" TEXT,
ADD COLUMN     "or_key_added_at" TIMESTAMP(3),
ADD COLUMN     "or_key_last_used_at" TIMESTAMP(3);
