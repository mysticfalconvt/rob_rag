-- CreateTable
CREATE TABLE "LLMRequest" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "userId" TEXT,
    "requestType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "tokensPerSecond" DOUBLE PRECISION NOT NULL,
    "requestPayload" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMCall" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "tokensPerSecond" DOUBLE PRECISION NOT NULL,
    "callPayload" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LLMRequest_conversationId_idx" ON "LLMRequest"("conversationId");

-- CreateIndex
CREATE INDEX "LLMRequest_messageId_idx" ON "LLMRequest"("messageId");

-- CreateIndex
CREATE INDEX "LLMRequest_userId_idx" ON "LLMRequest"("userId");

-- CreateIndex
CREATE INDEX "LLMRequest_requestType_idx" ON "LLMRequest"("requestType");

-- CreateIndex
CREATE INDEX "LLMRequest_model_idx" ON "LLMRequest"("model");

-- CreateIndex
CREATE INDEX "LLMRequest_createdAt_idx" ON "LLMRequest"("createdAt");

-- CreateIndex
CREATE INDEX "LLMCall_requestId_idx" ON "LLMCall"("requestId");

-- CreateIndex
CREATE INDEX "LLMCall_callType_idx" ON "LLMCall"("callType");

-- CreateIndex
CREATE INDEX "LLMCall_model_idx" ON "LLMCall"("model");

-- CreateIndex
CREATE INDEX "LLMCall_createdAt_idx" ON "LLMCall"("createdAt");

-- AddForeignKey
ALTER TABLE "LLMCall" ADD CONSTRAINT "LLMCall_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LLMRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
