-- AlterTable
ALTER TABLE "agent_teams" ADD COLUMN     "canvas_layout" JSONB,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_template" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "library_item_id" UUID,
ALTER COLUMN "order" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "agent_library_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_library_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_connections" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "from_agent_id" UUID NOT NULL,
    "to_agent_id" UUID NOT NULL,
    "input_key" TEXT NOT NULL DEFAULT 'output',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_library_items_category_idx" ON "agent_library_items"("category");

-- CreateIndex
CREATE INDEX "agent_library_items_is_public_idx" ON "agent_library_items"("is_public");

-- CreateIndex
CREATE INDEX "agent_library_items_created_by_user_id_idx" ON "agent_library_items"("created_by_user_id");

-- CreateIndex
CREATE INDEX "agent_connections_team_id_idx" ON "agent_connections"("team_id");

-- CreateIndex
CREATE INDEX "agent_connections_from_agent_id_idx" ON "agent_connections"("from_agent_id");

-- CreateIndex
CREATE INDEX "agent_connections_to_agent_id_idx" ON "agent_connections"("to_agent_id");

-- CreateIndex
CREATE INDEX "agent_teams_is_template_idx" ON "agent_teams"("is_template");

-- CreateIndex
CREATE INDEX "agent_teams_category_idx" ON "agent_teams"("category");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_library_item_id_fkey" FOREIGN KEY ("library_item_id") REFERENCES "agent_library_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_library_items" ADD CONSTRAINT "agent_library_items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "agent_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_from_agent_id_fkey" FOREIGN KEY ("from_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_to_agent_id_fkey" FOREIGN KEY ("to_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
