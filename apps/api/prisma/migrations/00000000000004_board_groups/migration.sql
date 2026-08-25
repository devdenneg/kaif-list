-- CreateTable
CREATE TABLE "BoardGroup" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateIndex
CREATE INDEX "BoardGroup_boardId_order_idx" ON "BoardGroup"("boardId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BoardGroup_boardId_name_key" ON "BoardGroup"("boardId", "name");

-- CreateIndex
CREATE INDEX "BoardGroupMember_userId_idx" ON "BoardGroupMember"("userId");

-- AddForeignKey
ALTER TABLE "BoardGroup" ADD CONSTRAINT "BoardGroup_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGroupMember" ADD CONSTRAINT "BoardGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BoardGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGroupMember" ADD CONSTRAINT "BoardGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

