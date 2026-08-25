-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOARD_MEMBER_JOINED';

-- CreateTable
CREATE TABLE "BoardInvite" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "BoardRole" NOT NULL DEFAULT 'MEMBER',
    "createdById" TEXT NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardInvite_token_key" ON "BoardInvite"("token");

-- CreateIndex
CREATE INDEX "BoardInvite_boardId_revokedAt_idx" ON "BoardInvite"("boardId", "revokedAt");

-- AddForeignKey
ALTER TABLE "BoardInvite" ADD CONSTRAINT "BoardInvite_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardInvite" ADD CONSTRAINT "BoardInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

