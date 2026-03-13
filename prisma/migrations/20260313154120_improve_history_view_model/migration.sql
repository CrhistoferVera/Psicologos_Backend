-- CreateTable
CREATE TABLE "history_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "history_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "history_views_userId_historyId_key" ON "history_views"("userId", "historyId");

-- AddForeignKey
ALTER TABLE "history_views" ADD CONSTRAINT "history_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_views" ADD CONSTRAINT "history_views_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
